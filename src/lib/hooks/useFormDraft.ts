/**
 * @file src/lib/hooks/useFormDraft.ts
 * @description 작성 폼 임시저장(draft) 영속화 훅.
 * canonical draft와 탭별 shadow snapshot을 함께 사용해 동시 탭 경합에서도 입력을 보존한다.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  compactFormDraftRecoveries,
  createFormDraftDataSignature,
  createFormDraftRecoveryPreview,
  createImmutableFormDraftRecoveryKey,
  findFormDraftClearMarker,
  findFormDraftClearMarkerForSnapshot,
  hasFutureFormDraftVersion,
  hasFormDraftStorageConflict,
  isImmutableFormDraftRecoveryKey,
  isFormDraftClearMarkerKey,
  isFormDraftRecoveryKey,
  parseFormDraftClearMarker,
  parseFormDraft,
  persistFormDraftRawSnapshot,
  pruneFormDraftRecoveries,
  readFormDraftRecovery,
  removeFormDraftCanonicalSnapshotBySignature,
  removeFormDraftSnapshotsBySignature,
  serializeFormDraft,
  writeFormDraftClearMarker,
  type FormDraftRecoverySummary,
  type FormDraftStorage,
  type FormDraftStatus,
} from "@/lib/form-draft";

const FORM_DRAFT_CHANGE_EVENT = "portal:form-draft-change";
const FORM_DRAFT_BROADCAST_CHANNEL = "portal:form-draft";

type FormDraftChangeDetail = {
  sourceKey: string;
  writerId: string;
  kind: "canonical" | "recovery" | "submitted-clear";
  signature?: string;
  clearedAt?: number;
};

type PendingDraft<T> = {
  data: T;
  signature: string | null;
  queuedAt: number;
};

function getPendingDraftSignature<T>(pending: PendingDraft<T>): string {
  if (pending.signature === null) {
    pending.signature = createFormDraftDataSignature(pending.data);
  }
  return pending.signature;
}

const volatileDraftFallbacks = new Map<
  string,
  Map<string, PendingDraft<unknown>>
>();
/**
 * 이 page session에서 이미 확인한 미래 canonical을 key별로 기억한다.
 * 같은 key의 effect 재설정이나 SPA 왕복 중 storage read가 일시 실패해도
 * 확인했던 제출 잠금을 조용히 해제하지 않는다.
 */
const knownIncompatibleCanonicalRaws = new Map<string, string>();
const activeVolatileDraftWriters = new Set<string>();
let volatileBeforeUnloadGuardAttached = false;

function handleVolatileBeforeUnload(event: BeforeUnloadEvent): void {
  if (!hasOrphanedVolatileDraftFallbacks()) return;
  event.preventDefault();
  event.returnValue = "";
}

function syncVolatileBeforeUnloadGuard(): void {
  if (typeof window === "undefined") return;
  const shouldAttach = hasVolatileDraftFallbacks();
  if (shouldAttach && !volatileBeforeUnloadGuardAttached) {
    window.addEventListener("beforeunload", handleVolatileBeforeUnload);
    volatileBeforeUnloadGuardAttached = true;
  } else if (!shouldAttach && volatileBeforeUnloadGuardAttached) {
    window.removeEventListener("beforeunload", handleVolatileBeforeUnload);
    volatileBeforeUnloadGuardAttached = false;
  }
}

function createVolatileWriterKey(key: string, writerId: string): string {
  return `${key}\u0000${writerId}`;
}

function rememberVolatileDraft<T>(
  key: string,
  writerId: string,
  pending: PendingDraft<T>,
): void {
  const writers = volatileDraftFallbacks.get(key) ?? new Map();
  writers.set(writerId, pending as PendingDraft<unknown>);
  volatileDraftFallbacks.set(key, writers);
  syncVolatileBeforeUnloadGuard();
}

function readVolatileDraft<T>(
  key: string,
  writerId: string,
): PendingDraft<T> | null {
  return (
    (volatileDraftFallbacks.get(key)?.get(writerId) as
      | PendingDraft<T>
      | undefined) ?? null
  );
}

function claimLatestOrphanedVolatileDraft<T>(
  key: string,
  writerId: string,
): PendingDraft<T> | null {
  const writers = volatileDraftFallbacks.get(key);
  if (!writers) return null;

  let claimedWriterId: string | null = null;
  let claimedPending: PendingDraft<unknown> | null = null;
  for (const [candidateWriterId, candidatePending] of writers) {
    if (
      candidateWriterId !== writerId &&
      activeVolatileDraftWriters.has(
        createVolatileWriterKey(key, candidateWriterId),
      )
    ) {
      continue;
    }
    if (!claimedPending || candidatePending.queuedAt > claimedPending.queuedAt) {
      claimedWriterId = candidateWriterId;
      claimedPending = candidatePending;
    }
  }

  if (!claimedWriterId || !claimedPending) return null;
  if (claimedWriterId !== writerId) {
    const currentWriterPending = writers.get(writerId);
    writers.delete(claimedWriterId);
    if (currentWriterPending && currentWriterPending !== claimedPending) {
      writers.set(claimedWriterId, currentWriterPending);
    }
  }
  writers.set(writerId, claimedPending);
  syncVolatileBeforeUnloadGuard();
  return claimedPending as PendingDraft<T>;
}

type ClaimableVolatileDraft<T> = {
  writerId: string;
  pending: PendingDraft<T>;
};

function listClaimableVolatileDrafts<T>(
  key: string,
  writerId: string,
): ClaimableVolatileDraft<T>[] {
  const writers = volatileDraftFallbacks.get(key);
  if (!writers) return [];

  const orphaned: Array<{ writerId: string; pending: PendingDraft<T> }> = [];
  for (const [candidateWriterId, candidatePending] of writers) {
    if (
      candidateWriterId !== writerId &&
      activeVolatileDraftWriters.has(
        createVolatileWriterKey(key, candidateWriterId),
      )
    ) {
      continue;
    }
    orphaned.push({
      writerId: candidateWriterId,
      pending: candidatePending as PendingDraft<T>,
    });
  }
  return orphaned.sort(
    (left, right) => right.pending.queuedAt - left.pending.queuedAt,
  );
}

