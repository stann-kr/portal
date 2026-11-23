/** 게시물 댓글 한 건의 최대 글자 수(유니코드 글자 단위). 서버 action과 입력 칸이 같은 값을 쓴다. */
export const COMMENT_MAX_LENGTH = 5_000;

/** 입력 칸 아래에 글자 수를 보이기 시작하는 길이(캔버스 "코드 리뷰 2차 후속" ③). */
export const COMMENT_COUNTER_FROM = 4_500;

export type LimitedCommentContent = {
  /** 한도 안으로 자른 내용. */
  value: string;
  /** 자른 뒤 글자 수. */
  length: number;
  /** 한도를 넘어 잘려 나간 글자 수. 0이면 그대로다. */
  cut: number;
};

/**
 * 댓글 입력을 한도 안으로 맞춘다. 서버가 세는 방식과 같게 유니코드 글자(이모지 한 개 = 한 글자)로 세고,
 * 넘친 뒷부분만 잘라 낸다.
 */
export function limitCommentContent(input: string): LimitedCommentContent {
  // UTF-16 길이가 한도 안이면 글자 수도 한도 안이다. 대부분의 입력은 여기서 끝난다.
  if (input.length <= COMMENT_COUNTER_FROM) return { value: input, length: [...input].length, cut: 0 };
  const characters = [...input];
  if (characters.length <= COMMENT_MAX_LENGTH) return { value: input, length: characters.length, cut: 0 };
  return {
    value: characters.slice(0, COMMENT_MAX_LENGTH).join(""),
    length: COMMENT_MAX_LENGTH,
    cut: characters.length - COMMENT_MAX_LENGTH,
  };
}

/** 답글이면 원 댓글 ID를 담는 form 칸. 비어 있으면 원 댓글이다. */
/**
 * 저장된 댓글 HTML(`<p>` 하나에 escape한 평문, createComment가 만든다)을 고치기 칸의 평문으로 되돌린다.
 * 다른 모양의 HTML이면 태그를 빼고 엔티티만 풀어 보인다.
 */
export function commentPlainText(html: string): string {
  const inner = /^<p>([\s\S]*)<\/p>$/u.exec(html)?.[1] ?? html.replace(/<[^>]*>/gu, "");
  return inner
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&");
}

export const COMMENT_PARENT_FIELD = "parentId";

/**
 * 답글의 답글이면 "답글"을 누른 그 답글 ID를 담는 form 칸(알림 대상만 정한다). 묶음은 COMMENT_PARENT_FIELD의 원 댓글로 정하므로,
 * 그 답글이 지워졌어도 답글은 원 댓글 묶음에 달린다.
 */
export const COMMENT_REPLY_TO_FIELD = "replyToId";

/** 답글 입력 초안 context. 원 댓글(묶음)마다 따로 보존한다(같은 "커뮤니티 댓글" 초안 종류). */
export function commentReplyDraftContext(postId: string, rootId: string): string {
  return `${postId}:reply:${rootId}`;
}

/** 답글의 답글을 열 때 입력 칸에 미리 넣는 말. 사용자가 지울 수 있는 일반 글자다. */
export function replyMention(name: string): string {
  return `@${name} `;
}

type ThreadRow = { id: string; parentId: string | null };

export type CommentThread<T extends ThreadRow> =
  | { kind: "comment"; id: string; root: T; replies: T[] }
  | { kind: "deleted"; id: string; replies: T[] };

/**
 * 작성 순서로 받은 댓글을 원 댓글 + 답글 묶음으로 나눈다(한 단계).
 * 원 댓글이 지워졌는데 답글이 남은 묶음은 "deleted"로, 그 묶음의 첫 답글 자리에 놓는다.
 * 답글이 모두 지워지면 그 묶음도 없다.
 */
export function groupCommentThreads<T extends ThreadRow>(rows: readonly T[]): CommentThread<T>[] {
  const rootIds = new Set(rows.filter((row) => row.parentId === null).map((row) => row.id));
  const repliesByParent = new Map<string, T[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const replies = repliesByParent.get(row.parentId);
    if (replies) replies.push(row);
    else repliesByParent.set(row.parentId, [row]);
  }
  const threads: CommentThread<T>[] = [];
  const placedDeleted = new Set<string>();
  for (const row of rows) {
    if (row.parentId === null) {
      threads.push({ kind: "comment", id: row.id, root: row, replies: repliesByParent.get(row.id) ?? [] });
    } else if (!rootIds.has(row.parentId) && !placedDeleted.has(row.parentId)) {
      placedDeleted.add(row.parentId);
      threads.push({ kind: "deleted", id: row.parentId, replies: repliesByParent.get(row.parentId) ?? [] });
    }
  }
  return threads;
}
