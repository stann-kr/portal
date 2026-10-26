import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import {
  mediaDeletionOutbox,
  mediaObjects,
  type MediaDeletionReason,
  type MediaPurpose,
  type MediaResourceType,
} from "@/db/schema";
import {
  DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  asDocumentReadDb,
  documentEpochSeconds,
  executeDocumentStatementsAtomically,
  type DocumentAtomicStatement,
} from "@/lib/document-lifecycle-atomic";
import {
  MEDIA_DELETE_REQUEST_TIMEOUT_MS,
  MEDIA_DRAFT_RETENTION_SECONDS,
  MEDIA_OWNER_UNATTACHED_BYTES_LIMIT,
  MEDIA_OWNER_UNATTACHED_OBJECT_LIMIT,
  MEDIA_SEAL_HEAD_TIMEOUT_MS,
  MEDIA_SEAL_LEASE_SECONDS,
  MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
  MEDIA_SEAL_REQUEST_TIMEOUT_MS,
  MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
  DOCUMENT_IMAGE_CLAIM_BATCH_SIZE,
  mediaDeletionBackoffSeconds,
} from "@/lib/media-lifecycle";
import { extractDocumentImageMediaIds } from "@/lib/document-image-references";
import {
  getMediaObjectStorage,
  type MediaObjectHead,
  type MediaObjectStorage,
} from "@/lib/r2";
import type { MediaObjectDeletionStorage } from "@/lib/r2-deletion-storage";

export type MediaObjectRecord = typeof mediaObjects.$inferSelect;

export type CreateMediaUploadIntent = {
  id: string;
  ownerId: string;
  purpose: MediaPurpose;
  objectKey: string;
  uploadObjectKey: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  draftOperationId: string;
  uploadExpiresAt: Date;
  now: Date;
};

export type CompleteMediaUploadResult =
  | { ok: true; media: MediaObjectRecord; replayed: boolean }
  | {
      ok: false;
      reason:
        | "NOT_FOUND_OR_FORBIDDEN"
        | "INVALID_STATE"
        | "UPLOAD_EXPIRED"
        | "OBJECT_NOT_FOUND"
        | "OBJECT_HEAD_FAILED"
        | "METADATA_MISMATCH"
        | "OBJECT_SEAL_FAILED"
        | "INTERNAL_INVARIANT_FAILURE";
    };

export async function findOwnedMediaObject(
  context: DbContext,
  ownerId: string,
  mediaObjectId: string,
): Promise<MediaObjectRecord | null> {
  const [media] = await asDocumentReadDb(context)
    .select()
    .from(mediaObjects)
    .where(
      and(eq(mediaObjects.id, mediaObjectId), eq(mediaObjects.ownerId, ownerId)),
    )
    .limit(1);
  return media ?? null;
}

export async function createMediaUploadIntent(
  context: DbContext,
  input: CreateMediaUploadIntent,
): Promise<boolean> {
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          INSERT INTO media_objects (
            id, owner_id, purpose, object_key, upload_object_key, state,
            expected_content_type, expected_size_bytes,
            actual_size_bytes, etag, draft_operation_id,
            resource_type, resource_id, upload_expires_at,
            ready_at, attached_at, delete_requested_at, deleted_at,
            created_at, updated_at
          )
          SELECT ?, profile.id, ?, ?, ?, 'PENDING_UPLOAD', ?, ?,
                 NULL, NULL, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?
          FROM profiles AS profile
          WHERE profile.id = ?
            AND (
              SELECT count(*) FROM media_objects AS active_media
              WHERE active_media.owner_id = profile.id
                AND active_media.resource_type IS NULL
                AND active_media.state <> 'DELETED'
            ) < ?
            AND (
              SELECT coalesce(sum(active_media.expected_size_bytes), 0)
              FROM media_objects AS active_media
              WHERE active_media.owner_id = profile.id
                AND active_media.resource_type IS NULL
                AND active_media.state <> 'DELETED'
            ) <= ? - ?
        `,
        params: [
          input.id,
          input.purpose,
          input.objectKey,
          input.uploadObjectKey,
          input.expectedContentType,
          input.expectedSizeBytes,
          input.draftOperationId,
          documentEpochSeconds(input.uploadExpiresAt),
          documentEpochSeconds(input.now),
          documentEpochSeconds(input.now),
          input.ownerId,
          MEDIA_OWNER_UNATTACHED_OBJECT_LIMIT,
          MEDIA_OWNER_UNATTACHED_BYTES_LIMIT,
          input.expectedSizeBytes,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return true;
  } catch {
    return false;
  }
}

function mediaHeadMatches(media: MediaObjectRecord, head: MediaObjectHead): boolean {
  return (
    head.size === media.expectedSizeBytes &&
    head.contentType?.toLowerCase() === media.expectedContentType.toLowerCase() &&
    Boolean(head.etag)
  );
}

async function runStorageOperationWithTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error("MEDIA_STORAGE_OPERATION_TIMEOUT");
      error.name = "MEDIA_STORAGE_OPERATION_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function claimMediaSeal(
  context: DbContext,
  input: {
    ownerId: string;
    mediaObjectId: string;
    now: Date;
  },
): Promise<string | null> {
  const leaseId = crypto.randomUUID();
  const nowEpoch = documentEpochSeconds(input.now)!;
  const leaseExpiresAt = nowEpoch + MEDIA_SEAL_LEASE_SECONDS;
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          UPDATE media_objects
          SET state = 'SEALING', seal_lease_id = ?,
              seal_lease_expires_at = ?, updated_at = ?
          WHERE id = ? AND owner_id = ? AND state = 'PENDING_UPLOAD'
            AND upload_expires_at >= ?
        `,
        params: [
          leaseId,
          leaseExpiresAt,
          nowEpoch,
          input.mediaObjectId,
          input.ownerId,
          nowEpoch,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return leaseId;
  } catch {
    return null;
  }
}

