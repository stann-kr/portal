/**
 * @file src/lib/hooks/useFormDraft.ts
 * @description 작성 폼 임시저장(draft) 영속화 훅.
 * localStorage 기반. 마운트 시 1회 복원, 변경 시 디바운스 저장, 제출 성공 시 삭제.
 * SSR 안전: 복원은 useEffect 내에서만 수행하여 하이드레이션 불일치 방지.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  hasFormDraftStorageConflict,
  parseFormDraft,
  serializeFormDraft,
  type FormDraftStatus,
} from "@/lib/form-draft";

interface UseFormDraftResult<T> {
  /** 클라이언트에서 복원 시도가 끝났는지 여부 (에디터 마운트 게이트용) */
  loaded: boolean;
  /** 현재 폼 값을 디바운스 저장 */
  save: (data: T) => void;
  /** 저장된 draft 삭제 (제출 성공 시 호출) */
  clear: () => void;
  /** 예약된 저장을 즉시 반영 (blur/page hide 경계용) */
  flush: () => void;
  /** 로컬 저장소 기록 상태 */
  status: FormDraftStatus;
  /** 마지막으로 저장된 시각 */
  savedAt: Date | null;
  /** 마운트 시 기존 draft를 복원했는지 여부 */
  restored: boolean;
}

/**
 * 폼 임시저장 훅.
 * @param key localStorage 키 (폼별/대상별로 고유해야 함)
 * @param onRestore 마운트 시 저장된 draft가 있으면 1회 호출 — 폼 state 복원에 사용
 * @param options 저장 디바운스와 key 전환 시 폼 초기화 동작
 */
export function useFormDraft<T>(
  key: string,
  onRestore: (draft: T) => void,
  options: { debounceMs?: number; onReset?: () => void } = {},
): UseFormDraftResult<T> {
  const { debounceMs = 500, onReset } = options;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<FormDraftStatus>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [restored, setRestored] = useState(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T | null>(null);
  const mountedRef = useRef(false);
  const lastKnownRawRef = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (pendingRef.current === null) return;

    const data = pendingRef.current;
    const writtenAt = new Date();

    try {
      const currentRaw = window.localStorage.getItem(key);
      if (hasFormDraftStorageConflict(lastKnownRawRef.current, currentRaw)) {
        if (mountedRef.current) setStatus("conflict");
        return;
      }

      const nextRaw = serializeFormDraft(data, writtenAt.getTime());
      window.localStorage.setItem(key, nextRaw);
      lastKnownRawRef.current = nextRaw;
      pendingRef.current = null;
      if (mountedRef.current) {
        setSavedAt(writtenAt);
        setRestored(false);
        setStatus("saved");
      }
    } catch {
      if (mountedRef.current) setStatus("error");
    }
  }, [key]);

  // 마운트 시 1회 복원 (setState들이 setLoaded와 함께 배치되어 단일 렌더로 반영)
  useEffect(() => {
    mountedRef.current = true;
    // 이전 문서 flush가 storage 충돌/오류로 끝났더라도 그 pending 값을 새 key로 넘기지 않는다.
    // 충돌 내용은 현재 문서 화면에서 직접 저장하도록 안내하며, 문서 간 초안 혼입을 우선 차단한다.
    pendingRef.current = null;
    setStatus("idle");
    setSavedAt(null);
    setRestored(false);
    lastKnownRawRef.current = null;
    try {
      const raw = window.localStorage.getItem(key);
      const stored = raw ? parseFormDraft<T>(raw) : null;
      if (stored) {
        lastKnownRawRef.current = raw;
        onRestoreRef.current(stored.data);
        setSavedAt(stored.savedAt);
        setRestored(true);
        setStatus("saved");
      } else if (raw) {
        window.localStorage.removeItem(key);
        onResetRef.current?.();
      } else {
        onResetRef.current?.();
      }
    } catch {
      setStatus("error");
    }
    setLoadedKey(key);

    const handlePageHide = () => flush();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || event.key !== key) return;
      if (hasFormDraftStorageConflict(lastKnownRawRef.current, event.newValue)) {
        setStatus("conflict");
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      flush();
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flush, key]);

  const save = useCallback(
    (data: T) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = data;
      setStatus("saving");
      timerRef.current = setTimeout(() => {
        flush();
      }, debounceMs);
    },
    [debounceMs, flush],
  );

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    try {
      const currentRaw = window.localStorage.getItem(key);
      if (hasFormDraftStorageConflict(lastKnownRawRef.current, currentRaw)) {
        setStatus("conflict");
        return;
      }
      window.localStorage.removeItem(key);
      lastKnownRawRef.current = null;
      setSavedAt(null);
      setRestored(false);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, [key]);

  return {
    loaded: loadedKey === key,
    save,
    clear,
    flush,
    status,
    savedAt,
    restored,
  };
}
