/**
 * 과제 글을 계정에 임시 저장해 다른 기기에서 이어 쓰게 한다(0035, 2026-11-23 사용자 결정·캔버스 CowriteDrafts ③④).
 * 이 기기 초안(`useFormDraft`)과 이탈 보호는 그대로 두고 그 위에 계정 사본 한 벌을 얹는다.
 *
 * - 이 기기 저장소에 key별로 "마지막으로 계정에 올린 글"의 signature와 version을 남긴다. 지금 화면 값이 그 signature와 같으면
 *   계정에 이미 있는 글이고, 다르면 아직 올리지 않은 입력이다.
 * - 열 때: 올리지 않은 입력이 없으면 계정 사본을 조용히 불러온다. 올리지 않은 입력이 있고 계정 사본이 그 사이 바뀌어
 *   내용이 다르면 고를 때까지 올리지 않는다(conflict). 고르지 않은 쪽은 이 기기에 보관해 되살릴 수 있다.
 * - 바뀐 값은 1.5초 뒤(페이지를 떠나거나 칸을 벗어나면 바로) version compare-and-set으로 올린다. 닿지 않으면 연결·초점이
 *   돌아올 때 다시 올린다.
 * - 제출보다 오래된 계정 사본은 이미 낸 글이라 쓰지 않는다. 한 번 올린 글이 계정에서 사라졌으면(다른 기기에서 제출·비움)
 *   이 기기에 남은 같은 글도 지운다.
 */
"use client";

import { useCallback, useEffect, useInsertionEffect, useRef, useState } from "react";
import {
  discardMyAssignmentDraft,
  getMyAssignmentDraft,
  saveMyAssignmentDraft,
} from "@/lib/actions/assignmentDrafts";
import type { AccountDraftCopy } from "@/lib/assignment-drafts";
import { createFormDraftDataSignature } from "@/lib/form-draft";
import type { UseFormDraftResult } from "@/lib/hooks/useFormDraft";
import { createAccountAssignmentDraftSyncStorageKey } from "@/lib/local-owner-keys";

export const ACCOUNT_DRAFT_UPLOAD_DELAY_MS = 1_500;

/** ③ 상태 줄: 저장 중 · 계정에 저장됨 · 이 기기에만 저장됨(닿지 않음) · 다른 기기 글을 불러옴. idle이면 이 기기 문구를 쓴다. */
export type AccountDraftState = "idle" | "saving" | "saved" | "offline" | "loaded";

export type AccountDraftSide = "device" | "account";

/** 고르지 않은 쪽 보관본. */
export type AccountDraftAlternate = { from: AccountDraftSide; at: Date; preview: string };

type Alternate<T> = { data: T; at: number; from: AccountDraftSide };
type SyncMarker<T> = { signature: string | null; version: number | null; alternate: Alternate<T> | null };
type Phase = "waiting" | "starting" | "ready" | "conflict" | "done";

const EMPTY_MARKER: SyncMarker<never> = { signature: null, version: null, alternate: null };

function readMarker<T>(storageKey: string): SyncMarker<T> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return EMPTY_MARKER;
    const parsed = JSON.parse(raw) as Partial<SyncMarker<T>>;
    const alternate = parsed.alternate && typeof parsed.alternate === "object"
      && (parsed.alternate.from === "device" || parsed.alternate.from === "account")
      && typeof parsed.alternate.at === "number"
      ? parsed.alternate
      : null;
    return {
      signature: typeof parsed.signature === "string" ? parsed.signature : null,
      version: typeof parsed.version === "number" && Number.isSafeInteger(parsed.version) ? parsed.version : null,
      alternate,
    };
  } catch {
    return EMPTY_MARKER;
  }
}

function writeMarker<T>(storageKey: string, marker: SyncMarker<T>): void {
  try {
    if (marker.signature === null && marker.version === null && marker.alternate === null) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(marker));
    }
  } catch {
    // 저장소를 못 쓰면 다음에 열 때 올리지 않은 입력으로 보고 다시 판단한다(내용은 잃지 않는다).
  }
}

function signatureOf(value: unknown): string | null {
  return value === null || value === undefined ? null : createFormDraftDataSignature(value);
}

function parsePayload(copy: AccountDraftCopy): unknown {
  try {
    return JSON.parse(copy.payloadJson) as unknown;
  } catch {
    return null;
  }
}