async function releaseMediaSeal(
  context: DbContext,
  input: {
    ownerId: string;
    mediaObjectId: string;
    leaseId: string;
    now: Date;
  },
): Promise<boolean> {
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          UPDATE media_objects
          SET state = 'PENDING_UPLOAD', seal_lease_id = NULL,
              seal_lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND owner_id = ? AND state = 'SEALING'
            AND seal_lease_id = ?
            AND seal_lease_expires_at > ?
        `,
        params: [
          documentEpochSeconds(input.now),
          input.mediaObjectId,
          input.ownerId,
          input.leaseId,
          documentEpochSeconds(input.now),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function renewMediaSeal(
  context: DbContext,
  input: {
    ownerId: string;
    mediaObjectId: string;
    leaseId: string;
    now: Date;
  },
): Promise<boolean> {
  const nowEpoch = documentEpochSeconds(input.now)!;
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          UPDATE media_objects
          SET seal_lease_expires_at = max(seal_lease_expires_at + 1, ?),
              updated_at = ?
          WHERE id = ? AND owner_id = ? AND state = 'SEALING'
            AND seal_lease_id = ? AND seal_lease_expires_at > ?
        `,
        params: [
          nowEpoch + MEDIA_SEAL_LEASE_SECONDS,
          nowEpoch,
          input.mediaObjectId,
          input.ownerId,
          input.leaseId,
          nowEpoch,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function completeMediaUpload(
  context: DbContext,
  storage: MediaObjectStorage,
  input: {
    ownerId: string;
    mediaObjectId: string;
    now: Date;
  },
): Promise<CompleteMediaUploadResult> {
  const startedAtMs = Date.now();
  const elapsedNow = () =>
    new Date(input.now.getTime() + Math.max(0, Date.now() - startedAtMs));
  const media = await findOwnedMediaObject(
    context,
    input.ownerId,
    input.mediaObjectId,
  );
  if (!media) return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  if (media.state === "READY" || media.state === "ATTACHED") {
    return { ok: true, media, replayed: true };
  }
  if (media.state !== "PENDING_UPLOAD") {
    return { ok: false, reason: "INVALID_STATE" };
  }
  if (media.uploadExpiresAt.getTime() < input.now.getTime()) {
    return { ok: false, reason: "UPLOAD_EXPIRED" };
  }

  const sealLeaseId = await claimMediaSeal(context, input);
  if (!sealLeaseId) {
    const raced = await findOwnedMediaObject(
      context,
      input.ownerId,
      input.mediaObjectId,
    );
    if (raced && (raced.state === "READY" || raced.state === "ATTACHED")) {
      return { ok: true, media: raced, replayed: true };
    }
    if (
      raced?.uploadExpiresAt &&
      raced.uploadExpiresAt.getTime() < input.now.getTime()
    ) {
      return { ok: false, reason: "UPLOAD_EXPIRED" };
    }
    return { ok: false, reason: "INVALID_STATE" };
  }

  let uploadHead: MediaObjectHead | null;
  try {
    uploadHead = await runStorageOperationWithTimeout(
      MEDIA_SEAL_HEAD_TIMEOUT_MS,
      (signal) => storage.head(media.uploadObjectKey, signal),
    );
  } catch {
    await releaseMediaSeal(context, {
      ...input,
      now: elapsedNow(),
      leaseId: sealLeaseId,
    });
    return { ok: false, reason: "OBJECT_HEAD_FAILED" };
  }
  if (!uploadHead) {
    await releaseMediaSeal(context, {
      ...input,
      now: elapsedNow(),
      leaseId: sealLeaseId,
    });
    return { ok: false, reason: "OBJECT_NOT_FOUND" };
  }
  if (!mediaHeadMatches(media, uploadHead)) {
    await releaseMediaSeal(context, {
      ...input,
      now: elapsedNow(),
      leaseId: sealLeaseId,
    });
    return { ok: false, reason: "METADATA_MISMATCH" };
  }

  if (
    !(await renewMediaSeal(context, {
      ...input,
      now: elapsedNow(),
      leaseId: sealLeaseId,
    }))
  ) {
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
  }

  let sealedHead: MediaObjectHead;
  try {
    sealedHead = await runStorageOperationWithTimeout(
      MEDIA_SEAL_REQUEST_TIMEOUT_MS,
      (signal) =>
        storage.seal(
          media.uploadObjectKey,
          media.objectKey,
          uploadHead,
          signal,
        ),
    );
  } catch {
    // CopyObject dispatch 뒤 결과를 잃었을 수 있으므로 lease를 유지한다.
    // 만료 sweep이 recovery grace 뒤 final key를 다시 삭제한다.
    return { ok: false, reason: "OBJECT_SEAL_FAILED" };
  }
  if (!mediaHeadMatches(media, sealedHead)) {
    return { ok: false, reason: "OBJECT_SEAL_FAILED" };
  }

  const completedAt = elapsedNow();
  const completedAtEpoch = documentEpochSeconds(completedAt)!;

  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          INSERT INTO media_deletion_outbox (
            id, media_object_id, object_key, reason, not_before,
            attempt_count, next_attempt_at, lease_id, lease_expires_at,
            last_error_code, completed_at, created_at, updated_at
          )
          SELECT ?, id, upload_object_key, 'UPLOAD_STAGING_EXPIRED',
                 upload_expires_at + ?, 0, upload_expires_at + ?,
                 NULL, NULL, NULL, NULL, ?, ?
          FROM media_objects
          WHERE id = ? AND owner_id = ? AND state = 'SEALING'
            AND seal_lease_id = ?
            AND seal_lease_expires_at > ?
        `,
        params: [
          stagingCleanupOutboxId(input.mediaObjectId),
          MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
          MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
          completedAtEpoch,
          completedAtEpoch,
          input.mediaObjectId,
          input.ownerId,
          sealLeaseId,
          completedAtEpoch,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      {
        query: `
          UPDATE media_objects
          SET state = 'READY', actual_size_bytes = ?, etag = ?,
              ready_at = ?, seal_lease_id = NULL,
              seal_lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND owner_id = ? AND state = 'SEALING'
            AND seal_lease_id = ?
            AND expected_content_type = ? AND expected_size_bytes = ?
            AND seal_lease_expires_at > ?
        `,
        params: [
          sealedHead.size,
          sealedHead.etag,
          completedAtEpoch,
          completedAtEpoch,
          input.mediaObjectId,
          input.ownerId,
          sealLeaseId,
          media.expectedContentType,
          media.expectedSizeBytes,
          completedAtEpoch,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
  } catch {
    const raced = await findOwnedMediaObject(
      context,
      input.ownerId,
      input.mediaObjectId,
    );
    if (raced && (raced.state === "READY" || raced.state === "ATTACHED")) {
      return { ok: true, media: raced, replayed: true };
    }
    // seal side effect 뒤 DB fence를 잃으면 즉시 보상 삭제를 시도한다.
    // 실패하거나 늦은 copy가 있어도 SEALING 만료 outbox가 다시 수렴시킨다.
    await runStorageOperationWithTimeout(
      MEDIA_DELETE_REQUEST_TIMEOUT_MS,
      (signal) => storage.delete(media.objectKey, signal),
    ).catch(() => undefined);
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
  }

  const completed = await findOwnedMediaObject(
    context,
    input.ownerId,
    input.mediaObjectId,
  );
  return completed
    ? { ok: true, media: completed, replayed: false }
    : { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
}

function finalDeletionOutboxId(mediaObjectId: string): string {
  return `media-delete-final:${mediaObjectId}`;
}

function stagingCleanupOutboxId(mediaObjectId: string): string {
  return `media-delete-upload:${mediaObjectId}`;
}

export async function queueOwnedMediaDeletion(
  context: DbContext,
  input: {
    ownerId: string;
    mediaObjectId: string;
    reason: Extract<
      MediaDeletionReason,
      "ABANDONED_UPLOAD" | "UPLOAD_VERIFICATION_FAILED" | "ADMIN_CLEANUP"
    >;
    now: Date;
  },
): Promise<boolean> {
  const current = await findOwnedMediaObject(
    context,
    input.ownerId,
    input.mediaObjectId,
  );
  if (!current) return false;
  if (current.state === "PENDING_DELETE" || current.state === "DELETED") {
    return true;
  }
  if (current.state === "SEALING" || current.state === "ATTACHED") return false;

  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          INSERT INTO media_deletion_outbox (
            id, media_object_id, object_key, reason, not_before,
            attempt_count, next_attempt_at, lease_id, lease_expires_at,
            last_error_code, completed_at, created_at, updated_at
          )
          SELECT ?, id, upload_object_key, 'UPLOAD_STAGING_EXPIRED',
                 max(?, upload_expires_at + ?), 0,
                 max(?, upload_expires_at + ?),
                 NULL, NULL, NULL, NULL, ?, ?
          FROM media_objects AS media
          WHERE media.id = ? AND media.owner_id = ?
            AND media.state IN ('PENDING_UPLOAD', 'READY')
            AND NOT EXISTS (
              SELECT 1 FROM media_deletion_outbox AS existing
              WHERE existing.id = ?
                 OR (
                   existing.media_object_id = media.id
                   AND existing.object_key = media.upload_object_key
                 )
            )
        `,
        params: [
          stagingCleanupOutboxId(input.mediaObjectId),
          documentEpochSeconds(input.now),
          MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
          documentEpochSeconds(input.now),
          MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
          documentEpochSeconds(input.now),
          documentEpochSeconds(input.now),
          input.mediaObjectId,
          input.ownerId,
          stagingCleanupOutboxId(input.mediaObjectId),
        ],
      },
      {
        query: `
          INSERT INTO media_deletion_outbox (
            id, media_object_id, object_key, reason, not_before,
            attempt_count, next_attempt_at, lease_id, lease_expires_at,
            last_error_code, completed_at, created_at, updated_at
          )
          SELECT ?, id, object_key, ?, ?, 0, ?,
                 NULL, NULL, NULL, NULL, ?, ?
          FROM media_objects
          WHERE id = ? AND owner_id = ? AND state IN ('PENDING_UPLOAD', 'READY')
        `,
        params: [
          finalDeletionOutboxId(input.mediaObjectId),
          input.reason,
          documentEpochSeconds(input.now),
          documentEpochSeconds(input.now),
          documentEpochSeconds(input.now),
          documentEpochSeconds(input.now),
          input.mediaObjectId,
          input.ownerId,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      {
        query: `
          UPDATE media_objects
          SET state = 'PENDING_DELETE', delete_requested_at = ?, updated_at = ?
          WHERE id = ? AND owner_id = ? AND state IN ('PENDING_UPLOAD', 'READY')
        `,
        params: [
          documentEpochSeconds(input.now),
          documentEpochSeconds(input.now),
          input.mediaObjectId,
          input.ownerId,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return true;
  } catch {
    const raced = await findOwnedMediaObject(
      context,
      input.ownerId,
      input.mediaObjectId,
    );
    return raced?.state === "PENDING_DELETE" || raced?.state === "DELETED";
  }
}

export function mediaClaimStatements(input: {
  mediaObjectId: string | null;
  ownerId: string;
  purpose: MediaPurpose;
  draftOperationId: string;
  resourceType: MediaResourceType;
  resourceId: string;
  now: Date;
}): DocumentAtomicStatement[] {
  if (!input.mediaObjectId) return [];
  return [
    {
      query: `
        UPDATE media_objects
        SET state = 'ATTACHED', resource_type = ?, resource_id = ?,
            attached_at = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND purpose = ? AND state = 'READY'
          AND draft_operation_id = ?
          AND resource_type IS NULL AND resource_id IS NULL
          AND ready_at >= ?
      `,
      params: [
        input.resourceType,
        input.resourceId,
        documentEpochSeconds(input.now),
        documentEpochSeconds(input.now),
        input.mediaObjectId,
        input.ownerId,
        input.purpose,
        input.draftOperationId,
        documentEpochSeconds(input.now)! - MEDIA_DRAFT_RETENTION_SECONDS,
      ],
    },
    DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  ];
}

/**
 * 본문이 참조하는 저장자 소유 READY 본문 이미지를 이 문서에 연결한다.
 * 다른 사람 이미지·이미 연결된 이미지·없는 ID는 건드리지 않으므로 저장을 막지 않는다.
 */
export function documentImageClaimStatements(input: {
  contentHtml: string;
  ownerId: string;
  resourceType: MediaResourceType;
  resourceId: string;
  now: Date;
}): DocumentAtomicStatement[] {
  const mediaIds = extractDocumentImageMediaIds(input.contentHtml);
  const now = documentEpochSeconds(input.now)!;
  const statements: DocumentAtomicStatement[] = [];
  for (
    let offset = 0;
    offset < mediaIds.length;
    offset += DOCUMENT_IMAGE_CLAIM_BATCH_SIZE
  ) {
    const batch = mediaIds.slice(offset, offset + DOCUMENT_IMAGE_CLAIM_BATCH_SIZE);
    statements.push({
      query: `
        UPDATE media_objects
        SET state = 'ATTACHED', resource_type = ?, resource_id = ?,
            attached_at = ?, updated_at = ?
        WHERE purpose = 'DOCUMENT_IMAGE' AND owner_id = ? AND state = 'READY'
          AND resource_type IS NULL AND resource_id IS NULL
          AND ready_at >= ?
          AND id IN (${batch.map(() => "?").join(", ")})
      `,
      params: [
        input.resourceType,
        input.resourceId,
        now,
        now,
        input.ownerId,
        now - MEDIA_DRAFT_RETENTION_SECONDS,
        ...batch,
      ],
    });
  }
  return statements;
}

export function postMediaPurgeStatements(input: {
  postId: string;
  now: Date;
}): DocumentAtomicStatement[] {
  const now = documentEpochSeconds(input.now);
  return [
    {
      query: `
        INSERT INTO media_deletion_outbox (
          id, media_object_id, object_key, reason, not_before,
          attempt_count, next_attempt_at, lease_id, lease_expires_at,
          last_error_code, completed_at, created_at, updated_at
        )
        SELECT 'media-delete-final:' || id, id, object_key, 'RESOURCE_PURGED',
               ?, 0, ?,
               NULL, NULL, NULL, NULL, ?, ?
        FROM media_objects
        WHERE resource_type = 'COMMUNITY_POST' AND resource_id = ?
          AND state = 'ATTACHED'
      `,
      params: [now, now, now, now, input.postId],
    },
    {
      query: `
        UPDATE media_objects
        SET state = 'PENDING_DELETE', delete_requested_at = ?, updated_at = ?
        WHERE resource_type = 'COMMUNITY_POST' AND resource_id = ?
          AND state = 'ATTACHED'
      `,
      params: [now, now, input.postId],
    },
  ];
}

/** 노트를 완전히 지울 때 본문 이미지를 durable 삭제 outbox로 넘긴다. */
export function privateNoteMediaPurgeStatements(input: {
  noteId: string;
  now: Date;
}): DocumentAtomicStatement[] {
  const now = documentEpochSeconds(input.now);
  return [
    {
      query: `
        INSERT INTO media_deletion_outbox (
          id, media_object_id, object_key, reason, not_before,
          attempt_count, next_attempt_at, lease_id, lease_expires_at,
          last_error_code, completed_at, created_at, updated_at
        )
        SELECT 'media-delete-final:' || id, id, object_key, 'RESOURCE_PURGED',
               ?, 0, ?,
               NULL, NULL, NULL, NULL, ?, ?
        FROM media_objects
        WHERE resource_type = 'PRIVATE_NOTE' AND resource_id = ?
          AND state = 'ATTACHED'
      `,
      params: [now, now, now, now, input.noteId],
    },
    {
      query: `
        UPDATE media_objects
        SET state = 'PENDING_DELETE', delete_requested_at = ?, updated_at = ?
        WHERE resource_type = 'PRIVATE_NOTE' AND resource_id = ?
          AND state = 'ATTACHED'
      `,
      params: [now, now, input.noteId],
    },
  ];
}

export function qnaMediaPurgeStatements(input: {
  threadId: string;
  now: Date;
}): DocumentAtomicStatement[] {
  const now = documentEpochSeconds(input.now);
  return [
    {
      query: `
        INSERT INTO media_deletion_outbox (
          id, media_object_id, object_key, reason, not_before,
          attempt_count, next_attempt_at, lease_id, lease_expires_at,
          last_error_code, completed_at, created_at, updated_at
        )
        SELECT 'media-delete-final:' || media.id, media.id, media.object_key,
               'RESOURCE_PURGED', ?, 0, ?,
               NULL, NULL, NULL, NULL, ?, ?
        FROM media_objects AS media
        JOIN qna_replies AS reply ON reply.id = media.resource_id
        WHERE media.resource_type = 'QNA_REPLY'
          AND reply.thread_id = ? AND media.state = 'ATTACHED'
      `,
      params: [now, now, now, now, input.threadId],
    },
    {
      query: `
        UPDATE media_objects
        SET state = 'PENDING_DELETE', delete_requested_at = ?, updated_at = ?
        WHERE resource_type = 'QNA_REPLY' AND state = 'ATTACHED'
          AND resource_id IN (
            SELECT id FROM qna_replies WHERE thread_id = ?
          )
      `,
      params: [now, now, input.threadId],
    },
  ];
}

export async function enqueueExpiredUnattachedMedia(
  context: DbContext,
  now: Date,
  requestedLimit = 25,
): Promise<void> {
  const nowEpoch = documentEpochSeconds(now)!;
  const readyCutoff = nowEpoch - MEDIA_DRAFT_RETENTION_SECONDS;
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 25;
  await executeDocumentStatementsAtomically(context, [
    {
      query: `
        WITH expired_media AS (
          SELECT id, upload_object_key, object_key, state,
                 upload_expires_at, seal_lease_expires_at, ready_at
          FROM media_objects
          WHERE (state = 'PENDING_UPLOAD' AND upload_expires_at < ?)
             OR (state = 'SEALING' AND seal_lease_expires_at <= ?)
             OR (state = 'READY' AND ready_at < ?)
          ORDER BY CASE state
                     WHEN 'PENDING_UPLOAD' THEN upload_expires_at
                     WHEN 'SEALING' THEN seal_lease_expires_at
                     ELSE ready_at
                   END,
                   id
          LIMIT ?
        )
        INSERT INTO media_deletion_outbox (
          id, media_object_id, object_key, reason, not_before,
          attempt_count, next_attempt_at, lease_id, lease_expires_at,
          last_error_code, completed_at, created_at, updated_at
        )
        SELECT 'media-delete-upload:' || id, id, upload_object_key,
               'UPLOAD_STAGING_EXPIRED', max(?, upload_expires_at + ?),
               0, max(?, upload_expires_at + ?),
               NULL, NULL, NULL, NULL, ?, ?
        FROM expired_media AS media
        WHERE NOT EXISTS (
          SELECT 1 FROM media_deletion_outbox AS existing
          WHERE existing.id = 'media-delete-upload:' || media.id
             OR (
               existing.media_object_id = media.id
               AND existing.object_key = media.upload_object_key
             )
        )
      `,
      params: [
        nowEpoch,
        nowEpoch,
        readyCutoff,
        limit,
        nowEpoch,
        MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
        nowEpoch,
        MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
        nowEpoch,
        nowEpoch,
      ],
    },
    {
      query: `
        WITH expired_media AS (
          SELECT id, upload_object_key, object_key, state,
                 upload_expires_at, seal_lease_expires_at, ready_at
          FROM media_objects
          WHERE (state = 'PENDING_UPLOAD' AND upload_expires_at < ?)
             OR (state = 'SEALING' AND seal_lease_expires_at <= ?)
             OR (state = 'READY' AND ready_at < ?)
          ORDER BY CASE state
                     WHEN 'PENDING_UPLOAD' THEN upload_expires_at
                     WHEN 'SEALING' THEN seal_lease_expires_at
                     ELSE ready_at
                   END,
                   id
          LIMIT ?
        )
        INSERT INTO media_deletion_outbox (
          id, media_object_id, object_key, reason, not_before,
          attempt_count, next_attempt_at, lease_id, lease_expires_at,
          last_error_code, completed_at, created_at, updated_at
        )
        SELECT 'media-delete-final:' || id, id, object_key,
               'EXPIRED_UNATTACHED',
               CASE WHEN state = 'SEALING'
                    THEN seal_lease_expires_at + ? ELSE ? END,
               0,
               CASE WHEN state = 'SEALING'
                    THEN seal_lease_expires_at + ? ELSE ? END,
               NULL, NULL, NULL, NULL, ?, ?
        FROM expired_media AS media
        WHERE NOT EXISTS (
          SELECT 1 FROM media_deletion_outbox AS existing
          WHERE existing.id = 'media-delete-final:' || media.id
             OR (
               existing.media_object_id = media.id
               AND existing.object_key = media.object_key
             )
        )
      `,
      params: [
        nowEpoch,
        nowEpoch,
        readyCutoff,
        limit,
        MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
        nowEpoch,
        MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
        nowEpoch,
        nowEpoch,
        nowEpoch,
      ],
    },
    {
      query: `
        WITH expired_media AS (
          SELECT id, state, upload_expires_at, seal_lease_expires_at, ready_at
          FROM media_objects
          WHERE (state = 'PENDING_UPLOAD' AND upload_expires_at < ?)
             OR (state = 'SEALING' AND seal_lease_expires_at <= ?)
             OR (state = 'READY' AND ready_at < ?)
          ORDER BY CASE state
                     WHEN 'PENDING_UPLOAD' THEN upload_expires_at
                     WHEN 'SEALING' THEN seal_lease_expires_at
                     ELSE ready_at
                   END,
                   id
          LIMIT ?
        )
        UPDATE media_objects
        SET state = 'PENDING_DELETE', seal_lease_id = NULL,
            seal_lease_expires_at = NULL,
            delete_requested_at = ?, updated_at = ?
        WHERE id IN (SELECT id FROM expired_media)
          AND id IN (
            SELECT media_object_id FROM media_deletion_outbox
            WHERE completed_at IS NULL AND reason = 'EXPIRED_UNATTACHED'
          ) AND (
          (state = 'PENDING_UPLOAD' AND upload_expires_at < ?)
          OR (state = 'SEALING' AND seal_lease_expires_at <= ?)
          OR (state = 'READY' AND ready_at < ?)
        )
      `,
      params: [
        nowEpoch,
        nowEpoch,
        readyCutoff,
        limit,
        nowEpoch,
        nowEpoch,
        nowEpoch,
        nowEpoch,
        readyCutoff,
      ],
    },
  ]);
}

export type ProcessMediaDeletionResult = {
  completed: number;
  failed: number;
};

function safeStorageErrorCode(error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "$metadata" in error
      ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined;
  if (status) return `HTTP_${status}`;
  const name = error instanceof Error ? error.name : "STORAGE_ERROR";
  const normalized = name.toUpperCase().replace(/[^A-Z0-9_]/gu, "_").slice(0, 64);
  return normalized || "STORAGE_ERROR";
}

async function finalizeMediaDeletionIfReady(
  context: DbContext,
  mediaObjectId: string,
  now: Date,
): Promise<void> {
  const [media] = await asDocumentReadDb(context)
    .select({ state: mediaObjects.state, objectKey: mediaObjects.objectKey })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  if (!media || media.state !== "PENDING_DELETE") return;

  const jobs = await asDocumentReadDb(context)
    .select({
      objectKey: mediaDeletionOutbox.objectKey,
      completedAt: mediaDeletionOutbox.completedAt,
    })
    .from(mediaDeletionOutbox)
    .where(eq(mediaDeletionOutbox.mediaObjectId, mediaObjectId));
  if (
    jobs.length === 0 ||
    jobs.some((job) => job.completedAt === null) ||
    !jobs.some(
      (job) => job.objectKey === media.objectKey && job.completedAt !== null,
    )
  ) {
    return;
  }

  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          UPDATE media_objects
          SET state = 'DELETED', deleted_at = ?, updated_at = ?
          WHERE id = ? AND state = 'PENDING_DELETE'
            AND EXISTS (
              SELECT 1 FROM media_deletion_outbox AS final_job
              WHERE final_job.media_object_id = media_objects.id
                AND final_job.object_key = media_objects.object_key
                AND final_job.completed_at IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM media_deletion_outbox AS pending_job
              WHERE pending_job.media_object_id = media_objects.id
                AND pending_job.completed_at IS NULL
            )
        `,
        params: [
          documentEpochSeconds(now),
          documentEpochSeconds(now),
          mediaObjectId,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
  } catch {
    // 다른 worker가 먼저 수렴했거나 새 cleanup job이 생기면 다음 완료 경계에서 재평가한다.
  }
}

async function convergeCompletedMediaDeletions(
  context: DbContext,
  now: Date,
  limit: number,
): Promise<void> {
  const pending = await asDocumentReadDb(context)
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.state, "PENDING_DELETE"),
        sql`EXISTS (
          SELECT 1 FROM media_deletion_outbox AS final_job
          WHERE final_job.media_object_id = ${mediaObjects.id}
            AND final_job.object_key = ${mediaObjects.objectKey}
            AND final_job.completed_at IS NOT NULL
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM media_deletion_outbox AS pending_job
          WHERE pending_job.media_object_id = ${mediaObjects.id}
            AND pending_job.completed_at IS NULL
        )`,
      ),
    )
    .orderBy(asc(mediaObjects.updatedAt), asc(mediaObjects.id))
    .limit(limit);
  for (const media of pending) {
    await finalizeMediaDeletionIfReady(context, media.id, now);
  }
}

export async function processMediaDeletionOutbox(
  context: DbContext,
  storage: MediaObjectDeletionStorage,
  options: {
    now?: Date;
    limit?: number;
    leaseSeconds?: number;
    deleteTimeoutMs?: number;
    shouldContinue?: () => boolean;
  } = {},
): Promise<ProcessMediaDeletionResult> {
  if (options.shouldContinue && !options.shouldContinue()) {
    return { completed: 0, failed: 0 };
  }
  const queryNow = options.now ?? new Date();
  const requestedLimit = options.limit ?? 5;
  const requestedLeaseSeconds = options.leaseSeconds ?? 60;
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 25)
    : 5;
  const leaseSeconds = Number.isSafeInteger(requestedLeaseSeconds)
    ? Math.min(Math.max(requestedLeaseSeconds, 10), 300)
    : 60;
  const requestedDeleteTimeoutMs =
    options.deleteTimeoutMs ?? MEDIA_DELETE_REQUEST_TIMEOUT_MS;
  const deleteTimeoutMs = Number.isSafeInteger(requestedDeleteTimeoutMs)
    ? Math.min(
        Math.max(requestedDeleteTimeoutMs, 1),
        MEDIA_DELETE_REQUEST_TIMEOUT_MS,
      )
    : MEDIA_DELETE_REQUEST_TIMEOUT_MS;
  try {
    await convergeCompletedMediaDeletions(context, queryNow, limit);
  } catch {
    // 이미 완료된 outbox의 finalization은 다음 runner 시작에서 다시 수렴한다.
  }
  const candidates = await asDocumentReadDb(context)
    .select()
    .from(mediaDeletionOutbox)
    .where(
      and(
        isNull(mediaDeletionOutbox.completedAt),
        lte(mediaDeletionOutbox.notBefore, queryNow),
        lte(mediaDeletionOutbox.nextAttemptAt, queryNow),
        or(
          isNull(mediaDeletionOutbox.leaseExpiresAt),
          lte(mediaDeletionOutbox.leaseExpiresAt, queryNow),
        ),
      ),
    )
    .orderBy(asc(mediaDeletionOutbox.nextAttemptAt), asc(mediaDeletionOutbox.id))
    .limit(limit);

  let completed = 0;
  let failed = 0;
  for (const candidate of candidates) {
    if (options.shouldContinue && !options.shouldContinue()) break;
    const leaseNow = options.now ?? new Date();
    const leaseId = crypto.randomUUID();
    const leaseExpiresAt = new Date(leaseNow.getTime() + leaseSeconds * 1_000);
    try {
      await executeDocumentStatementsAtomically(context, [
        {
          query: `
            UPDATE media_deletion_outbox
            SET lease_id = ?, lease_expires_at = ?, updated_at = ?
            WHERE id = ? AND completed_at IS NULL AND next_attempt_at <= ?
              AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
          `,
          params: [
            leaseId,
            documentEpochSeconds(leaseExpiresAt),
            documentEpochSeconds(leaseNow),
            candidate.id,
            documentEpochSeconds(leaseNow),
            documentEpochSeconds(leaseNow),
          ],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ]);
    } catch {
      continue;
    }

    try {
      await runStorageOperationWithTimeout(deleteTimeoutMs, (signal) =>
        storage.delete(candidate.objectKey, signal),
      );
      const completedAt = options.now ?? new Date();
      await executeDocumentStatementsAtomically(context, [
        {
          query: `
            UPDATE media_deletion_outbox
            SET completed_at = ?, lease_id = NULL, lease_expires_at = NULL,
                last_error_code = NULL, updated_at = ?
            WHERE id = ? AND lease_id = ? AND completed_at IS NULL
          `,
          params: [
            documentEpochSeconds(completedAt),
            documentEpochSeconds(completedAt),
            candidate.id,
            leaseId,
          ],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ]);
      await finalizeMediaDeletionIfReady(
        context,
        candidate.mediaObjectId,
        completedAt,
      );
      completed += 1;
    } catch (error: unknown) {
      const attemptCount = candidate.attemptCount + 1;
      const failedAt = options.now ?? new Date();
      const retryAt = new Date(
        failedAt.getTime() + mediaDeletionBackoffSeconds(attemptCount) * 1_000,
      );
      try {
        await executeDocumentStatementsAtomically(context, [
          {
            query: `
              UPDATE media_deletion_outbox
              SET attempt_count = ?, next_attempt_at = ?,
                  lease_id = NULL, lease_expires_at = NULL,
                  last_error_code = ?, updated_at = ?
              WHERE id = ? AND lease_id = ? AND completed_at IS NULL
            `,
            params: [
              attemptCount,
              documentEpochSeconds(retryAt),
              safeStorageErrorCode(error),
              documentEpochSeconds(failedAt),
              candidate.id,
              leaseId,
            ],
          },
          DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
        ]);
      } catch {
        // lease 만료 뒤 같은 object delete를 재시도하며 수렴한다.
      }
      failed += 1;
    }
  }

  return { completed, failed };
}

/** 사용자 요청 뒤 bounded cleanup을 시도하되 durable outbox 결과를 되돌리지는 않는다. */
export async function processMediaDeletionOutboxBestEffort(
  context: DbContext,
  options: { now?: Date; limit?: number; enqueueExpired?: boolean } = {},
): Promise<ProcessMediaDeletionResult | null> {
  try {
    if (options.enqueueExpired) {
      await enqueueExpiredUnattachedMedia(context, options.now ?? new Date());
    }
    return await processMediaDeletionOutbox(
      context,
      await getMediaObjectStorage(),
      { now: options.now, limit: options.limit ?? 1 },
    );
  } catch {
    return null;
  }
}
