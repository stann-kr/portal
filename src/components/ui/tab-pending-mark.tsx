"use client";

import { useLinkStatus } from "next/link";

/**
 * 탭 링크(Link) 안에 두어, 누른 탭의 내용을 기다리는 동안 그 탭 아래에 흐린 밑줄을 바로 보인다.
 * 같은 화면에서 주소의 query만 바뀌는 탭은 loading 스켈레톤이 다시 나오지 않아(Next) 누른 뒤 반응이 없어 보였다.
 */
export function TabPendingMark() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-foreground/40 motion-safe:animate-pulse"
    />
  );
}
