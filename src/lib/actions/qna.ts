/** 1:1 Q&A aggregate query와 append-only event/trash lifecycle server action. */
"use server";

import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createDb, createDbContext } from "@/db/client";
import {
  profiles,
  qnaReplies,
  qnaThreadEvents,
  qnaThreads,
  type QnaStatus,
} from "@/db/schema";
import { requireAuth } from "@/lib/auth-guard";
import {
  CREATION_OPERATION_FIELD,
  deriveCreationResourceId,
  resolveCreationOperationId,
} from "@/lib/creation-operation";
import {
  createQnaReplyAtomically,
  createQnaThreadAtomically,
  preflightLegacyQnaReplyCreateReplay,
  preflightLegacyQnaThreadCreateReplay,
  purgeQnaThreadAtomically,
  restoreTrashedQnaThreadAtomically,
  setQnaStatusAtomically,
  trashQnaThreadAtomically,
  type QnaMutationFailureReason,
  type QnaMutationResult,
} from "@/lib/qna-atomic";
import {
  QNA_MAX_CONTENT_LABEL,
  QNA_MAX_TITLE_LENGTH,
  QNA_TRASH_RETENTION_SECONDS,
  isQnaContentWithinLimit,
} from "@/lib/qna-continuity";
import { isRichTextEmpty } from "@/lib/rich-text";
import { sanitizeHtml } from "@/lib/sanitize-html";
import type { DbContext } from "@/db/client";
import {
  findOwnedMediaObject,
  processMediaDeletionOutboxBestEffort,
} from "@/lib/media-lifecycle-atomic";
import { mediaDeliveryPath, parseMediaUuidV4 } from "@/lib/media-lifecycle";

type ResolvedQnaAttachment =
  | { ok: true; attachmentUrl: string | null; attachmentObjectId: string | null }
  | { ok: false; error: string };

async function resolveQnaAttachment(
  context: DbContext,
  input: {
    ownerId: string;
    operationId: string;
    replyId: string;
    formData: FormData;
    allowLegacyReplay?: boolean;
  },
): Promise<ResolvedQnaAttachment> {
  const rawObjectId = String(input.formData.get("attachmentObjectId") ?? "").trim();
  const submittedLegacyUrl = String(input.formData.get("attachmentUrl") ?? "").trim();
  const attachmentObjectId = rawObjectId ? parseMediaUuidV4(rawObjectId) : null;
  if (rawObjectId && !attachmentObjectId) {
    return { ok: false, error: "첨부 파일 식별자가 올바르지 않습니다. 다시 업로드해 주세요." };
  }
  if (submittedLegacyUrl && !attachmentObjectId) {
    if (input.allowLegacyReplay) {
      return {
        ok: true,
        attachmentUrl: submittedLegacyUrl,
        attachmentObjectId: null,
      };
    }
    return {
      ok: false,
      error: "이전 방식의 첨부는 소유권을 확인할 수 없습니다. 파일을 다시 업로드해 주세요.",
    };
  }
  if (!attachmentObjectId) {
    return { ok: true, attachmentUrl: null, attachmentObjectId: null };
  }

  const media = await findOwnedMediaObject(
    context,
    input.ownerId,
    attachmentObjectId,
  );
  const historicalAttachment =
    media?.resourceType === "QNA_REPLY" && media.resourceId === input.replyId;
  if (
    !media ||
    media.purpose !== "QNA_ATTACHMENT" ||
    media.draftOperationId !== input.operationId ||
    (media.state !== "READY" && !historicalAttachment)
  ) {
    return {
      ok: false,
      error: "첨부 파일의 소유권이나 업로드 상태를 확인할 수 없습니다.",
    };
  }
  return {
    ok: true,
    attachmentUrl: mediaDeliveryPath(attachmentObjectId),
    attachmentObjectId,
  };
}

function actor(session: Awaited<ReturnType<typeof requireAuth>>) {
  return { id: session.user.id!, isAdmin: session.user.role === "admin" };
}

function canAccessThread(
  session: Awaited<ReturnType<typeof requireAuth>>,
  studentId: string,
): boolean {
  return session.user.role === "admin" || session.user.id === studentId;
}