function promoteClaimableVolatileDrafts<T>(
  storage: FormDraftStorage,
  key: string,
  candidates: readonly ClaimableVolatileDraft<T>[],
  protectedKeys: ReadonlySet<string>,
): { changed: boolean; storageReadable: boolean } {
  let changed = false;
  for (const orphaned of candidates) {
    let pendingSignature: string;
    try {
      pendingSignature = getPendingDraftSignature(orphaned.pending);
    } catch {
      return { changed, storageReadable: true };
    }
    let submittedMarker: ReturnType<typeof findFormDraftClearMarker>;
    try {
      submittedMarker = findFormDraftClearMarker(
        storage,
        key,
        pendingSignature,
      );
    } catch {
      return { changed, storageReadable: false };
    }
    if (
      submittedMarker &&
      orphaned.pending.queuedAt <= submittedMarker.clearedAt.getTime()
    ) {
      forgetVolatileDraft(key, orphaned.writerId, orphaned.pending);
      changed = true;
      continue;
    }

    try {
      const raw = serializeFormDraft(
        orphaned.pending.data,
        orphaned.pending.queuedAt,
        Date.now(),
      );
      const recoveryKey = createImmutableFormDraftRecoveryKey(
        key,
        orphaned.writerId,
        raw,
      );
      try {
        storage.setItem(recoveryKey, raw);
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        compactFormDraftRecoveries(storage, key, {
          protectedKeys: new Set([...protectedKeys, recoveryKey]),
        });
        storage.setItem(recoveryKey, raw);
      }
      forgetVolatileDraft(key, orphaned.writerId, orphaned.pending);
      changed = true;
    } catch {
      return { changed, storageReadable: true };
    }
  }
  return { changed, storageReadable: true };
}

function forgetVolatileDraft(
  key: string,
  writerId: string,
  pending?: PendingDraft<unknown>,
): void {
  const writers = volatileDraftFallbacks.get(key);
  if (!writers) return;
  if (pending && writers.get(writerId) !== pending) return;
  writers.delete(writerId);
  if (writers.size === 0) volatileDraftFallbacks.delete(key);
  syncVolatileBeforeUnloadGuard();
}

function forgetSubmittedVolatileDrafts(
  key: string,
  signature: string,
  clearedAt: number,
): void {
  const writers = volatileDraftFallbacks.get(key);
  if (!writers) return;
  for (const [candidateWriterId, pending] of writers) {
    let pendingSignature: string;
    try {
      pendingSignature = getPendingDraftSignature(pending);
    } catch {
      continue;
    }
    if (pendingSignature === signature && pending.queuedAt <= clearedAt) {
      writers.delete(candidateWriterId);
    }
  }
  if (writers.size === 0) volatileDraftFallbacks.delete(key);
  syncVolatileBeforeUnloadGuard();
}

function hasVolatileDraftFallbacks(): boolean {
  for (const writers of volatileDraftFallbacks.values()) {
    if (writers.size > 0) return true;
  }
  return false;
}

function hasOrphanedVolatileDraftFallbacks(): boolean {
  for (const [key, writers] of volatileDraftFallbacks) {
    for (const writerId of writers.keys()) {
      if (!activeVolatileDraftWriters.has(createVolatileWriterKey(key, writerId))) {
        return true;
      }
    }
  }
  return false;
}

interface UseFormDraftResult<T> {
  /** 클라이언트에서 복원 시도가 끝났는지 여부 (에디터 마운트 게이트용) */
  loaded: boolean;
  /** 현재 폼 값을 디바운스 저장 */
  save: (data: T) => void;
  /** 현재 폼의 draft 삭제 (빈 폼/제출 성공/명시 폐기 시 호출) */
  clear: (options?: {
    reason?: "empty" | "discard" | "submitted";
    submittedData?: T;
  }) => void;
  /** 예약된 저장을 즉시 반영 (blur/page hide 경계용) */
  flush: () => boolean;
  /** 로컬 저장소 기록 상태 */
  status: FormDraftStatus;
  /** 더 최신 앱이 만든 canonical draft와 충돌하지 않고 서버 저장할 수 있는지 여부 */
  canSubmit: boolean;
  /** 마지막으로 저장된 시각 */
  savedAt: Date | null;
  /** 마운트 시 기존 draft를 복원했는지 여부 */
  restored: boolean;
  /** canonical과 다른 충돌/중단 복구본 */
  recoveries: readonly FormDraftRecoverySummary[];
  /** 선택한 복구본을 현재 canonical draft로 복원 */
  restoreRecovery: (storageKey: string) => void;
  /** 선택한 복구본을 명시적으로 폐기 */
  discardRecovery: (storageKey: string) => void;
}

function createWriterId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isStorageQuotaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

/**
 * 폼 임시저장 훅.
 * @param key localStorage 키 (폼별/대상별로 고유해야 함)
 * @param onRestore 저장된 draft 또는 선택한 복구본을 폼 state에 반영
 * @param options 저장 디바운스와 key 전환 시 폼 초기화 동작
 */
