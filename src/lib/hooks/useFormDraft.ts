/** 폼별 React 상태와 draft 저장·복원·이탈 처리를 조정한다. */
"use client";

import {
  type FormDraftStatus,
  type FormDraftRecoverySummary,
  parseDocumentDraftKey,
  pruneFormDraftRecoveries,
  createFormDraftRecoveryPreview,
  removeFormDraftSnapshotsBySignature,
  removeFormDraftCanonicalSnapshotBySignature,
  parseFormDraft,
  createFormDraftDataSignature,
  hasFutureFormDraftVersion,
  serializeFormDraft,
  createImmutableFormDraftRecoveryKey,
  persistFormDraftRawSnapshot,
  assertFormDraftSourceOwnerMayPersist,
  hasFormDraftStorageConflict,
  isFormDraftClearMarkerKey,
  parseFormDraftClearMarker,
  isFormDraftRecoveryKey,
  prepareFormDraftSnapshotClearPlan,
  applyFormDraftSnapshotClearPlan,
  writeFormDraftClearMarker,
  writeFormDraftClearMarkers,
  readFormDraftRecovery,
  isImmutableFormDraftRecoveryKey,
} from "@/lib/form-draft";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useInsertionEffect,
} from "react";
import {
  type PendingDraft,
  broadcastFormDraftContinuityClear,
  reconcileVolatileSubmittedClearMarkers,
  readKnownIncompatibleCanonical,
  rememberKnownIncompatibleCanonical,
  type FormDraftChangeDetail,
  FORM_DRAFT_CHANGE_EVENT,
  readVolatileSubmittedClearMarker,
  findEffectiveSubmittedClearMarkerForSnapshot,
  type ClaimableVolatileDraft,
  promoteClaimableVolatileDrafts,
  hasVolatileSubmittedClearMarkerForSource,
  listClaimableVolatileDrafts,
  getPendingDraftSignature,
  findEffectiveSubmittedClearMarker,
  forgetVolatileDraft,
  registerVolatileDraftWriter,
  unregisterVolatileDraftWriter,
  clearVolatileFormDraftContinuity,
  claimLatestOrphanedVolatileDraft,
  rememberVolatileDraft,
  rememberVolatileSubmittedClearMarker,
  forgetSubmittedVolatileDrafts,
  hasUnresolvedVolatileContinuityState,
  drainInactiveVolatileContinuity,
  type FormDraftContinuityClearInput,
  shouldClearFormDraftSource,
  FORM_DRAFT_BROADCAST_CHANNEL,
  getMaxVolatileDraftQueuedAtBySignature,
  readVolatileDraft,
  forgetVolatileSubmittedClearMarker,
} from "@/lib/form-draft/page-session";
import {
  readBrowserLocalStorage,
  isStorageQuotaError,
  prepareFormDraftQuotaRetry,
  registerActiveFormDraftSource,
  scheduleFormDraftArtifactSweep,
  unregisterActiveFormDraftSource,
} from "@/lib/form-draft/storage-maintenance";
import {
  isAccountOwnerTerminallyLocked,
  createAccountTerminalLockStorageKey,
  isAccountTerminalLockEventForOwner,
  ACCOUNT_TERMINAL_LOCK_EVENT,
} from "@/lib/account-terminal-lock";

export const FORM_DRAFT_MAX_WAIT_MS = 5_000;