export interface UseAccountDraftSyncOptions<T> {
  /** 지금 학생 id(이 기기 표시를 계정별로 나눈다). */
  ownerId: string;
  /** 계정 사본 key(`task-submission:<과제>` 등). */
  draftKey: string;
  /** 같은 form의 이 기기 초안. 불러온 값은 여기에도 저장한다. */
  draft: Pick<UseFormDraftResult<T>, "loaded" | "save" | "clear">;
  /** 지금 화면 값. 처음 상태(저장된 글과 같거나 빈 칸)면 null. */
  value: T | null;
  /** 계정 사본·보관본을 화면에 넣는다(`useFormDraft`의 복원 함수와 같은 정리). */
  apply: (data: T) => void;
  /** 화면을 처음 상태로 되돌린다. */
  reset: () => void;
  /** 저장된 제출의 마지막 저장 시각. 이보다 오래된 계정 사본은 쓰지 않는다. */
  savedAt: Date | null | undefined;
  /** 충돌 안내·보관본에 보일 앞부분(약 40자). */
  preview: (data: T) => string;
}

export interface UseAccountDraftSyncResult {
  state: AccountDraftState;
  /** 저장됨·불러옴 시각(계정 사본 시각). */
  stateAt: Date | null;
  /** 이 기기에도 올리지 않은 다른 입력이 있을 때 다른 기기 사본의 시각·앞부분. 고를 때까지 올리지 않는다. */
  conflict: { at: Date; preview: string } | null;
  chooseAccountCopy: () => void;
  chooseDeviceCopy: () => void;
  /** 고르지 않은 쪽 보관본. */
  alternate: AccountDraftAlternate | null;
  restoreAlternate: () => void;
  dismissAlternate: () => void;
  /** 계정에 올렸던 글이 다른 기기에서 제출·비워져 이 기기의 같은 글을 지웠다. */
  remoteCleared: boolean;
  /** 예약된 올리기를 바로 보낸다(칸을 벗어날 때). */
  flush: () => void;
  /** 제출을 보내는 동안 올리지 않는다. 제출이 실패하면 false로 다시 이어 간다. */
  pause: (paused: boolean) => void;
  /**
   * 제출에 성공했다. 서버가 계정 사본을 지웠으므로 이 화면에서는 더 올리지 않는다.
   * `keepSyncing`: 제출 뒤 빈 칸으로 돌아가 새 글을 받는 form(새 자유 제출)은 계속 맞춘다.
   */
  markSubmitted: (options?: { keepSyncing?: boolean }) => void;
}

