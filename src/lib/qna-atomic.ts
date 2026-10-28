import { eq } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import {
  qnaGuideAnchors,
  qnaReplies,
  qnaThreads,
  type QnaStatus,
  type QnaThreadEventType,
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
  QNA_EVENT_HASH_VERSION,
  QNA_REQUEST_HASH_VERSION,
  QNA_TRASH_RETENTION_SECONDS,
  createQnaEventHash,
  createQnaRequestHash,
  createQnaRequestHashForVersion,
  deriveQnaEventId,
  type QnaCanonicalEvent,
  type QnaCanonicalRequest,
} from "@/lib/qna-continuity";
import { deriveDocumentOperationRecordId } from "@/lib/private-note-continuity";
import {
  documentImageClaimStatements,
  mediaClaimStatements,
  qnaMediaPurgeStatements,
} from "@/lib/media-lifecycle-atomic";

type QnaThreadHead = {
  id: string;
  studentId: string;
  title: string;
  status: QnaStatus;
  createdAt: Date | null;
  updatedAt: Date | null;
  version: number;
  deletedAt: Date | null;
};

export type QnaResourceState = "ACTIVE" | "TRASHED" | "PURGED";

export type QnaMutationFailureReason =
  | "VERSION_CONFLICT"
  | "TRASHED"
  | "PURGED"
  | "CLOSED"
  | "OPERATION_PAYLOAD_CONFLICT"
  | "OPERATION_VERSION_UNSUPPORTED"
  | "RETENTION_NOT_EXPIRED"
  | "RETENTION_EXPIRED"
  | "NOT_FOUND_OR_FORBIDDEN"
  | "INTERNAL_INVARIANT_FAILURE";

export type QnaMutationResult =
  | {
      ok: true;
      threadId: string;
      replyId?: string;
      replayed: boolean;
      resourceState: QnaResourceState;
      operationResultRevision: number;
      currentRevision: number | null;
      createdAt?: Date;
    }
  | {
      ok: false;
      reason: QnaMutationFailureReason;
      threadId?: string;
      currentRevision?: number;
    };

/** 가이드 구간 질문 위치. page_title은 생성 시점의 제목 snapshot이다. */
export type QnaGuideAnchorWrite = {
  guidePageId: string;
  pageTitle: string;
  blockId: string | null;
  quote: string;
};

export type CreateQnaThreadWrite = {
  actor: DocumentAtomicActor;
  threadId: string;
  replyId: string;
  operationId: string;
  title: string;
  contentHtml: string;
  attachmentUrl: string | null;
  attachmentObjectId: string | null;
  guideAnchor?: QnaGuideAnchorWrite | null;
  now: Date;
};

export type CreateQnaReplyWrite = {
  actor: DocumentAtomicActor;
  threadId: string;
  replyId: string;
  operationId: string;
  contentHtml: string;
  attachmentUrl: string | null;
  attachmentObjectId: string | null;
  now: Date;
};

export type SetQnaStatusWrite = {
  actor: DocumentAtomicActor;
  threadId: string;
  operationId: string;
  baseRevision: number;
  status: QnaStatus;
  now: Date;
};

export type QnaLifecycleWrite = {
  actor: DocumentAtomicActor;
  threadId: string;
  operationId: string;
  baseRevision: number;
  now: Date;
};

async function findThread(
  context: DbContext,
  threadId: string,
): Promise<QnaThreadHead | null> {
  const [thread] = await asDocumentReadDb(context)
    .select({
      id: qnaThreads.id,
      studentId: qnaThreads.studentId,
      title: qnaThreads.title,
      status: qnaThreads.status,
      createdAt: qnaThreads.createdAt,
      updatedAt: qnaThreads.updatedAt,
      version: qnaThreads.version,
      deletedAt: qnaThreads.deletedAt,
    })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, threadId))
    .limit(1);
  return thread ?? null;
}

async function findReply(context: DbContext, replyId: string) {
  const [reply] = await asDocumentReadDb(context)
    .select({
      id: qnaReplies.id,
      threadId: qnaReplies.threadId,
      authorId: qnaReplies.authorId,
      contentHtml: qnaReplies.contentHtml,
      attachmentUrl: qnaReplies.attachmentUrl,
      attachmentObjectId: qnaReplies.attachmentObjectId,
    })
    .from(qnaReplies)
    .where(eq(qnaReplies.id, replyId))
    .limit(1);
  return reply ?? null;
}