export interface UseFormDraftResult<T> {
  /** 클라이언트에서 복원 시도가 끝났는지 여부 (에디터 마운트 게이트용) */
  loaded: boolean;
  /** 현재 폼 값을 디바운스 저장 */
  save: (data: T) => void;
  /** 현재 폼의 draft 삭제 (빈 폼/제출 성공/명시 폐기 시 호출) */
  clear: (options?: {
    reason?: "empty" | "discard" | "submitted";
    submittedData?: T;
    submittedAliases?: readonly T[];
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

/**
 * 폼 임시저장 훅.
 * @param key localStorage 키 (폼별/대상별로 고유해야 함)
 * @param onRestore 저장된 draft 또는 선택한 복구본을 폼 state에 반영
 * @param options 저장 디바운스·최대 대기 시간과 key 전환 시 폼 초기화 동작
 */
export function useFormDraft<T>(
  key: string,
  onRestore: (draft: T) => void,
  options: {
    debounceMs?: number;
    maxWaitMs?: number;
    onReset?: () => void;
  } = {},
): UseFormDraftResult<T> {
  const {
    debounceMs = 500,
    maxWaitMs = FORM_DRAFT_MAX_WAIT_MS,
    onReset,
  } = options;
  const [writerId] = useState(createWriterId);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<FormDraftStatus>("idle");
  const [hasIncompatibleCanonical, setHasIncompatibleCanonical] =
    useState(false);
  const [accountCleared, setAccountCleared] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [restored, setRestored] = useState(false);
  const [recoveries, setRecoveries] = useState<FormDraftRecoverySummary[]>([]);
  const onRestoreRef = useRef(onRestore);
  const onResetRef = useRef(onReset);
  // insertion effect는 같은 commit의 모든 layout/passive effect보다 먼저 실행되므로
  // mount 복원 effect와 이벤트 handler가 항상 최신 callback을 호출한다.
  useInsertionEffect(() => {
    onRestoreRef.current = onRestore;
    onResetRef.current = onReset;
  }, [onRestore, onReset]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingDraft<T> | null>(null);
  const mountedRef = useRef(false);
  const accountClearedRef = useRef(false);
  const lastKnownCanonicalRawRef = useRef<string | null>(null);
  const incompatibleCanonicalRawRef = useRef<string | null>(null);
  const localSnapshotRawRef = useRef<string | null>(null);
  const lastDataSignatureRef = useRef<string | null>(null);
  const observedSavedAtBySignatureRef = useRef<Map<string, number>>(new Map());
  const activeRecoveryKeyRef = useRef<string | null>(null);
  const protectedRecoveryKeysRef = useRef<Set<string>>(new Set());
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current === null) return;
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
  }, []);

  const clearFlushTimers = useCallback(() => {
    clearDebounceTimer();
    if (maxWaitTimerRef.current === null) return;
    clearTimeout(maxWaitTimerRef.current);
    maxWaitTimerRef.current = null;
  }, [clearDebounceTimer]);

  const blockTerminallyLockedOwner = useCallback(() => {
    if (accountClearedRef.current) return true;
    const ownerId = parseDocumentDraftKey(key)?.ownerId;
    const storage = readBrowserLocalStorage();
    if (!ownerId || !storage) return false;
    try {
      if (!isAccountOwnerTerminallyLocked(storage, ownerId)) return false;
      broadcastFormDraftContinuityClear({
        mode: "owner",
        ownerId,
        lock: true,
      });
      return true;
    } catch {
      return false;
    }
  }, [key]);

  const reconcileSubmittedClearMarkers = useCallback(
    () => reconcileVolatileSubmittedClearMarkers<T>(
      window.localStorage,
      key,
      protectedRecoveryKeysRef.current,
    ),
    [key],
  );

  const updateIncompatibleCanonical = useCallback(
    (raw: string | null) => {
      rememberKnownIncompatibleCanonical(key, raw);
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

  const rememberObservedSavedAt = useCallback(
    (signature: string, savedAt: number | null | undefined) => {
      if (savedAt === null || savedAt === undefined || !Number.isFinite(savedAt)) {
        return;
      }
      const previous = observedSavedAtBySignatureRef.current.get(signature);
      if (previous === undefined || savedAt > previous) {
        observedSavedAtBySignatureRef.current.set(signature, savedAt);
      }
    },
    [],
  );

  const refreshRecoveries = useCallback(() => {
    try {
      const submittedMarkersResolved = reconcileSubmittedClearMarkers();
      const prunedRecoveries = pruneFormDraftRecoveries<T>(
        window.localStorage,
        key,
        { protectedKeys: protectedRecoveryKeysRef.current },
      );
      for (const recovery of prunedRecoveries) {
        rememberObservedSavedAt(
          recovery.signature,
          recovery.savedAt.getTime(),
        );
      }
      const nextRecoveries = prunedRecoveries
        .filter(({ savedAt: recoverySavedAt, signature }) => {
          // pruneFormDraftRecoveries가 durable marker를 한 번의 batch snapshot으로
          // 이미 적용한다. 여기서는 storage 실패 동안 남은 process-local marker만
          // 합쳐 recovery 수만큼 전체 localStorage를 다시 훑지 않는다.
          const marker = readVolatileSubmittedClearMarker(key, signature);
          return !marker || recoverySavedAt.getTime() > marker.clearedAt.getTime();
        })
        .map(({ storageKey, savedAt: recoverySavedAt, data, signature }) => ({
          storageKey,
          savedAt: recoverySavedAt,
          isCurrent: signature === lastDataSignatureRef.current,
          preview: createFormDraftRecoveryPreview(data),
        }));
      if (mountedRef.current) setRecoveries(nextRecoveries);
      if (!submittedMarkersResolved && mountedRef.current) setStatus("error");
      return nextRecoveries;
    } catch {
      if (mountedRef.current) setStatus("error");
      return [];
    }
  }, [key, reconcileSubmittedClearMarkers, rememberObservedSavedAt]);

  const adoptRemainingCanonical = useCallback(() => {
    reconcileSubmittedClearMarkers();
    let currentRaw = window.localStorage.getItem(key);
    for (let attempt = 0; currentRaw && attempt < 3; attempt += 1) {
      const submittedMarker = findEffectiveSubmittedClearMarkerForSnapshot<T>(
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
      rememberObservedSavedAt(
        lastDataSignatureRef.current,
        current.savedAt?.getTime(),
      );
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
  }, [
    key,
    reconcileSubmittedClearMarkers,
    rememberObservedSavedAt,
    updateIncompatibleCanonical,
  ]);

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
    clearFlushTimers();
    if (blockTerminallyLockedOwner()) return true;
    const storage = readBrowserLocalStorage();
    if (!storage) {
      if (mountedRef.current) setStatus("error");
      return false;
    }
    try {
      reconcileVolatileSubmittedClearMarkers<T>(
        storage,
        key,
        protectedRecoveryKeysRef.current,
      );
    } catch {
      if (mountedRef.current) setStatus("error");
      return false;
    }

    const isCurrentVolatileContinuityResolved = () =>
      !hasVolatileSubmittedClearMarkerForSource(key) &&
      listClaimableVolatileDrafts<T>(key, writerId).length === 0;

    const pending = pendingRef.current;
    if (!pending) {
      try {
        const promotion = promoteVolatileDrafts(
          listClaimableVolatileDrafts<T>(key, writerId),
        );
        if (promotion.changed) {
          refreshRecoveries();
          notifyDraftChange({ kind: "recovery" });
        }
        return isCurrentVolatileContinuityResolved();
      } catch {
        if (mountedRef.current) setStatus("error");
        return false;
      }
    }

    let pendingSignature: string;
    try {
      pendingSignature = getPendingDraftSignature(pending);
      rememberObservedSavedAt(pendingSignature, pending.queuedAt);
    } catch {
      if (mountedRef.current) setStatus("error");
      return false;
    }

    try {
      const submittedMarker = findEffectiveSubmittedClearMarker(
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
        return isCurrentVolatileContinuityResolved();
      }

      const lastKnownCanonicalSubmitted = lastKnownCanonicalRawRef.current
        ? findEffectiveSubmittedClearMarkerForSnapshot<T>(
            window.localStorage,
            key,
            lastKnownCanonicalRawRef.current,
          )
        : null;
      if (
        lastKnownCanonicalSubmitted &&
        window.localStorage.getItem(key) === null
      ) {
        lastKnownCanonicalRawRef.current = null;
      }
      if (
        !lastKnownCanonicalSubmitted &&
        pendingSignature === lastDataSignatureRef.current &&
        lastKnownCanonicalRawRef.current !== null &&
        localSnapshotRawRef.current === lastKnownCanonicalRawRef.current &&
        listClaimableVolatileDrafts<T>(key, writerId).length === 0
      ) {
        forgetVolatileDraft(key, writerId, pending);
        pendingRef.current = null;
        if (mountedRef.current) setStatus("saved");
        return isCurrentVolatileContinuityResolved();
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
        prepareFormDraftQuotaRetry(
          window.localStorage,
          key,
          protectedRecoveryKeysRef.current,
        );
        result = persist();
      }

      const submittedMarker = findEffectiveSubmittedClearMarker(
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
        return isCurrentVolatileContinuityResolved();
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
      return isCurrentVolatileContinuityResolved();
    } catch {
      if (mountedRef.current) setStatus("error");
      return false;
    }
  }, [
    adoptRemainingCanonical,
    blockTerminallyLockedOwner,
    clearFlushTimers,
    key,
    notifyDraftChange,
    promoteVolatileDrafts,
    refreshRecoveries,
    rememberObservedSavedAt,
    updateIncompatibleCanonical,
    writerId,
  ]);

  // 마운트 시 복원하고 탭/동일 window 문서 변경을 함께 감시한다.
  useEffect(() => {
    const effectStorage = readBrowserLocalStorage();
    const draftOwnerId = parseDocumentDraftKey(key)?.ownerId ?? null;
    let mountedWithTerminalLock = false;
    try {
      mountedWithTerminalLock = Boolean(
        effectStorage &&
          draftOwnerId &&
          isAccountOwnerTerminallyLocked(effectStorage, draftOwnerId),
      );
    } catch {
      // storage read failure는 아래 기존 오류 경로에서 처리한다.
    }
    mountedRef.current = true;
    if (!mountedWithTerminalLock) {
      registerVolatileDraftWriter(key, writerId);
    }
    if (effectStorage && !mountedWithTerminalLock) {
      registerActiveFormDraftSource(effectStorage, key);
      scheduleFormDraftArtifactSweep(effectStorage);
    }
    activeRecoveryKeyRef.current = null;
    protectedRecoveryKeysRef.current = new Set();
    pendingRef.current = null;
    accountClearedRef.current = mountedWithTerminalLock;
    // 이 effect는 hydration 뒤에만 읽을 수 있는 localStorage·terminal lock(외부 시스템)에서
    // key별 상태를 다시 맞추고 구독한다. ref 초기화와 같은 시점에 state를 함께 되돌려야
    // remount·key 전환에서 ref/state가 어긋나지 않으므로 render 단계로 옮길 수 없다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 복원·구독 effect의 외부 시스템 동기화
    setAccountCleared(mountedWithTerminalLock);
    lastKnownCanonicalRawRef.current = null;
    updateIncompatibleCanonical(
      readKnownIncompatibleCanonical(key),
    );
    localSnapshotRawRef.current = null;
    lastDataSignatureRef.current = null;
    observedSavedAtBySignatureRef.current = new Map();
    setStatus(mountedWithTerminalLock ? "error" : "idle");
    setSavedAt(null);
    setRestored(false);
    setRecoveries([]);

    if (mountedWithTerminalLock) {
      if (draftOwnerId) {
        clearVolatileFormDraftContinuity({
          mode: "owner",
          ownerId: draftOwnerId,
        });
      }
      onResetRef.current?.();
      setLoadedKey(key);
      return () => {
        mountedRef.current = false;
        clearFlushTimers();
      };
    }

    let storageReadable = effectStorage !== null;
    let mountedWithIncompatibleCanonical = false;
    let canonicalSavedAtMs: number | null = null;
    try {
      if (!effectStorage) {
        throw new Error("localStorage accessor is unavailable");
      }
      reconcileSubmittedClearMarkers();
      let raw: string | null = null;
      let stored: ReturnType<typeof parseFormDraft<T>> = null;
      let unstableCanonical = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        raw = window.localStorage.getItem(key);
        stored = raw ? parseFormDraft<T>(raw) : null;
        if (
          !raw ||
          !stored ||
          !findEffectiveSubmittedClearMarkerForSnapshot<T>(
            window.localStorage,
            key,
            raw,
          )
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
        const storedSignature = createFormDraftDataSignature(stored.data);
        lastDataSignatureRef.current = storedSignature;
        rememberObservedSavedAt(
          storedSignature,
          stored.savedAt?.getTime(),
        );
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
      try {
        volatileSignature = getPendingDraftSignature(volatilePending);
        const submittedMarker = findEffectiveSubmittedClearMarker(
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

      if (isSubmitted) {
        forgetVolatileDraft(key, writerId, volatilePending);
      } else {
        pendingRef.current = volatilePending;
        localSnapshotRawRef.current = serializeFormDraft(
          volatilePending.data,
          volatilePending.queuedAt,
        );
        lastDataSignatureRef.current = volatileSignature;
        if (volatileSignature) {
          rememberObservedSavedAt(
            volatileSignature,
            volatilePending.queuedAt,
          );
        }
        onRestoreRef.current(volatilePending.data);
        setSavedAt(new Date(volatilePending.queuedAt));
        setRestored(true);
        setStatus(mountedWithIncompatibleCanonical ? "incompatible" : "error");
        debounceTimerRef.current = setTimeout(() => flush(), debounceMs);
        maxWaitTimerRef.current = setTimeout(() => flush(), maxWaitMs);
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
        assertFormDraftSourceOwnerMayPersist(window.localStorage, key);
        window.localStorage.setItem(nextRecoveryKey, preservedRaw);
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        prepareFormDraftQuotaRetry(
          window.localStorage,
          key,
          protectedRecoveryKeysRef.current,
        );
        assertFormDraftSourceOwnerMayPersist(window.localStorage, key);
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
      rememberVolatileSubmittedClearMarker(
        key,
        marker.signature,
        marker.clearedAt.getTime(),
      );
      forgetSubmittedVolatileDrafts(
        key,
        marker.signature,
        marker.clearedAt.getTime(),
      );
      reconcileSubmittedClearMarkers();
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

      clearFlushTimers();
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
        ? findEffectiveSubmittedClearMarkerForSnapshot<T>(
            window.localStorage,
            key,
            currentRaw,
          )
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
        ? findEffectiveSubmittedClearMarker(
            window.localStorage,
            key,
            visibleSignature,
          )
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

    const handleExitBoundary = () => {
      const flushed = flush();
      const storage = readBrowserLocalStorage();
      if (!storage) {
        return flushed && !hasUnresolvedVolatileContinuityState();
      }
      try {
        const continuityDrained = drainInactiveVolatileContinuity(
          storage,
          key,
          protectedRecoveryKeysRef.current,
        );
        return flushed && continuityDrained;
      } catch {
        return false;
      }
    };
    const handlePageHide = () => {
      handleExitBoundary();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") handleExitBoundary();
    };
    const applyContinuityStateClear = (input: FormDraftContinuityClearInput) => {
      clearVolatileFormDraftContinuity(input);
      clearFlushTimers();
      const pending = pendingRef.current;
      if (pending) forgetVolatileDraft(key, writerId, pending);
      pendingRef.current = null;
      activeRecoveryKeyRef.current = null;
      protectedRecoveryKeysRef.current = new Set();
      rememberKnownIncompatibleCanonical(key, null);
      incompatibleCanonicalRawRef.current = null;
      lastKnownCanonicalRawRef.current = null;
      localSnapshotRawRef.current = null;
      lastDataSignatureRef.current = null;
      observedSavedAtBySignatureRef.current = new Map();
      accountClearedRef.current = input.lock;
      setAccountCleared(input.lock);
      setHasIncompatibleCanonical(false);
      setSavedAt(null);
      setRestored(false);
      setRecoveries([]);
      setStatus(input.lock ? "error" : "idle");
      onResetRef.current?.();
    };
    const handleStorage = (event: StorageEvent) => {
      try {
        if (event.storageArea !== window.localStorage) return;
        if (
          draftOwnerId &&
          event.key === createAccountTerminalLockStorageKey(draftOwnerId) &&
          isAccountOwnerTerminallyLocked(window.localStorage, draftOwnerId)
        ) {
          applyContinuityStateClear({
            mode: "owner",
            ownerId: draftOwnerId,
            lock: true,
          });
          return;
        }
        if (accountClearedRef.current) return;
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
    const handleContinuityClear = (
      detail: FormDraftChangeDetail,
    ): boolean => {
      if (
        detail.kind !== "continuity-clear" ||
        !detail.clearMode ||
        typeof detail.ownerId !== "string" ||
        !shouldClearFormDraftSource(key, {
          mode: detail.clearMode,
          ownerId: detail.ownerId,
          sourceKey: detail.sourceKey || undefined,
        })
      ) {
        return false;
      }
      applyContinuityStateClear({
        mode: detail.clearMode,
        ownerId: detail.ownerId,
        sourceKey: detail.sourceKey || undefined,
        lock: detail.lock === true,
      });
      return true;
    };
    const handleTerminalLock = (event: Event) => {
      if (
        !draftOwnerId ||
        !isAccountTerminalLockEventForOwner(event, draftOwnerId)
      ) {
        return;
      }
      applyContinuityStateClear({
        mode: "owner",
        ownerId: draftOwnerId,
        lock: true,
      });
    };
    const handleDraftChangeDetail = (detail: FormDraftChangeDetail | null | undefined) => {
      if (!detail || detail.writerId === writerId) return;
      if (handleContinuityClear(detail)) return;
      if (detail.sourceKey !== key || accountClearedRef.current) return;
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
      if (
        event.data.kind === "continuity-clear" &&
        event.data.clearMode &&
        typeof event.data.ownerId === "string"
      ) {
        clearVolatileFormDraftContinuity({
          mode: event.data.clearMode,
          ownerId: event.data.ownerId,
          sourceKey: event.data.sourceKey || undefined,
        });
      }
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
      if (handleExitBoundary()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(ACCOUNT_TERMINAL_LOCK_EVENT, handleTerminalLock);
    window.addEventListener(FORM_DRAFT_CHANGE_EVENT, handleLocalDraftChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      flush();
      unregisterVolatileDraftWriter(key, writerId);
      if (effectStorage) unregisterActiveFormDraftSource(effectStorage, key);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(ACCOUNT_TERMINAL_LOCK_EVENT, handleTerminalLock);
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
    clearFlushTimers,
    debounceMs,
    flush,
    key,
    maxWaitMs,
    promoteVolatileDrafts,
    reconcileSubmittedClearMarkers,
    rememberObservedSavedAt,
    refreshRecoveries,
    updateIncompatibleCanonical,
    writerId,
  ]);

  const save = useCallback(
    (data: T) => {
      if (blockTerminallyLockedOwner()) {
        setStatus("error");
        return;
      }
      try {
        clearDebounceTimer();
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
        debounceTimerRef.current = setTimeout(() => {
          flush();
        }, debounceMs);
        if (maxWaitTimerRef.current === null) {
          maxWaitTimerRef.current = setTimeout(() => {
            flush();
          }, maxWaitMs);
        }
      } catch {
        setStatus("error");
      }
    },
    [
      blockTerminallyLockedOwner,
      clearDebounceTimer,
      debounceMs,
      flush,
      key,
      maxWaitMs,
      writerId,
    ],
  );

  const clear = useCallback((options: {
    reason?: "empty" | "discard" | "submitted";
    submittedData?: T;
    submittedAliases?: readonly T[];
  } = {}) => {
    if (blockTerminallyLockedOwner()) return;
    try {
      clearFlushTimers();
      const submitted = options.reason === "submitted";
      const pendingSignature = submitted && pendingRef.current
        ? getPendingDraftSignature(pendingRef.current)
        : null;
      const requestedPrimarySignature = submitted
        ? options.submittedData === undefined
          ? lastDataSignatureRef.current ?? pendingSignature
          : createFormDraftDataSignature(options.submittedData)
        : lastDataSignatureRef.current;
      const submittedSignatures = new Set<string>();
      if (submitted && requestedPrimarySignature) {
        submittedSignatures.add(requestedPrimarySignature);
      }
      if (submitted) {
        for (const alias of options.submittedAliases ?? []) {
          submittedSignatures.add(createFormDraftDataSignature(alias));
        }
      }
      const signature = requestedPrimarySignature ??
        submittedSignatures.values().next().value ??
        null;
      const requestedClearedAt = Date.now();
      let requestedCutoffs = new Map<string, number>();
      for (const submittedSignature of submittedSignatures) {
        requestedCutoffs.set(
          submittedSignature,
          Math.max(
            requestedClearedAt,
            observedSavedAtBySignatureRef.current.get(submittedSignature) ??
              Number.NEGATIVE_INFINITY,
            getMaxVolatileDraftQueuedAtBySignature(key, submittedSignature) ??
              Number.NEGATIVE_INFINITY,
            pendingSignature === submittedSignature && pendingRef.current
              ? pendingRef.current.queuedAt
              : Number.NEGATIVE_INFINITY,
          ),
        );
      }
      let submittedClearPlan: ReturnType<
        typeof prepareFormDraftSnapshotClearPlan
      > | null = null;
      try {
        submittedClearPlan = prepareFormDraftSnapshotClearPlan(
          window.localStorage,
          key,
          requestedCutoffs,
        );
        requestedCutoffs = new Map(submittedClearPlan.cutoffs);
      } catch {
        // storage가 차단돼도 mount/refresh/save에서 관측한 signature별 cutoff는 유지한다.
      }
      for (const [submittedSignature, cutoff] of requestedCutoffs) {
        rememberObservedSavedAt(submittedSignature, cutoff);
      }
      const volatileSubmittedMarkers = submitted
        ? [...submittedSignatures].map((submittedSignature) =>
            rememberVolatileSubmittedClearMarker(
              key,
              submittedSignature,
              requestedCutoffs.get(submittedSignature) ?? requestedClearedAt,
            ))
        : [];
      const clearedAtBySignature = new Map(
        volatileSubmittedMarkers.map((marker) => [
          marker.signature,
          marker.clearedAt,
        ] as const),
      );
      const volatilePending = readVolatileDraft<T>(key, writerId);
      if (submitted && submittedSignatures.size > 0) {
        for (const submittedSignature of submittedSignatures) {
          forgetSubmittedVolatileDrafts(
            key,
            submittedSignature,
            clearedAtBySignature.get(submittedSignature) ?? requestedClearedAt,
          );
        }
      } else {
        forgetVolatileDraft(key, writerId, volatilePending ?? undefined);
      }
      const removeSubmittedSnapshots = () => {
        if (submittedClearPlan) {
          applyFormDraftSnapshotClearPlan(
            window.localStorage,
            submittedClearPlan,
            clearedAtBySignature,
          );
          return;
        }
        for (const submittedSignature of submittedSignatures) {
          removeFormDraftSnapshotsBySignature(
            window.localStorage,
            key,
            submittedSignature,
            {
              savedAtOrBefore:
                clearedAtBySignature.get(submittedSignature) ??
                requestedClearedAt,
            },
          );
          removeFormDraftCanonicalSnapshotBySignature<T>(
            window.localStorage,
            key,
            submittedSignature,
            {
              savedAtOrBefore:
                clearedAtBySignature.get(submittedSignature) ??
                requestedClearedAt,
            },
          );
        }
      };

      if (submitted && pendingRef.current) {
        if (pendingSignature && submittedSignatures.has(pendingSignature)) {
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

      pendingRef.current = null;

      let submittedMarker: ReturnType<typeof writeFormDraftClearMarker> | null = null;
      if (submitted && signature) {
        let durableSubmittedMarkers: ReturnType<
          typeof writeFormDraftClearMarkers
        > | null = null;
        let unresolvedMarkerError: unknown = null;
        const markerInputs = volatileSubmittedMarkers.map((marker) => ({
          signature: marker.signature,
          clearedAt: marker.clearedAt,
        }));
        try {
          durableSubmittedMarkers = writeFormDraftClearMarkers(
            window.localStorage,
            key,
            markerInputs,
          );
        } catch (error) {
          unresolvedMarkerError = error;
          if (isStorageQuotaError(error)) {
            try {
              removeSubmittedSnapshots();
              prepareFormDraftQuotaRetry(
                window.localStorage,
                key,
                protectedRecoveryKeysRef.current,
              );
              durableSubmittedMarkers = writeFormDraftClearMarkers(
                window.localStorage,
                key,
                markerInputs,
              );
              unresolvedMarkerError = null;
            } catch (retryError) {
              unresolvedMarkerError = retryError;
            }
          }
        }
        if (unresolvedMarkerError || !durableSubmittedMarkers) {
          try {
            removeSubmittedSnapshots();
          } catch {
            // 저장소 자체가 차단된 경우에도 활성 peer에는 제출 완료를 전파한다.
          }
          for (const volatileMarker of volatileSubmittedMarkers) {
            notifyDraftChange({
              kind: "submitted-clear",
              signature: volatileMarker.signature,
              clearedAt: volatileMarker.clearedAt,
            });
          }
          throw unresolvedMarkerError ?? new Error("Form draft marker write failed");
        }
        submittedMarker =
          durableSubmittedMarkers.find(
            (marker) => marker.signature === signature,
          ) ?? null;
      }
      if (submittedMarker) {
        removeSubmittedSnapshots();
        for (const volatileMarker of volatileSubmittedMarkers) {
          forgetVolatileSubmittedClearMarker(key, volatileMarker);
        }
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
        !submittedSignatures.has(lastDataSignatureRef.current);
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
        for (const submittedSignature of submittedSignatures) {
          notifyDraftChange({
            kind: "submitted-clear",
            signature: submittedSignature,
            clearedAt:
              clearedAtBySignature.get(submittedSignature) ?? requestedClearedAt,
          });
        }
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
    clearFlushTimers,
    blockTerminallyLockedOwner,
    flush,
    key,
    notifyDraftChange,
    rememberObservedSavedAt,
    refreshRecoveries,
    updateIncompatibleCanonical,
    writerId,
  ]);

  const restoreRecovery = useCallback(
    (storageKey: string) => {
      if (blockTerminallyLockedOwner()) return;
      try {
        reconcileSubmittedClearMarkers();
        const selected = readFormDraftRecovery<T>(window.localStorage, key, storageKey);
        if (!selected) {
          refreshRecoveries();
          return;
        }
        const selectedMarker = findEffectiveSubmittedClearMarker(
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
          ? findEffectiveSubmittedClearMarkerForSnapshot<T>(
              window.localStorage,
              key,
              currentRaw,
            )
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

          const submittedMarker = findEffectiveSubmittedClearMarker(
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
            assertFormDraftSourceOwnerMayPersist(window.localStorage, key);
            window.localStorage.setItem(preservedKey, preservedRaw);
          } catch (error) {
            if (!isStorageQuotaError(error)) throw error;
            prepareFormDraftQuotaRetry(
              window.localStorage,
              key,
              protectedRecoveryKeysRef.current,
            );
            assertFormDraftSourceOwnerMayPersist(window.localStorage, key);
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

        clearFlushTimers();
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
          prepareFormDraftQuotaRetry(
            window.localStorage,
            key,
            protectedRecoveryKeysRef.current,
          );
          result = persist();
        }

        const postPersistMarker = findEffectiveSubmittedClearMarker(
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
        rememberObservedSavedAt(
          selected.signature,
          restoredAt.getTime(),
        );
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
      blockTerminallyLockedOwner,
      clearFlushTimers,
      key,
      notifyDraftChange,
      rememberObservedSavedAt,
      reconcileSubmittedClearMarkers,
      refreshRecoveries,
      updateIncompatibleCanonical,
      writerId,
    ],
  );

  const discardRecovery = useCallback(
    (storageKey: string) => {
      if (blockTerminallyLockedOwner()) return;
      if (!isFormDraftRecoveryKey(key, storageKey)) return;
      try {
        reconcileSubmittedClearMarkers();
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
          clearFlushTimers();
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
    [
      adoptRemainingCanonical,
      blockTerminallyLockedOwner,
      clearFlushTimers,
      key,
      notifyDraftChange,
      reconcileSubmittedClearMarkers,
      refreshRecoveries,
      writerId,
    ],
  );

  return {
    loaded: loadedKey === key,
    save,
    clear,
    flush,
    status,
    canSubmit: !hasIncompatibleCanonical && !accountCleared,
    savedAt,
    restored,
    recoveries,
    restoreRecovery,
    discardRecovery,
  };
}

export { broadcastFormDraftContinuityClear, type FormDraftContinuityClearInput } from "@/lib/form-draft/page-session";