export function useAccountDraftSync<T>({
  ownerId,
  draftKey,
  draft,
  value,
  apply,
  reset,
  savedAt,
  preview,
}: UseAccountDraftSyncOptions<T>): UseAccountDraftSyncResult {
  const storageKey = createAccountAssignmentDraftSyncStorageKey(ownerId, draftKey);
  const [state, setState] = useState<AccountDraftState>("idle");
  const [stateAt, setStateAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<{ at: Date; preview: string } | null>(null);
  const [alternate, setAlternate] = useState<AccountDraftAlternate | null>(null);
  const [remoteCleared, setRemoteCleared] = useState(false);

  const phaseRef = useRef<Phase>("waiting");
  const conflictCopyRef = useRef<{ data: T; version: number; updatedAt: Date } | null>(null);
  const inflightRef = useRef(false);
  const rerunRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const pausedRef = useRef(false);
  const latest = useRef({ draft, apply, reset, savedAt, preview });
  useInsertionEffect(() => {
    valueRef.current = value;
    latest.current = { draft, apply, reset, savedAt, preview };
  });

  const updateMarker = useCallback((patch: Partial<SyncMarker<T>>) => {
    const next = { ...readMarker<T>(storageKey), ...patch };
    writeMarker(storageKey, next);
    if ("alternate" in patch) {
      const stored = next.alternate;
      setAlternate(stored ? { from: stored.from, at: new Date(stored.at), preview: latest.current.preview(stored.data) } : null);
    }
    return next;
  }, [storageKey]);

  const show = useCallback((next: AccountDraftState, at: Date | null = null) => {
    setState(next);
    setStateAt(at);
  }, []);

  /** 계정 사본을 화면과 이 기기 초안에 넣고, 그 글을 올린 글로 기록한다. */
  const adopt = useCallback((data: T, version: number) => {
    latest.current.apply(data);
    latest.current.draft.save(data);
    valueRef.current = data;
    updateMarker({ signature: signatureOf(data), version });
  }, [updateMarker]);

  const syncRef = useRef<() => Promise<void>>(async () => undefined);

  /** 계정 사본과 이 기기 값을 맞춰 본다(열 때, 저장 충돌 때). */
  const decide = useCallback((copy: AccountDraftCopy | null) => {
    const { savedAt: submittedAt } = latest.current;
    // 제출(수정)보다 먼저 쓴 사본은 이미 낸 글이다.
    const remote = copy && !(submittedAt && copy.updatedAt.getTime() <= submittedAt.getTime()) ? copy : null;
    const local = valueRef.current;
    const localSignature = signatureOf(local);
    const marker = readMarker<T>(storageKey);

    if (!remote) {
      if (local !== null && marker.version !== null && localSignature === marker.signature) {
        // 올렸던 글이 계정에서 사라졌다(다른 기기에서 제출하거나 비움). 이 기기에 남은 같은 글도 지운다.
        latest.current.draft.clear({ reason: "discard" });
        latest.current.reset();
        valueRef.current = null;
        updateMarker({ signature: null, version: null });
        setRemoteCleared(true);
        phaseRef.current = "ready";
        show("idle");
        return;
      }
      updateMarker({ version: null });
      phaseRef.current = "ready";
      void syncRef.current();
      return;
    }

    const data = parsePayload(remote) as T | null;
    if (data === null || typeof data !== "object") {
      // 읽을 수 없는 사본은 이 기기 값으로 덮는다.
      updateMarker({ version: remote.version });
      phaseRef.current = "ready";
      void syncRef.current();
      return;
    }
    const remoteSignature = signatureOf(data);
    if (localSignature === remoteSignature) {
      updateMarker({ signature: remoteSignature, version: remote.version });
      phaseRef.current = "ready";
      show("saved", remote.updatedAt);
      return;
    }
    if (local === null || localSignature === marker.signature) {
      // 이 기기에 올리지 않은 입력이 없다: 계정 사본을 조용히 불러온다.
      adopt(data, remote.version);
      phaseRef.current = "ready";
      show("loaded", remote.updatedAt);
      return;
    }
    if (marker.version === remote.version) {
      // 마지막으로 맞춘 뒤 계정 사본은 그대로이고 이 기기만 더 썼다.
      phaseRef.current = "ready";
      void syncRef.current();
      return;
    }
    conflictCopyRef.current = { data, version: remote.version, updatedAt: remote.updatedAt };
    phaseRef.current = "conflict";
    setConflict({ at: remote.updatedAt, preview: latest.current.preview(data) });
    show("idle");
  }, [adopt, show, storageKey, updateMarker]);

  const sync = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (phaseRef.current !== "ready" || pausedRef.current) return;
    if (inflightRef.current) {
      rerunRef.current = true;
      return;
    }
    const current = valueRef.current;
    const signature = signatureOf(current);
    const marker = readMarker<T>(storageKey);
    if (signature === marker.signature && (current === null || marker.version !== null)) {
      // 쓰다가 원래 글로 되돌렸다: 올릴 것이 없다.
      setState((previous) => (previous === "saving" ? (marker.version === null ? "idle" : "saved") : previous));
      return;
    }
    if (current === null && marker.version === null) {
      updateMarker({ signature: null });
      show("idle");
      return;
    }

    inflightRef.current = true;
    show("saving");
    try {
      if (current === null) {
        const result = await discardMyAssignmentDraft(draftKey, marker.version!);
        if ((phaseRef.current as Phase) === "done") return;
        if (result.status === "discarded" || result.status === "denied") {
          updateMarker({ signature: null, version: null });
          show("idle");
        } else {
          decide(result.draft);
        }
        return;
      }
      const result = await saveMyAssignmentDraft(draftKey, JSON.stringify(current), marker.version);
      // 보내는 사이 제출했다: 결과를 반영하지 않는다(서버가 사본을 지웠다).
      if ((phaseRef.current as Phase) === "done") return;
      if (result.status === "saved") {
        updateMarker({ signature, version: result.version });
        show("saved", result.updatedAt);
      } else if (result.status === "conflict") {
        decide(result.draft);
      } else {
        // 과제가 지워졌거나 받을 수 없는 글: 이 기기 초안만 남긴다.
        phaseRef.current = "done";
        show("offline");
      }
    } catch {
      show("offline");
    } finally {
      inflightRef.current = false;
      if (rerunRef.current) {
        rerunRef.current = false;
        void syncRef.current();
      }
    }
  }, [decide, draftKey, show, storageKey, updateMarker]);
  useInsertionEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  const start = useCallback(async () => {
    if (phaseRef.current !== "waiting") return;
    phaseRef.current = "starting";
    try {
      const result = await getMyAssignmentDraft(draftKey);
      if (phaseRef.current !== "starting") return;
      if (!result.ok) {
        phaseRef.current = "done";
        return;
      }
      decide(result.draft);
    } catch {
      if (phaseRef.current !== "starting") return;
      phaseRef.current = "waiting";
      show("offline");
    }
  }, [decide, draftKey, show]);

  // 이 기기 초안 복원이 끝난 뒤 한 번 계정 사본과 맞춘다. 보관본은 이 기기 저장소에서 읽는다.
  const { loaded } = draft;
  useEffect(() => {
    if (!loaded) return;
    const stored = readMarker<T>(storageKey).alternate;
    setAlternate(stored ? { from: stored.from, at: new Date(stored.at), preview: latest.current.preview(stored.data) } : null);
    void start();
  }, [loaded, start, storageKey]);

  // 화면 값이 바뀌면 잠시 뒤 올린다.
  const valueJson = value === null ? null : JSON.stringify(value);
  const schedule = useCallback(() => {
    if (phaseRef.current !== "ready" || pausedRef.current) return;
    const marker = readMarker<T>(storageKey);
    const signature = signatureOf(valueRef.current);
    if (signature === marker.signature && (valueRef.current === null || marker.version !== null)) return;
    // 다시 쓰기 시작하면 "지웠습니다" 안내를 거두고, 바로 "저장 중"을 보여 이전 저장 시각이 남아 보이지 않게 한다.
    // 닿지 않는 동안은 "이 기기에만"을 유지한다.
    if (valueRef.current !== null) setRemoteCleared(false);
    setState((previous) => (previous === "offline" ? previous : "saving"));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void syncRef.current(), ACCOUNT_DRAFT_UPLOAD_DELAY_MS);
  }, [storageKey]);
  useEffect(() => {
    schedule();
  }, [schedule, valueJson]);

  // 페이지를 떠나거나 가려지면 바로 보내고, 연결·초점이 돌아오면 다시 시도한다.
  useEffect(() => {
    const flushNow = () => {
      if (timerRef.current) void syncRef.current();
    };
    const retry = () => {
      if (phaseRef.current === "waiting" && loaded) void start();
      else void syncRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
      else retry();
    };
    window.addEventListener("pagehide", flushNow);
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loaded, start]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const chooseAccountCopy = useCallback(() => {
    const copy = conflictCopyRef.current;
    if (!copy || phaseRef.current !== "conflict") return;
    const local = valueRef.current;
    if (local !== null) updateMarker({ alternate: { data: local, at: Date.now(), from: "device" } });
    conflictCopyRef.current = null;
    adopt(copy.data, copy.version);
    phaseRef.current = "ready";
    setConflict(null);
    show("loaded", copy.updatedAt);
  }, [adopt, show, updateMarker]);

  const chooseDeviceCopy = useCallback(() => {
    const copy = conflictCopyRef.current;
    if (!copy || phaseRef.current !== "conflict") return;
    // 다른 기기 사본을 기준 version으로 삼아 이 기기 글로 덮는다. 덮인 사본은 이 기기에 보관한다.
    updateMarker({ version: copy.version, alternate: { data: copy.data, at: copy.updatedAt.getTime(), from: "account" } });
    conflictCopyRef.current = null;
    phaseRef.current = "ready";
    setConflict(null);
    void syncRef.current();
  }, [updateMarker]);

  const restoreAlternate = useCallback(() => {
    const stored = readMarker<T>(storageKey).alternate;
    if (!stored || phaseRef.current === "conflict") return;
    const local = valueRef.current;
    // 바꾼 쪽을 다시 보관해 언제든 되돌릴 수 있게 한다.
    updateMarker({ alternate: local === null ? null : { data: local, at: Date.now(), from: "device" } });
    latest.current.apply(stored.data);
    latest.current.draft.save(stored.data);
  }, [storageKey, updateMarker]);

  const dismissAlternate = useCallback(() => {
    updateMarker({ alternate: null });
  }, [updateMarker]);

  const flush = useCallback(() => {
    if (timerRef.current) void syncRef.current();
  }, []);

  const pause = useCallback((paused: boolean) => {
    pausedRef.current = paused;
    if (paused && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!paused) schedule();
  }, [schedule]);

  const markSubmitted = useCallback((options?: { keepSyncing?: boolean }) => {
    phaseRef.current = options?.keepSyncing ? "ready" : "done";
    pausedRef.current = false;
    // 낸 글을 다시 올리지 않도록 화면이 비기 전에도 올릴 값이 없다고 본다.
    if (options?.keepSyncing) valueRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    writeMarker(storageKey, EMPTY_MARKER);
    setAlternate(null);
    setConflict(null);
    show("idle");
  }, [show, storageKey]);

  return {
    state,
    stateAt,
    conflict,
    chooseAccountCopy,
    chooseDeviceCopy,
    alternate,
    restoreAlternate,
    dismissAlternate,
    remoteCleared,
    flush,
    pause,
    markSubmitted,
  };
}
