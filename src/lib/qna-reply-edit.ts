/**
 * Q&A 답글(질문 본문 포함) 고치기(감사 보완 #7, 0039).
 *
 * `qna_replies` 행은 DB trigger로 바꿀 수 없다(원래 글과 생성 영수증 재전송 대조를 지킨다). 그래서 고친 본문은
 * `qna_reply_revisions`에 번호를 붙여 쌓고, 화면은 가장 큰 번호의 본문을 보인다. 원래 글은 `qna_replies`에 그대로 남는다.
 * 고치기는 작성자 본인만, 휴지통에 없는 질문에서만 하며 첨부는 바꾸지 않는다.
 */
import { sql } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import {
  DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  asDocumentReadDb,
  documentEpochSeconds,
  executeDocumentStatementsAtomically,
} from "@/lib/document-lifecycle-atomic";
import { documentImageClaimStatements } from "@/lib/media-lifecycle-atomic";

export type QnaReplyEditHead = { contentHtml: string; editedAt: Date; editNumber: number };

/** D1 한 문장의 bind 개수 한도(100) 안에서 나눠 읽는다. */
const READ_CHUNK = 90;

/** 답글마다 가장 최근에 고친 본문. 고친 적 없는 답글은 Map에 없다. */
export async function readQnaReplyEditHeads(
  db: DrizzleDb,
  replyIds: readonly string[],
): Promise<Map<string, QnaReplyEditHead>> {
  const heads = new Map<string, QnaReplyEditHead>();
  const unique = [...new Set(replyIds)];
  for (let offset = 0; offset < unique.length; offset += READ_CHUNK) {
    const chunk = unique.slice(offset, offset + READ_CHUNK);
    // 상관 subquery는 drizzle column 참조 대신 별칭을 쓴 SQL 문자열로 적는다(열 이름이 한정되지 않는 문제).
    const rows = await db.all<{ reply_id: string; content_html: string; created_at: number; edit_number: number }>(sql`
      SELECT edit.reply_id, edit.content_html, edit.created_at, edit.edit_number
      FROM qna_reply_revisions AS edit
      WHERE edit.reply_id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
        AND edit.edit_number = (
          SELECT MAX(latest.edit_number) FROM qna_reply_revisions AS latest WHERE latest.reply_id = edit.reply_id
        )`);
    for (const row of rows) {
      heads.set(row.reply_id, {
        contentHtml: row.content_html,
        editedAt: new Date(Number(row.created_at) * 1000),
        editNumber: Number(row.edit_number),
      });
    }
  }
  return heads;
}

/** 답글 목록의 본문을 고친 본문으로 바꾸고 고친 시각을 붙인다. */
export async function withQnaReplyEdits<T extends { id: string; contentHtml: string }>(
  db: DrizzleDb,
  replies: readonly T[],
): Promise<(T & { editedAt: Date | null })[]> {
  const heads = await readQnaReplyEditHeads(db, replies.map((reply) => reply.id));
  return replies.map((reply) => {
    const head = heads.get(reply.id);
    return head ? { ...reply, contentHtml: head.contentHtml, editedAt: head.editedAt } : { ...reply, editedAt: null };
  });
}

export type QnaReplyEditHistoryRow = { replyId: string; editNumber: number; contentHtml: string; createdAt: Date };

/** 한 질문의 고친 기록(이력 화면). 답글·번호 순. */
export async function readQnaReplyEditHistory(db: DrizzleDb, threadId: string): Promise<QnaReplyEditHistoryRow[]> {
  const rows = await db.all<{ reply_id: string; edit_number: number; content_html: string; created_at: number }>(sql`
    SELECT edit.reply_id, edit.edit_number, edit.content_html, edit.created_at
    FROM qna_reply_revisions AS edit
    JOIN qna_replies AS reply ON reply.id = edit.reply_id
    WHERE reply.thread_id = ${threadId}
    ORDER BY edit.created_at DESC, edit.edit_number DESC`);
  return rows.map((row) => ({
    replyId: row.reply_id,
    editNumber: Number(row.edit_number),
    contentHtml: row.content_html,
    createdAt: new Date(Number(row.created_at) * 1000),
  }));
}

export type EditQnaReplyResult =
  | { ok: true; threadId: string; contentHtml: string; editedAt: Date | null; unchanged: boolean }
  | { ok: false; reason: "NOT_FOUND" | "TRASHED" | "CONFLICT"; currentHtml?: string };

