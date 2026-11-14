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
