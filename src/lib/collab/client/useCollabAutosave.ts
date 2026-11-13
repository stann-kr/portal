"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { collabSavedMarker } from "../saved-marker";
import { COLLAB_META } from "./seed";

/**
 * 공동 편집 문서의 서버 저장. 저장 담당으로 선출된 한 탭만 기존 server action으로 저장한다.
 * - 누가 바꿨든 문서가 바뀌면 1.5초 쉼(최대 10초) 뒤 저장한다. 화면을 떠날 때는 바로 저장한다.
 * - 마지막 저장 내용의 hash를 room `meta.savedHash`에 남겨 담당이 바뀌어도 같은 내용을 다시 저장하지 않는다.
 * - 저장 가능한 상태가 아니면(필수 칸 비어 있음) `blocked`로 기다린다.
 * - 스냅샷에는 본문·칸·lifecycle이 함께 들어가므로 hash도 lifecycle을 포함한다(복원 뒤 같은 본문도 다시 저장 대상).
 */
export type CollabAutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "blocked";

/**
 * deferred: 이 스냅샷은 복원 전 세대라 서버가 받지 않았다(오류가 아니다). 복원이 이 문서에 들어오면(스냅샷이 바뀌면) 다시 저장한다.
 */
export type CollabSaveResult = { ok: true } | { ok: false; error: string } | { ok: false; deferred: true };

export type CollabAutosaveOptions<S> = {
  doc: Y.Doc | null;
  enabled: boolean;
  isSaver: boolean;
  /** 지금 저장할 값. null이면 저장할 수 없는 상태(blocked). */
  readSnapshot: () => S | null;
  save: (snapshot: S) => Promise<CollabSaveResult>;
  idleMs?: number;
  maxWaitMs?: number;
  /**
   * 내용이 실시간 room(Durable Object)에 이미 보관되는지. true면 D1 저장(= 이력 하나)을 드물게 하고
   * (입력이 2분 멈추면 / 이어서 입력해도 10분마다 / 탭을 가리거나 떠날 때), 저장 대기만으로는 이탈을 막지 않는다.
   */
  roomBacked?: boolean;
  /** 저장 성공(또는 이미 저장된 내용과 같음) 뒤 room 상태의 저장 표지(snapshot). room이 "밀린 내용 없음"을 알게 한다. */
  onSaved?: (stateVector: Uint8Array) => void;
};

export const COLLAB_META_SAVED_HASH = "savedHash";

/**
 * room이 내용을 보관할 때의 D1 저장 간격. 저장마다 revision이 하나씩 남으므로 이력 빈도도 이 값이 정한다.
 * 통합 테스트만 값을 줄인다.
 */
export const COLLAB_ROOM_BACKED_SAVE: { idleMs: number; maxWaitMs: number } = { idleMs: 2 * 60_000, maxWaitMs: 10 * 60_000 };

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
  idleMs: idleMsOption,
  maxWaitMs: maxWaitMsOption,
  roomBacked = false,
  onSaved,
}: CollabAutosaveOptions<S>) {
  const idleMs = idleMsOption ?? (roomBacked ? COLLAB_ROOM_BACKED_SAVE.idleMs : 1500);
  const maxWaitMs = maxWaitMsOption ?? (roomBacked ? COLLAB_ROOM_BACKED_SAVE.maxWaitMs : 10_000);
  const roomBackedRef = useRef(roomBacked);
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
    roomBackedRef.current = roomBacked;
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
      } else if ("deferred" in result) {
        // 복원 반영을 기다린다: 같은 스냅샷은 다시 보내지 않고, 문서가 바뀌면(복원 적용) 다시 저장한다.
        failedHashRef.current = hash;
        setError(null);
        setStatus("pending");
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

  // 앱 안 이동으로 화면이 사라질 때는 pagehide가 없다. 기다리던 저장을 그 자리에서 보낸다(server action은 unmount 뒤에도 끝난다).
  // layout effect 정리는 문서를 닫는 effect 정리보다 먼저 실행되므로 지금 내용을 읽을 수 있다.
  const runSaveRef = useRef(runSave);
  useEffect(() => {
    runSaveRef.current = runSave;
  });
  useLayoutEffect(
    () => () => {
      if (idleTimerRef.current) void runSaveRef.current();
    },
    [],
  );
  useEffect(() => () => clearTimer(), []);

  const retry = useCallback(() => {
    failedHashRef.current = null;
    void runSave();
  }, [runSave]);

  /** 저장 대기·진행 중인지(이탈 보호). room이 보관하는 동안의 저장 대기는 잃을 내용이 없어 막지 않는다. */
  const hasPendingSave = useCallback(
    () =>
      activeRef.current &&
      ((!roomBackedRef.current && Boolean(idleTimerRef.current)) || Boolean(savingRef.current)),
    [],
  );

  /** 기다리는 저장이 있을 때만 바로 보낸다(진행 중·실패한 저장은 다시 보내지 않는다). */
  const flushPending = useCallback(() => {
    if (idleTimerRef.current) void runSave();
  }, [runSave]);

  return { status, error, savedAt, retry, flush: runSave, flushPending, hasPendingSave };
}