export function useFormDraft<T>(
  key: string,
  onRestore: (draft: T) => void,
  options: { debounceMs?: number; onReset?: () => void } = {},
): UseFormDraftResult<T> {
  const { debounceMs = 500, onReset } = options;
  const [writerId] = useState(createWriterId);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<FormDraftStatus>("idle");
  const [hasIncompatibleCanonical, setHasIncompatibleCanonical] =
    useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [restored, setRestored] = useState(false);
  const [recoveries, setRecoveries] = useState<FormDraftRecoverySummary[]>([]);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingDraft<T> | null>(null);
  const mountedRef = useRef(false);
  const lastKnownCanonicalRawRef = useRef<string | null>(null);
  const incompatibleCanonicalRawRef = useRef<string | null>(null);
  const localSnapshotRawRef = useRef<string | null>(null);
  const lastDataSignatureRef = useRef<string | null>(null);
  const activeRecoveryKeyRef = useRef<string | null>(null);
  const protectedRecoveryKeysRef = useRef<Set<string>>(new Set());
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  const updateIncompatibleCanonical = useCallback(
    (raw: string | null) => {
      if (raw === null) knownIncompatibleCanonicalRaws.delete(key);
      else knownIncompatibleCanonicalRaws.set(key, raw);
      incompatibleCanonicalRawRef.current = raw;
      if (mountedRef.current) setHasIncompatibleCanonical(raw !== null);
    },
    [key],
  );

  const notifyDraftChange = useCallback(
    (detail: Pick<FormDraftChangeDetail, "kind" | "signature" | "clearedAt">) => {
      const changeDetail: FormDraftChangeDetail = {
        sourceKey: key,
        writerId,
        ...detail,
      };
      try {
        window.dispatchEvent(
          new CustomEvent<FormDraftChangeDetail>(FORM_DRAFT_CHANGE_EVENT, {
            detail: changeDetail,
          }),
        );
      } catch {
        // 탭 내부 알림은 best-effort다. 저장 결과 자체를 실패로 되돌리지 않는다.
      }
      try {
        broadcastChannelRef.current?.postMessage(changeDetail);
      } catch {
        // sandbox/opaque origin에서 채널 송신이 거부되어도 저장 결과는 유지한다.
      }
    },
    [key, writerId],
  );

  const refreshRecoveries = useCallback(() => {
    try {
      const nextRecoveries = pruneFormDraftRecoveries<T>(window.localStorage, key, {
        protectedKeys: protectedRecoveryKeysRef.current,
      }).map(({ storageKey, savedAt: recoverySavedAt, data, signature }) => ({
        storageKey,
        savedAt: recoverySavedAt,
        isCurrent: signature === lastDataSignatureRef.current,
        preview: createFormDraftRecoveryPreview(data),
      }));
      if (mountedRef.current) setRecoveries(nextRecoveries);
      return nextRecoveries;
    } catch {
      if (mountedRef.current) setStatus("error");
      return [];
    }
  }, [key]);

  const adoptRemainingCanonical = useCallback(() => {
    let currentRaw = window.localStorage.getItem(key);
    for (let attempt = 0; currentRaw && attempt < 3; attempt += 1) {
      const submittedMarker = findFormDraftClearMarkerForSnapshot<T>(
        window.localStorage,
        key,
        currentRaw,
      );
      if (!submittedMarker) break;

      removeFormDraftSnapshotsBySignature(
        window.localStorage,
        key,
        submittedMarker.signature,
        { savedAtOrBefore: submittedMarker.clearedAt.getTime() },
      );
      removeFormDraftCanonicalSnapshotBySignature<T>(
        window.localStorage,
        key,
        submittedMarker.signature,
        { savedAtOrBefore: submittedMarker.clearedAt.getTime() },
      );
      const nextRaw = window.localStorage.getItem(key);
      if (nextRaw === currentRaw) {
        currentRaw = null;
        break;
      }
      currentRaw = nextRaw;
    }
    const current = currentRaw ? parseFormDraft<T>(currentRaw) : null;

    if (currentRaw && current) {
      updateIncompatibleCanonical(null);
      lastKnownCanonicalRawRef.current = currentRaw;
      localSnapshotRawRef.current = currentRaw;
      lastDataSignatureRef.current = createFormDraftDataSignature(current.data);
      if (mountedRef.current) {
        onRestoreRef.current(current.data);
        setSavedAt(current.savedAt);
        setRestored(true);
        setStatus("saved");
      }
      return;
    }

    const incompatibleRaw =
      currentRaw && hasFutureFormDraftVersion(currentRaw) ? currentRaw : null;
    updateIncompatibleCanonical(incompatibleRaw);
    lastKnownCanonicalRawRef.current = null;
    localSnapshotRawRef.current = null;
    lastDataSignatureRef.current = null;
    if (mountedRef.current) {
      onResetRef.current?.();
      setSavedAt(null);
      setRestored(false);
      setStatus(
        incompatibleRaw
          ? "incompatible"
          : currentRaw
            ? "error"
            : "idle",
      );
    }
  }, [key, updateIncompatibleCanonical]);

  const promoteVolatileDrafts = useCallback(
    (candidates: readonly ClaimableVolatileDraft<T>[]) =>
      promoteClaimableVolatileDrafts(
        window.localStorage,
        key,
        candidates,
        protectedRecoveryKeysRef.current,
      ),
    [key],
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const pending = pendingRef.current;
    if (!pending) {
      const promotion = promoteVolatileDrafts(
        listClaimableVolatileDrafts<T>(key, writerId),
      );
      if (promotion.changed) {
        refreshRecoveries();
        notifyDraftChange({ kind: "recovery" });
      }
      return listClaimableVolatileDrafts<T>(key, writerId).length === 0;
    }

    let pendingSignature: string;
    try {
      pendingSignature = getPendingDraftSignature(pending);
    } catch {
      if (mountedRef.current) setStatus("error");
      return false;
    }

    if (
      pendingSignature === lastDataSignatureRef.current &&
      lastKnownCanonicalRawRef.current !== null &&
      localSnapshotRawRef.current === lastKnownCanonicalRawRef.current &&
      listClaimableVolatileDrafts<T>(key, writerId).length === 0
    ) {
      forgetVolatileDraft(key, writerId, pending);
      pendingRef.current = null;
      if (mountedRef.current) setStatus("saved");
      return true;
    }

    try {
      const submittedMarker = findFormDraftClearMarker(
        window.localStorage,
        key,
        pendingSignature,
      );
      if (
        submittedMarker?.signature === pendingSignature &&
        pending.queuedAt <= submittedMarker.clearedAt.getTime()
      ) {
        forgetVolatileDraft(key, writerId, pending);
        pendingRef.current = null;
        removeFormDraftSnapshotsBySignature(
          window.localStorage,
          key,
          pendingSignature,
          { savedAtOrBefore: submittedMarker.clearedAt.getTime() },
        );
        removeFormDraftCanonicalSnapshotBySignature<T>(
          window.localStorage,
          key,
          pendingSignature,
          { savedAtOrBefore: submittedMarker.clearedAt.getTime() },
        );
        activeRecoveryKeyRef.current = null;
        protectedRecoveryKeysRef.current = new Set();
        promoteVolatileDrafts(listClaimableVolatileDrafts<T>(key, writerId));
        adoptRemainingCanonical();
        refreshRecoveries();
        return true;
      }
    } catch {
      if (mountedRef.current) setStatus("error");
      return false;
    }

    const writtenAt = new Date();
    try {
      const raw = serializeFormDraft(
        pending.data,
        pending.queuedAt,
        writtenAt.getTime(),
      );
      const nextRecoveryKey = createImmutableFormDraftRecoveryKey(
        key,
        writerId,
        raw,
      );
      protectedRecoveryKeysRef.current.add(nextRecoveryKey);
      const persist = () =>
        persistFormDraftRawSnapshot(window.localStorage, {
          sourceKey: key,
          recoveryKey: nextRecoveryKey,
          raw,
          expectedRaw: lastKnownCanonicalRawRef.current,
        });
      let result: ReturnType<typeof persist>;
      try {
        result = persist();
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        compactFormDraftRecoveries(window.localStorage, key, {
          protectedKeys: protectedRecoveryKeysRef.current,
        });
        result = persist();
      }

      const submittedMarker = findFormDraftClearMarker(
        window.localStorage,
        key,
        pendingSignature,
      );
      if (
        submittedMarker &&
        pending.queuedAt <= submittedMarker.clearedAt.getTime()
      ) {
        forgetVolatileDraft(key, writerId, pending);
        pendingRef.current = null;
        removeFormDraftSnapshotsBySignature(
          window.localStorage,
          key,
          pendingSignature,
          { savedAtOrBefore: submittedMarker.clearedAt.getTime() },
        );
        removeFormDraftCanonicalSnapshotBySignature<T>(
          window.localStorage,
          key,
          pendingSignature,
          { savedAtOrBefore: submittedMarker.clearedAt.getTime() },
        );
        activeRecoveryKeyRef.current = null;
        protectedRecoveryKeysRef.current = new Set();
        promoteVolatileDrafts(listClaimableVolatileDrafts<T>(key, writerId));
        adoptRemainingCanonical();
        refreshRecoveries();
        return true;
      }

      forgetVolatileDraft(key, writerId, pending);
      pendingRef.current = null;
      promoteVolatileDrafts(listClaimableVolatileDrafts<T>(key, writerId));
      const previousRecoveryKey = activeRecoveryKeyRef.current;
      activeRecoveryKeyRef.current = nextRecoveryKey;
      protectedRecoveryKeysRef.current = new Set([nextRecoveryKey]);
      if (previousRecoveryKey && previousRecoveryKey !== nextRecoveryKey) {
        window.localStorage.removeItem(previousRecoveryKey);
      }
      localSnapshotRawRef.current = result.raw;
      lastDataSignatureRef.current = pendingSignature;
      const incompatibleRaw =
        result.currentRaw && hasFutureFormDraftVersion(result.currentRaw)
          ? result.currentRaw
          : null;
      updateIncompatibleCanonical(incompatibleRaw);
      if (result.status === "saved") {
        lastKnownCanonicalRawRef.current = result.raw;
      } else if (incompatibleRaw) {
        lastKnownCanonicalRawRef.current = null;
      }

      if (mountedRef.current) {
        setSavedAt(writtenAt);
        setRestored(false);
        setStatus(incompatibleRaw ? "incompatible" : result.status);
      }
      refreshRecoveries();
      notifyDraftChange({ kind: result.status === "saved" ? "canonical" : "recovery" });
      return true;
    } catch {
      if (mountedRef.current) setStatus("error");
      return false;
    }
  }, [
    adoptRemainingCanonical,
    key,
    notifyDraftChange,
    promoteVolatileDrafts,
    refreshRecoveries,
    updateIncompatibleCanonical,
    writerId,
  ]);

  // 마운트 시 복원하고 탭/동일 window 문서 변경을 함께 감시한다.
  useEffect(() => {
    mountedRef.current = true;
    activeVolatileDraftWriters.add(createVolatileWriterKey(key, writerId));
    activeRecoveryKeyRef.current = null;
    protectedRecoveryKeysRef.current = new Set();
    pendingRef.current = null;
    lastKnownCanonicalRawRef.current = null;
    updateIncompatibleCanonical(
      knownIncompatibleCanonicalRaws.get(key) ?? null,
    );
    localSnapshotRawRef.current = null;
    lastDataSignatureRef.current = null;
    setStatus("idle");
    setSavedAt(null);
    setRestored(false);
    setRecoveries([]);

    let storageReadable = true;
    let mountedWithIncompatibleCanonical = false;
    let canonicalSavedAtMs: number | null = null;
    try {
      let raw: string | null = null;
      let stored: ReturnType<typeof parseFormDraft<T>> = null;
      let unstableCanonical = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        raw = window.localStorage.getItem(key);
        stored = raw ? parseFormDraft<T>(raw) : null;
        if (
          !raw ||
          !stored ||
          !findFormDraftClearMarkerForSnapshot<T>(window.localStorage, key, raw)
        ) {
          unstableCanonical = false;
          break;
        }
        if (window.localStorage.getItem(key) !== raw) {
          raw = null;
          stored = null;
          unstableCanonical = true;
          continue;
        }
        window.localStorage.removeItem(key);
        raw = null;
        stored = null;
        unstableCanonical = false;
      }
      if (stored) {
        updateIncompatibleCanonical(null);
        canonicalSavedAtMs = stored.savedAt?.getTime() ?? null;
        lastKnownCanonicalRawRef.current = raw;
        localSnapshotRawRef.current = raw;
        lastDataSignatureRef.current = createFormDraftDataSignature(stored.data);
        onRestoreRef.current(stored.data);
        setSavedAt(stored.savedAt);
        setRestored(true);
        setStatus("saved");
      } else if (raw) {
        mountedWithIncompatibleCanonical = hasFutureFormDraftVersion(raw);
        if (mountedWithIncompatibleCanonical) {
          updateIncompatibleCanonical(raw);
          setStatus("incompatible");
        } else {
          updateIncompatibleCanonical(null);
          window.localStorage.removeItem(key);
        }
        onResetRef.current?.();
      } else {
        // 반복 교체로 안정된 snapshot을 읽지 못했다면 기존 key 잠금을 유지한다.
        if (!unstableCanonical) updateIncompatibleCanonical(null);
        onResetRef.current?.();
        if (unstableCanonical) setStatus("conflict");
      }

    } catch {
      storageReadable = false;
      onResetRef.current?.();
      setStatus("error");
    }

    let shouldClaimVolatile = !storageReadable;
    if (storageReadable) {
      const claimableDrafts = listClaimableVolatileDrafts<T>(
        key,
        writerId,
      );
      const newestClaimable = claimableDrafts[0];
      shouldClaimVolatile = Boolean(
        newestClaimable &&
          (canonicalSavedAtMs === null ||
            newestClaimable.pending.queuedAt > canonicalSavedAtMs),
      );
      const draftsToPromote = shouldClaimVolatile
        ? claimableDrafts.slice(1)
        : claimableDrafts;
      const promotion = promoteVolatileDrafts(draftsToPromote);
      if (!promotion.storageReadable) storageReadable = false;
    }

    const volatilePending = shouldClaimVolatile
      ? claimLatestOrphanedVolatileDraft<T>(key, writerId)
      : null;
    if (volatilePending) {
      let isSubmitted = false;
      let volatileSignature: string | null = null;
      if (storageReadable) {
        try {
          volatileSignature = getPendingDraftSignature(volatilePending);
          const submittedMarker = findFormDraftClearMarker(
            window.localStorage,
            key,
            volatileSignature,
          );
          isSubmitted = Boolean(
            submittedMarker &&
              volatilePending.queuedAt <= submittedMarker.clearedAt.getTime(),
          );
        } catch {
          storageReadable = false;
        }
      }

      if (isSubmitted) {
        forgetVolatileDraft(key, writerId, volatilePending);
      } else {
        pendingRef.current = volatilePending;
        localSnapshotRawRef.current = serializeFormDraft(
          volatilePending.data,
          volatilePending.queuedAt,
        );
        lastDataSignatureRef.current = volatileSignature;
        onRestoreRef.current(volatilePending.data);
        setSavedAt(new Date(volatilePending.queuedAt));
        setRestored(true);
        setStatus(mountedWithIncompatibleCanonical ? "incompatible" : "error");
        timerRef.current = setTimeout(() => flush(), debounceMs);
      }
    }
    refreshRecoveries();
    setLoadedKey(key);

    const preserveVisibleSnapshot = () => {
      const visibleRaw = localSnapshotRawRef.current;
      const visible = visibleRaw ? parseFormDraft<T>(visibleRaw) : null;
      if (!visible) return;

      const preservedAt = visible.savedAt ?? new Date();
      const preservedRaw = serializeFormDraft(
        visible.data,
        preservedAt.getTime(),
        Date.now(),
      );
      const nextRecoveryKey = createImmutableFormDraftRecoveryKey(
        key,
        writerId,
        preservedRaw,
      );
      const volatileVisibleSnapshot: PendingDraft<T> = {
        data: visible.data,
        signature: lastDataSignatureRef.current,
        queuedAt: preservedAt.getTime(),
      };
      rememberVolatileDraft(key, writerId, volatileVisibleSnapshot);
      protectedRecoveryKeysRef.current.add(nextRecoveryKey);
      try {
        window.localStorage.setItem(nextRecoveryKey, preservedRaw);
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        compactFormDraftRecoveries(window.localStorage, key, {
          protectedKeys: protectedRecoveryKeysRef.current,
        });
        window.localStorage.setItem(nextRecoveryKey, preservedRaw);
      }
      forgetVolatileDraft(key, writerId, volatileVisibleSnapshot);
      const previousRecoveryKey = activeRecoveryKeyRef.current;
      activeRecoveryKeyRef.current = nextRecoveryKey;
      protectedRecoveryKeysRef.current = new Set([nextRecoveryKey]);
      if (previousRecoveryKey && previousRecoveryKey !== nextRecoveryKey) {
        window.localStorage.removeItem(previousRecoveryKey);
      }
      localSnapshotRawRef.current = preservedRaw;
      setSavedAt(preservedAt);
    };

    const handleSubmittedClear = (marker: {
      signature: string;
      clearedAt: Date;
    }) => {
      forgetSubmittedVolatileDrafts(
        key,
        marker.signature,
        marker.clearedAt.getTime(),
      );
      const pending = pendingRef.current;
      const visible = localSnapshotRawRef.current
        ? parseFormDraft<T>(localSnapshotRawRef.current)
        : null;
      const visibleSignature = pending
        ? getPendingDraftSignature(pending)
        : lastDataSignatureRef.current;
      const visibleAt = pending?.queuedAt ??
        visible?.savedAt?.getTime() ??
        Number.NEGATIVE_INFINITY;
      if (
        visibleSignature !== marker.signature ||
        visibleAt > marker.clearedAt.getTime()
      ) {
        return false;
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pending) forgetVolatileDraft(key, writerId, pending);
      pendingRef.current = null;
      removeFormDraftSnapshotsBySignature(
        window.localStorage,
        key,
        marker.signature,
        { savedAtOrBefore: marker.clearedAt.getTime() },
      );
      removeFormDraftCanonicalSnapshotBySignature<T>(
        window.localStorage,
        key,
        marker.signature,
        { savedAtOrBefore: marker.clearedAt.getTime() },
      );
      activeRecoveryKeyRef.current = null;
      protectedRecoveryKeysRef.current = new Set();
      adoptRemainingCanonical();
      refreshRecoveries();
      return true;
    };

    const handleCanonicalChange = (nextRaw: string | null) => {
      const observedCanonicalRaw =
        incompatibleCanonicalRawRef.current ?? lastKnownCanonicalRawRef.current;
      if (!hasFormDraftStorageConflict(observedCanonicalRaw, nextRaw)) return;

      let currentRaw = nextRaw;
      const resolvedCanonicalMarker = currentRaw
        ? findFormDraftClearMarkerForSnapshot<T>(window.localStorage, key, currentRaw)
        : null;
      if (resolvedCanonicalMarker) {
        if (window.localStorage.getItem(key) === currentRaw) {
          window.localStorage.removeItem(key);
        }
        currentRaw = window.localStorage.getItem(key);
        if (handleSubmittedClear(resolvedCanonicalMarker)) return;
        if (!pendingRef.current && !localSnapshotRawRef.current && currentRaw === null) {
          updateIncompatibleCanonical(null);
          lastKnownCanonicalRawRef.current = null;
          setStatus("idle");
          refreshRecoveries();
          return;
        }
      }

      const visibleSignature = pendingRef.current
        ? getPendingDraftSignature(pendingRef.current)
        : lastDataSignatureRef.current;
      const submittedMarker = currentRaw === null && visibleSignature
        ? findFormDraftClearMarker(window.localStorage, key, visibleSignature)
        : null;
      if (submittedMarker && handleSubmittedClear(submittedMarker)) return;

      if (currentRaw && hasFutureFormDraftVersion(currentRaw)) {
        updateIncompatibleCanonical(currentRaw);
        lastKnownCanonicalRawRef.current = null;
        try {
          if (pendingRef.current) {
            if (!flush()) return;
          } else {
            preserveVisibleSnapshot();
          }
          setStatus("incompatible");
          refreshRecoveries();
        } catch {
          setStatus("error");
        }
        return;
      }

      if (
        incompatibleCanonicalRawRef.current &&
        !pendingRef.current &&
        !localSnapshotRawRef.current
      ) {
        updateIncompatibleCanonical(null);
        adoptRemainingCanonical();
        refreshRecoveries();
        return;
      }
      updateIncompatibleCanonical(null);

      const nextStored = currentRaw ? parseFormDraft<T>(currentRaw) : null;
      if (
        nextStored &&
        lastDataSignatureRef.current === createFormDraftDataSignature(nextStored.data)
      ) {
        updateIncompatibleCanonical(null);
        lastKnownCanonicalRawRef.current = currentRaw;
        localSnapshotRawRef.current = currentRaw;
        setSavedAt(nextStored.savedAt);
        setStatus("saved");
        refreshRecoveries();
        return;
      }

      try {
        if (pendingRef.current) {
          if (!flush()) return;
        } else {
          preserveVisibleSnapshot();
        }
        setStatus("conflict");
        refreshRecoveries();
      } catch {
        setStatus("error");
      }
    };

    const handlePageHide = () => flush();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const handleStorage = (event: StorageEvent) => {
      try {
        if (event.storageArea !== window.localStorage) return;
        if (event.key === key) {
          handleCanonicalChange(window.localStorage.getItem(key));
        }
        else if (event.key && isFormDraftClearMarkerKey(key, event.key)) {
          const marker = event.newValue
            ? parseFormDraftClearMarker(event.newValue)
            : null;
          if (marker) handleSubmittedClear(marker);
        }
        else if (event.key && isFormDraftRecoveryKey(key, event.key)) refreshRecoveries();
      } catch {
        setStatus("error");
      }
    };
    const handleDraftChangeDetail = (detail: FormDraftChangeDetail | null | undefined) => {
      if (!detail || detail.sourceKey !== key || detail.writerId === writerId) return;
      if (
        detail.kind === "submitted-clear" &&
        detail.signature &&
        typeof detail.clearedAt === "number"
      ) {
        handleSubmittedClear({
          signature: detail.signature,
          clearedAt: new Date(detail.clearedAt),
        });
      } else if (detail.kind === "canonical") {
        try {
          handleCanonicalChange(window.localStorage.getItem(key));
        } catch {
          setStatus("error");
        }
      } else {
        refreshRecoveries();
      }
    };
    const handleLocalDraftChange = (event: Event) => {
      handleDraftChangeDetail(
        (event as CustomEvent<FormDraftChangeDetail>).detail,
      );
    };
    const handleBroadcastDraftChange = (event: MessageEvent<FormDraftChangeDetail>) => {
      handleDraftChangeDetail(event.data);
    };
    let broadcastChannel: BroadcastChannel | null = null;
    if (typeof window.BroadcastChannel === "function") {
      try {
        broadcastChannel = new window.BroadcastChannel(
          FORM_DRAFT_BROADCAST_CHANNEL,
        );
      } catch {
        // sandbox/opaque origin에서는 동일 window 이벤트만 사용한다.
      }
    }
    if (broadcastChannel) {
      broadcastChannelRef.current = broadcastChannel;
      broadcastChannel.addEventListener("message", handleBroadcastDraftChange);
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const flushed = flush();
      if (flushed && !hasOrphanedVolatileDraftFallbacks()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(FORM_DRAFT_CHANGE_EVENT, handleLocalDraftChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      flush();
      activeVolatileDraftWriters.delete(createVolatileWriterKey(key, writerId));
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(FORM_DRAFT_CHANGE_EVENT, handleLocalDraftChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (broadcastChannel) {
        broadcastChannel.removeEventListener("message", handleBroadcastDraftChange);
        try {
          broadcastChannel.close();
        } catch {
          // 이미 닫힌 채널은 정리 완료로 본다.
        }
        if (broadcastChannelRef.current === broadcastChannel) {
          broadcastChannelRef.current = null;
        }
      }
    };
  }, [
    adoptRemainingCanonical,
    debounceMs,
    flush,
    key,
    promoteVolatileDrafts,
    refreshRecoveries,
    updateIncompatibleCanonical,
    writerId,
  ]);

  const save = useCallback(
    (data: T) => {
      try {
        if (timerRef.current) clearTimeout(timerRef.current);
        const pending: PendingDraft<T> = {
          data,
          signature: null,
          queuedAt: Date.now(),
        };
        pendingRef.current = pending;
        rememberVolatileDraft(key, writerId, pending);
        setStatus(
          incompatibleCanonicalRawRef.current ? "incompatible" : "saving",
        );
        timerRef.current = setTimeout(() => {
          flush();
        }, debounceMs);
      } catch {
        setStatus("error");
      }
    },
    [debounceMs, flush, key, writerId],
  );

  const clear = useCallback((options: {
    reason?: "empty" | "discard" | "submitted";
    submittedData?: T;
  } = {}) => {
    try {
      const submitted = options.reason === "submitted";
      const pendingSignature = submitted && pendingRef.current
        ? getPendingDraftSignature(pendingRef.current)
        : null;
      const signature = submitted
        ? options.submittedData === undefined
          ? lastDataSignatureRef.current ?? pendingSignature
          : createFormDraftDataSignature(options.submittedData)
        : lastDataSignatureRef.current;
      const clearedAt = Date.now();
      const volatilePending = readVolatileDraft<T>(key, writerId);
      if (submitted && signature) {
        forgetSubmittedVolatileDrafts(key, signature, clearedAt);
      } else {
        forgetVolatileDraft(key, writerId, volatilePending ?? undefined);
      }
      const removeSubmittedSnapshots = () => {
        if (!signature) return;
        removeFormDraftSnapshotsBySignature(
          window.localStorage,
          key,
          signature,
          { savedAtOrBefore: clearedAt },
        );
        removeFormDraftCanonicalSnapshotBySignature<T>(
          window.localStorage,
          key,
          signature,
          { savedAtOrBefore: clearedAt },
        );
      };

      if (submitted && pendingRef.current) {
        if (pendingSignature === signature) {
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          pendingRef.current = null;
        } else {
          flush();
          if (pendingRef.current) {
            removeSubmittedSnapshots();
            flush();
          }
          if (pendingRef.current) {
            setStatus("error");
            return;
          }
        }
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;

      let submittedMarker: ReturnType<typeof writeFormDraftClearMarker> | null = null;
      if (submitted && signature) {
        try {
          submittedMarker = writeFormDraftClearMarker(
            window.localStorage,
            key,
            signature,
            clearedAt,
          );
        } catch (error) {
          let finalError = error;
          if (isStorageQuotaError(error)) {
            try {
              removeSubmittedSnapshots();
              compactFormDraftRecoveries(window.localStorage, key, {
                protectedKeys: protectedRecoveryKeysRef.current,
              });
              submittedMarker = writeFormDraftClearMarker(
                window.localStorage,
                key,
                signature,
                clearedAt,
              );
            } catch (retryError) {
              finalError = retryError;
            }
          }
          if (!submittedMarker) {
            try {
              removeSubmittedSnapshots();
            } catch {
              // 저장소 자체가 차단된 경우에도 활성 peer에는 제출 완료를 전파한다.
            }
            notifyDraftChange({
              kind: "submitted-clear",
              signature,
              clearedAt,
            });
            throw finalError;
          }
        }
      }
      if (submittedMarker) {
        removeSubmittedSnapshots();
      } else {
        const activeRecoveryKey = activeRecoveryKeyRef.current;
        if (activeRecoveryKey) window.localStorage.removeItem(activeRecoveryKey);
        activeRecoveryKeyRef.current = null;
        protectedRecoveryKeysRef.current = new Set();
      }

      const currentRaw = window.localStorage.getItem(key);
      const incompatibleRaw =
        currentRaw && hasFutureFormDraftVersion(currentRaw) ? currentRaw : null;
      updateIncompatibleCanonical(incompatibleRaw);
      const conflict = submittedMarker
        ? currentRaw !== null
        : hasFormDraftStorageConflict(lastKnownCanonicalRawRef.current, currentRaw);
      if (!submittedMarker && !conflict) window.localStorage.removeItem(key);

      const preserveVisibleDraft = submittedMarker !== null &&
        lastDataSignatureRef.current !== null &&
        lastDataSignatureRef.current !== submittedMarker.signature;
      if (!preserveVisibleDraft) {
        activeRecoveryKeyRef.current = null;
        protectedRecoveryKeysRef.current = new Set();
        lastKnownCanonicalRawRef.current = null;
        localSnapshotRawRef.current = null;
        lastDataSignatureRef.current = null;
        setSavedAt(null);
        setRestored(false);
      }
      setStatus(
        incompatibleRaw ? "incompatible" : conflict ? "conflict" : "idle",
      );
      refreshRecoveries();
      if (submittedMarker) {
        notifyDraftChange({
          kind: "submitted-clear",
          signature: submittedMarker.signature,
          clearedAt: submittedMarker.clearedAt.getTime(),
        });
      } else {
        notifyDraftChange({
          kind: !conflict && currentRaw !== null ? "canonical" : "recovery",
        });
      }
    } catch {
      setStatus("error");
      refreshRecoveries();
    }
  }, [
    flush,
    key,
    notifyDraftChange,
    refreshRecoveries,
    updateIncompatibleCanonical,
    writerId,
  ]);

  const restoreRecovery = useCallback(
    (storageKey: string) => {
      try {
        const selected = readFormDraftRecovery<T>(window.localStorage, key, storageKey);
        if (!selected) {
          refreshRecoveries();
          return;
        }
        const selectedMarker = findFormDraftClearMarker(
          window.localStorage,
          key,
          selected.signature,
        );
        if (
          selectedMarker &&
          selected.savedAt.getTime() <= selectedMarker.clearedAt.getTime()
        ) {
          removeFormDraftSnapshotsBySignature(
            window.localStorage,
            key,
            selected.signature,
            { savedAtOrBefore: selectedMarker.clearedAt.getTime() },
          );
          removeFormDraftCanonicalSnapshotBySignature<T>(
            window.localStorage,
            key,
            selected.signature,
            { savedAtOrBefore: selectedMarker.clearedAt.getTime() },
          );
          protectedRecoveryKeysRef.current.delete(storageKey);
          refreshRecoveries();
          notifyDraftChange({ kind: "recovery" });
          return;
        }
        protectedRecoveryKeysRef.current.add(storageKey);
        let currentRaw = window.localStorage.getItem(key);
        const currentMarker = currentRaw
          ? findFormDraftClearMarkerForSnapshot<T>(window.localStorage, key, currentRaw)
          : null;
        if (currentMarker) {
          removeFormDraftSnapshotsBySignature(
            window.localStorage,
            key,
            currentMarker.signature,
            { savedAtOrBefore: currentMarker.clearedAt.getTime() },
          );
          removeFormDraftCanonicalSnapshotBySignature<T>(
            window.localStorage,
            key,
            currentMarker.signature,
            { savedAtOrBefore: currentMarker.clearedAt.getTime() },
          );
          currentRaw = window.localStorage.getItem(key);
        }
        const currentStored = currentRaw ? parseFormDraft<T>(currentRaw) : null;
        const currentHasFutureVersion = currentRaw
          ? hasFutureFormDraftVersion(currentRaw)
          : false;
        const preservedSignatures = new Set([selected.signature]);
        const preserveRecoveryData = (
          data: T,
          signature: string,
          savedAtMs: number | null,
        ) => {
          if (preservedSignatures.has(signature)) return;

          const submittedMarker = findFormDraftClearMarker(
            window.localStorage,
            key,
            signature,
          );
          if (
            submittedMarker &&
            (savedAtMs === null || savedAtMs <= submittedMarker.clearedAt.getTime())
          ) {
            removeFormDraftSnapshotsBySignature(
              window.localStorage,
              key,
              signature,
              { savedAtOrBefore: submittedMarker.clearedAt.getTime() },
            );
            return;
          }

          const retainedAt = Date.now();
          const preservedRaw = serializeFormDraft(
            data,
            savedAtMs ?? retainedAt,
            retainedAt,
          );
          const preservedKey = createImmutableFormDraftRecoveryKey(
            key,
            createWriterId(),
            preservedRaw,
          );
          protectedRecoveryKeysRef.current.add(preservedKey);
          try {
            window.localStorage.setItem(preservedKey, preservedRaw);
          } catch (error) {
            if (!isStorageQuotaError(error)) throw error;
            compactFormDraftRecoveries(window.localStorage, key, {
              protectedKeys: protectedRecoveryKeysRef.current,
            });
            window.localStorage.setItem(preservedKey, preservedRaw);
          }
          preservedSignatures.add(signature);
        };

        const pending = pendingRef.current;
        const visibleStored = localSnapshotRawRef.current
          ? parseFormDraft<T>(localSnapshotRawRef.current)
          : null;
        const visibleData = pending?.data ?? visibleStored?.data;
        const visibleSignature = pending
          ? getPendingDraftSignature(pending)
          : visibleStored
            ? createFormDraftDataSignature(visibleStored.data)
            : null;
        if (visibleData !== undefined && visibleSignature) {
          preserveRecoveryData(
            visibleData,
            visibleSignature,
            pending?.queuedAt ?? visibleStored?.savedAt?.getTime() ?? null,
          );
        }

        if (currentStored) {
          preserveRecoveryData(
            currentStored.data,
            createFormDraftDataSignature(currentStored.data),
            currentStored.savedAt?.getTime() ?? null,
          );
        }

        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (pending) forgetVolatileDraft(key, writerId, pending);
        pendingRef.current = null;

        const restoredAt = selected.savedAt;
        const restoredRaw = serializeFormDraft(
          selected.data,
          restoredAt.getTime(),
          Date.now(),
        );
        const restoredRecoveryKey = createImmutableFormDraftRecoveryKey(
          key,
          writerId,
          restoredRaw,
        );
        protectedRecoveryKeysRef.current.add(restoredRecoveryKey);
        const persist = () =>
          persistFormDraftRawSnapshot(window.localStorage, {
            sourceKey: key,
            recoveryKey: restoredRecoveryKey,
            raw: restoredRaw,
            expectedRaw: currentHasFutureVersion ? null : currentRaw,
          });
        let result: ReturnType<typeof persist>;
        try {
          result = persist();
        } catch (error) {
          if (!isStorageQuotaError(error)) throw error;
          compactFormDraftRecoveries(window.localStorage, key, {
            protectedKeys: protectedRecoveryKeysRef.current,
          });
          result = persist();
        }

        const postPersistMarker = findFormDraftClearMarker(
          window.localStorage,
          key,
          selected.signature,
        );
        if (
          postPersistMarker &&
          restoredAt.getTime() <= postPersistMarker.clearedAt.getTime()
        ) {
          removeFormDraftSnapshotsBySignature(
            window.localStorage,
            key,
            selected.signature,
            { savedAtOrBefore: postPersistMarker.clearedAt.getTime() },
          );
          removeFormDraftCanonicalSnapshotBySignature<T>(
            window.localStorage,
            key,
            selected.signature,
            { savedAtOrBefore: postPersistMarker.clearedAt.getTime() },
          );
          activeRecoveryKeyRef.current = null;
          protectedRecoveryKeysRef.current = new Set();
          adoptRemainingCanonical();
          refreshRecoveries();
          return;
        }

        activeRecoveryKeyRef.current = restoredRecoveryKey;
        protectedRecoveryKeysRef.current = new Set([restoredRecoveryKey]);
        localSnapshotRawRef.current = restoredRaw;
        lastDataSignatureRef.current = selected.signature;
        const incompatibleRaw =
          result.currentRaw && hasFutureFormDraftVersion(result.currentRaw)
            ? result.currentRaw
            : null;
        updateIncompatibleCanonical(incompatibleRaw);
        if (result.status === "saved") {
          lastKnownCanonicalRawRef.current = restoredRaw;
        } else if (incompatibleRaw) {
          lastKnownCanonicalRawRef.current = null;
        }
        onRestoreRef.current(selected.data);
        setSavedAt(restoredAt);
        setRestored(true);
        setStatus(incompatibleRaw ? "incompatible" : result.status);
        refreshRecoveries();
        notifyDraftChange({ kind: result.status === "saved" ? "canonical" : "recovery" });
      } catch {
        setStatus("error");
      }
    },
    [
      adoptRemainingCanonical,
      key,
      notifyDraftChange,
      refreshRecoveries,
      updateIncompatibleCanonical,
      writerId,
    ],
  );

  const discardRecovery = useCallback(
    (storageKey: string) => {
      if (!isFormDraftRecoveryKey(key, storageKey)) return;
      try {
        const selected = readFormDraftRecovery<T>(window.localStorage, key, storageKey);
        if (!selected || window.localStorage.getItem(storageKey) !== selected.raw) {
          refreshRecoveries();
          return;
        }
        if (isImmutableFormDraftRecoveryKey(key, storageKey)) {
          window.localStorage.removeItem(storageKey);
        } else {
          writeFormDraftClearMarker(
            window.localStorage,
            key,
            selected.signature,
          );
        }
        protectedRecoveryKeysRef.current.delete(storageKey);

        if (
          storageKey === activeRecoveryKeyRef.current &&
          selected.signature ===
            (pendingRef.current
              ? getPendingDraftSignature(pendingRef.current)
              : lastDataSignatureRef.current)
        ) {
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          if (pendingRef.current) {
            forgetVolatileDraft(key, writerId, pendingRef.current);
          }
          pendingRef.current = null;
          activeRecoveryKeyRef.current = null;
          adoptRemainingCanonical();
        }

        refreshRecoveries();
        notifyDraftChange({ kind: "recovery" });
      } catch {
        setStatus("error");
      }
    },
    [adoptRemainingCanonical, key, notifyDraftChange, refreshRecoveries, writerId],
  );

  return {
    loaded: loadedKey === key,
    save,
    clear,
    flush,
    status,
    canSubmit: !hasIncompatibleCanonical,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
  };
}
