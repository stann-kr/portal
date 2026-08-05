/**
 * @file src/lib/actions/qna.ts
 * @description 1:1 Q&A 게시판 서버 액션 (Phase 6).
 * 학생: 본인 스레드 생성/조회, 답변 추가.
 * 어드민: 전체 스레드 조회, 답변 작성, 상태 변경.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb, createDbContext } from "@/db/client";
import { qnaThreads, qnaReplies, profiles } from "@/db/schema";
import type { QnaStatus } from "@/db/schema";
import { and, eq, desc, count } from "drizzle-orm";
import { requireAuth } from "@/lib/auth-guard";
import {
  createQnaReplyAtomically,
  createQnaThreadAtomically,
} from "@/lib/qna-atomic";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { isRichTextEmpty } from "@/lib/rich-text";
import {
  CREATION_OPERATION_FIELD,
  deriveCreationResourceId,
  resolveCreationOperationId,
} from "@/lib/creation-operation";

/**
 * 첨부 URL 파싱/검증.
 * FileUploader가 발급한 R2 publicUrl(http/https)만 허용. 그 외에는 null.
 * @returns 유효한 첨부 URL 또는 null
 */
function parseAttachmentUrl(formData: FormData): string | null {
  const raw = (formData.get("attachmentUrl") as string | null)?.trim();
  if (!raw) return null;
  if (raw.length > 2048) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

async function getQnaThreadOwner(threadId: string) {
  const db = createDb();
  const [thread] = await db
    .select({ id: qnaThreads.id, studentId: qnaThreads.studentId, status: qnaThreads.status })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, threadId))
    .limit(1);

  return thread ?? null;
}

// ─── 스레드 조회 ──────────────────────────────────

/**
 * 스레드 목록 조회.
 * 학생: 본인 스레드만, 어드민: 전체 + 학생 정보 포함.
 */
export async function getQnaThreads() {
  const session = await requireAuth();
  const db = createDb();
  const isAdmin = session.user.role === "admin";

  return db
    .select({
      id: qnaThreads.id,
      title: qnaThreads.title,
      status: qnaThreads.status,
      createdAt: qnaThreads.createdAt,
      updatedAt: qnaThreads.updatedAt,
      studentId: qnaThreads.studentId,
      studentName: profiles.displayName,
      studentEmail: profiles.email,
    })
    .from(qnaThreads)
    .leftJoin(profiles, eq(qnaThreads.studentId, profiles.id))
    .where(isAdmin ? undefined : eq(qnaThreads.studentId, session.user.id!))
    .orderBy(desc(qnaThreads.updatedAt));
}

/**
 * 특정 학생의 Q&A 스레드 목록 조회 (어드민 전용).
 * @param studentId 조회 대상 학생 ID
 */
export async function getQnaThreadsByStudent(studentId: string) {
  const session = await requireAuth();
  if (session.user.role !== "admin") throw new Error("Unauthorized");

  const db = createDb();
  return db
    .select({
      id: qnaThreads.id,
      title: qnaThreads.title,
      status: qnaThreads.status,
      createdAt: qnaThreads.createdAt,
      updatedAt: qnaThreads.updatedAt,
      studentId: qnaThreads.studentId,
      studentName: profiles.displayName,
      studentEmail: profiles.email,
    })
    .from(qnaThreads)
    .leftJoin(profiles, eq(qnaThreads.studentId, profiles.id))
    .where(eq(qnaThreads.studentId, studentId))
    .orderBy(desc(qnaThreads.updatedAt));
}

/**
 * 스레드 단건 + 답변 목록 조회.
 */
