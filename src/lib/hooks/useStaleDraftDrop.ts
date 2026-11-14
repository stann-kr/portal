/** 이미 저장된 글을 고치는 form에서, 저장된 글보다 오래된 이 기기 초안을 열 때 한 번 지운다. */
"use client";

import { useCallback, useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import type { UseFormDraftResult } from "@/lib/hooks/useFormDraft";

/**
 * 이 기기 초안이 서버에 저장된 글보다 오래됐는지. 시각을 모르면 오래됐다고 보지 않는다(초안을 지키는 쪽).
 * 초안 시각은 이 기기 시계, 저장 시각은 서버 시계라 두 시계가 어긋난 만큼은 판단이 달라질 수 있다.
 */
export function isDraftOlderThanSaved(
  draftSavedAt: Date | null,
  savedAt: Date | null | undefined,
): boolean {
  if (!draftSavedAt || !savedAt) return false;
  const draftMs = draftSavedAt.getTime();
  const savedMs = savedAt.getTime();
  return Number.isFinite(draftMs) && Number.isFinite(savedMs) && draftMs < savedMs;
}

/**
 * 다른 기기에서 고쳐 저장한 뒤에 남은 이 기기의 이전 초안(캔버스 "코드 리뷰 2차 후속" ⑤).
 * form을 열 때 복원된 초안이 저장된 글보다 오래됐으면 초안을 지우고 `onDrop`으로 저장된 글을 다시 보인다.
 * 더 새 초안은 그대로 복원된다. 연 뒤에 사용자가 직접 고른 복구본은 건드리지 않도록 form마다 한 번만 판단한다.
 *
 * @param draft 이 form의 `useFormDraft` 결과
 * @param savedAt 서버에 저장된 글의 마지막 저장 시각(새로 쓰는 form이면 null)
 * @param onDrop 초안을 지운 뒤 form 값을 저장된 글로 되돌린다
 * @returns `staleDropped`: 안내를 보일지, `dismissStaleNotice`: 다시 쓰기 시작하면 안내를 거둔다
 */
export function useStaleDraftDrop<T>(
  draft: Pick<UseFormDraftResult<T>, "loaded" | "restored" | "savedAt" | "clear">,
  savedAt: Date | null | undefined,
  onDrop: () => void,
): { staleDropped: boolean; dismissStaleNotice: () => void } {
  const [staleDropped, setStaleDropped] = useState(false);
  const checkedRef = useRef(false);
  const onDropRef = useRef(onDrop);
  useInsertionEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);
  const { loaded, restored, savedAt: draftSavedAt, clear } = draft;

  // 복원된 값이 화면에 그려지기 전에 판단해야 오래된 내용이 한순간도 보이지 않는다(layout effect).
  useLayoutEffect(() => {
    if (!loaded || checkedRef.current) return;
    checkedRef.current = true;
    if (!restored || !isDraftOlderThanSaved(draftSavedAt, savedAt)) return;
    clear({ reason: "discard" });
    onDropRef.current();
    // 이 기기 저장소(외부 시스템)에서 읽은 초안 시각으로만 알 수 있는 결과라 render 단계에서 정할 수 없다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 초안 판정 결과 반영
    setStaleDropped(true);
  }, [clear, draftSavedAt, loaded, restored, savedAt]);

  const dismissStaleNotice = useCallback(() => setStaleDropped(false), []);
  return { staleDropped, dismissStaleNotice };
}