function canAccessThread(actor: DocumentAtomicActor, thread: QnaThreadHead): boolean {
  return actor.isAdmin || actor.id === thread.studentId;
}

function canAccessTombstone(
  actor: DocumentAtomicActor,
  tombstone: { subjectId: string },
): boolean {
  return actor.isAdmin || actor.id === tombstone.subjectId;
}

function qnaEventInsertStatement(input: {
  eventId: string;
  threadId: string;
  eventNumber: number;
  eventType: Exclude<QnaThreadEventType, "BASELINE">;
  event: QnaCanonicalEvent;
  actorId: string;
  operationRecordId: string;
  now: Date;
}): DocumentAtomicStatement {
  return {
    query: `
      INSERT INTO qna_thread_events (
        id, thread_id, event_number, event_type, title, status,
        reply_id, deleted_at, event_hash, event_hash_version,
        actor_id, operation_record_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      input.eventId,
      input.threadId,
      input.eventNumber,
      input.eventType,
      input.event.title,
      input.event.status,
      input.event.replyId,
      documentEpochSeconds(input.event.deletedAt),
      createQnaEventHash(input.event),
      QNA_EVENT_HASH_VERSION,
      input.actorId,
      input.operationRecordId,
      documentEpochSeconds(input.now),
    ],
  };
}

async function resolveQnaReceiptReplay(
  context: DbContext,
  input: {
    actor: DocumentAtomicActor;
    operationId: string;
    operationType: QnaCanonicalRequest["operationType"];
    request: QnaCanonicalRequest;
    replyId?: string;
  },
): Promise<QnaMutationResult | null> {
  const receipt = await findDocumentOperationReceipt(
    context,
    input.actor.id,
    input.operationId,
  );
  if (!receipt) return null;
  const requestHash = createQnaRequestHashForVersion(
    input.request,
    receipt.requestHashVersion,
  );
  if (!requestHash) return { ok: false, reason: "OPERATION_VERSION_UNSUPPORTED" };
  if (
    receipt.resourceType !== "QNA_THREAD" ||
    receipt.operationType !== input.operationType ||
    receipt.requestHash !== requestHash
  ) {
    return {
      ok: false,
      reason: "OPERATION_PAYLOAD_CONFLICT",
      threadId: receipt.resourceId,
    };
  }

  const thread = await findThread(context, receipt.resourceId);
  const tombstone = thread
    ? null
    : await findDocumentTombstone(context, "QNA_THREAD", receipt.resourceId);
  const privilegedOperation =
    input.operationType === "SET_STATUS" || input.operationType === "PURGE";
  if (privilegedOperation && !input.actor.isAdmin) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (input.operationType === "PURGE") {
    if (!tombstone) return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    return {
      ok: true,
      threadId: receipt.resourceId,
      replayed: true,
      resourceState: "PURGED",
      operationResultRevision: receipt.resultRevision,
      currentRevision: null,
    };
  }
  if (tombstone) {
    return canAccessTombstone(input.actor, tombstone)
      ? { ok: false, reason: "PURGED", threadId: receipt.resourceId }
      : { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (!thread || thread.studentId !== receipt.subjectId || !canAccessThread(input.actor, thread)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (
    thread.deletedAt &&
    !["APPEND_REPLY", "TRASH", "RESTORE_TRASH"].includes(input.operationType)
  ) {
    return {
      ok: false,
      reason: "TRASHED",
      threadId: thread.id,
      currentRevision: thread.version,
    };
  }

  return {
    ok: true,
    threadId: thread.id,
    replyId: input.replyId,
    replayed: true,
    resourceState: thread.deletedAt ? "TRASHED" : "ACTIVE",
    operationResultRevision: receipt.resultRevision,
    currentRevision: thread.version,
    createdAt: thread.createdAt ?? undefined,
  };
}

function createQnaThreadCreateRequest(
  write: Omit<CreateQnaThreadWrite, "now">,
): QnaCanonicalRequest {
  return {
    operationType: "CREATE",
    resourceId: write.threadId,
    subjectId: write.actor.id,
    baseRevision: null,
    title: write.title,
    status: "OPEN",
    replyId: write.replyId,
    replyAuthorId: write.actor.id,
    contentHtml: write.contentHtml,
    attachmentUrl: write.attachmentUrl,
    attachmentObjectId: write.attachmentObjectId,
    guideAnchor: write.guideAnchor
      ? {
          guidePageId: write.guideAnchor.guidePageId,
          blockId: write.guideAnchor.blockId,
          quote: write.guideAnchor.quote,
        }
      : null,
  };
}

async function findGuideAnchor(context: DbContext, threadId: string) {
  const [anchor] = await asDocumentReadDb(context)
    .select({
      guidePageId: qnaGuideAnchors.guidePageId,
      blockId: qnaGuideAnchors.anchorBlockId,
      quote: qnaGuideAnchors.anchorQuote,
    })
    .from(qnaGuideAnchors)
    .where(eq(qnaGuideAnchors.threadId, threadId))
    .limit(1);
  return anchor ?? null;
}

/** 이미 있는 질문의 위치가 이번 요청과 같은지 본다. 페이지가 지워져 연결이 끊긴 위치도 같은 위치로 본다. */
function sameGuideAnchor(
  existing: Awaited<ReturnType<typeof findGuideAnchor>> | null,
  requested: QnaGuideAnchorWrite | null | undefined,
): boolean {
  if (!requested) return existing === null;
  return Boolean(
    existing &&
      (existing.guidePageId === null || existing.guidePageId === requested.guidePageId) &&
      existing.blockId === requested.blockId &&
      existing.quote === requested.quote,
  );
}

async function createQnaReplyRequest(
  context: DbContext,
  write: Omit<CreateQnaReplyWrite, "now">,
): Promise<QnaCanonicalRequest> {
  const initialThread = await findThread(context, write.threadId);
  const initialTombstone = initialThread
    ? null
    : await findDocumentTombstone(context, "QNA_THREAD", write.threadId);
  return {
    operationType: "APPEND_REPLY",
    resourceId: write.threadId,
    subjectId: initialThread?.studentId ?? initialTombstone?.subjectId ?? "unknown",
    baseRevision: null,
    replyId: write.replyId,
    replyAuthorId: write.actor.id,
    contentHtml: write.contentHtml,
    attachmentUrl: write.attachmentUrl,
    attachmentObjectId: write.attachmentObjectId,
  };
}

async function isLegacyQnaReplay(
  context: DbContext,
  input: {
    actor: DocumentAtomicActor;
    operationId: string;
    operationType: "CREATE" | "APPEND_REPLY";
    request: QnaCanonicalRequest;
    replyId: string;
  },
): Promise<boolean> {
  const receipt = await findDocumentOperationReceipt(
    context,
    input.actor.id,
    input.operationId,
  );
  if (receipt?.requestHashVersion !== 1) return false;

  const replay = await resolveQnaReceiptReplay(context, input);
  return Boolean(replay?.ok && replay.replayed);
}

/** v1 영수증과 정확히 일치하는 URL-only Q&A 생성 재실행만 허용한다. */
export async function preflightLegacyQnaThreadCreateReplay(
  context: DbContext,
  write: Omit<CreateQnaThreadWrite, "now">,
): Promise<boolean> {
  return isLegacyQnaReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "CREATE",
    request: createQnaThreadCreateRequest(write),
    replyId: write.replyId,
  });
}

/** v1 영수증과 정확히 일치하는 URL-only Q&A 답변 재실행만 허용한다. */
export async function preflightLegacyQnaReplyCreateReplay(
  context: DbContext,
  write: Omit<CreateQnaReplyWrite, "now">,
): Promise<boolean> {
  return isLegacyQnaReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "APPEND_REPLY",
    request: await createQnaReplyRequest(context, write),
    replyId: write.replyId,
  });
}

async function classifyQnaMutation(
  context: DbContext,
  actor: DocumentAtomicActor,
  threadId: string,
  baseRevision?: number,
): Promise<QnaMutationResult> {
  const thread = await findThread(context, threadId);
  if (thread) {
    if (!canAccessThread(actor, thread)) {
      return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    }
    if (thread.deletedAt) {
      return { ok: false, reason: "TRASHED", threadId, currentRevision: thread.version };
    }
    if (baseRevision !== undefined && thread.version !== baseRevision) {
      return {
        ok: false,
        reason: "VERSION_CONFLICT",
        threadId,
        currentRevision: thread.version,
      };
    }
    if (thread.status === "CLOSED") {
      return { ok: false, reason: "CLOSED", threadId, currentRevision: thread.version };
    }
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
  }
  const tombstone = await findDocumentTombstone(context, "QNA_THREAD", threadId);
  if (tombstone && canAccessTombstone(actor, tombstone)) {
    return { ok: false, reason: "PURGED", threadId };
  }
  return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
}

export async function createQnaThreadAtomically(
  context: DbContext,
  write: CreateQnaThreadWrite,
): Promise<QnaMutationResult> {
  const request = createQnaThreadCreateRequest(write);
  const requestHash = createQnaRequestHash(request);
  const replay = await resolveQnaReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "CREATE",
    request,
    replyId: write.replyId,
  });
  if (replay) return replay;
  if (write.actor.isAdmin) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }

  const tombstone = await findDocumentTombstone(context, "QNA_THREAD", write.threadId);
  if (tombstone) {
    return canAccessTombstone(write.actor, tombstone)
      ? { ok: false, reason: "PURGED", threadId: write.threadId }
      : { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  const existingThread = await findThread(context, write.threadId);
  const existingReply = await findReply(context, write.replyId);
  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  if (existingThread || existingReply) {
    const existingAnchor = existingThread ? await findGuideAnchor(context, existingThread.id) : null;
    const sameSubmission = Boolean(
      sameGuideAnchor(existingAnchor, write.guideAnchor) &&
      existingThread &&
        existingReply &&
        !existingThread.deletedAt &&
        existingThread.studentId === write.actor.id &&
        existingThread.title === write.title &&
        existingReply.threadId === write.threadId &&
        existingReply.authorId === write.actor.id &&
        existingReply.contentHtml === write.contentHtml &&
        existingReply.attachmentUrl === write.attachmentUrl &&
        existingReply.attachmentObjectId === write.attachmentObjectId,
    );
    if (!sameSubmission || !existingThread) {
      return {
        ok: false,
        reason: "OPERATION_PAYLOAD_CONFLICT",
        threadId: existingThread?.id ?? write.threadId,
        currentRevision: existingThread?.version,
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
            SELECT ?, ?, ?, thread.student_id, 'QNA_THREAD', 'CREATE',
                   thread.id, ?, ?, thread.version, ?
            FROM qna_threads AS thread
            JOIN qna_replies AS reply ON reply.id = ? AND reply.thread_id = thread.id
            WHERE thread.id = ? AND thread.student_id = ? AND thread.deleted_at IS NULL
              AND thread.title = ? AND reply.author_id = ?
              AND reply.content_html = ? AND reply.attachment_url IS ?
              AND reply.attachment_object_id IS ?
          `,
          params: [
            recordId,
            write.operationId,
            write.actor.id,
            requestHash,
            QNA_REQUEST_HASH_VERSION,
            documentEpochSeconds(write.now),
            write.replyId,
            write.threadId,
            write.actor.id,
            write.title,
            write.actor.id,
            write.contentHtml,
            write.attachmentUrl,
            write.attachmentObjectId,
          ],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ]);
      return {
        ok: true,
        threadId: write.threadId,
        replyId: write.replyId,
        replayed: true,
        resourceState: "ACTIVE",
        operationResultRevision: existingThread.version,
        currentRevision: existingThread.version,
        createdAt: existingThread.createdAt ?? undefined,
      };
    } catch {
      return (
        (await resolveQnaReceiptReplay(context, {
          actor: write.actor,
          operationId: write.operationId,
          operationType: "CREATE",
          request,
          replyId: write.replyId,
        })) ?? { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" }
      );
    }
  }

  const event: QnaCanonicalEvent = {
    title: write.title,
    status: "OPEN",
    replyId: write.replyId,
    deletedAt: null,
  };
  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: write.actor.id,
        resourceType: "QNA_THREAD",
        operationType: "CREATE",
        resourceId: write.threadId,
        requestHash,
        requestHashVersion: QNA_REQUEST_HASH_VERSION,
        resultRevision: 1,
        now: write.now,
      }),
      ...mediaClaimStatements({
        mediaObjectId: write.attachmentObjectId,
        ownerId: write.actor.id,
        purpose: "QNA_ATTACHMENT",
        draftOperationId: write.operationId,
        resourceType: "QNA_REPLY",
        resourceId: write.replyId,
        now: write.now,
      }),
      ...documentImageClaimStatements({
        contentHtml: write.contentHtml,
        ownerId: write.actor.id,
        resourceType: "QNA_REPLY",
        resourceId: write.replyId,
        now: write.now,
      }),
      {
        query: `
          INSERT INTO qna_threads (
            id, student_id, title, status, created_at, updated_at,
            version, deleted_at, deleted_by_id
          )
          SELECT ?, profile.id, ?, 'OPEN', ?, ?, 1, NULL, NULL
          FROM profiles AS profile
          WHERE profile.id = ? AND ? = 0
        `,
        params: [
          write.threadId,
          write.title,
          documentEpochSeconds(write.now),
          documentEpochSeconds(write.now),
          write.actor.id,
          Number(write.actor.isAdmin),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      {
        query: `
          INSERT INTO qna_replies (
            id, thread_id, author_id, content_html, attachment_url,
            attachment_object_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        params: [
          write.replyId,
          write.threadId,
          write.actor.id,
          write.contentHtml,
          write.attachmentUrl,
          write.attachmentObjectId,
          documentEpochSeconds(write.now),
        ],
      },
      ...(write.guideAnchor
        ? [{
            // 페이지가 그 사이 지워졌으면 연결 없이 제목·인용만 남긴다(FK 실패로 질문을 잃지 않는다).
            query: `
              INSERT INTO qna_guide_anchors (
                thread_id, guide_page_id, page_title, anchor_block_id, anchor_quote, created_at
              ) VALUES (?, (SELECT id FROM guide_pages WHERE id = ?), ?, ?, ?, ?)
            `,
            params: [
              write.threadId,
              write.guideAnchor.guidePageId,
              write.guideAnchor.pageTitle,
              write.guideAnchor.blockId,
              write.guideAnchor.quote,
              documentEpochSeconds(write.now),
            ],
          }]
        : []),
      qnaEventInsertStatement({
        eventId: deriveQnaEventId(write.actor.id, write.operationId),
        threadId: write.threadId,
        eventNumber: 1,
        eventType: "CREATE",
        event,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      threadId: write.threadId,
      replyId: write.replyId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: 1,
      currentRevision: 1,
      createdAt: persistedDocumentDate(write.now),
    };
  } catch {
    const racedReplay = await resolveQnaReceiptReplay(context, {
      actor: write.actor,
      operationId: write.operationId,
      operationType: "CREATE",
      request,
      replyId: write.replyId,
    });
    if (racedReplay) return racedReplay;
    const classified = await classifyQnaMutation(
      context,
      write.actor,
      write.threadId,
    );
    if (classified.ok) return classified;
    return classified.reason === "NOT_FOUND_OR_FORBIDDEN"
      ? { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" }
      : classified;
  }
}

export async function createQnaReplyAtomically(
  context: DbContext,
  write: CreateQnaReplyWrite,
): Promise<QnaMutationResult> {
  const request = await createQnaReplyRequest(context, write);
  const requestHash = createQnaRequestHash(request);
  const replay = await resolveQnaReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "APPEND_REPLY",
    request,
    replyId: write.replyId,
  });
  if (replay) return replay;

  const existingReply = await findReply(context, write.replyId);
  if (existingReply) {
    if (
      existingReply.threadId !== write.threadId ||
      existingReply.authorId !== write.actor.id ||
      existingReply.contentHtml !== write.contentHtml ||
      existingReply.attachmentUrl !== write.attachmentUrl ||
      existingReply.attachmentObjectId !== write.attachmentObjectId
    ) {
      return {
        ok: false,
        reason: "OPERATION_PAYLOAD_CONFLICT",
        threadId: write.threadId,
      };
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const thread = await findThread(context, write.threadId);
    if (!thread || !canAccessThread(write.actor, thread)) {
      return classifyQnaMutation(context, write.actor, write.threadId);
    }
    if (thread.deletedAt) {
      return { ok: false, reason: "TRASHED", threadId: thread.id, currentRevision: thread.version };
    }
    if (thread.status === "CLOSED") {
      return { ok: false, reason: "CLOSED", threadId: thread.id, currentRevision: thread.version };
    }

    const nextRevision = thread.version + 1;
    const nextStatus: QnaStatus = write.actor.isAdmin ? "ANSWERED" : "OPEN";
    const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
    const event: QnaCanonicalEvent = {
      title: thread.title,
      status: nextStatus,
      replyId: write.replyId,
      deletedAt: null,
    };
    try {
      await executeDocumentStatementsAtomically(context, [
        documentLedgerInsertStatement({
          recordId,
          operationId: write.operationId,
          actorId: write.actor.id,
          subjectId: thread.studentId,
          resourceType: "QNA_THREAD",
          operationType: "APPEND_REPLY",
          resourceId: write.threadId,
          requestHash,
          requestHashVersion: QNA_REQUEST_HASH_VERSION,
          resultRevision: nextRevision,
          now: write.now,
        }),
        {
          query: `
            UPDATE qna_threads
            SET status = ?, updated_at = ?, version = version + 1
            WHERE id = ? AND version = ? AND deleted_at IS NULL
              AND status <> 'CLOSED' AND (student_id = ? OR ? = 1)
          `,
          params: [
            nextStatus,
            documentEpochSeconds(write.now),
            write.threadId,
            thread.version,
            write.actor.id,
            Number(write.actor.isAdmin),
          ],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
        ...mediaClaimStatements({
          mediaObjectId: write.attachmentObjectId,
          ownerId: write.actor.id,
          purpose: "QNA_ATTACHMENT",
          draftOperationId: write.operationId,
          resourceType: "QNA_REPLY",
          resourceId: write.replyId,
          now: write.now,
        }),
        ...documentImageClaimStatements({
          contentHtml: write.contentHtml,
          ownerId: write.actor.id,
          resourceType: "QNA_REPLY",
          resourceId: write.replyId,
          now: write.now,
        }),
        {
          query: `
            INSERT INTO qna_replies (
              id, thread_id, author_id, content_html, attachment_url,
              attachment_object_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          params: [
            write.replyId,
            write.threadId,
            write.actor.id,
            write.contentHtml,
            write.attachmentUrl,
            write.attachmentObjectId,
            documentEpochSeconds(write.now),
          ],
        },
        qnaEventInsertStatement({
          eventId: deriveQnaEventId(write.actor.id, write.operationId),
          threadId: write.threadId,
          eventNumber: nextRevision,
          eventType: "APPEND_REPLY",
          event,
          actorId: write.actor.id,
          operationRecordId: recordId,
          now: write.now,
        }),
      ]);
      return {
        ok: true,
        threadId: write.threadId,
        replyId: write.replyId,
        replayed: false,
        resourceState: "ACTIVE",
        operationResultRevision: nextRevision,
        currentRevision: nextRevision,
        createdAt: thread.createdAt ?? undefined,
      };
    } catch {
      const racedReplay = await resolveQnaReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType: "APPEND_REPLY",
        request,
        replyId: write.replyId,
      });
      if (racedReplay) return racedReplay;
      const current = await findThread(context, write.threadId);
      if (
        attempt === 0 &&
        current &&
        !current.deletedAt &&
        current.status !== "CLOSED" &&
        canAccessThread(write.actor, current) &&
        current.version !== thread.version
      ) {
        continue;
      }
      return classifyQnaMutation(context, write.actor, write.threadId);
    }
  }
  return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
}

