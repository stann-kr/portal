/** 활성 문서를 보호하며 저장소의 idle sweep와 quota 재시도를 조정한다. */
"use client";

import type { FormDraftStorage } from "./contract";
import { sweepExpiredFormDraftArtifacts } from "./artifact-sweep";
import { compactFormDraftRecoveries } from "./recoveries";

const FORM_DRAFT_ARTIFACT_SWEEP_MAX_KEYS_PER_SLICE = 4;

const FORM_DRAFT_ARTIFACT_SWEEP_MIN_IDLE_MS = 8;

const FORM_DRAFT_ARTIFACT_SWEEP_MAX_RAW_CODE_UNITS = 256 * 1024;

const FORM_DRAFT_ARTIFACT_SWEEP_MAX_KEY_CODE_UNITS = 4 * 1024;

type FormDraftIdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

const activeFormDraftSourceCounts = new WeakMap<
  FormDraftStorage,
  Map<string, number>
>();

const scheduledFormDraftArtifactSweeps = new WeakSet<FormDraftStorage>();

const pendingFormDraftArtifactSweepJobs = new WeakMap<
  FormDraftStorage,
  { cancel: () => void }
>();

export function registerActiveFormDraftSource(
  storage: FormDraftStorage,
  sourceKey: string,
): void {
  const counts = activeFormDraftSourceCounts.get(storage) ?? new Map();
  counts.set(sourceKey, (counts.get(sourceKey) ?? 0) + 1);
  activeFormDraftSourceCounts.set(storage, counts);
}

export function unregisterActiveFormDraftSource(
  storage: FormDraftStorage,
  sourceKey: string,
): void {
  const counts = activeFormDraftSourceCounts.get(storage);
  if (!counts) return;
  const nextCount = (counts.get(sourceKey) ?? 0) - 1;
  if (nextCount > 0) counts.set(sourceKey, nextCount);
  else counts.delete(sourceKey);
  if (counts.size === 0) {
    activeFormDraftSourceCounts.delete(storage);
    cancelPendingFormDraftArtifactSweep(storage);
  }
}

export function listActiveFormDraftSources(
  storage: FormDraftStorage,
  currentSourceKey?: string,
): Set<string> {
  const sourceKeys = new Set(activeFormDraftSourceCounts.get(storage)?.keys());
  if (currentSourceKey) sourceKeys.add(currentSourceKey);
  return sourceKeys;
}

function scheduleFormDraftIdleWork(
  callback: (deadline: FormDraftIdleDeadline) => void,
): () => void {
  const idleWindow = window;
  const requestIdleCallback = Reflect.get(idleWindow, "requestIdleCallback");
  if (typeof requestIdleCallback === "function") {
    try {
      const handle: unknown = requestIdleCallback.call(
        idleWindow,
        callback,
        { timeout: 1_000 },
      );
      return () => {
        const cancelIdleCallback = Reflect.get(
          idleWindow,
          "cancelIdleCallback",
        );
        if (
          typeof cancelIdleCallback === "function" &&
          typeof handle === "number"
        ) {
          cancelIdleCallback.call(idleWindow, handle);
        }
      };
    } catch {
      // 일부 sandbox 구현은 API를 노출한 뒤 호출만 거부한다.
    }
  }
  const scheduleTimeout = setTimeout;
  const cancelTimeout = clearTimeout;
  const timeout = scheduleTimeout(() => {
    callback({ didTimeout: true, timeRemaining: () => 0 });
  }, 0);
  return () => cancelTimeout(timeout);
}

function cancelPendingFormDraftArtifactSweep(storage: FormDraftStorage): void {
  const job = pendingFormDraftArtifactSweepJobs.get(storage);
  if (!job) return;
  job.cancel();
  pendingFormDraftArtifactSweepJobs.delete(storage);
  scheduledFormDraftArtifactSweeps.delete(storage);
}

export function scheduleFormDraftArtifactSweep(storage: FormDraftStorage): void {
  if (scheduledFormDraftArtifactSweeps.has(storage)) return;
  scheduledFormDraftArtifactSweeps.add(storage);

  let nextStorageIndex: number | null = null;
  let cancelled = false;
  let cancelScheduledSlice = () => {};
  const job = {
    cancel: () => {
      cancelled = true;
      cancelScheduledSlice();
    },
  };
  pendingFormDraftArtifactSweepJobs.set(storage, job);

  const sweepSlice = (deadline: FormDraftIdleDeadline) => {
    cancelScheduledSlice = () => {};
    if (cancelled) return;
    try {
      if (nextStorageIndex === null) nextStorageIndex = storage.length - 1;
      const maxKeys = deadline.didTimeout
        ? 1
        : FORM_DRAFT_ARTIFACT_SWEEP_MAX_KEYS_PER_SLICE;
      const protectedSourceKeys = listActiveFormDraftSources(storage);
      const now = Date.now();
      let scannedKeys = 0;

      while (nextStorageIndex >= 0 && scannedKeys < maxKeys) {
        if (
          !deadline.didTimeout &&
          deadline.timeRemaining() < FORM_DRAFT_ARTIFACT_SWEEP_MIN_IDLE_MS
        ) {
          break;
        }
        nextStorageIndex = Math.min(nextStorageIndex, storage.length - 1);
        if (nextStorageIndex < 0) break;
        const candidateKey = storage.key(nextStorageIndex);
        nextStorageIndex -= 1;
        scannedKeys += 1;
        if (
          candidateKey === null ||
          candidateKey.length > FORM_DRAFT_ARTIFACT_SWEEP_MAX_KEY_CODE_UNITS
        ) {
          continue;
        }
        sweepExpiredFormDraftArtifacts(storage, {
          now,
          protectedSourceKeys,
          candidateKeys: [candidateKey],
          maxArtifactRawCodeUnits:
            FORM_DRAFT_ARTIFACT_SWEEP_MAX_RAW_CODE_UNITS,
          includeClearMarkers: false,
        });
      }
    } catch {
      // proactive sweep는 best-effort다. 현재 폼의 저장/복원 상태를 바꾸지 않는다.
      pendingFormDraftArtifactSweepJobs.delete(storage);
      return;
    }

    if (nextStorageIndex >= 0) {
      cancelScheduledSlice = scheduleFormDraftIdleWork(sweepSlice);
    } else {
      pendingFormDraftArtifactSweepJobs.delete(storage);
    }
  };

  cancelScheduledSlice = scheduleFormDraftIdleWork(sweepSlice);
}

export function readBrowserLocalStorage(): FormDraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function prepareFormDraftQuotaRetry(
  storage: FormDraftStorage,
  sourceKey: string,
  protectedRecoveryKeys: ReadonlySet<string>,
): void {
  try {
    sweepExpiredFormDraftArtifacts(storage, {
      protectedSourceKeys: listActiveFormDraftSources(storage, sourceKey),
      protectedRecoveryKeys,
    });
  } catch {
    // 다른 namespace 정리가 실패해도 기존 current-source compaction은 계속 시도한다.
  }
  compactFormDraftRecoveries(storage, sourceKey, {
    protectedKeys: protectedRecoveryKeys,
  });
}

export function isStorageQuotaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}