function lifecycleError(reason: QnaMutationFailureReason): string {
  switch (reason) {
    case "VERSION_CONFLICT":
      return "다른 화면에서 이 Q&A가 먼저 변경되었습니다. 최신 상태를 확인해 주세요.";
    case "TRASHED":
      return "이 Q&A는 휴지통에 있습니다.";
    case "PURGED":
      return "이 Q&A는 영구 삭제되어 다시 저장할 수 없습니다.";
    case "CLOSED":
      return "종료된 스레드에는 답변을 추가할 수 없습니다.";
    case "OPERATION_PAYLOAD_CONFLICT":
      return "같은 작업 식별자가 다른 내용에 이미 사용되었습니다.";
    case "OPERATION_VERSION_UNSUPPORTED":
      return "오래된 저장 요청을 확인할 수 없습니다. 페이지를 새로고침해 주세요.";
    case "RETENTION_NOT_EXPIRED":
      return "휴지통 보존 기간이 끝난 뒤에만 영구 삭제할 수 있습니다.";
    case "RETENTION_EXPIRED":
      return "복원 가능 기간이 지났습니다.";
    case "NOT_FOUND_OR_FORBIDDEN":
      return "Q&A를 찾을 수 없거나 권한이 없습니다.";
    case "INTERNAL_INVARIANT_FAILURE":
      return "Q&A 상태를 안전하게 변경하지 못했습니다. 다시 시도해 주세요.";
  }
}

function revalidateQnaPaths(threadId?: string) {
  revalidatePath("/dashboard/qna");
  revalidatePath("/dashboard/qna/trash");
  if (threadId) {
    revalidatePath(`/dashboard/qna/${threadId}`);
    revalidatePath(`/dashboard/qna/${threadId}/history`);
  }
  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/admin");
}

const THREAD_SELECT = {
  id: qnaThreads.id,
  title: qnaThreads.title,
  status: qnaThreads.status,
  createdAt: qnaThreads.createdAt,
  updatedAt: qnaThreads.updatedAt,
  version: qnaThreads.version,
  deletedAt: qnaThreads.deletedAt,
  studentId: qnaThreads.studentId,
  studentName: profiles.displayName,
  studentEmail: profiles.email,
} as const;

export async function getQnaThreads() {
  const session = await requireAuth();
  const isAdmin = session.user.role === "admin";
  return createDb()
    .select(THREAD_SELECT)
    .from(qnaThreads)
    .leftJoin(profiles, eq(qnaThreads.studentId, profiles.id))
    .where(
      isAdmin
        ? isNull(qnaThreads.deletedAt)
        : and(
            eq(qnaThreads.studentId, session.user.id!),
            isNull(qnaThreads.deletedAt),
          ),
    )
    .orderBy(desc(qnaThreads.updatedAt));
}

export async function getQnaThreadsByStudent(studentId: string) {
  const session = await requireAuth();
  if (session.user.role !== "admin") throw new Error("Unauthorized");
  return createDb()
    .select(THREAD_SELECT)
    .from(qnaThreads)
    .leftJoin(profiles, eq(qnaThreads.studentId, profiles.id))
    .where(and(eq(qnaThreads.studentId, studentId), isNull(qnaThreads.deletedAt)))
    .orderBy(desc(qnaThreads.updatedAt));
}

async function readQnaThread(threadId: string, includeTrash: boolean) {
  const session = await requireAuth();
  const isAdmin = session.user.role === "admin";
  const [thread] = await createDb()
    .select(THREAD_SELECT)
    .from(qnaThreads)
    .leftJoin(profiles, eq(qnaThreads.studentId, profiles.id))
    .where(
      and(
        eq(qnaThreads.id, threadId),
        isAdmin ? undefined : eq(qnaThreads.studentId, session.user.id!),
        includeTrash ? undefined : isNull(qnaThreads.deletedAt),
      ),
    )
    .limit(1);
  if (!thread) return null;
  const replies = await createDb()
    .select({
      id: qnaReplies.id,
      contentHtml: qnaReplies.contentHtml,
      attachmentUrl: qnaReplies.attachmentUrl,
      attachmentObjectId: qnaReplies.attachmentObjectId,
      createdAt: qnaReplies.createdAt,
      authorId: qnaReplies.authorId,
      authorName: profiles.displayName,
      authorEmail: profiles.email,
      authorRole: profiles.role,
    })
    .from(qnaReplies)
    .leftJoin(profiles, eq(qnaReplies.authorId, profiles.id))
    .where(eq(qnaReplies.threadId, threadId))
    .orderBy(qnaReplies.createdAt);
  return { ...thread, replies };
}

