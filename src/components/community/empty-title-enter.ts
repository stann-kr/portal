/**
 * @file src/components/community/empty-title-enter.ts
 * @description 게시물 작성·수정 form에서 한 줄 입력칸의 Enter(암묵 제출)를 알아본다.
 * 제목이 비면 제출 버튼이 disabled라 브라우저가 암묵 제출을 하지 않아 안내 없이 아무 일도 일어나지 않는다.
 * form이 이 Enter를 직접 받아 버튼 제출과 같은 빈 제목 안내를 보이게 한다.
 * 과제 제출·믹스 분석처럼 한 줄 칸 뒤에 더 쓸 칸이 있는 form은 `keepEnterFromSubmitting`으로
 * 암묵 제출을 막고 `data-enter-focus`가 가리키는 다음 칸으로 넘긴다(제출은 버튼만).
 */
import type { KeyboardEvent } from "react";

const IMPLICIT_SUBMIT_INPUT_TYPES = new Set(["text", "url", "search", "email", "tel", "number", "password"]);

export function isImplicitSubmitEnter(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== "Enter" || event.defaultPrevented) return false;
  if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  return target instanceof HTMLInputElement && IMPLICIT_SUBMIT_INPUT_TYPES.has(target.type);
}

/** form `onKeyDown`에 둔다. 한 줄 칸의 Enter(휴대폰 '이동' 포함)로 제출하지 않고 `data-enter-focus` id의 칸으로 넘긴다. */
export function keepEnterFromSubmitting(event: KeyboardEvent<HTMLElement>) {
  if (!isImplicitSubmitEnter(event)) return;
  event.preventDefault();
  const nextId = (event.target as HTMLElement).dataset.enterFocus;
  if (nextId) document.getElementById(nextId)?.focus();
}