export async function getQnaThread(threadId: string) {
  const session = await requireAuth();
  const db = createDb();
  const isAdmin = session.user.role === "admin";

  const [thread] = await db
    .select({
      id: qnaThreads.id,
      title: qnaThreads.title,
      status: qnaThreads.status,
      createdAt: qnaThreads.createdAt,
      studentId: qnaThreads.studentId,
      studentName: profiles.displayName,
      studentEmail: profiles.email,
    })
    .from(qnaThreads)
    .leftJoin(profiles, eq(qnaThreads.studentId, profiles.id))
    .where(
      isAdmin
        ? eq(qnaThreads.id, threadId)
        : and(
            eq(qnaThreads.id, threadId),
            eq(qnaThreads.studentId, session.user.id!),
          ),
    )
    .limit(1);

  if (!thread) return null;

  const replies = await db
    .select({
      id: qnaReplies.id,
      contentHtml: qnaReplies.contentHtml,
      attachmentUrl: qnaReplies.attachmentUrl,
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

/**
 * 미답변(OPEN) 스레드 수 — 대시보드 위젯/뱃지용.
 * 어드민: 전체, 학생: 본인 것만.
 */
export async function getOpenThreadCount(): Promise<number> {
  const session = await requireAuth();
  const db = createDb();
  const isAdmin = session.user.role === "admin";

  const [row] = await db
    .select({ cnt: count() })
    .from(qnaThreads)
    .where(
      isAdmin
        ? eq(qnaThreads.status, "OPEN")
        : and(
            eq(qnaThreads.studentId, session.user.id!),
            eq(qnaThreads.status, "OPEN"),
          ),
    );

  return row?.cnt ?? 0;
}

// ─── 스레드 생성 ──────────────────────────────────

export type CreateThreadState = {
  error?: string;
  success?: boolean;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
  thread?: { id: string; title: string };
};

export type CreateThreadInlineState = {
  error?: string;
  success?: boolean;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
  thread?: { id: string; title: string; createdAt: Date };
};

type CreateThreadRecordResult = {
  error?: string;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
  thread?: { id: string; title: string; createdAt: Date };
};

async function createQnaThreadRecord(
  studentId: string,
  formData: FormData,
): Promise<CreateThreadRecordResult> {
  const title = String(formData.get("title") ?? "").trim();
  const rawHtml = String(formData.get("contentHtml") ?? "");

  if (!title) return { error: "제목을 입력해주세요." };
  if (isRichTextEmpty(rawHtml)) return { error: "내용을 입력해주세요." };

  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml)) return { error: "내용을 입력해주세요." };
  const attachmentUrl = parseAttachmentUrl(formData);
  const operationId = resolveCreationOperationId(
    formData.get(CREATION_OPERATION_FIELD),
  );
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
  const db = createDb();
  const findExisting = async () => {
    const [thread] = await db
      .select({
        id: qnaThreads.id,
        studentId: qnaThreads.studentId,
        title: qnaThreads.title,
        createdAt: qnaThreads.createdAt,
      })
      .from(qnaThreads)
      .where(eq(qnaThreads.id, threadId))
      .limit(1);
    const [reply] = await db
      .select({
        id: qnaReplies.id,
        threadId: qnaReplies.threadId,
        authorId: qnaReplies.authorId,
        contentHtml: qnaReplies.contentHtml,
        attachmentUrl: qnaReplies.attachmentUrl,
      })
      .from(qnaReplies)
      .where(eq(qnaReplies.id, replyId))
      .limit(1);
    return { thread: thread ?? null, reply: reply ?? null };
  };
  const isSameSubmission = (
    existing: Awaited<ReturnType<typeof findExisting>>,
  ) =>
    Boolean(
      existing.thread &&
      existing.reply &&
      existing.thread.studentId === studentId &&
      existing.thread.title === title &&
      existing.reply.threadId === threadId &&
      existing.reply.authorId === studentId &&
      existing.reply.contentHtml === contentHtml &&
      existing.reply.attachmentUrl === attachmentUrl,
    );

  try {
    await createQnaThreadAtomically(createDbContext(), {
      threadId,
      replyId,
      studentId,
      title,
      contentHtml,
      attachmentUrl,
    });
  } catch {
    try {
      const existing = await findExisting();
      if (!isSameSubmission(existing)) {
        if (existing.thread?.studentId === studentId) {
          return {
            error: "이 초안은 다른 내용으로 이미 등록되었습니다. 기존 질문을 열거나 별도 질문으로 분리해 주세요.",
            operationConflict: true,
            conflictedOperationId: operationId,
            existingId: existing.thread.id,
          };
        }
        return { error: "질문을 저장하지 못했습니다. 다시 시도해 주세요." };
      }
      return {
        thread: {
          id: threadId,
          title,
          createdAt: existing.thread?.createdAt ?? new Date(),
        },
      };
    } catch {
      return { error: "질문을 저장하지 못했습니다. 다시 시도해 주세요." };
    }
  }

  let createdAt = new Date();
  try {
    const existing = await findExisting();
    if (isSameSubmission(existing) && existing.thread?.createdAt) {
      createdAt = existing.thread.createdAt;
    }
  } catch {
    // 원자 생성은 완료되었다. 생성 시각 조회 실패는 성공을 되돌리지 않는다.
  }
  return { thread: { id: threadId, title, createdAt } };
}

/**
 * 새 Q&A 스레드 생성 (학생 전용).
 */
export async function createQnaThread(
  _prev: CreateThreadState,
  formData: FormData,
): Promise<CreateThreadState> {
  const session = await requireAuth();
  if (session.user.role === "admin") {
    return { error: "학생만 새 Q&A 스레드를 생성할 수 있습니다." };
  }

  const result = await createQnaThreadRecord(session.user.id!, formData);
  if (!result.thread) return result;

  revalidatePath("/dashboard/qna");
  revalidatePath("/dashboard/student");
  return {
    success: true,
    thread: { id: result.thread.id, title: result.thread.title },
  };
}

/**
 * 새 Q&A 스레드 생성 — 인라인 폼용 (redirect 없이 결과 반환).
 * UnifiedCreateDialog 등 원페이지 폼에서 사용.
 */
export async function createQnaThreadInline(
  _prev: CreateThreadInlineState,
  formData: FormData,
): Promise<CreateThreadInlineState> {
  const session = await requireAuth();
  if (session.user.role === "admin") {
    return { error: "학생만 새 Q&A 스레드를 생성할 수 있습니다." };
  }

  const result = await createQnaThreadRecord(session.user.id!, formData);
  if (!result.thread) return result;

  revalidatePath("/dashboard/qna");
  revalidatePath("/dashboard/student");
  return { success: true, thread: result.thread };
}

// ─── 답변 추가 ────────────────────────────────────

export type CreateReplyState = {
  error?: string;
  success?: boolean;
  replyId?: string;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
};

/**
 * 답변/추가 질문 작성 (학생 + 어드민).
 * 어드민이 답변하면 스레드 상태를 ANSWERED로 자동 변경.
 */
export async function createQnaReply(
  threadId: string,
  _prev: CreateReplyState,
  formData: FormData,
): Promise<CreateReplyState> {
  const session = await requireAuth();
  const isAdmin = session.user.role === "admin";
  const actorId = session.user.id!;

  const rawHtml = String(formData.get("contentHtml") ?? "");
  if (isRichTextEmpty(rawHtml))
    return { error: "내용을 입력해주세요." };

  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml))
    return { error: "내용을 입력해주세요." };
  const attachmentUrl = parseAttachmentUrl(formData);

  const thread = await getQnaThreadOwner(threadId);
  if (!thread) {
    return { error: "존재하지 않는 스레드입니다." };
  }

  if (!isAdmin && thread.studentId !== session.user.id) {
    return { error: "권한이 없습니다." };
  }
  const operationId = resolveCreationOperationId(
    formData.get(CREATION_OPERATION_FIELD),
  );
  if (!operationId) {
    return { error: "문서 생성 식별자가 올바르지 않습니다. 페이지를 새로고침해 주세요." };
  }
  const replyId = deriveCreationResourceId(
    operationId,
    JSON.stringify(["qna-reply", actorId, threadId]),
  );
  const db = createDb();
  const findExisting = async () => {
    const [existing] = await db
      .select({
        id: qnaReplies.id,
        threadId: qnaReplies.threadId,
        authorId: qnaReplies.authorId,
        contentHtml: qnaReplies.contentHtml,
        attachmentUrl: qnaReplies.attachmentUrl,
      })
      .from(qnaReplies)
      .where(eq(qnaReplies.id, replyId))
      .limit(1);
    return existing ?? null;
  };
  const isSameSubmission = (existing: Awaited<ReturnType<typeof findExisting>>) =>
    Boolean(
      existing &&
      existing.threadId === threadId &&
      existing.authorId === actorId &&
      existing.contentHtml === contentHtml &&
      existing.attachmentUrl === attachmentUrl,
    );
  const conflictResult = (existingId: string): CreateReplyState => ({
    error: "이 초안은 다른 내용으로 이미 등록되었습니다. 현재 답변을 확인하거나 별도 답변으로 분리해 주세요.",
    operationConflict: true,
    conflictedOperationId: operationId,
    existingId,
  });
  const successResult = (): CreateReplyState => {
    revalidatePath(`/dashboard/qna/${threadId}`);
    revalidatePath("/dashboard/qna");
    revalidatePath("/dashboard/student");
    return { success: true, replyId };
  };

  let existingBeforeInsert: Awaited<ReturnType<typeof findExisting>>;
  try {
    existingBeforeInsert = await findExisting();
  } catch {
    return { error: "답변을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  if (existingBeforeInsert) {
    if (isSameSubmission(existingBeforeInsert)) return successResult();
    return existingBeforeInsert.threadId === threadId &&
      existingBeforeInsert.authorId === actorId
      ? conflictResult(existingBeforeInsert.id)
      : { error: "답변을 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  if (thread.status === "CLOSED") {
    return { error: "종료된 스레드에는 답변을 추가할 수 없습니다." };
  }

  const dbContext = createDbContext();

  try {
    const created = await createQnaReplyAtomically(dbContext, {
      threadId,
      replyId,
      actorId,
      isAdmin,
      contentHtml,
      attachmentUrl,
    });

    if (!created) {
      return { error: "종료된 스레드에는 답변을 추가할 수 없습니다." };
    }
  } catch {
    try {
      const existing = await findExisting();
      if (isSameSubmission(existing)) return successResult();
      if (existing?.threadId === threadId && existing.authorId === actorId) {
        return conflictResult(existing.id);
      }
      const latestThread = await getQnaThreadOwner(threadId);
      if (latestThread?.status === "CLOSED") {
        return { error: "종료된 스레드에는 답변을 추가할 수 없습니다." };
      }
    } catch {
      // 원래 쓰기 오류 메시지를 유지한다.
    }
    return { error: "답변을 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  return successResult();
}

// ─── 상태 변경 ────────────────────────────────────

/**
 * 스레드 상태 변경 (어드민 전용).
 */
export async function updateThreadStatus(threadId: string, status: QnaStatus) {
  const session = await requireAuth();
  if (session.user.role !== "admin") throw new Error("Unauthorized");
  if (!["OPEN", "ANSWERED", "CLOSED"].includes(status)) {
    throw new Error("Invalid Q&A status");
  }

  const db = createDb();
  await db
    .update(qnaThreads)
    .set({ status, updatedAt: new Date() })
    .where(eq(qnaThreads.id, threadId));

  revalidatePath(`/dashboard/qna/${threadId}`);
  revalidatePath("/dashboard/qna");
  revalidatePath("/dashboard/student");
}