export async function setQnaStatusAtomically(
  context: DbContext,
  write: SetQnaStatusWrite,
): Promise<QnaMutationResult> {
  const thread = await findThread(context, write.threadId);
  const tombstone = thread
    ? null
    : await findDocumentTombstone(context, "QNA_THREAD", write.threadId);
  const subjectId = thread?.studentId ?? tombstone?.subjectId ?? "unknown";
  const request: QnaCanonicalRequest = {
    operationType: "SET_STATUS",
    resourceId: write.threadId,
    subjectId,
    baseRevision: write.baseRevision,
    status: write.status,
  };
  const requestHash = createQnaRequestHash(request);
  const replay = await resolveQnaReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "SET_STATUS",
    request,
  });
  if (replay) return replay;
  if (!write.actor.isAdmin || !thread) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (thread.deletedAt) {
    return { ok: false, reason: "TRASHED", threadId: thread.id, currentRevision: thread.version };
  }
  if (thread.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", threadId: thread.id, currentRevision: thread.version };
  }

  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  if (thread.status === write.status) {
    try {
      await executeDocumentStatementsAtomically(context, [
        {
          query: `
            INSERT INTO document_operation_ledger (
              id, operation_id, actor_id, subject_id, resource_type,
              operation_type, resource_id, request_hash, request_hash_version,
              result_revision, created_at
            )
            SELECT ?, ?, ?, student_id, 'QNA_THREAD', 'SET_STATUS', id, ?, ?, version, ?
            FROM qna_threads
            WHERE id = ? AND version = ? AND deleted_at IS NULL
              AND status = ? AND ? = 1
          `,
          params: [
            recordId,
            write.operationId,
            write.actor.id,
            requestHash,
            QNA_REQUEST_HASH_VERSION,
            documentEpochSeconds(write.now),
            write.threadId,
            write.baseRevision,
            write.status,
            Number(write.actor.isAdmin),
          ],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ]);
      return {
        ok: true,
        threadId: write.threadId,
        replayed: false,
        resourceState: "ACTIVE",
        operationResultRevision: thread.version,
        currentRevision: thread.version,
      };
    } catch {
      return (
        (await resolveQnaReceiptReplay(context, {
          actor: write.actor,
          operationId: write.operationId,
          operationType: "SET_STATUS",
          request,
        })) ?? (await classifyQnaMutation(context, write.actor, write.threadId, write.baseRevision))
      );
    }
  }

  const nextRevision = thread.version + 1;
  const event: QnaCanonicalEvent = {
    title: thread.title,
    status: write.status,
    replyId: null,
    deletedAt: null,
  };
  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: thread.studentId,
        resourceType: "QNA_THREAD",
        operationType: "SET_STATUS",
        resourceId: write.threadId,
        requestHash,
        requestHashVersion: QNA_REQUEST_HASH_VERSION,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query: `
          UPDATE qna_threads
          SET status = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL AND ? = 1
        `,
        params: [
          write.status,
          documentEpochSeconds(write.now),
          write.threadId,
          write.baseRevision,
          Number(write.actor.isAdmin),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      qnaEventInsertStatement({
        eventId: deriveQnaEventId(write.actor.id, write.operationId),
        threadId: write.threadId,
        eventNumber: nextRevision,
        eventType: "SET_STATUS",
        event,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      threadId: write.threadId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
    };
  } catch {
    return (
      (await resolveQnaReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType: "SET_STATUS",
        request,
      })) ?? (await classifyQnaMutation(context, write.actor, write.threadId, write.baseRevision))
    );
  }
}

