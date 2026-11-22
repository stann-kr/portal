/**
 * @file src/lib/feedback-content.ts
 * @description 과제 피드백 내용의 길이 상한. 서버 액션과 입력칸이 같은 값을 쓴다.
 */
export const FEEDBACK_CONTENT_MAX_LENGTH = 2_000;

/** 글자(코드 포인트) 수로 센다. 화면 maxLength(UTF-16)보다 넉넉해 화면에서 넣은 값은 늘 통과한다. */
export function isFeedbackContentTooLong(content: string): boolean {
  return Array.from(content).length > FEEDBACK_CONTENT_MAX_LENGTH;
}

export const FEEDBACK_CONTENT_TOO_LONG_ERROR = `피드백은 ${new Intl.NumberFormat("ko-KR").format(FEEDBACK_CONTENT_MAX_LENGTH)}자까지 남길 수 있습니다.`;
