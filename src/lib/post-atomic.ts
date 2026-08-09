import { and, eq } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import {
  postRevisions,
  posts,
  type BoardType,
  type PostRevisionChangeType,
} from "@/db/schema";
import {
  DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  asDocumentReadDb,
  documentEpochSeconds,
  documentLedgerInsertStatement,
  executeDocumentStatementsAtomically,
  findDocumentOperationReceipt,
  findDocumentTombstone,
  persistedDocumentDate,
  type DocumentAtomicActor,
  type DocumentAtomicStatement,
} from "@/lib/document-lifecycle-atomic";
import {
  POST_REQUEST_HASH_VERSION,
  POST_SNAPSHOT_HASH_VERSION,
  POST_TRASH_RETENTION_SECONDS,
  createPostRequestHash,
  createPostRequestHashForVersion,
  createPostSnapshotHash,
  createPostSnapshotHashForVersion,
  derivePostRevisionId,
  type PostCanonicalRequest,
  type PostCanonicalSnapshot,
} from "@/lib/post-continuity";
import { deriveDocumentOperationRecordId } from "@/lib/private-note-continuity";
import {
  mediaClaimStatements,
  postMediaPurgeStatements,
} from "@/lib/media-lifecycle-atomic";

type PostHead = {
  id: string;
  authorId: string;
  category: string;
  boardType: BoardType;
  isPinned: boolean;
  mediaUrl: string | null;
  mediaObjectId: string | null;
  title: string;
  contentHtml: string;
  createdAt: Date | null;
  updatedAt: Date;
  version: number;
  deletedAt: Date | null;
};

export type PostResourceState = "ACTIVE" | "TRASHED" | "PURGED";

export type PostMutationFailureReason =
  | "VERSION_CONFLICT"
  | "TRASHED"
  | "PURGED"
  | "OPERATION_PAYLOAD_CONFLICT"
  | "OPERATION_VERSION_UNSUPPORTED"
  | "RETENTION_NOT_EXPIRED"
  | "RETENTION_EXPIRED"
  | "NOT_FOUND_OR_FORBIDDEN"
  | "INTERNAL_INVARIANT_FAILURE";

export type PostMutationResult =
  | {
      ok: true;
      postId: string;
      replayed: boolean;
      resourceState: PostResourceState;
      operationResultRevision: number;
      currentRevision: number | null;
      createdAt?: Date;
    }
  | {
      ok: false;
      reason: PostMutationFailureReason;
      postId?: string;
      currentRevision?: number;
    };

export type CreatePostWrite = {
  actor: DocumentAtomicActor;
  postId: string;
  operationId: string;
  snapshot: Omit<PostCanonicalSnapshot, "deletedAt">;
  now: Date;
};

export type UpdatePostWrite = {
  actor: DocumentAtomicActor;
  postId: string;
  operationId: string;
  baseRevision: number;
  title: string;
  contentHtml: string;
  now: Date;
};

export type SetPostPinWrite = {
  actor: DocumentAtomicActor;
  postId: string;
  operationId: string;
  baseRevision: number;
  isPinned: boolean;
  now: Date;
};

export type PostLifecycleWrite = {
  actor: DocumentAtomicActor;
  postId: string;
  operationId: string;
  baseRevision: number;
  now: Date;
};

export type RestorePostRevisionWrite = PostLifecycleWrite & {
  revisionNumber: number;
};

function postSnapshot(head: PostHead, deletedAt = head.deletedAt): PostCanonicalSnapshot {
  return {
    category: head.category,
    boardType: head.boardType,
    isPinned: head.isPinned,
    mediaUrl: head.mediaUrl,
    mediaObjectId: head.mediaObjectId,
    title: head.title,
    contentHtml: head.contentHtml,
    deletedAt,
  };
}

function snapshotsEqual(
  left: PostCanonicalSnapshot,
  right: PostCanonicalSnapshot,
): boolean {
  return (
    left.category === right.category &&
    left.boardType === right.boardType &&
    left.isPinned === right.isPinned &&
    left.mediaUrl === right.mediaUrl &&
    left.mediaObjectId === right.mediaObjectId &&
    left.title === right.title &&
    left.contentHtml === right.contentHtml &&
    documentEpochSeconds(left.deletedAt) === documentEpochSeconds(right.deletedAt)
  );
}

