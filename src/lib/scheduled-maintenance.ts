import { and, count, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import { accountDeletionJobs, mediaDeletionOutbox } from "@/db/schema";
import {
  processDueAccountRawIdErasures,
  type ProcessAccountRawIdErasuresResult,
} from "@/lib/account-privacy-atomic";
import { asDocumentReadDb } from "@/lib/document-lifecycle-atomic";
import {
  enqueueExpiredUnattachedMedia,
  processMediaDeletionOutbox,
  type ProcessMediaDeletionResult,
} from "@/lib/media-lifecycle-atomic";
import type { MediaObjectDeletionStorage } from "@/lib/r2-deletion-storage";
import type { MediaInventoryReconciliationResult } from "@/lib/media-inventory-reconciliation";

export const SCHEDULED_MAINTENANCE_SOFT_BUDGET_MS = 25_000;
export const SCHEDULED_ACCOUNT_ERASURE_LIMIT = 10;
export const SCHEDULED_EXPIRED_MEDIA_LIMIT = 25;
export const SCHEDULED_MEDIA_DELETION_LIMIT = 8;
export const SCHEDULED_MEDIA_RECONCILIATION_LIMIT = 50;

type StageStatus = "completed" | "failed" | "skipped_budget";

export type ScheduledMaintenanceBacklog = {
  accountDue: number;
  mediaPending: number;
  mediaDue: number;
  mediaRetrying: number;
};

export type ScheduledMaintenanceReport = {
  event: "portal_scheduled_maintenance";
  version: 1;
  outcome: "ok" | "retry" | "budget_exhausted" | "partial_failure";
  scheduledAt: string;
  durationMs: number;
  budgetExhausted: boolean;
  account: {
    status: StageStatus;
    processed: number;
    skipped: number;
    failed: number;
    dueAfter: number | null;
  };
  media: {
    enqueueStatus: StageStatus;
    cleanupStatus: StageStatus;
    reconciliationStatus: StageStatus;
    completed: number;
    failed: number;
    inspected: number;
    reconciled: number;
    reconciliationFailed: number;
    pendingAfter: number | null;
    dueAfter: number | null;
    retryingAfter: number | null;
  };
  metricsStatus: StageStatus;
};

export type ScheduledMaintenanceOperations = {
  processAccount(input: {
    now: Date;
    limit: number;
    shouldContinue: () => boolean;
  }): Promise<ProcessAccountRawIdErasuresResult>;
  enqueueExpiredMedia(now: Date, limit: number): Promise<void>;
  processMedia(input: {
    now: Date;
    limit: number;
    shouldContinue: () => boolean;
  }): Promise<ProcessMediaDeletionResult>;
  reconcileMedia(input: {
    limit: number;
    shouldContinue: () => boolean;
  }): Promise<MediaInventoryReconciliationResult>;
  readBacklog(now: Date): Promise<ScheduledMaintenanceBacklog>;
};

export async function readScheduledMaintenanceBacklog(
  context: DbContext,
  now: Date,
): Promise<ScheduledMaintenanceBacklog> {
  const db = asDocumentReadDb(context);
  const [accountDue] = await db
    .select({ value: count() })
    .from(accountDeletionJobs)
    .where(
      and(
        eq(accountDeletionJobs.status, "ERASED"),
        lte(accountDeletionJobs.aliasAfter, now),
      ),
    );
  const [mediaPending] = await db
    .select({ value: count() })
    .from(mediaDeletionOutbox)
    .where(isNull(mediaDeletionOutbox.completedAt));
  const [mediaDue] = await db
    .select({ value: count() })
    .from(mediaDeletionOutbox)
    .where(
      and(
        isNull(mediaDeletionOutbox.completedAt),
        lte(mediaDeletionOutbox.notBefore, now),
        lte(mediaDeletionOutbox.nextAttemptAt, now),
        or(
          isNull(mediaDeletionOutbox.leaseExpiresAt),
          lte(mediaDeletionOutbox.leaseExpiresAt, now),
        ),
      ),
    );
  const [mediaRetrying] = await db
    .select({ value: count() })
    .from(mediaDeletionOutbox)
    .where(
      and(
        isNull(mediaDeletionOutbox.completedAt),
        gt(mediaDeletionOutbox.attemptCount, 0),
      ),
    );
  return {
    accountDue: accountDue?.value ?? 0,
    mediaPending: mediaPending?.value ?? 0,
    mediaDue: mediaDue?.value ?? 0,
    mediaRetrying: mediaRetrying?.value ?? 0,
  };
}

export function createScheduledMaintenanceOperations(
  context: DbContext,
  storage: MediaObjectDeletionStorage,
  reconcileMedia: ScheduledMaintenanceOperations["reconcileMedia"] = async () => ({
    inspected: 0,
    deleted: 0,
    preserved: 0,
    invalid: 0,
    failed: 0,
    cycleCompleted: true,
    budgetExhausted: false,
  }),
): ScheduledMaintenanceOperations {
  return {
    processAccount: (input) =>
      processDueAccountRawIdErasures(context, input),
    enqueueExpiredMedia: (now, limit) =>
      enqueueExpiredUnattachedMedia(context, now, limit),
    processMedia: (input) =>
      processMediaDeletionOutbox(context, storage, input),
    reconcileMedia,
    readBacklog: (now) => readScheduledMaintenanceBacklog(context, now),
  };
}

export async function runScheduledMaintenance(
  operations: ScheduledMaintenanceOperations,
  input: {
    now: Date;
    scheduledAt: Date;
    softBudgetMs?: number;
    clock?: () => number;
  },
): Promise<ScheduledMaintenanceReport> {
  const clock = input.clock ?? Date.now;
  const startedAt = clock();
  const requestedBudget = input.softBudgetMs ?? SCHEDULED_MAINTENANCE_SOFT_BUDGET_MS;
  const softBudgetMs = Number.isSafeInteger(requestedBudget)
    ? Math.min(Math.max(requestedBudget, 1_000), 60_000)
    : SCHEDULED_MAINTENANCE_SOFT_BUDGET_MS;
  const shouldContinue = () => clock() - startedAt < softBudgetMs;

  let stageFailure = false;
  let accountStatus: StageStatus = "skipped_budget";
  let accountResult: ProcessAccountRawIdErasuresResult = {
    processed: 0,
    skipped: 0,
    failed: 0,
  };
  if (shouldContinue()) {
    try {
      accountResult = await operations.processAccount({
        now: input.now,
        limit: SCHEDULED_ACCOUNT_ERASURE_LIMIT,
        shouldContinue,
      });
      accountStatus = "completed";
      if (accountResult.failed > 0) stageFailure = true;
    } catch {
      accountStatus = "failed";
      stageFailure = true;
    }
  }

  let enqueueStatus: StageStatus = "skipped_budget";
  if (shouldContinue()) {
    try {
      await operations.enqueueExpiredMedia(
        input.now,
        SCHEDULED_EXPIRED_MEDIA_LIMIT,
      );
      enqueueStatus = "completed";
    } catch {
      enqueueStatus = "failed";
      stageFailure = true;
    }
  }

  let cleanupStatus: StageStatus = "skipped_budget";
  let mediaResult: ProcessMediaDeletionResult = { completed: 0, failed: 0 };
  if (shouldContinue()) {
    try {
      mediaResult = await operations.processMedia({
        now: input.now,
        limit: SCHEDULED_MEDIA_DELETION_LIMIT,
        shouldContinue,
      });
      cleanupStatus = "completed";
    } catch {
      cleanupStatus = "failed";
      stageFailure = true;
    }
  }

  let reconciliationStatus: StageStatus = "skipped_budget";
  let reconciliationResult: MediaInventoryReconciliationResult = {
    inspected: 0,
    deleted: 0,
    preserved: 0,
    invalid: 0,
    failed: 0,
    cycleCompleted: false,
    budgetExhausted: false,
  };
  if (shouldContinue()) {
    try {
      reconciliationResult = await operations.reconcileMedia({
        limit: SCHEDULED_MEDIA_RECONCILIATION_LIMIT,
        shouldContinue,
      });
      reconciliationStatus = "completed";
      if (reconciliationResult.failed > 0) stageFailure = true;
    } catch {
      reconciliationStatus = "failed";
      stageFailure = true;
    }
  }

  let metricsStatus: StageStatus = "skipped_budget";
  let backlog: ScheduledMaintenanceBacklog | null = null;
  if (shouldContinue()) {
    try {
      backlog = await operations.readBacklog(input.now);
      metricsStatus = "completed";
    } catch {
      metricsStatus = "failed";
      stageFailure = true;
    }
  }

  const durationMs = Math.max(0, Math.trunc(clock() - startedAt));
  const budgetExhausted = !shouldContinue();
  const retryRequired =
    mediaResult.failed > 0 ||
    reconciliationResult.failed > 0 ||
    (backlog !== null &&
      (backlog.accountDue > 0 ||
        backlog.mediaDue > 0 ||
        backlog.mediaRetrying > 0));
  const outcome = stageFailure
    ? "partial_failure"
    : budgetExhausted
      ? "budget_exhausted"
      : retryRequired
        ? "retry"
        : "ok";

  return {
    event: "portal_scheduled_maintenance",
    version: 1,
    outcome,
    scheduledAt: input.scheduledAt.toISOString(),
    durationMs,
    budgetExhausted,
    account: {
      status: accountStatus,
      ...accountResult,
      dueAfter: backlog?.accountDue ?? null,
    },
    media: {
      enqueueStatus,
      cleanupStatus,
      reconciliationStatus,
      ...mediaResult,
      inspected: reconciliationResult.inspected,
      reconciled: reconciliationResult.deleted,
      reconciliationFailed: reconciliationResult.failed,
      pendingAfter: backlog?.mediaPending ?? null,
      dueAfter: backlog?.mediaDue ?? null,
      retryingAfter: backlog?.mediaRetrying ?? null,
    },
    metricsStatus,
  };
}

export function serializeScheduledMaintenanceReport(
  report: ScheduledMaintenanceReport,
): string {
  return JSON.stringify(report);
}
