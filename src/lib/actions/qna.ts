/**
 * @file src/lib/actions/qna.ts
 * @description 1:1 Q&A 게시판 서버 액션 (Phase 6).
 * 학생: 본인 스레드 생성/조회, 답변 추가.
 * 어드민: 전체 스레드 조회, 답변 작성, 상태 변경.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { qnaThreads, qnaReplies, profiles } from "@/db/schema";
import type { QnaStatus } from "@/db/schema";
import { and, eq, desc, count, ne } from "drizzle-orm";
import { requireAuth } from "@/lib/auth-guard";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { isRichTextEmpty } from "@/lib/rich-text";

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
  thread?: { id: string; title: string };
};

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

  const title = (formData.get("title") as string)?.trim();
  const rawHtml = formData.get("contentHtml") as string;

  if (!title) return { error: "제목을 입력해주세요." };
  if (isRichTextEmpty(rawHtml))
    return { error: "내용을 입력해주세요." };

  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml))
    return { error: "내용을 입력해주세요." };

  const db = createDb();
  const threadId = crypto.randomUUID();
  const replyId = crypto.randomUUID();

  let threadCreated = false;
  try {
    await db.insert(qnaThreads).values({
      id: threadId,
      studentId: session.user.id!,
      title,
      status: "OPEN",
    });
    threadCreated = true;

    await db.insert(qnaReplies).values({
      id: replyId,
      threadId,
      authorId: session.user.id!,
      contentHtml,
      attachmentUrl: parseAttachmentUrl(formData),
    });
  } catch {
    if (threadCreated) {
      try {
        await db.delete(qnaThreads).where(eq(qnaThreads.id, threadId));
      } catch {
        // 원자 transaction은 승인된 persistence 보강 단계에서 적용한다.
      }
    }
    return { error: "질문을 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  revalidatePath("/dashboard/qna");
  revalidatePath("/dashboard/student");
  return { success: true, thread: { id: threadId, title } };
}

export type CreateThreadInlineState = {
  error?: string;
  success?: boolean;
  thread?: { id: string; title: string; createdAt: Date };
};

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

  const title = (formData.get("title") as string)?.trim();
  const rawHtml = formData.get("contentHtml") as string;

  if (!title) return { error: "제목을 입력해주세요." };
  if (isRichTextEmpty(rawHtml))
    return { error: "내용을 입력해주세요." };

  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml))
    return { error: "내용을 입력해주세요." };
  const attachmentUrl = parseAttachmentUrl(formData);

  const db = createDb();
  const threadId = crypto.randomUUID();
  const replyId = crypto.randomUUID();

  let threadCreated = false;
  try {
    await db.insert(qnaThreads).values({
      id: threadId,
      studentId: session.user.id!,
      title,
      status: "OPEN",
    });
    threadCreated = true;

    await db.insert(qnaReplies).values({
      id: replyId,
      threadId,
      authorId: session.user.id!,
      contentHtml,
      attachmentUrl,
    });

    revalidatePath("/dashboard/qna");
    revalidatePath("/dashboard/student");

    return { success: true, thread: { id: threadId, title, createdAt: new Date() } };
  } catch {
    if (threadCreated) {
      try {
        await db.delete(qnaThreads).where(eq(qnaThreads.id, threadId));
      } catch {
        // 원자 transaction은 승인된 persistence 보강 단계에서 적용한다.
      }
    }
    return { error: "질문 작성 중 오류가 발생했습니다." };
  }
}

// ─── 답변 추가 ────────────────────────────────────

export type CreateReplyState = { error?: string; success?: boolean; replyId?: string };

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

  const rawHtml = formData.get("contentHtml") as string;
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
  if (thread.status === "CLOSED") {
    return { error: "종료된 스레드에는 답변을 추가할 수 없습니다." };
  }

  const db = createDb();

  const replyId = crypto.randomUUID();
  try {
    await db.insert(qnaReplies).values({
      id: replyId,
      threadId,
      authorId: session.user.id!,
      contentHtml,
      attachmentUrl,
    });

    // 상태 확인 이후 CLOSED로 바뀐 경우 새 답변을 제거해 재오픈 경쟁을 막는다.
    const updatedThreads = await db
      .update(qnaThreads)
      .set({ status: isAdmin ? "ANSWERED" : "OPEN", updatedAt: new Date() })
      .where(and(eq(qnaThreads.id, threadId), ne(qnaThreads.status, "CLOSED")))
      .returning({ id: qnaThreads.id });

    if (updatedThreads.length === 0) {
      await db.delete(qnaReplies).where(eq(qnaReplies.id, replyId));
      return { error: "종료된 스레드에는 답변을 추가할 수 없습니다." };
    }
  } catch {
    try {
      await db.delete(qnaReplies).where(eq(qnaReplies.id, replyId));
    } catch {
      // 원자 transaction은 승인된 persistence 보강 단계에서 적용한다.
    }
    return { error: "답변을 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  revalidatePath(`/dashboard/qna/${threadId}`);
  revalidatePath("/dashboard/qna");
  revalidatePath("/dashboard/student");
  return { success: true, replyId };
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
