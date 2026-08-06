/**
 * @file src/lib/hooks/useBusyNavigationGuard.ts
 * @description 제출·업로드 중 SPA 링크 이동과 문서 이탈로 성공 후 정리가 끊기는 것을 막는다.
 */
"use client";

import { useEffect } from "react";

export function useBusyNavigationGuard(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const preventLinkNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("a[href]")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("click", preventLinkNavigation, true);
    window.addEventListener("beforeunload", preventUnload);
    return () => {
      document.removeEventListener("click", preventLinkNavigation, true);
      window.removeEventListener("beforeunload", preventUnload);
    };
  }, [locked]);
}
