import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { and, asc, eq, gt, lte } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import {
  accountCleanupTokens,
  accountDeletionJobs,
  mediaObjects,
  profiles,
  type AccountCleanupTokenStatus,
  type AccountDeletionInitiatingTokenMode,
  type AccountDeletionStatus,
} from "@/db/schema";
import { parseCreationOperationId } from "@/lib/creation-operation";
import {
  documentEpochSeconds,
  executeDocumentStatementsAtomically,
  type DocumentAtomicStatement,
} from "@/lib/document-lifecycle-atomic";
import {
  MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
  MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
} from "@/lib/media-lifecycle";

export const ACCOUNT_RAW_ID_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const ACCOUNT_CLEANUP_TOKEN_LIMIT = 64;
export const ACCOUNT_DELETION_REQUEST_HASH_VERSION = 1;

const TOKEN_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export type RegisterAccountCleanupTokenFailureReason =
  | "INVALID_TOKEN_DIGEST"
  | "STUDENT_NOT_FOUND"
  | "TOKEN_DIGEST_CONFLICT"
  | "TOKEN_QUOTA_EXCEEDED"
  | "CONCURRENT_MUTATION";

export type RegisterAccountCleanupTokenResult =
  | { ok: true; status: "REGISTERED" | "REPLAYED" }
  | { ok: false; reason: RegisterAccountCleanupTokenFailureReason };

export type DeleteStudentAccountFailureReason =
  | "INVALID_OPERATION_ID"
  | "INVALID_TOKEN_DIGEST"
  | "STUDENT_NOT_FOUND"
  | "ADMIN_FORBIDDEN"
  | "CLEANUP_TOKEN_NOT_ACTIVE"
  | "OPERATION_PAYLOAD_CONFLICT"
  | "ACTIVE_MEDIA_SEAL"
  | "CONCURRENT_MUTATION";

export type DeleteStudentAccountSuccess = {
  ok: true;
  status: "DELETED" | "REPLAYED";
  deletionJobId: string;
  deletionStatus: Exclude<AccountDeletionStatus, "ERASING">;
  rawIdEraseAfter: Date;
};

export type DeleteStudentAccountResult =
  | DeleteStudentAccountSuccess
  | { ok: false; reason: DeleteStudentAccountFailureReason };

export type AccountCleanupTokenLookup = {
  tokenStatus: AccountCleanupTokenStatus | null;
  deletionStatus: AccountDeletionStatus | null;
  requestedAt: Date | null;
  erasedAt: Date | null;
  aliasedAt: Date | null;
};

export type ProcessAccountRawIdErasuresResult = {
  processed: number;
  skipped: number;
  failed: number;
};

type StoredDeletionJob = {
  id: string;
  operationId: string;
  subjectId: string | null;
  initiatingTokenDigest: string;
  initiatingTokenMode: AccountDeletionInitiatingTokenMode;
  requestHash: string;
  status: AccountDeletionStatus;
  aliasAfter: Date;
};

type StoredCleanupToken = {
  tokenDigest: string;
  subjectId: string | null;
  deletionJobId: string | null;
  status: AccountCleanupTokenStatus;
};

function asReadDb(context: DbContext): DrizzleDb {
  return context.db as unknown as DrizzleDb;
}

function requestHash(input: {
  actorId: string;
  operationId: string;
  initiatingCleanupTokenDigest: string;
}): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify([
          "account-deletion",
          ACCOUNT_DELETION_REQUEST_HASH_VERSION,
          input.actorId,
          input.operationId,
          input.initiatingCleanupTokenDigest,
        ]),
      ),
    ),
  );
}

function createSecureUuid(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("안전한 계정 삭제 식별자를 만들 수 없습니다.");
  }
  return crypto.randomUUID();
}

async function findDeletionJobByOperationId(
  context: DbContext,
  operationId: string,
): Promise<StoredDeletionJob | null> {
  const [job] = await asReadDb(context)
    .select({
      id: accountDeletionJobs.id,
      operationId: accountDeletionJobs.operationId,
      subjectId: accountDeletionJobs.subjectId,
      initiatingTokenDigest: accountDeletionJobs.initiatingTokenDigest,
      initiatingTokenMode: accountDeletionJobs.initiatingTokenMode,
      requestHash: accountDeletionJobs.requestHash,
      status: accountDeletionJobs.status,
      aliasAfter: accountDeletionJobs.aliasAfter,
    })
    .from(accountDeletionJobs)
    .where(eq(accountDeletionJobs.operationId, operationId))
    .limit(1);
  return job ?? null;
}

