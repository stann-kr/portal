/**
 * @file src/components/community/empty-title-enter.ts
 * @description 게시물 작성·수정 form에서 한 줄 입력칸의 Enter(암묵 제출)를 알아본다.
 * 제목이 비면 제출 버튼이 disabled라 브라우저가 암묵 제출을 하지 않아 안내 없이 아무 일도 일어나지 않는다.
 * form이 이 Enter를 직접 받아 버튼 제출과 같은 빈 제목 안내를 보이게 한다.
 */
import type { KeyboardEvent } from "react";

const IMPLICIT_SUBMIT_INPUT_TYPES = new Set(["text", "url", "search", "email", "tel", "number", "password"]);

export function isImplicitSubmitEnter(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== "Enter" || event.defaultPrevented) return false;
  if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  return target instanceof HTMLInputElement && IMPLICIT_SUBMIT_INPUT_TYPES.has(target.type);
}
