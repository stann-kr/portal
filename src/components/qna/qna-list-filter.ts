"use client";

import { useSyncExternalStore } from "react";
import type { QnaFilterTab } from "@/lib/qna-status";

/**
 * Q&A 목록에서 화면 안 상태 탭(ThreadList)으로 고른 필터. 서버가 그린 머리 링크(휴지통·새 질문)도 이 값으로
 * 복귀 주소를 만들어, 탭을 바꾼 뒤 갔다 와도 같은 탭으로 돌아온다. null이면 서버가 그린 값 그대로.
 */
let selected: QnaFilterTab | null = null;
const listeners = new Set<() => void>();

export function setQnaListFilter(next: QnaFilterTab | null) {
  if (selected === next) return;
  selected = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 화면 안에서 고른 필터, 없으면 서버가 그린 필터. */
export function useQnaListFilter(serverFilter: QnaFilterTab): QnaFilterTab {
  const chosen = useSyncExternalStore(subscribe, () => selected, () => null);
  return chosen ?? serverFilter;
}