export async function getQnaThread(threadId: string) {
  return readQnaThread(threadId, false);
}

export async function getQnaThreadIncludingTrash(threadId: string) {
  return readQnaThread(threadId, true);
}

export async function getTrashedQnaThreads() {
  const session = await requireAuth();
  const isAdmin = session.user.role === "admin";
  const rows = await createDb()
    .select(THREAD_SELECT)
    .from(qnaThreads)
    .leftJoin(profiles, eq(qnaThreads.studentId, profiles.id))
    .where(
      isAdmin
        ? isNotNull(qnaThreads.deletedAt)
        : and(
            eq(qnaThreads.studentId, session.user.id!),
            isNotNull(qnaThreads.deletedAt),
          ),
    )
    .orderBy(desc(qnaThreads.deletedAt));
  return rows.map((thread) => ({
    ...thread,
    purgeEligibleAt: thread.deletedAt
      ? new Date(thread.deletedAt.getTime() + QNA_TRASH_RETENTION_SECONDS * 1000)
      : null,
  }));
}

export async function getQnaThreadEvents(threadId: string) {
  const session = await requireAuth();
  const [thread] = await createDb()
    .select({ studentId: qnaThreads.studentId })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, threadId))
    .limit(1);
  if (!thread || !canAccessThread(session, thread.studentId)) return [];
  return createDb()
    .select({
      id: qnaThreadEvents.id,
      eventNumber: qnaThreadEvents.eventNumber,
      eventType: qnaThreadEvents.eventType,
      title: qnaThreadEvents.title,
      status: qnaThreadEvents.status,
      replyId: qnaThreadEvents.replyId,
      deletedAt: qnaThreadEvents.deletedAt,
      actorId: qnaThreadEvents.actorId,
      actorName: profiles.displayName,
      createdAt: qnaThreadEvents.createdAt,
      replyContentHtml: qnaReplies.contentHtml,
      replyAttachmentUrl: qnaReplies.attachmentUrl,
      replyAttachmentObjectId: qnaReplies.attachmentObjectId,
    })
    .from(qnaThreadEvents)
    .leftJoin(profiles, eq(qnaThreadEvents.actorId, profiles.id))
    .leftJoin(qnaReplies, eq(qnaThreadEvents.replyId, qnaReplies.id))
    .where(eq(qnaThreadEvents.threadId, threadId))
    .orderBy(desc(qnaThreadEvents.eventNumber));
}

export async function getOpenThreadCount(): Promise<number> {
  const session = await requireAuth();
  const isAdmin = session.user.role === "admin";
  const [row] = await createDb()
    .select({ cnt: count() })
    .from(qnaThreads)
    .where(
      and(
        eq(qnaThreads.status, "OPEN"),
        isNull(qnaThreads.deletedAt),
        isAdmin ? undefined : eq(qnaThreads.studentId, session.user.id!),
      ),
    );
  return row?.cnt ?? 0;
}

export type CreateThreadState = {
  error?: string;
  success?: boolean;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
  thread?: { id: string; title: string; version?: number };
};

export type CreateThreadInlineState = Omit<CreateThreadState, "thread"> & {
  thread?: { id: string; title: string; createdAt: Date; version?: number };
};

type CreateThreadRecordResult = Omit<CreateThreadInlineState, "success">;

