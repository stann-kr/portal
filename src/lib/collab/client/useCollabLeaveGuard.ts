"use client";

import { useEffect, useRef } from "react";

/**
 * 공동 편집 화면의 이탈 보호. 저장 대기·진행 중이거나 서버에 아직 보내지 못한 입력이 있으면
 * 새로고침·탭 닫기 전에 브라우저 확인을 띄운다. 입력은 기기 보관(IndexedDB)에도 남아 있다.
 */
export function useCollabLeaveGuard(shouldBlock: () => boolean): void {
  const shouldBlockRef = useRef(shouldBlock);
  useEffect(() => {
    shouldBlockRef.current = shouldBlock;
  });
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlockRef.current()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
}
