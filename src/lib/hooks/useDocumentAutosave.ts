"use client";

import { useEffect, useRef } from "react";

export const DOCUMENT_AUTOSAVE_DELAY_MS = 1_500;

/**
 * 문서가 바뀐 뒤 입력이 멈추면 저장을 요청한다. 탭을 숨기면 기다리지 않고 바로 요청한다.
 * 저장 버튼 없이 쓰는 흐름의 시점만 정하고, 실제 저장·충돌·초안 보호는 각 form의 기존 경로가 맡는다.
 *
 * - `changeKey`가 바뀔 때마다 대기 시간을 다시 센다.
 * - `enabled`가 false인 동안(저장 중, 충돌 확인 중, 필수값 누락, 직전 실패 뒤 변경 없음)은 요청하지 않는다.
 */
export function useDocumentAutosave({
  enabled,
  dirty,
  changeKey,
  onSave,
  delayMs = DOCUMENT_AUTOSAVE_DELAY_MS,
}: {
  enabled: boolean;
  dirty: boolean;
  changeKey: string;
  onSave: () => void;
  delayMs?: number;
}) {
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const active = enabled && dirty;

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => onSaveRef.current(), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, changeKey, delayMs]);

  useEffect(() => {
    if (!active) return;
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") onSaveRef.current();
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    window.addEventListener("pagehide", saveWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", saveWhenHidden);
      window.removeEventListener("pagehide", saveWhenHidden);
    };
  }, [active]);
}