async function createQnaThreadRecord(
  session: Awaited<ReturnType<typeof requireAuth>>,
  formData: FormData,
): Promise<CreateThreadRecordResult> {
  const studentId = session.user.id!;
  const title = String(formData.get("title") ?? "").trim();
  const rawHtml = String(formData.get("contentHtml") ?? "");
  if (!title || isRichTextEmpty(rawHtml)) return { error: "제목과 내용은 필수입니다." };
  if (title.length > QNA_MAX_TITLE_LENGTH) {
    return { error: `제목은 ${QNA_MAX_TITLE_LENGTH}자 이하로 입력해 주세요.` };
  }
  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml)) return { error: "유효한 내용을 입력해 주세요." };
  if (!isQnaContentWithinLimit(contentHtml)) {
    return { error: `Q&A 본문은 ${QNA_MAX_CONTENT_LABEL} 이하로 저장할 수 있습니다.` };
  }
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) {
    return { error: "문서 생성 식별자가 올바르지 않습니다. 페이지를 새로고침해 주세요." };
  }
  const threadId = deriveCreationResourceId(
    operationId,
    JSON.stringify(["qna-thread", studentId]),
  );
  const replyId = deriveCreationResourceId(
    operationId,
    JSON.stringify(["qna-initial-reply", studentId]),
  );
  const context = createDbContext();
  const threadActor = actor(session);
  const submittedLegacyUrl = String(formData.get("attachmentUrl") ?? "").trim();
  const rawAttachmentObjectId = String(
    formData.get("attachmentObjectId") ?? "",
  ).trim();
  const allowLegacyReplay = Boolean(
    submittedLegacyUrl &&
      !rawAttachmentObjectId &&
      (await preflightLegacyQnaThreadCreateReplay(context, {
        actor: threadActor,
        threadId,
        replyId,
        operationId,
        title,
        contentHtml,
        attachmentUrl: submittedLegacyUrl,
        attachmentObjectId: null,
      })),
  );
  const attachment = await resolveQnaAttachment(context, {
    ownerId: studentId,
    operationId,
    replyId,
    formData,
    allowLegacyReplay,
  });
  if (!attachment.ok) return { error: attachment.error };
  const result = await createQnaThreadAtomically(context, {
    actor: threadActor,
    threadId,
    replyId,
    operationId,
    title,
    contentHtml,
    attachmentUrl: attachment.attachmentUrl,
    attachmentObjectId: attachment.attachmentObjectId,
    now: new Date(),
  });
  if (!result.ok) {
    if (result.reason === "OPERATION_PAYLOAD_CONFLICT") {
      return {
        error: "이 초안은 다른 내용으로 이미 등록되었습니다. 기존 질문을 열거나 별도 질문으로 분리해 주세요.",
        operationConflict: true,
        conflictedOperationId: operationId,
        existingId: result.threadId,
      };
    }
    return { error: lifecycleError(result.reason) };
  }
  return {
    thread: {
      id: result.threadId,
      title,
      createdAt: result.createdAt ?? new Date(),
      version: result.currentRevision ?? undefined,
    },
  };
}

export async function createQnaThread(
  _prev: CreateThreadState,
  formData: FormData,
): Promise<CreateThreadState> {
  const session = await requireAuth();
  if (session.user.role === "admin") {
    return { error: "학생만 새 Q&A 스레드를 생성할 수 있습니다." };
  }
  const result = await createQnaThreadRecord(session, formData);
  if (!result.thread) return result;
  revalidateQnaPaths(result.thread.id);
  return {
    success: true,
    thread: {
      id: result.thread.id,
      title: result.thread.title,
      version: result.thread.version,
    },
  };
}

export async function createQnaThreadInline(
  _prev: CreateThreadInlineState,
  formData: FormData,
): Promise<CreateThreadInlineState> {
  const session = await requireAuth();
  if (session.user.role === "admin") {
    return { error: "학생만 새 Q&A 스레드를 생성할 수 있습니다." };
  }
  const result = await createQnaThreadRecord(session, formData);
  if (!result.thread) return result;
  revalidateQnaPaths(result.thread.id);
  return { success: true, thread: result.thread };
}

export type CreateReplyState = {
  error?: string;
  success?: boolean;
  replyId?: string;
  currentRevision?: number;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
};