type ReplyRow = { id: string; thread_id: string; author_id: string; content_html: string; deleted_at: number | null };

/**
 * 작성자 본인의 답글 본문을 고친다. `expectedHtml`(고치기 시작할 때 본 본문)이 지금 본문과 다르면 덮지 않고 CONFLICT.
 * 권한·휴지통·본문 대조를 INSERT 문장 안에서 다시 확인하고, 본문 이미지는 같은 batch에서 이 답글에 붙인다.
 */
export async function editQnaReplyAtomically(
  context: DbContext,
  input: { actorId: string; replyId: string; expectedHtml: string; contentHtml: string; editId: string; now: Date },
): Promise<EditQnaReplyResult> {
  const db = asDocumentReadDb(context);
  const [reply] = await db.all<ReplyRow>(sql`
    SELECT reply.id, reply.thread_id, reply.author_id, reply.content_html, thread.deleted_at
    FROM qna_replies AS reply
    JOIN qna_threads AS thread ON thread.id = reply.thread_id
    WHERE reply.id = ${input.replyId}
    LIMIT 1`);
  // 남의 답글은 있는지도 알리지 않는다.
  if (!reply || reply.author_id !== input.actorId) return { ok: false, reason: "NOT_FOUND" };
  if (reply.deleted_at !== null) return { ok: false, reason: "TRASHED" };
  const head = (await readQnaReplyEditHeads(db, [reply.id])).get(reply.id);
  const currentHtml = head?.contentHtml ?? reply.content_html;
  // 이미 같은 본문이면(응답을 못 받은 재전송 포함) 새 줄을 쌓지 않고 성공으로 본다.
  if (currentHtml === input.contentHtml) {
    return { ok: true, threadId: reply.thread_id, contentHtml: currentHtml, editedAt: head?.editedAt ?? null, unchanged: true };
  }
  if (currentHtml !== input.expectedHtml) return { ok: false, reason: "CONFLICT", currentHtml };

  const now = documentEpochSeconds(input.now)!;
  try {
    await executeDocumentStatementsAtomically(context, [
      {
        query: `
          INSERT INTO qna_reply_revisions (id, reply_id, edit_number, content_html, editor_id, created_at)
          SELECT ?, reply.id,
            COALESCE((SELECT MAX(edit_number) FROM qna_reply_revisions WHERE reply_id = reply.id), 0) + 1,
            ?, ?, ?
          FROM qna_replies AS reply
          JOIN qna_threads AS thread ON thread.id = reply.thread_id
          WHERE reply.id = ? AND reply.author_id = ? AND thread.deleted_at IS NULL
            AND COALESCE(
              (SELECT content_html FROM qna_reply_revisions WHERE reply_id = reply.id ORDER BY edit_number DESC LIMIT 1),
              reply.content_html
            ) = ?
        `,
        params: [input.editId, input.contentHtml, input.actorId, now, input.replyId, input.actorId, input.expectedHtml],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ...documentImageClaimStatements({
        contentHtml: input.contentHtml,
        ownerId: input.actorId,
        resourceType: "QNA_REPLY",
        resourceId: input.replyId,
        now: input.now,
      }),
    ]);
  } catch (error) {
    // 조건부 INSERT가 0행이면(그 사이 다른 창에서 고침·휴지통) batch 전체가 취소된다. 지금 상태로 다시 판정한다.
    const [after] = await db.all<ReplyRow>(sql`
      SELECT reply.id, reply.thread_id, reply.author_id, reply.content_html, thread.deleted_at
      FROM qna_replies AS reply
      JOIN qna_threads AS thread ON thread.id = reply.thread_id
      WHERE reply.id = ${input.replyId}
      LIMIT 1`);
    if (!after || after.author_id !== input.actorId) return { ok: false, reason: "NOT_FOUND" };
    if (after.deleted_at !== null) return { ok: false, reason: "TRASHED" };
    const afterHead = (await readQnaReplyEditHeads(db, [after.id])).get(after.id);
    const afterHtml = afterHead?.contentHtml ?? after.content_html;
    if (afterHtml !== input.expectedHtml) return { ok: false, reason: "CONFLICT", currentHtml: afterHtml };
    throw error;
  }
  return { ok: true, threadId: reply.thread_id, contentHtml: input.contentHtml, editedAt: new Date(now * 1000), unchanged: false };
}
