import type { DbContext } from "@/db/client";
import { qnaReplies, qnaThreads } from "@/db/schema";
import type { QnaStatus } from "@/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";

export type CreateQnaThreadWrite = {
  threadId: string;
  replyId: string;
  studentId: string;
  title: string;
  contentHtml: string;
  attachmentUrl: string | null;
};

export type CreateQnaReplyWrite = {
  threadId: string;
  replyId: string;
  actorId: string;
  isAdmin: boolean;
  contentHtml: string;
  attachmentUrl: string | null;
};

/**
 * 질문 스레드와 첫 본문을 하나의 원자 쓰기로 생성한다.
 * D1은 binding batch, 로컬 SQLite는 동기 transaction을 사용한다.
 */
export async function createQnaThreadAtomically(
  context: DbContext,
  write: CreateQnaThreadWrite,
): Promise<void> {
  const threadValues = {
    id: write.threadId,
    studentId: write.studentId,
    title: write.title,
    status: "OPEN" as const,
  };
  const replyValues = {
    id: write.replyId,
    threadId: write.threadId,
    authorId: write.studentId,
    contentHtml: write.contentHtml,
    attachmentUrl: write.attachmentUrl,
  };

  if (context.kind === "d1") {
    await context.db.batch([
      context.db.insert(qnaThreads).values(threadValues),
      context.db.insert(qnaReplies).values(replyValues),
    ]);
    return;
  }

  context.db.transaction((tx) => {
    tx.insert(qnaThreads).values(threadValues).run();
    tx.insert(qnaReplies).values(replyValues).run();
  });
}

/**
 * 답변 추가와 스레드 상태 변경을 하나의 원자 쓰기로 처리한다.
 *
 * D1에서는 먼저 CLOSED가 아닌 대상만 갱신하고, 다음 insert의 thread_id를
 * 같은 대상을 다시 찾는 scalar subquery로 제한한다. 대상이 사라졌거나 CLOSED로
 * 바뀌었다면 thread_id가 NULL이 되어 NOT NULL 제약이 batch 전체를 rollback한다.
 */
export async function createQnaReplyAtomically(
  context: DbContext,
  write: CreateQnaReplyWrite,
): Promise<boolean> {
  const nextStatus: QnaStatus = write.isAdmin ? "ANSWERED" : "OPEN";
  const writableThread = write.isAdmin
    ? and(
        eq(qnaThreads.id, write.threadId),
        ne(qnaThreads.status, "CLOSED"),
      )
    : and(
        eq(qnaThreads.id, write.threadId),
        eq(qnaThreads.studentId, write.actorId),
        ne(qnaThreads.status, "CLOSED"),
      );

  if (context.kind === "d1") {
    const ownerGuard = write.isAdmin
      ? sql``
      : sql`and ${qnaThreads.studentId} = ${write.actorId}`;
    const guardedThreadId = sql<string>`(
      select ${qnaThreads.id}
      from ${qnaThreads}
      where ${qnaThreads.id} = ${write.threadId}
        and ${qnaThreads.status} = ${nextStatus}
        ${ownerGuard}
      limit 1
    )`;

    await context.db.batch([
      context.db
        .update(qnaThreads)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(writableThread),
      context.db.insert(qnaReplies).values({
        id: write.replyId,
        threadId: guardedThreadId,
        authorId: write.actorId,
        contentHtml: write.contentHtml,
        attachmentUrl: write.attachmentUrl,
      }),
    ]);
    return true;
  }

  return context.db.transaction((tx) => {
    const updatedThreads = tx
      .update(qnaThreads)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(writableThread)
      .returning({ id: qnaThreads.id })
      .all();

    if (updatedThreads.length === 0) {
      return false;
    }

    tx.insert(qnaReplies)
      .values({
        id: write.replyId,
        threadId: write.threadId,
        authorId: write.actorId,
        contentHtml: write.contentHtml,
        attachmentUrl: write.attachmentUrl,
      })
      .run();
    return true;
  });
}