async function findPost(context: DbContext, postId: string): Promise<PostHead | null> {
  const [post] = await asDocumentReadDb(context)
    .select({
      id: posts.id,
      authorId: posts.authorId,
      category: posts.category,
      boardType: posts.boardType,
      isPinned: posts.isPinned,
      mediaUrl: posts.mediaUrl,
      mediaObjectId: posts.mediaObjectId,
      title: posts.title,
      contentHtml: posts.contentHtml,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      version: posts.version,
      deletedAt: posts.deletedAt,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  return post ?? null;
}

function canMutatePost(actor: DocumentAtomicActor, post: PostHead): boolean {
  return actor.isAdmin || actor.id === post.authorId;
}

function canAccessPostTombstone(
  actor: DocumentAtomicActor,
  tombstone: { ownerId: string },
): boolean {
  return actor.isAdmin || actor.id === tombstone.ownerId;
}

function postRevisionInsertStatement(input: {
  revisionId: string;
  postId: string;
  revisionNumber: number;
  changeType: Exclude<PostRevisionChangeType, "BASELINE">;
  snapshot: PostCanonicalSnapshot;
  actorId: string;
  restoredFromRevision?: number | null;
  operationRecordId: string;
  now: Date;
}): DocumentAtomicStatement {
  return {
    query: `
      INSERT INTO post_revisions (
        id, post_id, revision_number, change_type, category, board_type,
        is_pinned, media_url, media_object_id, title, content_html, deleted_at,
        snapshot_hash, snapshot_hash_version, actor_id,
        restored_from_revision, operation_record_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      input.revisionId,
      input.postId,
      input.revisionNumber,
      input.changeType,
      input.snapshot.category,
      input.snapshot.boardType,
      Number(input.snapshot.isPinned),
      input.snapshot.mediaUrl,
      input.snapshot.mediaObjectId,
      input.snapshot.title,
      input.snapshot.contentHtml,
      documentEpochSeconds(input.snapshot.deletedAt),
      createPostSnapshotHash(input.snapshot),
      POST_SNAPSHOT_HASH_VERSION,
      input.actorId,
      input.restoredFromRevision ?? null,
      input.operationRecordId,
      documentEpochSeconds(input.now),
    ],
  };
}

async function resolvePostReceiptReplay(
  context: DbContext,
  input: {
    actor: DocumentAtomicActor;
    operationId: string;
    operationType: PostCanonicalRequest["operationType"];
    request: PostCanonicalRequest;
  },
): Promise<PostMutationResult | null> {
  const receipt = await findDocumentOperationReceipt(
    context,
    input.actor.id,
    input.operationId,
  );
  if (!receipt) return null;

  const requestHash = createPostRequestHashForVersion(
    input.request,
    receipt.requestHashVersion,
  );
  if (!requestHash) return { ok: false, reason: "OPERATION_VERSION_UNSUPPORTED" };
  if (
    receipt.resourceType !== "COMMUNITY_POST" ||
    receipt.operationType !== input.operationType ||
    receipt.requestHash !== requestHash
  ) {
    return {
      ok: false,
      reason: "OPERATION_PAYLOAD_CONFLICT",
      postId: receipt.resourceId,
    };
  }

  const post = await findPost(context, receipt.resourceId);
  const tombstone = post
    ? null
    : await findDocumentTombstone(context, "COMMUNITY_POST", receipt.resourceId);

  if (input.operationType === "PURGE") {
    if (!input.actor.isAdmin || !tombstone) {
      return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    }
    return {
      ok: true,
      postId: receipt.resourceId,
      replayed: true,
      resourceState: "PURGED",
      operationResultRevision: receipt.resultRevision,
      currentRevision: null,
    };
  }

  if (tombstone) {
    return canAccessPostTombstone(input.actor, tombstone)
      ? { ok: false, reason: "PURGED", postId: receipt.resourceId }
      : { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (!post || post.authorId !== receipt.subjectId || !canMutatePost(input.actor, post)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (post.deletedAt && input.operationType !== "TRASH" && input.operationType !== "RESTORE_TRASH") {
    return {
      ok: false,
      reason: "TRASHED",
      postId: post.id,
      currentRevision: post.version,
    };
  }

  return {
    ok: true,
    postId: post.id,
    replayed: true,
    resourceState: post.deletedAt ? "TRASHED" : "ACTIVE",
    operationResultRevision: receipt.resultRevision,
    currentRevision: post.version,
    createdAt: post.createdAt ?? undefined,
  };
}

function createPostCreateRequest(
  write: Omit<CreatePostWrite, "now">,
): PostCanonicalRequest {
  return {
    operationType: "CREATE",
    resourceId: write.postId,
    subjectId: write.actor.id,
    baseRevision: null,
    snapshot: { ...write.snapshot, deletedAt: null },
  };
}

/**
 * 0010에서 발급한 v1 영수증과 정확히 일치하는 URL-only 생성 재실행인지
 * 쓰기 전에 판별한다. 신규 요청이나 v2 영수증은 의도적으로 허용하지 않는다.
 */
export async function preflightLegacyPostCreateReplay(
  context: DbContext,
  write: Omit<CreatePostWrite, "now">,
): Promise<boolean> {
  const receipt = await findDocumentOperationReceipt(
    context,
    write.actor.id,
    write.operationId,
  );
  if (receipt?.requestHashVersion !== 1) return false;

  const replay = await resolvePostReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "CREATE",
    request: createPostCreateRequest(write),
  });
  return Boolean(replay?.ok && replay.replayed);
}

async function classifyPostMutation(
  context: DbContext,
  actor: DocumentAtomicActor,
  postId: string,
  baseRevision?: number,
): Promise<PostMutationResult> {
  const post = await findPost(context, postId);
  if (post) {
    if (!canMutatePost(actor, post)) {
      return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    }
    if (post.deletedAt) {
      return { ok: false, reason: "TRASHED", postId, currentRevision: post.version };
    }
    if (baseRevision !== undefined && post.version !== baseRevision) {
      return {
        ok: false,
        reason: "VERSION_CONFLICT",
        postId,
        currentRevision: post.version,
      };
    }
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
  }

  const tombstone = await findDocumentTombstone(context, "COMMUNITY_POST", postId);
  if (tombstone && canAccessPostTombstone(actor, tombstone)) {
    return { ok: false, reason: "PURGED", postId };
  }
  return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
}

export async function createPostAtomically(
  context: DbContext,
  write: CreatePostWrite,
): Promise<PostMutationResult> {
  const snapshot: PostCanonicalSnapshot = { ...write.snapshot, deletedAt: null };
  const request = createPostCreateRequest(write);
  const requestHash = createPostRequestHash(request);
  const replay = await resolvePostReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "CREATE",
    request,
  });
  if (replay) return replay;

  const tombstone = await findDocumentTombstone(
    context,
    "COMMUNITY_POST",
    write.postId,
  );
  if (tombstone) {
    return canAccessPostTombstone(write.actor, tombstone)
      ? { ok: false, reason: "PURGED", postId: write.postId }
      : { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }

  const existing = await findPost(context, write.postId);
  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  if (existing) {
    if (existing.authorId !== write.actor.id) {
      return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    }
    if (existing.deletedAt) {
      return {
        ok: false,
        reason: "TRASHED",
        postId: existing.id,
        currentRevision: existing.version,
      };
    }
    if (!snapshotsEqual(postSnapshot(existing), snapshot)) {
      return {
        ok: false,
        reason: "OPERATION_PAYLOAD_CONFLICT",
        postId: existing.id,
        currentRevision: existing.version,
      };
    }
    try {
      await executeDocumentStatementsAtomically(context, [
        {
          query: `
            INSERT INTO document_operation_ledger (
              id, operation_id, actor_id, subject_id, resource_type,
              operation_type, resource_id, request_hash, request_hash_version,
              result_revision, created_at
            )
            SELECT ?, ?, ?, author_id, 'COMMUNITY_POST', 'CREATE', id, ?, ?, version, ?
            FROM posts
            WHERE id = ? AND author_id = ? AND deleted_at IS NULL
              AND category = ? AND board_type = ? AND is_pinned = ?
              AND media_url IS ? AND media_object_id IS ?
              AND title = ? AND content_html = ?
          `,
          params: [
            recordId,
            write.operationId,
            write.actor.id,
            requestHash,
            POST_REQUEST_HASH_VERSION,
            documentEpochSeconds(write.now),
            write.postId,
            write.actor.id,
            snapshot.category,
            snapshot.boardType,
            Number(snapshot.isPinned),
            snapshot.mediaUrl,
            snapshot.mediaObjectId,
            snapshot.title,
            snapshot.contentHtml,
          ],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ]);
      return {
        ok: true,
        postId: existing.id,
        replayed: true,
        resourceState: "ACTIVE",
        operationResultRevision: existing.version,
        currentRevision: existing.version,
        createdAt: existing.createdAt ?? undefined,
      };
    } catch {
      return (
        (await resolvePostReceiptReplay(context, {
          actor: write.actor,
          operationId: write.operationId,
          operationType: "CREATE",
          request,
        })) ?? { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" }
      );
    }
  }

  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: write.actor.id,
        resourceType: "COMMUNITY_POST",
        operationType: "CREATE",
        resourceId: write.postId,
        requestHash,
        requestHashVersion: POST_REQUEST_HASH_VERSION,
        resultRevision: 1,
        now: write.now,
      }),
      ...mediaClaimStatements({
        mediaObjectId: snapshot.mediaObjectId,
        ownerId: write.actor.id,
        purpose: "COMMUNITY_POST_AUDIO",
        draftOperationId: write.operationId,
        resourceType: "COMMUNITY_POST",
        resourceId: write.postId,
        now: write.now,
      }),
      {
        query: `
          INSERT INTO posts (
            id, author_id, category, title, content_html, board_type,
            is_pinned, media_url, media_object_id, created_at, updated_at, version,
            deleted_at, deleted_by_id
          )
          SELECT ?, profile.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL
          FROM profiles AS profile
          WHERE profile.id = ? AND (? <> 'ANNOUNCEMENT' OR ? = 1)
        `,
        params: [
          write.postId,
          snapshot.category,
          snapshot.title,
          snapshot.contentHtml,
          snapshot.boardType,
          Number(snapshot.isPinned),
          snapshot.mediaUrl,
          snapshot.mediaObjectId,
          documentEpochSeconds(write.now),
          documentEpochSeconds(write.now),
          write.actor.id,
          snapshot.boardType,
          Number(write.actor.isAdmin),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      postRevisionInsertStatement({
        revisionId: derivePostRevisionId(write.actor.id, write.operationId),
        postId: write.postId,
        revisionNumber: 1,
        changeType: "CREATE",
        snapshot,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      postId: write.postId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: 1,
      currentRevision: 1,
      createdAt: persistedDocumentDate(write.now),
    };
  } catch {
    const racedReplay = await resolvePostReceiptReplay(context, {
      actor: write.actor,
      operationId: write.operationId,
      operationType: "CREATE",
      request,
    });
    if (racedReplay) return racedReplay;
    const classified = await classifyPostMutation(
      context,
      write.actor,
      write.postId,
    );
    if (classified.ok) return classified;
    return classified.reason === "NOT_FOUND_OR_FORBIDDEN"
      ? { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" }
      : classified;
  }
}

export async function updatePostAtomically(
  context: DbContext,
  write: UpdatePostWrite,
): Promise<PostMutationResult> {
  const existing = await findPost(context, write.postId);
  const tombstone = existing
    ? null
    : await findDocumentTombstone(context, "COMMUNITY_POST", write.postId);
  const subjectId = existing?.authorId ?? tombstone?.subjectId ?? "unknown";
  const nextSnapshot = existing
    ? { ...postSnapshot(existing, null), title: write.title, contentHtml: write.contentHtml }
    : undefined;
  const request: PostCanonicalRequest = {
    operationType: "UPDATE",
    resourceId: write.postId,
    subjectId,
    baseRevision: write.baseRevision,
    title: write.title,
    contentHtml: write.contentHtml,
  };
  const requestHash = createPostRequestHash(request);
  const replay = await resolvePostReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "UPDATE",
    request,
  });
  if (replay) return replay;
  if (!existing || !nextSnapshot) {
    return classifyPostMutation(context, write.actor, write.postId, write.baseRevision);
  }
  if (!canMutatePost(write.actor, existing)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (existing.deletedAt) {
    return { ok: false, reason: "TRASHED", postId: write.postId, currentRevision: existing.version };
  }
  if (existing.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", postId: write.postId, currentRevision: existing.version };
  }

  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  if (snapshotsEqual(postSnapshot(existing, null), nextSnapshot)) {
    try {
      await executeDocumentStatementsAtomically(context, [
        {
          query: `
            INSERT INTO document_operation_ledger (
              id, operation_id, actor_id, subject_id, resource_type,
              operation_type, resource_id, request_hash, request_hash_version,
              result_revision, created_at
            )
            SELECT ?, ?, ?, author_id, 'COMMUNITY_POST', 'UPDATE', id, ?, ?, version, ?
            FROM posts
            WHERE id = ? AND version = ? AND deleted_at IS NULL
              AND (author_id = ? OR ? = 1) AND title = ? AND content_html = ?
          `,
          params: [
            recordId,
            write.operationId,
            write.actor.id,
            requestHash,
            POST_REQUEST_HASH_VERSION,
            documentEpochSeconds(write.now),
            write.postId,
            write.baseRevision,
            write.actor.id,
            Number(write.actor.isAdmin),
            write.title,
            write.contentHtml,
          ],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ]);
      return {
        ok: true,
        postId: write.postId,
        replayed: false,
        resourceState: "ACTIVE",
        operationResultRevision: existing.version,
        currentRevision: existing.version,
        createdAt: existing.createdAt ?? undefined,
      };
    } catch {
      return (
        (await resolvePostReceiptReplay(context, {
          actor: write.actor,
          operationId: write.operationId,
          operationType: "UPDATE",
          request,
        })) ?? (await classifyPostMutation(context, write.actor, write.postId, write.baseRevision))
      );
    }
  }

  const nextRevision = existing.version + 1;
  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.authorId,
        resourceType: "COMMUNITY_POST",
        operationType: "UPDATE",
        resourceId: write.postId,
        requestHash,
        requestHashVersion: POST_REQUEST_HASH_VERSION,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query: `
          UPDATE posts
          SET title = ?, content_html = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL
            AND (author_id = ? OR ? = 1)
        `,
        params: [
          write.title,
          write.contentHtml,
          documentEpochSeconds(write.now),
          write.postId,
          write.baseRevision,
          write.actor.id,
          Number(write.actor.isAdmin),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      postRevisionInsertStatement({
        revisionId: derivePostRevisionId(write.actor.id, write.operationId),
        postId: write.postId,
        revisionNumber: nextRevision,
        changeType: "UPDATE",
        snapshot: nextSnapshot,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      postId: write.postId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
      createdAt: existing.createdAt ?? undefined,
    };
  } catch {
    return (
      (await resolvePostReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType: "UPDATE",
        request,
      })) ?? (await classifyPostMutation(context, write.actor, write.postId, write.baseRevision))
    );
  }
}

export async function setPostPinAtomically(
  context: DbContext,
  write: SetPostPinWrite,
): Promise<PostMutationResult> {
  const existing = await findPost(context, write.postId);
  const tombstone = existing
    ? null
    : await findDocumentTombstone(context, "COMMUNITY_POST", write.postId);
  const subjectId = existing?.authorId ?? tombstone?.subjectId ?? "unknown";
  const nextSnapshot = existing
    ? { ...postSnapshot(existing, null), isPinned: write.isPinned }
    : undefined;
  const request: PostCanonicalRequest = {
    operationType: "SET_PIN",
    resourceId: write.postId,
    subjectId,
    baseRevision: write.baseRevision,
    isPinned: write.isPinned,
  };
  const requestHash = createPostRequestHash(request);
  const replay = await resolvePostReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "SET_PIN",
    request,
  });
  if (replay) return replay;
  if (!write.actor.isAdmin || !existing || !nextSnapshot || existing.boardType !== "ANNOUNCEMENT") {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (existing.deletedAt) {
    return { ok: false, reason: "TRASHED", postId: write.postId, currentRevision: existing.version };
  }
  if (existing.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", postId: write.postId, currentRevision: existing.version };
  }

  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  if (existing.isPinned === write.isPinned) {
    try {
      await executeDocumentStatementsAtomically(context, [
        {
          query: `
            INSERT INTO document_operation_ledger (
              id, operation_id, actor_id, subject_id, resource_type,
              operation_type, resource_id, request_hash, request_hash_version,
              result_revision, created_at
            )
            SELECT ?, ?, ?, author_id, 'COMMUNITY_POST', 'SET_PIN', id, ?, ?, version, ?
            FROM posts
            WHERE id = ? AND version = ? AND deleted_at IS NULL
              AND board_type = 'ANNOUNCEMENT' AND is_pinned = ? AND ? = 1
          `,
          params: [
            recordId,
            write.operationId,
            write.actor.id,
            requestHash,
            POST_REQUEST_HASH_VERSION,
            documentEpochSeconds(write.now),
            write.postId,
            write.baseRevision,
            Number(write.isPinned),
            Number(write.actor.isAdmin),
          ],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ]);
      return {
        ok: true,
        postId: write.postId,
        replayed: false,
        resourceState: "ACTIVE",
        operationResultRevision: existing.version,
        currentRevision: existing.version,
      };
    } catch {
      return (
        (await resolvePostReceiptReplay(context, {
          actor: write.actor,
          operationId: write.operationId,
          operationType: "SET_PIN",
          request,
        })) ?? (await classifyPostMutation(context, write.actor, write.postId, write.baseRevision))
      );
    }
  }

  const nextRevision = existing.version + 1;
  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.authorId,
        resourceType: "COMMUNITY_POST",
        operationType: "SET_PIN",
        resourceId: write.postId,
        requestHash,
        requestHashVersion: POST_REQUEST_HASH_VERSION,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query: `
          UPDATE posts
          SET is_pinned = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL
            AND board_type = 'ANNOUNCEMENT' AND ? = 1
        `,
        params: [
          Number(write.isPinned),
          documentEpochSeconds(write.now),
          write.postId,
          write.baseRevision,
          Number(write.actor.isAdmin),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      postRevisionInsertStatement({
        revisionId: derivePostRevisionId(write.actor.id, write.operationId),
        postId: write.postId,
        revisionNumber: nextRevision,
        changeType: "SET_PIN",
        snapshot: nextSnapshot,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      postId: write.postId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
    };
  } catch {
    return (
      (await resolvePostReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType: "SET_PIN",
        request,
      })) ?? (await classifyPostMutation(context, write.actor, write.postId, write.baseRevision))
    );
  }
}

async function mutatePostTrashState(
  context: DbContext,
  write: PostLifecycleWrite,
  operationType: "TRASH" | "RESTORE_TRASH",
): Promise<PostMutationResult> {
  const existing = await findPost(context, write.postId);
  const tombstone = existing
    ? null
    : await findDocumentTombstone(context, "COMMUNITY_POST", write.postId);
  const subjectId = existing?.authorId ?? tombstone?.subjectId ?? "unknown";
  const request: PostCanonicalRequest = {
    operationType,
    resourceId: write.postId,
    subjectId,
    baseRevision: write.baseRevision,
  };
  const requestHash = createPostRequestHash(request);
  const replay = await resolvePostReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType,
    request,
  });
  if (replay) return replay;
  if (!existing) {
    return classifyPostMutation(context, write.actor, write.postId, write.baseRevision);
  }
  if (!canMutatePost(write.actor, existing)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (existing.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", postId: write.postId, currentRevision: existing.version };
  }
  if (operationType === "TRASH" && existing.deletedAt) {
    return { ok: false, reason: "TRASHED", postId: write.postId, currentRevision: existing.version };
  }
  if (operationType === "RESTORE_TRASH") {
    if (!existing.deletedAt) {
      return { ok: false, reason: "VERSION_CONFLICT", postId: write.postId, currentRevision: existing.version };
    }
    if (
      documentEpochSeconds(existing.deletedAt)! <=
      documentEpochSeconds(write.now)! - POST_TRASH_RETENTION_SECONDS
    ) {
      return { ok: false, reason: "RETENTION_EXPIRED", postId: write.postId, currentRevision: existing.version };
    }
  }

  const nextRevision = existing.version + 1;
  const nextDeletedAt = operationType === "TRASH" ? write.now : null;
  const snapshot = postSnapshot(existing, nextDeletedAt);
  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.authorId,
        resourceType: "COMMUNITY_POST",
        operationType,
        resourceId: write.postId,
        requestHash,
        requestHashVersion: POST_REQUEST_HASH_VERSION,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query:
          operationType === "TRASH"
            ? `
                UPDATE posts
                SET deleted_at = ?, deleted_by_id = ?, updated_at = ?, version = version + 1
                WHERE id = ? AND version = ? AND deleted_at IS NULL
                  AND (author_id = ? OR ? = 1)
              `
            : `
                UPDATE posts
                SET deleted_at = NULL, deleted_by_id = NULL, updated_at = ?, version = version + 1
                WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
                  AND deleted_at > ? AND (author_id = ? OR ? = 1)
              `,
        params:
          operationType === "TRASH"
            ? [
                documentEpochSeconds(write.now),
                write.actor.id,
                documentEpochSeconds(write.now),
                write.postId,
                write.baseRevision,
                write.actor.id,
                Number(write.actor.isAdmin),
              ]
            : [
                documentEpochSeconds(write.now),
                write.postId,
                write.baseRevision,
                documentEpochSeconds(write.now)! - POST_TRASH_RETENTION_SECONDS,
                write.actor.id,
                Number(write.actor.isAdmin),
              ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      postRevisionInsertStatement({
        revisionId: derivePostRevisionId(write.actor.id, write.operationId),
        postId: write.postId,
        revisionNumber: nextRevision,
        changeType: operationType,
        snapshot,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      postId: write.postId,
      replayed: false,
      resourceState: operationType === "TRASH" ? "TRASHED" : "ACTIVE",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
      createdAt: existing.createdAt ?? undefined,
    };
  } catch {
    return (
      (await resolvePostReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType,
        request,
      })) ?? (await classifyPostMutation(context, write.actor, write.postId, write.baseRevision))
    );
  }
}

export function trashPostAtomically(context: DbContext, write: PostLifecycleWrite) {
  return mutatePostTrashState(context, write, "TRASH");
}

export function restoreTrashedPostAtomically(
  context: DbContext,
  write: PostLifecycleWrite,
) {
  return mutatePostTrashState(context, write, "RESTORE_TRASH");
}

export async function restorePostRevisionAtomically(
  context: DbContext,
  write: RestorePostRevisionWrite,
): Promise<PostMutationResult> {
  const existing = await findPost(context, write.postId);
  const tombstone = existing
    ? null
    : await findDocumentTombstone(context, "COMMUNITY_POST", write.postId);
  const subjectId = existing?.authorId ?? tombstone?.subjectId ?? "unknown";
  const [revision] = await asDocumentReadDb(context)
    .select({
      changeType: postRevisions.changeType,
      category: postRevisions.category,
      boardType: postRevisions.boardType,
      isPinned: postRevisions.isPinned,
      mediaUrl: postRevisions.mediaUrl,
      mediaObjectId: postRevisions.mediaObjectId,
      title: postRevisions.title,
      contentHtml: postRevisions.contentHtml,
      deletedAt: postRevisions.deletedAt,
      snapshotHash: postRevisions.snapshotHash,
      snapshotHashVersion: postRevisions.snapshotHashVersion,
    })
    .from(postRevisions)
    .where(
      and(
        eq(postRevisions.postId, write.postId),
        eq(postRevisions.revisionNumber, write.revisionNumber),
      ),
    )
    .limit(1);
  const snapshot: PostCanonicalSnapshot | undefined = revision
    ? {
        category: revision.category,
        boardType: revision.boardType,
        isPinned: revision.isPinned,
        mediaUrl: revision.mediaUrl,
        mediaObjectId: revision.mediaObjectId,
        title: revision.title,
        contentHtml: revision.contentHtml,
        deletedAt: null,
      }
    : undefined;
  const request: PostCanonicalRequest = {
    operationType: "RESTORE_REVISION",
    resourceId: write.postId,
    subjectId,
    baseRevision: write.baseRevision,
    snapshot,
    restoredFromRevision: write.revisionNumber,
  };
  const requestHash = createPostRequestHash(request);
  const replay = await resolvePostReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "RESTORE_REVISION",
    request,
  });
  if (replay) return replay;
  if (!existing || !revision || !snapshot || !canMutatePost(write.actor, existing)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (existing.deletedAt) {
    return { ok: false, reason: "TRASHED", postId: write.postId, currentRevision: existing.version };
  }
  if (existing.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", postId: write.postId, currentRevision: existing.version };
  }
  if (revision.changeType !== "BASELINE") {
    if (revision.snapshotHash === null || revision.snapshotHashVersion === null) {
      return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
    }
    const sourceSnapshotHash = createPostSnapshotHashForVersion(
      {
        category: revision.category,
        boardType: revision.boardType,
        isPinned: revision.isPinned,
        mediaUrl: revision.mediaUrl,
        mediaObjectId: revision.mediaObjectId,
        title: revision.title,
        contentHtml: revision.contentHtml,
        deletedAt: revision.deletedAt,
      },
      revision.snapshotHashVersion,
    );
    if (!sourceSnapshotHash) {
      return { ok: false, reason: "OPERATION_VERSION_UNSUPPORTED" };
    }
    if (sourceSnapshotHash !== revision.snapshotHash) {
      return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
    }
  }

  const nextRevision = existing.version + 1;
  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.authorId,
        resourceType: "COMMUNITY_POST",
        operationType: "RESTORE_REVISION",
        resourceId: write.postId,
        requestHash,
        requestHashVersion: POST_REQUEST_HASH_VERSION,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query: `
          UPDATE posts
          SET category = ?, board_type = ?, is_pinned = ?, media_url = ?, media_object_id = ?,
              title = ?, content_html = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL
            AND (author_id = ? OR ? = 1)
            AND EXISTS (
              SELECT 1 FROM post_revisions
              WHERE post_id = ? AND revision_number = ?
            )
        `,
        params: [
          snapshot.category,
          snapshot.boardType,
          Number(snapshot.isPinned),
          snapshot.mediaUrl,
          snapshot.mediaObjectId,
          snapshot.title,
          snapshot.contentHtml,
          documentEpochSeconds(write.now),
          write.postId,
          write.baseRevision,
          write.actor.id,
          Number(write.actor.isAdmin),
          write.postId,
          write.revisionNumber,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      postRevisionInsertStatement({
        revisionId: derivePostRevisionId(write.actor.id, write.operationId),
        postId: write.postId,
        revisionNumber: nextRevision,
        changeType: "RESTORE_REVISION",
        snapshot,
        actorId: write.actor.id,
        restoredFromRevision: write.revisionNumber,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      postId: write.postId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
      createdAt: existing.createdAt ?? undefined,
    };
  } catch {
    return (
      (await resolvePostReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType: "RESTORE_REVISION",
        request,
      })) ?? (await classifyPostMutation(context, write.actor, write.postId, write.baseRevision))
    );
  }
}

export async function purgePostAtomically(
  context: DbContext,
  write: PostLifecycleWrite,
): Promise<PostMutationResult> {
  const existing = await findPost(context, write.postId);
  const tombstone = existing
    ? null
    : await findDocumentTombstone(context, "COMMUNITY_POST", write.postId);
  const subjectId = existing?.authorId ?? tombstone?.subjectId ?? "unknown";
  const request: PostCanonicalRequest = {
    operationType: "PURGE",
    resourceId: write.postId,
    subjectId,
    baseRevision: write.baseRevision,
  };
  const requestHash = createPostRequestHash(request);
  const replay = await resolvePostReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "PURGE",
    request,
  });
  if (replay) return replay;
  if (!write.actor.isAdmin || !existing) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (!existing.deletedAt) {
    return { ok: false, reason: "RETENTION_NOT_EXPIRED", postId: write.postId, currentRevision: existing.version };
  }
  if (existing.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", postId: write.postId, currentRevision: existing.version };
  }
  if (
    documentEpochSeconds(existing.deletedAt)! >
    documentEpochSeconds(write.now)! - POST_TRASH_RETENTION_SECONDS
  ) {
    return { ok: false, reason: "RETENTION_NOT_EXPIRED", postId: write.postId, currentRevision: existing.version };
  }

  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.authorId,
        resourceType: "COMMUNITY_POST",
        operationType: "PURGE",
        resourceId: write.postId,
        requestHash,
        requestHashVersion: POST_REQUEST_HASH_VERSION,
        resultRevision: existing.version,
        now: write.now,
      }),
      {
        query: `
          INSERT INTO document_tombstones (
            resource_type, resource_id, subject_id, owner_id,
            source_created_at, source_version, purged_at, purged_by_id
          )
          SELECT 'COMMUNITY_POST', id, author_id, author_id,
                 created_at, version, ?, ?
          FROM posts
          WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
            AND deleted_at <= ? AND ? = 1
        `,
        params: [
          documentEpochSeconds(write.now),
          write.actor.id,
          write.postId,
          write.baseRevision,
          documentEpochSeconds(write.now)! - POST_TRASH_RETENTION_SECONDS,
          Number(write.actor.isAdmin),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ...postMediaPurgeStatements({ postId: write.postId, now: write.now }),
      {
        query: `
          DELETE FROM posts
          WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
            AND deleted_at <= ? AND ? = 1
        `,
        params: [
          write.postId,
          write.baseRevision,
          documentEpochSeconds(write.now)! - POST_TRASH_RETENTION_SECONDS,
          Number(write.actor.isAdmin),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return {
      ok: true,
      postId: write.postId,
      replayed: false,
      resourceState: "PURGED",
      operationResultRevision: existing.version,
      currentRevision: null,
    };
  } catch {
    return (
      (await resolvePostReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType: "PURGE",
        request,
      })) ?? (await classifyPostMutation(context, write.actor, write.postId, write.baseRevision))
    );
  }
}