async function findDeletionJobByInitiatingTokenDigest(
  context: DbContext,
  initiatingTokenDigest: string,
): Promise<StoredDeletionJob | null> {
  const [job] = await asReadDb(context)
    .select({
      id: accountDeletionJobs.id,
      operationId: accountDeletionJobs.operationId,
      subjectId: accountDeletionJobs.subjectId,
      initiatingTokenDigest: accountDeletionJobs.initiatingTokenDigest,
      initiatingTokenMode: accountDeletionJobs.initiatingTokenMode,
      requestHash: accountDeletionJobs.requestHash,
      status: accountDeletionJobs.status,
      aliasAfter: accountDeletionJobs.aliasAfter,
    })
    .from(accountDeletionJobs)
    .where(
      eq(accountDeletionJobs.initiatingTokenDigest, initiatingTokenDigest),
    )
    .limit(1);
  return job ?? null;
}

async function findCleanupToken(
  context: DbContext,
  tokenDigest: string,
): Promise<StoredCleanupToken | null> {
  const [token] = await asReadDb(context)
    .select({
      tokenDigest: accountCleanupTokens.tokenDigest,
      subjectId: accountCleanupTokens.subjectId,
      deletionJobId: accountCleanupTokens.deletionJobId,
      status: accountCleanupTokens.status,
    })
    .from(accountCleanupTokens)
    .where(eq(accountCleanupTokens.tokenDigest, tokenDigest))
    .limit(1);
  return token ?? null;
}

