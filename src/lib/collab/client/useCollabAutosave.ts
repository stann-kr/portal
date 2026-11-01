"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { collabSavedMarker } from "../saved-marker";
import { COLLAB_META } from "./seed";

/**
 * 공동 편집 문서의 서버 저장. 저장 담당으로 선출된 한 탭만 기존 server action으로 저장한다.
 * - 누가 바꿨든 문서가 바뀌면 1.5초 쉼(최대 10초) 뒤 저장한다. 화면을 떠날 때는 바로 저장한다.
 * - 마지막 저장 내용의 hash를 room `meta.savedHash`에 남겨 담당이 바뀌어도 같은 내용을 다시 저장하지 않는다.
 * - 저장 가능한 상태가 아니면(필수 칸 비어 있음) `blocked`로 기다린다.
 */
export type CollabAutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "blocked";

export type CollabSaveResult = { ok: true } | { ok: false; error: string };

export type CollabAutosaveOptions<S> = {
  doc: Y.Doc | null;
  enabled: boolean;
  isSaver: boolean;
  /** 지금 저장할 값. null이면 저장할 수 없는 상태(blocked). */
  readSnapshot: () => S | null;
  save: (snapshot: S) => Promise<CollabSaveResult>;
  idleMs?: number;
  maxWaitMs?: number;
  /** 저장 성공(또는 이미 저장된 내용과 같음) 뒤 room 상태의 저장 표지(snapshot). room이 "밀린 내용 없음"을 알게 한다. */
  onSaved?: (stateVector: Uint8Array) => void;
};

export const COLLAB_META_SAVED_HASH = "savedHash";