async function mutateQnaTrashState(
  context: DbContext,
  write: QnaLifecycleWrite,
  operationType: "TRASH" | "RESTORE_TRASH",
): Promise<QnaMutationResult> {
  const thread = await findThread(context, write.threadId);
  const tombstone = thread
    ? null
    : await findDocumentTombstone(context, "QNA_THREAD", write.threadId);
  const subjectId = thread?.studentId ?? tombstone?.subjectId ?? "unknown";
  const request: QnaCanonicalRequest = {
    operationType,
    resourceId: write.threadId,
    subjectId,
    baseRevision: write.baseRevision,
  };
  const requestHash = createQnaRequestHash(request);
  const replay = await resolveQnaReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType,
    request,
  });
  if (replay) return replay;
  if (!thread || !canAccessThread(write.actor, thread)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (thread.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", threadId: thread.id, currentRevision: thread.version };
  }
  if (operationType === "TRASH" && thread.deletedAt) {
    return { ok: false, reason: "TRASHED", threadId: thread.id, currentRevision: thread.version };
  }
  if (operationType === "RESTORE_TRASH") {
    if (!thread.deletedAt) {
      return { ok: false, reason: "VERSION_CONFLICT", threadId: thread.id, currentRevision: thread.version };
    }
    if (
      documentEpochSeconds(thread.deletedAt)! <=
      documentEpochSeconds(write.now)! - QNA_TRASH_RETENTION_SECONDS
    ) {
      return { ok: false, reason: "RETENTION_EXPIRED", threadId: thread.id, currentRevision: thread.version };
    }
  }

  const nextRevision = thread.version + 1;
  const nextDeletedAt = operationType === "TRASH" ? write.now : null;
  const event: QnaCanonicalEvent = {
    title: thread.title,
    status: thread.status,
    replyId: null,
    deletedAt: nextDeletedAt,
  };
  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: thread.studentId,
        resourceType: "QNA_THREAD",
        operationType,
        resourceId: write.threadId,
        requestHash,
        requestHashVersion: QNA_REQUEST_HASH_VERSION,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query:
          operationType === "TRASH"
            ? `
                UPDATE qna_threads
                SET deleted_at = ?, deleted_by_id = ?, updated_at = ?, version = version + 1
                WHERE id = ? AND version = ? AND deleted_at IS NULL
                  AND (student_id = ? OR ? = 1)
              `
            : `
                UPDATE qna_threads
                SET deleted_at = NULL, deleted_by_id = NULL,
                    updated_at = ?, version = version + 1
                WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
                  AND deleted_at > ? AND (student_id = ? OR ? = 1)
              `,
        params:
          operationType === "TRASH"
            ? [
                documentEpochSeconds(write.now),
                write.actor.id,
                documentEpochSeconds(write.now),
                write.threadId,
                write.baseRevision,
                write.actor.id,
                Number(write.actor.isAdmin),
              ]
            : [
                documentEpochSeconds(write.now),
                write.threadId,
                write.baseRevision,
                documentEpochSeconds(write.now)! - QNA_TRASH_RETENTION_SECONDS,
                write.actor.id,
                Number(write.actor.isAdmin),
              ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      qnaEventInsertStatement({
        eventId: deriveQnaEventId(write.actor.id, write.operationId),
        threadId: write.threadId,
        eventNumber: nextRevision,
        eventType: operationType,
        event,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      threadId: write.threadId,
      replayed: false,
      resourceState: operationType === "TRASH" ? "TRASHED" : "ACTIVE",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
      createdAt: thread.createdAt ?? undefined,
    };
  } catch {
    return (
      (await resolveQnaReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType,
        request,
      })) ?? (await classifyQnaMutation(context, write.actor, write.threadId, write.baseRevision))
    );
  }
}

