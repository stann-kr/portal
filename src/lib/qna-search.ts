import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { createDb } from "@/db/client";
import { qnaReplies, qnaThreads } from "@/db/schema";
import {
  getDocumentSearchExcerpt,
  getDocumentSearchWords,
  getSearchableDocumentText,
  normalizeDocumentSearchQuery,
} from "@/lib/document-search";

/** 인증된 목록의 제목·질문·답변을 검색한다. 원문은 결과로 내보내지 않는다. */
export async function searchQnaThreads<T extends { id: string; title: string }>(
  db: ReturnType<typeof createDb>,
  threads: T[],
  query: string,
  studentId: string | null,
): Promise<(T & { searchPreview?: string })[]> {
  const words = getDocumentSearchWords(normalizeDocumentSearchQuery(query));
  if (!words.length || !threads.length) return threads;
  const matches = new Map(threads.map((thread) => {
    const title = thread.title.normalize("NFKC").toLowerCase();
    return [thread.id, {
      missing: new Set(words.filter((word) => !title.includes(word))),
      preview: undefined as string | undefined,
    }];
  }));

  // 긴 대화 전체를 한 번에 메모리에 올리지 않고 고정된 크기로 읽는다.
  const batchSize = 64;
  let cursor: string | undefined;
  while (true) {
    const replies = await db.select({
      id: qnaReplies.id,
      threadId: qnaReplies.threadId,
      contentHtml: qnaReplies.contentHtml,
    }).from(qnaReplies).innerJoin(qnaThreads, eq(qnaReplies.threadId, qnaThreads.id))
      .where(and(
        isNull(qnaThreads.deletedAt),
        studentId === null ? undefined : eq(qnaThreads.studentId, studentId),
        cursor === undefined ? undefined : gt(qnaReplies.id, cursor),
      )).orderBy(asc(qnaReplies.id)).limit(batchSize);
    for (const reply of replies) {
      const match = matches.get(reply.threadId);
      if (!match) continue;
      const body = getSearchableDocumentText(reply.contentHtml);
      const folded = body.toLowerCase();
      for (const word of match.missing) {
        if (folded.includes(word)) match.missing.delete(word);
      }
      if (!match.preview && words.some((word) => folded.includes(word))) {
        match.preview = getDocumentSearchExcerpt(body, words);
      }
    }
    if (replies.length < batchSize) break;
    cursor = replies[replies.length - 1].id;
  }
  return threads.flatMap((thread) => {
    const match = matches.get(thread.id)!;
    return match.missing.size ? [] : [{ ...thread, searchPreview: match.preview }];
  });
}