async function classifyDeletionReplay(
  context: DbContext,
  job: StoredDeletionJob,
  expected: {
    actorId: string;
    requestHash: string;
    initiatingCleanupTokenDigest: string;
  },
): Promise<DeleteStudentAccountResult> {
  const token = await findCleanupToken(
    context,
    expected.initiatingCleanupTokenDigest,
  );
  const persistentTokenMatches =
    job.initiatingTokenMode === "PERSISTENT" &&
    token?.deletionJobId === job.id &&
    ["BOUND", "ERASED"].includes(token.status) &&
    (token.subjectId === null || token.subjectId === expected.actorId);
  const ephemeralReceiptMatches =
    job.initiatingTokenMode === "EPHEMERAL" && token === null;
  if (
    job.requestHash !== expected.requestHash ||
    job.initiatingTokenDigest !== expected.initiatingCleanupTokenDigest ||
    (job.subjectId !== null && job.subjectId !== expected.actorId) ||
    (!persistentTokenMatches && !ephemeralReceiptMatches)
  ) {
    return { ok: false, reason: "OPERATION_PAYLOAD_CONFLICT" };
  }
  if (job.status === "ERASING") {
    return { ok: false, reason: "CONCURRENT_MUTATION" };
  }
  return {
    ok: true,
    status: "REPLAYED",
    deletionJobId: job.id,
    deletionStatus: job.status,
    rawIdEraseAfter: job.aliasAfter,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExpectedAtomicRace(error: unknown): boolean {
  const message = messageOf(error);
  return [
    "DOCUMENT_BATCH_ABORT",
    "ACCOUNT_DELETION_JOB_DUPLICATE",
    "ACCOUNT_DELETION_INITIAL_STATE_INVALID",
    "ACCOUNT_CLEANUP_TOKEN_DUPLICATE",
    "ACCOUNT_CLEANUP_TOKEN_TRANSITION_INVALID",
    "DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED",
    "MEDIA_OBJECT_STATE_TRANSITION_INVALID",
    "MEDIA_DELETION_OUTBOX_DUPLICATE",
  ].some((code) => message.includes(code));
}

export async function registerAccountCleanupTokenAtomically(
  context: DbContext,
  input: { ownerId: string; tokenDigest: string; now: Date },
): Promise<RegisterAccountCleanupTokenResult> {
  if (!TOKEN_DIGEST_PATTERN.test(input.tokenDigest)) {
    return { ok: false, reason: "INVALID_TOKEN_DIGEST" };
  }

  const existing = await findCleanupToken(context, input.tokenDigest);
  if (existing) {
    return existing.status === "ACTIVE" && existing.subjectId === input.ownerId
      ? { ok: true, status: "REPLAYED" }
      : { ok: false, reason: "TOKEN_DIGEST_CONFLICT" };
  }
  if (await findDeletionJobByInitiatingTokenDigest(context, input.tokenDigest)) {
    return { ok: false, reason: "TOKEN_DIGEST_CONFLICT" };
  }

  const [owner] = await asReadDb(context)
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, input.ownerId))
    .limit(1);
  if (!owner || owner.role !== "student") {
    return { ok: false, reason: "STUDENT_NOT_FOUND" };
  }

  const activeTokens = await asReadDb(context)
    .select({ tokenDigest: accountCleanupTokens.tokenDigest })
    .from(accountCleanupTokens)
    .where(
      and(
        eq(accountCleanupTokens.subjectId, input.ownerId),
        eq(accountCleanupTokens.status, "ACTIVE"),
      ),
    );
  if (activeTokens.length >= ACCOUNT_CLEANUP_TOKEN_LIMIT) {
    return { ok: false, reason: "TOKEN_QUOTA_EXCEEDED" };
  }

  const now = documentEpochSeconds(input.now);
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          INSERT INTO account_cleanup_tokens (
            token_digest, subject_id, status, created_at, updated_at
          )
          SELECT ?, ?, 'ACTIVE', ?, ?
          FROM profiles
          WHERE id = ? AND role = 'student'
            AND NOT EXISTS (
              SELECT 1 FROM account_cleanup_tokens WHERE token_digest = ?
            )
            AND (
              SELECT count(*) FROM account_cleanup_tokens
              WHERE subject_id = ? AND status = 'ACTIVE'
            ) < ?
        `,
        params: [
          input.tokenDigest,
          input.ownerId,
          now,
          now,
          input.ownerId,
          input.tokenDigest,
          input.ownerId,
          ACCOUNT_CLEANUP_TOKEN_LIMIT,
        ],
      },
      {
        query:
          "INSERT INTO document_batch_abort_guard (reason) " +
          "SELECT 'ACCOUNT_CLEANUP_TOKEN_REGISTER' WHERE changes() <> 1",
      },
    ]);
    return { ok: true, status: "REGISTERED" };
  } catch (error) {
    const raced = await findCleanupToken(context, input.tokenDigest);
    if (raced) {
      return raced.status === "ACTIVE" && raced.subjectId === input.ownerId
        ? { ok: true, status: "REPLAYED" }
        : { ok: false, reason: "TOKEN_DIGEST_CONFLICT" };
    }
    if (await findDeletionJobByInitiatingTokenDigest(context, input.tokenDigest)) {
      return { ok: false, reason: "TOKEN_DIGEST_CONFLICT" };
    }
    if (isExpectedAtomicRace(error)) {
      return { ok: false, reason: "CONCURRENT_MUTATION" };
    }
    throw error;
  }
}

function accountDeletionStatements(input: {
  actorId: string;
  operationId: string;
  initiatingCleanupTokenDigest: string;
  requestHash: string;
  deletionJobId: string;
  erasureAlias: string;
  now: number;
  initiatingTokenMode: AccountDeletionInitiatingTokenMode;
}): DocumentAtomicStatement[] {
  const jobId = input.deletionJobId;
  const actorId = input.actorId;
  const now = input.now;
  return [
    {
      query: `
        INSERT INTO account_deletion_jobs (
          id, operation_id, subject_id, erasure_alias,
          initiating_token_digest, initiating_token_mode,
          request_hash, request_hash_version, status,
          requested_at, alias_after, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'ERASING', ?, ?, ?
        FROM profiles AS profile
        WHERE profile.id = ? AND profile.role = 'student'
          AND NOT EXISTS (
            SELECT 1 FROM account_deletion_jobs
            WHERE operation_id = ? OR subject_id = ?
          )
          AND (
            (
              ? = 'PERSISTENT'
              AND EXISTS (
                SELECT 1 FROM account_cleanup_tokens AS token
                WHERE token.token_digest = ?
                  AND token.subject_id = profile.id
                  AND token.status = 'ACTIVE'
                  AND token.deletion_job_id IS NULL
              )
            ) OR (
              ? = 'EPHEMERAL'
              AND NOT EXISTS (
                SELECT 1 FROM account_cleanup_tokens
                WHERE token_digest = ?
              )
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM media_objects
            WHERE state = 'SEALING'
              AND seal_lease_expires_at > ?
              AND (
                owner_id = ?
                OR (
                  resource_type = 'COMMUNITY_POST'
                  AND EXISTS (
                    SELECT 1 FROM posts
                    WHERE posts.id = media_objects.resource_id
                      AND posts.author_id = ?
                  )
                )
                OR (
                  resource_type = 'QNA_REPLY'
                  AND EXISTS (
                    SELECT 1
                    FROM qna_replies AS reply
                    JOIN qna_threads AS thread ON thread.id = reply.thread_id
                    WHERE reply.id = media_objects.resource_id
                      AND thread.student_id = ?
                  )
                )
                OR (
                  resource_type = 'PRIVATE_NOTE'
                  AND EXISTS (
                    SELECT 1 FROM private_notes AS note
                    WHERE note.id = media_objects.resource_id
                      AND (note.student_id = ? OR note.author_id = ?)
                  )
                )
              )
          )
      `,
      params: [
        jobId,
        input.operationId,
        actorId,
        input.erasureAlias,
        input.initiatingCleanupTokenDigest,
        input.initiatingTokenMode,
        input.requestHash,
        ACCOUNT_DELETION_REQUEST_HASH_VERSION,
        now,
        now + ACCOUNT_RAW_ID_RETENTION_SECONDS,
        now,
        actorId,
        input.operationId,
        actorId,
        input.initiatingTokenMode,
        input.initiatingCleanupTokenDigest,
        input.initiatingTokenMode,
        input.initiatingCleanupTokenDigest,
        now,
        actorId,
        actorId,
        actorId,
        actorId,
        actorId,
      ],
    },
    {
      query:
        "INSERT INTO document_batch_abort_guard (reason) " +
        "SELECT 'ACCOUNT_DELETION_JOB_CREATE' WHERE changes() <> 1",
    },
    {
      query: `
        UPDATE account_cleanup_tokens
        SET deletion_job_id = ?, status = 'BOUND', bound_at = ?, updated_at = ?
        WHERE subject_id = ? AND status = 'ACTIVE'
      `,
      params: [jobId, now, now, actorId],
    },
    {
      query: `
        INSERT INTO document_batch_abort_guard (reason)
        SELECT 'ACCOUNT_DELETION_INITIATOR_RECEIPT_INVALID'
        WHERE (
          ? = 'PERSISTENT'
          AND NOT EXISTS (
            SELECT 1 FROM account_cleanup_tokens
            WHERE token_digest = ? AND subject_id = ?
              AND deletion_job_id = ? AND status = 'BOUND'
          )
        ) OR (
          ? = 'EPHEMERAL'
          AND EXISTS (
            SELECT 1 FROM account_cleanup_tokens WHERE token_digest = ?
          )
        )
      `,
      params: [
        input.initiatingTokenMode,
        input.initiatingCleanupTokenDigest,
        actorId,
        jobId,
        input.initiatingTokenMode,
        input.initiatingCleanupTokenDigest,
      ],
    },
    {
      query: `
        INSERT INTO media_deletion_outbox (
          id, media_object_id, object_key, reason, not_before,
          attempt_count, next_attempt_at, created_at, updated_at
        )
        SELECT
          'account-delete:' || ? || ':final:' || media.id,
          media.id, media.object_key, 'ACCOUNT_DELETION',
          CASE WHEN media.state = 'SEALING'
               THEN media.seal_lease_expires_at + ? ELSE ? END,
          0,
          CASE WHEN media.state = 'SEALING'
               THEN media.seal_lease_expires_at + ? ELSE ? END,
          ?, ?
        FROM media_objects AS media
        WHERE (
            media.owner_id = ?
            OR (
              media.resource_type = 'COMMUNITY_POST'
              AND EXISTS (
                SELECT 1 FROM posts
                WHERE posts.id = media.resource_id AND posts.author_id = ?
              )
            )
            OR (
              media.resource_type = 'QNA_REPLY'
              AND EXISTS (
                SELECT 1
                FROM qna_replies AS reply
                JOIN qna_threads AS thread ON thread.id = reply.thread_id
                WHERE reply.id = media.resource_id AND thread.student_id = ?
              )
            )
            OR (
              media.resource_type = 'PRIVATE_NOTE'
              AND EXISTS (
                SELECT 1 FROM private_notes AS note
                WHERE note.id = media.resource_id
                  AND (note.student_id = ? OR note.author_id = ?)
              )
            )
          )
          AND media.state IN ('PENDING_UPLOAD', 'SEALING', 'READY', 'ATTACHED')
          AND NOT EXISTS (
            SELECT 1 FROM media_deletion_outbox AS deletion
            WHERE deletion.media_object_id = media.id
              AND deletion.object_key = media.object_key
          )
      `,
      params: [
        jobId,
        MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
        now,
        MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
        now,
        now,
        now,
        actorId,
        actorId,
        actorId,
        actorId,
        actorId,
      ],
    },
    {
      query: `
        INSERT INTO media_deletion_outbox (
          id, media_object_id, object_key, reason, not_before,
          attempt_count, next_attempt_at, created_at, updated_at
        )
        SELECT
          'account-delete:' || ? || ':staging:' || media.id,
          media.id, media.upload_object_key, 'UPLOAD_STAGING_EXPIRED',
          max(?, media.upload_expires_at + ?),
          0, max(?, media.upload_expires_at + ?), ?, ?
        FROM media_objects AS media
        WHERE (
            media.owner_id = ?
            OR (
              media.resource_type = 'COMMUNITY_POST'
              AND EXISTS (
                SELECT 1 FROM posts
                WHERE posts.id = media.resource_id AND posts.author_id = ?
              )
            )
            OR (
              media.resource_type = 'QNA_REPLY'
              AND EXISTS (
                SELECT 1
                FROM qna_replies AS reply
                JOIN qna_threads AS thread ON thread.id = reply.thread_id
                WHERE reply.id = media.resource_id AND thread.student_id = ?
              )
            )
            OR (
              media.resource_type = 'PRIVATE_NOTE'
              AND EXISTS (
                SELECT 1 FROM private_notes AS note
                WHERE note.id = media.resource_id
                  AND (note.student_id = ? OR note.author_id = ?)
              )
            )
          )
          AND media.state IN ('PENDING_UPLOAD', 'SEALING', 'READY', 'ATTACHED')
          AND NOT EXISTS (
            SELECT 1 FROM media_deletion_outbox AS deletion
            WHERE deletion.media_object_id = media.id
              AND deletion.object_key = media.upload_object_key
          )
      `,
      params: [
        jobId,
        now,
        MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
        now,
        MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
        now,
        now,
        actorId,
        actorId,
        actorId,
        actorId,
        actorId,
      ],
    },
    {
      query: `
        UPDATE media_objects
        SET state = 'PENDING_DELETE', seal_lease_id = NULL,
            seal_lease_expires_at = NULL, delete_requested_at = ?, updated_at = ?
        WHERE (
            owner_id = ?
            OR (
              resource_type = 'COMMUNITY_POST'
              AND EXISTS (
                SELECT 1 FROM posts
                WHERE posts.id = media_objects.resource_id AND posts.author_id = ?
              )
            )
            OR (
              resource_type = 'QNA_REPLY'
              AND EXISTS (
                SELECT 1
                FROM qna_replies AS reply
                JOIN qna_threads AS thread ON thread.id = reply.thread_id
                WHERE reply.id = media_objects.resource_id AND thread.student_id = ?
              )
            )
            OR (
              resource_type = 'PRIVATE_NOTE'
              AND EXISTS (
                SELECT 1 FROM private_notes AS note
                WHERE note.id = media_objects.resource_id
                  AND (note.student_id = ? OR note.author_id = ?)
              )
            )
          )
          AND state IN ('PENDING_UPLOAD', 'SEALING', 'READY', 'ATTACHED')
      `,
      params: [now, now, actorId, actorId, actorId, actorId, actorId],
    },
    {
      query: `
        DELETE FROM comments
        WHERE author_id = ?
          AND post_id NOT IN (SELECT id FROM posts WHERE author_id = ?)
      `,
      params: [actorId, actorId],
    },
    {
      query: `
        DELETE FROM qna_replies
        WHERE author_id = ?
          AND thread_id NOT IN (SELECT id FROM qna_threads WHERE student_id = ?)
      `,
      params: [actorId, actorId],
    },
    {
      query: "DELETE FROM private_notes WHERE student_id = ? OR author_id = ?",
      params: [actorId, actorId],
    },
    { query: "DELETE FROM posts WHERE author_id = ?", params: [actorId] },
    { query: "DELETE FROM qna_threads WHERE student_id = ?", params: [actorId] },
    {
      query: "DELETE FROM document_server_drafts WHERE owner_id = ?",
      params: [actorId],
    },
    {
      query: "DELETE FROM document_server_draft_operations WHERE owner_id = ?",
      params: [actorId],
    },
    { query: "DELETE FROM curriculums WHERE student_id = ?", params: [actorId] },
    { query: "DELETE FROM lessons WHERE student_id = ?", params: [actorId] },
    { query: "DELETE FROM assignments WHERE student_id = ?", params: [actorId] },
    { query: "DELETE FROM assignment_tasks WHERE student_id = ?", params: [actorId] },
    { query: "DELETE FROM assignment_recurrences WHERE student_id = ?", params: [actorId] },
    { query: "DELETE FROM digging_columns WHERE user_id = ?", params: [actorId] },
    { query: "DELETE FROM digging_tracks WHERE user_id = ?", params: [actorId] },
    { query: "DELETE FROM digging_playlists WHERE user_id = ?", params: [actorId] },
    { query: "DELETE FROM calendar_events WHERE user_id = ?", params: [actorId] },
    { query: "DELETE FROM external_calendar_subscriptions WHERE student_id = ?", params: [actorId] },
    { query: "DELETE FROM calendar_mappings WHERE student_id = ?", params: [actorId] },
    {
      query: "DELETE FROM profiles WHERE id = ? AND role = 'student'",
      params: [actorId],
    },
    {
      query:
        "INSERT INTO document_batch_abort_guard (reason) " +
        "SELECT 'ACCOUNT_PROFILE_DELETE' WHERE changes() <> 1",
    },
    {
      query: `
        UPDATE account_deletion_jobs
        SET status = 'ERASED', erased_at = ?, updated_at = ?
        WHERE id = ? AND subject_id = ? AND status = 'ERASING'
      `,
      params: [now, now, jobId, actorId],
    },
    {
      query:
        "INSERT INTO document_batch_abort_guard (reason) " +
        "SELECT 'ACCOUNT_DELETION_COMPLETE' WHERE changes() <> 1",
    },
  ];
}

export async function deleteStudentAccountAtomically(
  context: DbContext,
  input: {
    actorId: string;
    operationId: string;
    initiatingCleanupTokenDigest: string;
    useEphemeralCleanupDigest?: boolean;
    now: Date;
  },
): Promise<DeleteStudentAccountResult> {
  const operationId = parseCreationOperationId(input.operationId);
  if (!operationId) return { ok: false, reason: "INVALID_OPERATION_ID" };
  if (!TOKEN_DIGEST_PATTERN.test(input.initiatingCleanupTokenDigest)) {
    return { ok: false, reason: "INVALID_TOKEN_DIGEST" };
  }
  const expectedHash = requestHash({
    actorId: input.actorId,
    operationId,
    initiatingCleanupTokenDigest: input.initiatingCleanupTokenDigest,
  });
  const existingJob = await findDeletionJobByOperationId(context, operationId);
  if (existingJob) {
    return classifyDeletionReplay(context, existingJob, {
      actorId: input.actorId,
      requestHash: expectedHash,
      initiatingCleanupTokenDigest: input.initiatingCleanupTokenDigest,
    });
  }
  if (
    await findDeletionJobByInitiatingTokenDigest(
      context,
      input.initiatingCleanupTokenDigest,
    )
  ) {
    return { ok: false, reason: "OPERATION_PAYLOAD_CONFLICT" };
  }

  const [owner] = await asReadDb(context)
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, input.actorId))
    .limit(1);
  if (!owner) return { ok: false, reason: "STUDENT_NOT_FOUND" };
  if (owner.role !== "student") return { ok: false, reason: "ADMIN_FORBIDDEN" };

  const initiatingToken = await findCleanupToken(
    context,
    input.initiatingCleanupTokenDigest,
  );
  const mayUseEphemeralDigest = input.useEphemeralCleanupDigest === true;
  if (
    (initiatingToken !== null &&
      (initiatingToken.subjectId !== input.actorId ||
        initiatingToken.status !== "ACTIVE" ||
        initiatingToken.deletionJobId !== null)) ||
    (initiatingToken === null && !mayUseEphemeralDigest)
  ) {
    return { ok: false, reason: "CLEANUP_TOKEN_NOT_ACTIVE" };
  }

  const [activeSeal] = await asReadDb(context)
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.ownerId, input.actorId),
        eq(mediaObjects.state, "SEALING"),
        gt(mediaObjects.sealLeaseExpiresAt, input.now),
      ),
    )
    .limit(1);
  if (activeSeal) return { ok: false, reason: "ACTIVE_MEDIA_SEAL" };

  const deletionJobId = createSecureUuid();
  const erasureAlias = `erased:${createSecureUuid()}`;
  const now = documentEpochSeconds(input.now)!;
  try {
    await executeDocumentStatementsAtomically(
      context,
      accountDeletionStatements({
        actorId: input.actorId,
        operationId,
        initiatingCleanupTokenDigest: input.initiatingCleanupTokenDigest,
        requestHash: expectedHash,
        deletionJobId,
        erasureAlias,
        now,
        initiatingTokenMode: initiatingToken ? "PERSISTENT" : "EPHEMERAL",
      }),
    );
  } catch (error) {
    const raced = await findDeletionJobByOperationId(context, operationId);
    if (raced) {
      return classifyDeletionReplay(context, raced, {
        actorId: input.actorId,
        requestHash: expectedHash,
        initiatingCleanupTokenDigest: input.initiatingCleanupTokenDigest,
      });
    }
    if (isExpectedAtomicRace(error)) {
      return { ok: false, reason: "CONCURRENT_MUTATION" };
    }
    throw error;
  }

  return {
    ok: true,
    status: "DELETED",
    deletionJobId,
    deletionStatus: "ERASED",
    rawIdEraseAfter: new Date(
      (now + ACCOUNT_RAW_ID_RETENTION_SECONDS) * 1_000,
    ),
  };
}

export async function findAccountDeletionByCleanupTokenDigest(
  context: DbContext,
  tokenDigest: string,
): Promise<AccountCleanupTokenLookup | null> {
  if (!TOKEN_DIGEST_PATTERN.test(tokenDigest)) return null;
  const [row] = await asReadDb(context)
    .select({
      tokenStatus: accountCleanupTokens.status,
      deletionStatus: accountDeletionJobs.status,
      requestedAt: accountDeletionJobs.requestedAt,
      erasedAt: accountDeletionJobs.erasedAt,
      aliasedAt: accountDeletionJobs.aliasedAt,
    })
    .from(accountCleanupTokens)
    .leftJoin(
      accountDeletionJobs,
      eq(accountCleanupTokens.deletionJobId, accountDeletionJobs.id),
    )
    .where(eq(accountCleanupTokens.tokenDigest, tokenDigest))
    .limit(1);
  if (row) return row;

  const [job] = await asReadDb(context)
    .select({
      deletionStatus: accountDeletionJobs.status,
      requestedAt: accountDeletionJobs.requestedAt,
      erasedAt: accountDeletionJobs.erasedAt,
      aliasedAt: accountDeletionJobs.aliasedAt,
    })
    .from(accountDeletionJobs)
    .where(eq(accountDeletionJobs.initiatingTokenDigest, tokenDigest))
    .limit(1);
  return job ? { tokenStatus: null, ...job } : null;
}

function rawIdErasureStatements(input: {
  jobId: string;
  subjectId: string;
  erasureAlias: string;
  now: number;
}): DocumentAtomicStatement[] {
  const { jobId, subjectId, erasureAlias, now } = input;
  return [
    {
      query: `
        UPDATE document_operation_ledger
        SET actor_id = CASE WHEN actor_id = ? THEN ? ELSE actor_id END,
            subject_id = CASE WHEN subject_id = ? THEN ? ELSE subject_id END
        WHERE actor_id = ? OR subject_id = ?
      `,
      params: [subjectId, erasureAlias, subjectId, erasureAlias, subjectId, subjectId],
    },
    {
      query: `
        UPDATE document_tombstones
        SET subject_id = CASE WHEN subject_id = ? THEN ? ELSE subject_id END,
            owner_id = CASE WHEN owner_id = ? THEN ? ELSE owner_id END,
            purged_by_id = CASE WHEN purged_by_id = ? THEN ? ELSE purged_by_id END
        WHERE subject_id = ? OR owner_id = ? OR purged_by_id = ?
      `,
      params: [
        subjectId,
        erasureAlias,
        subjectId,
        erasureAlias,
        subjectId,
        erasureAlias,
        subjectId,
        subjectId,
        subjectId,
      ],
    },
    {
      query: "UPDATE private_note_revisions SET actor_id = ? WHERE actor_id = ?",
      params: [erasureAlias, subjectId],
    },
    {
      query: "UPDATE post_revisions SET actor_id = ? WHERE actor_id = ?",
      params: [erasureAlias, subjectId],
    },
    {
      query: "UPDATE qna_thread_events SET actor_id = ? WHERE actor_id = ?",
      params: [erasureAlias, subjectId],
    },
    {
      query: `
        UPDATE account_cleanup_tokens
        SET subject_id = NULL, status = 'ERASED', erased_at = ?, updated_at = ?
        WHERE deletion_job_id = ? AND subject_id = ? AND status = 'BOUND'
      `,
      params: [now, now, jobId, subjectId],
    },
    {
      query: `
        INSERT INTO document_batch_abort_guard (reason)
        SELECT 'ACCOUNT_CLEANUP_TOKEN_ERASURE_INCOMPLETE'
        WHERE EXISTS (
          SELECT 1 FROM account_cleanup_tokens
          WHERE deletion_job_id = ? AND subject_id IS NOT NULL
        )
      `,
      params: [jobId],
    },
    {
      query: `
        UPDATE account_deletion_jobs
        SET subject_id = NULL, status = 'ALIASED', aliased_at = ?, updated_at = ?
        WHERE id = ? AND subject_id = ? AND status = 'ERASED'
          AND alias_after <= ?
      `,
      params: [now, now, jobId, subjectId, now],
    },
    {
      query:
        "INSERT INTO document_batch_abort_guard (reason) " +
        "SELECT 'ACCOUNT_RAW_ID_ERASURE' WHERE changes() <> 1",
    },
  ];
}

export async function processDueAccountRawIdErasures(
  context: DbContext,
  input: { now: Date; limit: number; shouldContinue?: () => boolean },
): Promise<ProcessAccountRawIdErasuresResult> {
  const limit = Number.isSafeInteger(input.limit)
    ? Math.min(Math.max(input.limit, 1), 100)
    : 10;
  // 예약 실행은 실패 job이 성공 처리 한도를 소비하지 않게 더 넓게 훑되,
  // soft budget과 hard cap 100 안에서만 진행한다.
  const scanLimit = input.shouldContinue ? 100 : limit;
  const now = documentEpochSeconds(input.now)!;
  const dueJobs = await asReadDb(context)
    .select({
      id: accountDeletionJobs.id,
      subjectId: accountDeletionJobs.subjectId,
      erasureAlias: accountDeletionJobs.erasureAlias,
    })
    .from(accountDeletionJobs)
    .where(
      and(
        eq(accountDeletionJobs.status, "ERASED"),
        lte(accountDeletionJobs.aliasAfter, input.now),
      ),
    )
    .orderBy(asc(accountDeletionJobs.aliasAfter), asc(accountDeletionJobs.id))
    .limit(scanLimit);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of dueJobs) {
    if (processed + skipped >= limit) break;
    if (input.shouldContinue && !input.shouldContinue()) break;
    if (!job.subjectId) {
      skipped += 1;
      continue;
    }
    try {
      await executeDocumentStatementsAtomically(
        context,
        rawIdErasureStatements({
          jobId: job.id,
          subjectId: job.subjectId,
          erasureAlias: job.erasureAlias,
          now,
        }),
      );
      processed += 1;
    } catch (error) {
      if (isExpectedAtomicRace(error)) {
        skipped += 1;
      } else {
        failed += 1;
      }
    }
  }
  return { processed, skipped, failed };
}
