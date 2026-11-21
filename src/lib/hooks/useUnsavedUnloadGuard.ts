"use client";

import { useEffect } from "react";

/** 저장하지 않은 입력이 있으면 새로고침·탭 닫기·외부 이동에 브라우저 확인을 띄운다. */
export function useUnsavedUnloadGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);
}