export function trashQnaThreadAtomically(context: DbContext, write: QnaLifecycleWrite) {
  return mutateQnaTrashState(context, write, "TRASH");
}

export function restoreTrashedQnaThreadAtomically(
  context: DbContext,
  write: QnaLifecycleWrite,
) {
  return mutateQnaTrashState(context, write, "RESTORE_TRASH");
}

export async function purgeQnaThreadAtomically(
  context: DbContext,
  write: QnaLifecycleWrite,
): Promise<QnaMutationResult> {
  const thread = await findThread(context, write.threadId);
  const tombstone = thread
    ? null
    : await findDocumentTombstone(context, "QNA_THREAD", write.threadId);
  const subjectId = thread?.studentId ?? tombstone?.subjectId ?? "unknown";
  const request: QnaCanonicalRequest = {
    operationType: "PURGE",
    resourceId: write.threadId,
    subjectId,
    baseRevision: write.baseRevision,
  };
  const requestHash = createQnaRequestHash(request);
  const replay = await resolveQnaReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "PURGE",
    request,
  });
  if (replay) return replay;
  if (!write.actor.isAdmin || !thread) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (!thread.deletedAt) {
    return { ok: false, reason: "RETENTION_NOT_EXPIRED", threadId: thread.id, currentRevision: thread.version };
  }
  if (thread.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", threadId: thread.id, currentRevision: thread.version };
  }
  if (
    documentEpochSeconds(thread.deletedAt)! >
    documentEpochSeconds(write.now)! - QNA_TRASH_RETENTION_SECONDS
  ) {
    return { ok: false, reason: "RETENTION_NOT_EXPIRED", threadId: thread.id, currentRevision: thread.version };
  }

  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  try {
    await executeDocumentStatementsAtomically(context, [
      documentLedgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: thread.studentId,
        resourceType: "QNA_THREAD",
        operationType: "PURGE",
        resourceId: write.threadId,
        requestHash,
        requestHashVersion: QNA_REQUEST_HASH_VERSION,
        resultRevision: thread.version,
        now: write.now,
      }),
      {
        query: `
          INSERT INTO document_tombstones (
            resource_type, resource_id, subject_id, owner_id,
            source_created_at, source_version, purged_at, purged_by_id
          )
          SELECT 'QNA_THREAD', id, student_id, student_id,
                 created_at, version, ?, ?
          FROM qna_threads
          WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
            AND deleted_at <= ? AND ? = 1
        `,
        params: [
          documentEpochSeconds(write.now),
          write.actor.id,
          write.threadId,
          write.baseRevision,
          documentEpochSeconds(write.now)! - QNA_TRASH_RETENTION_SECONDS,
          Number(write.actor.isAdmin),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ...qnaMediaPurgeStatements({ threadId: write.threadId, now: write.now }),
      {
        query: `
          DELETE FROM qna_threads
          WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
            AND deleted_at <= ? AND ? = 1
        `,
        params: [
          write.threadId,
          write.baseRevision,
          documentEpochSeconds(write.now)! - QNA_TRASH_RETENTION_SECONDS,
          Number(write.actor.isAdmin),
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
    return {
      ok: true,
      threadId: write.threadId,
      replayed: false,
      resourceState: "PURGED",
      operationResultRevision: thread.version,
      currentRevision: null,
    };
  } catch {
    return (
      (await resolveQnaReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType: "PURGE",
        request,
      })) ?? (await classifyQnaMutation(context, write.actor, write.threadId, write.baseRevision))
    );
  }
}
