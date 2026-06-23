/**
 * @file src/lib/hooks/useFormDraft.ts
 * @description 작성 폼 임시저장(draft) 영속화 훅.
 * localStorage 기반. 마운트 시 1회 복원, 변경 시 디바운스 저장, 제출 성공 시 삭제.
 * SSR 안전: 복원은 useEffect 내에서만 수행하여 하이드레이션 불일치 방지.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseFormDraftResult<T> {
  /** 클라이언트에서 복원 시도가 끝났는지 여부 (에디터 마운트 게이트용) */
  loaded: boolean;
  /** 현재 폼 값을 디바운스 저장 */
  save: (data: T) => void;
  /** 저장된 draft 삭제 (제출 성공 시 호출) */
  clear: () => void;
}

/**
 * 폼 임시저장 훅.
 * @param key localStorage 키 (폼별/대상별로 고유해야 함)
 * @param onRestore 마운트 시 저장된 draft가 있으면 1회 호출 — 폼 state 복원에 사용
 * @param debounceMs 저장 디바운스 (기본 500ms)
 */
export function useFormDraft<T>(
  key: string,
  onRestore: (draft: T) => void,
  debounceMs = 500,
): UseFormDraftResult<T> {
  const [loaded, setLoaded] = useState(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 마운트 시 1회 복원 (setState들이 setLoaded와 함께 배치되어 단일 렌더로 반영)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) onRestoreRef.current(JSON.parse(raw) as T);
    } catch {
      // 손상된 draft는 무시
    }
    setLoaded(true);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [key]);

  const save = useCallback(
    (data: T) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        try {
          window.localStorage.setItem(key, JSON.stringify(data));
        } catch {
          // 저장소 사용 불가/용량 초과 시 무시
        }
      }, debounceMs);
    },
    [key, debounceMs],
  );

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 무시
    }
  }, [key]);

  return { loaded, save, clear };
}