/** 저장 내용 비교용 가벼운 hash(FNV-1a 53bit). 보안 용도가 아니다. */
export function collabSnapshotHash(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 16777619);
    h2 = Math.imul(h2 ^ code, 2246822507);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}:${text.length}`;
}

export function useCollabAutosave<S>({
  doc,
  enabled,
  isSaver,
  readSnapshot,
  save,
  idleMs = 1500,
  maxWaitMs = 10_000,
  onSaved,
}: CollabAutosaveOptions<S>) {
  const [status, setStatus] = useState<CollabAutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const readRef = useRef(readSnapshot);
  const saveRef = useRef(save);
  const onSavedRef = useRef(onSaved);
  const activeRef = useRef(false);
  useEffect(() => {
    readRef.current = readSnapshot;
    saveRef.current = save;
    onSavedRef.current = onSaved;
    activeRef.current = enabled && isSaver && Boolean(doc);
  });
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPendingAtRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const rerunRef = useRef(false);
  const failedHashRef = useRef<string | null>(null);

  /** 지금 room 내용이 저장한 내용과 같으면 그 state vector를 알린다(저장 중 새 입력이 있었으면 알리지 않는다). */
  const reportSavedIfCurrent = useCallback(
    (hash: string) => {
      if (!doc || doc.isDestroyed) return;
      const current = readRef.current();
      if (current !== null && collabSnapshotHash(current) === hash) onSavedRef.current?.(collabSavedMarker(doc));
    },
    [doc],
  );

  const clearTimer = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  };

  const runSave = useCallback(async (): Promise<void> => {
    clearTimer();
    firstPendingAtRef.current = null;
    if (!activeRef.current || !doc) return;
    if (savingRef.current) {
      rerunRef.current = true;
      return savingRef.current;
    }
    const snapshot = readRef.current();
    if (snapshot === null) {
      setStatus("blocked");
      return;
    }
    const hash = collabSnapshotHash(snapshot);
    const meta = doc.getMap(COLLAB_META);
    if (meta.get(COLLAB_META_SAVED_HASH) === hash) {
      setStatus((previous) => (previous === "idle" ? "idle" : "saved"));
      reportSavedIfCurrent(hash);
      return;
    }
    setStatus("saving");
    const task = (async () => {
      let result: CollabSaveResult;
      try {
        result = await saveRef.current(snapshot);
      } catch {
        result = { ok: false, error: "저장 결과를 확인하지 못했습니다. 입력 내용은 이 기기와 실시간 문서에 남아 있습니다." };
      }
      if (result.ok) {
        failedHashRef.current = null;
        setError(null);
        setSavedAt(new Date());
        setStatus("saved");
        if (!doc.isDestroyed) doc.transact(() => meta.set(COLLAB_META_SAVED_HASH, hash), "collab-autosave-meta");
        reportSavedIfCurrent(hash);
      } else {
        failedHashRef.current = hash;
        setError(result.error);
        setStatus("error");
      }
    })();
    savingRef.current = task;
    try {
      await task;
    } finally {
      savingRef.current = null;
      if (rerunRef.current) {
        rerunRef.current = false;
        void runSave();
      }
    }
  }, [doc, reportSavedIfCurrent]);

  const schedule = useCallback(() => {
    if (!activeRef.current) return;
    const now = Date.now();
    firstPendingAtRef.current ??= now;
    setStatus((previous) => (previous === "saving" ? previous : "pending"));
    clearTimer();
    const waitedMs = now - firstPendingAtRef.current;
    idleTimerRef.current = setTimeout(() => void runSave(), Math.max(0, Math.min(idleMs, maxWaitMs - waitedMs)));
  }, [idleMs, maxWaitMs, runSave]);

  useEffect(() => {
    if (!doc) return;
    const handleUpdate = (_update: Uint8Array, origin: unknown) => {
      // 저장 표시(meta.savedHash)만 바뀐 update는 다시 저장할 이유가 아니다.
      if (origin === "collab-autosave-meta") return;
      const snapshot = activeRef.current ? readRef.current() : null;
      if (snapshot !== null && failedHashRef.current === collabSnapshotHash(snapshot)) return;
      schedule();
    };
    doc.on("update", handleUpdate);
    return () => doc.off("update", handleUpdate);
  }, [doc, schedule]);

  // 저장 담당이 되거나 저장할 수 있게 되면 밀린 변경이 있는지 한 번 확인한다.
  useEffect(() => {
    if (enabled && isSaver && doc) schedule();
    else clearTimer();
  }, [doc, enabled, isSaver, schedule]);

  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === "hidden" && idleTimerRef.current) void runSave();
    };
    const flushOnPageHide = () => {
      if (idleTimerRef.current) void runSave();
    };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnPageHide);
    };
  }, [runSave]);

  useEffect(() => () => clearTimer(), []);

  const retry = useCallback(() => {
    failedHashRef.current = null;
    void runSave();
  }, [runSave]);

  /**
   * 복원 준비(checkpoint): 선출·대기 시간·잠금과 무관하게 지금 내용을 저장한다. 진행 중인 저장이 있으면 끝난 뒤 다시 확인한다.
   * 이미 저장된 내용과 같으면 저장 없이 성공이다. 저장할 수 없는 상태(필수 칸 비어 있음)·실패는 ok: false.
   */
  const checkpoint = useCallback(async (): Promise<{ ok: boolean }> => {
    clearTimer();
    firstPendingAtRef.current = null;
    while (savingRef.current) await savingRef.current.catch(() => undefined);
    if (!doc || doc.isDestroyed) return { ok: false };
    const snapshot = readRef.current();
    if (snapshot === null) return { ok: false };
    const hash = collabSnapshotHash(snapshot);
    const meta = doc.getMap(COLLAB_META);
    if (meta.get(COLLAB_META_SAVED_HASH) === hash) return { ok: true };
    setStatus("saving");
    let result: CollabSaveResult;
    try {
      result = await saveRef.current(snapshot);
    } catch {
      result = { ok: false, error: "저장 결과를 확인하지 못했습니다." };
    }
    if (!result.ok) {
      failedHashRef.current = hash;
      setError(result.error);
      setStatus("error");
      return { ok: false };
    }
    failedHashRef.current = null;
    setError(null);
    setSavedAt(new Date());
    setStatus("saved");
    if (!doc.isDestroyed) doc.transact(() => meta.set(COLLAB_META_SAVED_HASH, hash), "collab-autosave-meta");
    reportSavedIfCurrent(hash);
    return { ok: true };
  }, [doc, reportSavedIfCurrent]);

  /** 저장 대기·진행 중인지(이탈 보호). */
  const hasPendingSave = useCallback(
    () => activeRef.current && (Boolean(idleTimerRef.current) || Boolean(savingRef.current)),
    [],
  );

  return { status, error, savedAt, retry, flush: runSave, checkpoint, hasPendingSave };
}