export async function createQnaReply(
  threadId: string,
  _prev: CreateReplyState,
  formData: FormData,
): Promise<CreateReplyState> {
  const session = await requireAuth();
  const rawHtml = String(formData.get("contentHtml") ?? "");
  if (isRichTextEmpty(rawHtml)) return { error: "내용을 입력해 주세요." };
  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml)) return { error: "유효한 내용을 입력해 주세요." };
  if (!isQnaContentWithinLimit(contentHtml)) {
    return { error: `Q&A 본문은 ${QNA_MAX_CONTENT_LABEL} 이하로 저장할 수 있습니다.` };
  }
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) {
    return { error: "문서 생성 식별자가 올바르지 않습니다. 페이지를 새로고침해 주세요." };
  }
  const replyId = deriveCreationResourceId(
    operationId,
    JSON.stringify(["qna-reply", session.user.id!, threadId]),
  );
  const context = createDbContext();
  const replyActor = actor(session);
  const submittedLegacyUrl = String(formData.get("attachmentUrl") ?? "").trim();
  const rawAttachmentObjectId = String(
    formData.get("attachmentObjectId") ?? "",
  ).trim();
  const allowLegacyReplay = Boolean(
    submittedLegacyUrl &&
      !rawAttachmentObjectId &&
      (await preflightLegacyQnaReplyCreateReplay(context, {
        actor: replyActor,
        threadId,
        replyId,
        operationId,
        contentHtml,
        attachmentUrl: submittedLegacyUrl,
        attachmentObjectId: null,
      })),
  );
  const attachment = await resolveQnaAttachment(context, {
    ownerId: session.user.id!,
    operationId,
    replyId,
    formData,
    allowLegacyReplay,
  });
  if (!attachment.ok) return { error: attachment.error };
  const result = await createQnaReplyAtomically(context, {
    actor: replyActor,
    threadId,
    replyId,
    operationId,
    contentHtml,
    attachmentUrl: attachment.attachmentUrl,
    attachmentObjectId: attachment.attachmentObjectId,
    now: new Date(),
  });
  if (!result.ok) {
    if (result.reason === "OPERATION_PAYLOAD_CONFLICT") {
      return {
        error: "이 초안은 다른 내용으로 이미 등록되었습니다. 현재 답변을 확인하거나 별도 답변으로 분리해 주세요.",
        operationConflict: true,
        conflictedOperationId: operationId,
        existingId: replyId,
      };
    }
    return { error: lifecycleError(result.reason) };
  }
  revalidateQnaPaths(threadId);
  return {
    success: true,
    replyId: result.replyId ?? replyId,
    currentRevision: result.currentRevision ?? undefined,
  };
}

export type QnaLifecycleState = {
  success: boolean;
  error?: string;
  conflictKind?: QnaMutationFailureReason;
  currentRevision?: number;
  purged?: boolean;
};

function lifecycleState(result: QnaMutationResult): QnaLifecycleState {
  return result.ok
    ? {
        success: true,
        currentRevision: result.currentRevision ?? undefined,
        purged: result.resourceState === "PURGED",
      }
    : {
        success: false,
        error: lifecycleError(result.reason),
        conflictKind: result.reason,
        currentRevision: result.currentRevision,
      };
}

export async function updateThreadStatus(
  threadId: string,
  status: QnaStatus,
  operationId: string,
  baseRevision: number,
): Promise<QnaLifecycleState> {
  const session = await requireAuth();
  if (!["OPEN", "ANSWERED", "CLOSED"].includes(status)) {
    return { success: false, error: "올바른 Q&A 상태가 아닙니다." };
  }
  const result = await setQnaStatusAtomically(createDbContext(), {
    actor: actor(session),
    threadId,
    operationId,
    baseRevision,
    status,
    now: new Date(),
  });
  if (result.ok) revalidateQnaPaths(threadId);
  return lifecycleState(result);
}

async function runQnaLifecycle(
  kind: "trash" | "restore" | "purge",
  threadId: string,
  operationId: string,
  baseRevision: number,
): Promise<QnaLifecycleState> {
  const session = await requireAuth();
  const write = {
    actor: actor(session),
    threadId,
    operationId,
    baseRevision,
    now: new Date(),
  };
  const result =
    kind === "trash"
      ? await trashQnaThreadAtomically(createDbContext(), write)
      : kind === "restore"
        ? await restoreTrashedQnaThreadAtomically(createDbContext(), write)
        : await purgeQnaThreadAtomically(createDbContext(), write);
  if (result.ok) {
    revalidateQnaPaths(threadId);
    if (kind === "purge") {
      await processMediaDeletionOutboxBestEffort(createDbContext(), { limit: 5 });
    }
  }
  return lifecycleState(result);
}

export async function trashQnaThread(
  threadId: string,
  operationId: string,
  baseRevision: number,
) {
  return runQnaLifecycle("trash", threadId, operationId, baseRevision);
}

export async function restoreQnaThread(
  threadId: string,
  operationId: string,
  baseRevision: number,
) {
  return runQnaLifecycle("restore", threadId, operationId, baseRevision);
}

export async function purgeQnaThread(
  threadId: string,
  operationId: string,
  baseRevision: number,
) {
  return runQnaLifecycle("purge", threadId, operationId, baseRevision);
}
