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
  hasFutureFormDraftVersion,
  hasFormDraftStorageConflict,
  isImmutableFormDraftRecoveryKey,
  isFormDraftClearMarkerKey,
  isFormDraftRecoveryKey,
  parseDocumentDraftKey,
  parseFormDraftClearMarker,
  parseFormDraft,
  applyFormDraftSnapshotClearPlan,
  persistFormDraftRawSnapshot,
  prepareFormDraftSnapshotClearPlan,
  pruneFormDraftRecoveries,
  readFormDraftRecovery,
  removeFormDraftCanonicalSnapshotBySignature,
  removeFormDraftSnapshotsBySignature,
  serializeFormDraft,
  sweepExpiredFormDraftArtifacts,
  writeFormDraftClearMarker,
  writeFormDraftClearMarkers,
  type FormDraftRecoverySummary,
  type FormDraftStorage,
  type FormDraftStatus,
} from "@/lib/form-draft";

const FORM_DRAFT_CHANGE_EVENT = "portal:form-draft-change";
const FORM_DRAFT_BROADCAST_CHANNEL = "portal:form-draft";
export const FORM_DRAFT_MAX_WAIT_MS = 5_000;
const FORM_DRAFT_ARTIFACT_SWEEP_MAX_KEYS_PER_SLICE = 4;
const FORM_DRAFT_ARTIFACT_SWEEP_MIN_IDLE_MS = 8;
const FORM_DRAFT_ARTIFACT_SWEEP_MAX_RAW_CODE_UNITS = 256 * 1024;
const FORM_DRAFT_ARTIFACT_SWEEP_MAX_KEY_CODE_UNITS = 4 * 1024;

type FormDraftIdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type FormDraftChangeDetail = {
  sourceKey: string;
  writerId: string;
  kind:
    | "canonical"
    | "recovery"
    | "submitted-clear"
    | "continuity-clear";
  signature?: string;
  clearedAt?: number;
  clearMode?: "owner" | "except-owner" | "source";
  ownerId?: string;
  lock?: boolean;
};

export type FormDraftContinuityClearInput = {
  mode: "owner" | "except-owner" | "source";
  ownerId: string;
  sourceKey?: string;
  lock: boolean;
};

type PendingDraft<T> = {
  data: T;
  signature: string | null;
  queuedAt: number;
};

type SubmittedClearCutoff = {
  signature: string;
  clearedAt: Date;
};

type VolatileSubmittedClearMarker = {
  signature: string;
  clearedAt: number;
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
const volatileSubmittedClearMarkers = new Map<
  string,
  Map<string, VolatileSubmittedClearMarker>
>();
/**
 * 이 page session에서 이미 확인한 미래 canonical을 key별로 기억한다.
 * 같은 key의 effect 재설정이나 SPA 왕복 중 storage read가 일시 실패해도
 * 확인했던 제출 잠금을 조용히 해제하지 않는다.
 */
const knownIncompatibleCanonicalRaws = new Map<string, string>();
const activeVolatileDraftWriters = new Set<string>();
const activeFormDraftSourceCounts = new WeakMap<
  FormDraftStorage,
  Map<string, number>
>();
const scheduledFormDraftArtifactSweeps = new WeakSet<FormDraftStorage>();
const pendingFormDraftArtifactSweepJobs = new WeakMap<
  FormDraftStorage,
  { cancel: () => void }
>();
let volatileBeforeUnloadGuardAttached = false;

function shouldClearFormDraftSource(
  sourceKey: string,
  input: Pick<FormDraftContinuityClearInput, "mode" | "ownerId" | "sourceKey">,
): boolean {
  const identity = parseDocumentDraftKey(sourceKey);
  if (!identity) return false;
  if (input.mode === "source") {
    return identity.ownerId === input.ownerId && sourceKey === input.sourceKey;
  }
  return input.mode === "owner"
    ? identity.ownerId === input.ownerId
    : identity.ownerId !== input.ownerId;
}

function clearVolatileFormDraftContinuity(
  input: Pick<FormDraftContinuityClearInput, "mode" | "ownerId" | "sourceKey">,
): void {
  const clearMapKeys = <V>(map: Map<string, V>) => {
    for (const sourceKey of [...map.keys()]) {
      if (shouldClearFormDraftSource(sourceKey, input)) map.delete(sourceKey);
    }
  };

  clearMapKeys(volatileDraftFallbacks);
  clearMapKeys(volatileSubmittedClearMarkers);
  clearMapKeys(knownIncompatibleCanonicalRaws);
  for (const writerKey of [...activeVolatileDraftWriters]) {
    const separatorIndex = writerKey.indexOf("\u0000");
    const sourceKey = separatorIndex === -1
      ? writerKey
      : writerKey.slice(0, separatorIndex);
    if (shouldClearFormDraftSource(sourceKey, input)) {
      activeVolatileDraftWriters.delete(writerKey);
    }
  }
  syncVolatileBeforeUnloadGuard();
}

/**
 * 로그아웃·계정 전환·명시 폐기를 현재 window와 열린 peer에 먼저 알린다.
 * 호출자는 이 알림 직후 같은 범위의 durable localStorage artifact를 제거한다.
 */
export function broadcastFormDraftContinuityClear(
  input: FormDraftContinuityClearInput,
): void {
  if (
    input.mode === "source" &&
    (!input.sourceKey || !shouldClearFormDraftSource(input.sourceKey, input))
  ) {
    throw new Error("Form draft source does not belong to the requested owner");
  }

  clearVolatileFormDraftContinuity(input);
  if (typeof window === "undefined") return;
  const detail: FormDraftChangeDetail = {
    sourceKey: input.sourceKey ?? "",
    writerId: "account-boundary",
    kind: "continuity-clear",
    clearMode: input.mode,
    ownerId: input.ownerId,
    lock: input.lock,
  };

  try {
    window.dispatchEvent(
      new CustomEvent<FormDraftChangeDetail>(FORM_DRAFT_CHANGE_EVENT, {
        detail,
      }),
    );
  } catch {
    // 현재 window 알림 실패와 무관하게 durable 정리는 호출자가 계속한다.
  }

  if (typeof window.BroadcastChannel !== "function") return;
  try {
    const channel = new window.BroadcastChannel(FORM_DRAFT_BROADCAST_CHANNEL);
    channel.postMessage(detail);
    channel.close();
  } catch {
    // opaque origin 등 BroadcastChannel 비지원 환경은 storage 정리로 수렴한다.
  }
}

function registerActiveFormDraftSource(
  storage: FormDraftStorage,
  sourceKey: string,
): void {
  const counts = activeFormDraftSourceCounts.get(storage) ?? new Map();
  counts.set(sourceKey, (counts.get(sourceKey) ?? 0) + 1);
  activeFormDraftSourceCounts.set(storage, counts);
}

function unregisterActiveFormDraftSource(
  storage: FormDraftStorage,
  sourceKey: string,
): void {
  const counts = activeFormDraftSourceCounts.get(storage);
  if (!counts) return;
  const nextCount = (counts.get(sourceKey) ?? 0) - 1;
  if (nextCount > 0) counts.set(sourceKey, nextCount);
  else counts.delete(sourceKey);
  if (counts.size === 0) {
    activeFormDraftSourceCounts.delete(storage);
    cancelPendingFormDraftArtifactSweep(storage);
  }
}

function listActiveFormDraftSources(
  storage: FormDraftStorage,
  currentSourceKey?: string,
): Set<string> {
  const sourceKeys = new Set(activeFormDraftSourceCounts.get(storage)?.keys());
  if (currentSourceKey) sourceKeys.add(currentSourceKey);
  return sourceKeys;
}

function scheduleFormDraftIdleWork(
  callback: (deadline: FormDraftIdleDeadline) => void,
): () => void {
  const idleWindow = window;
  const requestIdleCallback = Reflect.get(idleWindow, "requestIdleCallback");
  if (typeof requestIdleCallback === "function") {
    try {
      const handle: unknown = requestIdleCallback.call(
        idleWindow,
        callback,
        { timeout: 1_000 },
      );
      return () => {
        const cancelIdleCallback = Reflect.get(
          idleWindow,
          "cancelIdleCallback",
        );
        if (
          typeof cancelIdleCallback === "function" &&
          typeof handle === "number"
        ) {
          cancelIdleCallback.call(idleWindow, handle);
        }
      };
    } catch {
      // 일부 sandbox 구현은 API를 노출한 뒤 호출만 거부한다.
    }
  }
  const scheduleTimeout = setTimeout;
  const cancelTimeout = clearTimeout;
  const timeout = scheduleTimeout(() => {
    callback({ didTimeout: true, timeRemaining: () => 0 });
  }, 0);
  return () => cancelTimeout(timeout);
}

function cancelPendingFormDraftArtifactSweep(storage: FormDraftStorage): void {
  const job = pendingFormDraftArtifactSweepJobs.get(storage);
  if (!job) return;
  job.cancel();
  pendingFormDraftArtifactSweepJobs.delete(storage);
  scheduledFormDraftArtifactSweeps.delete(storage);
}

function scheduleFormDraftArtifactSweep(storage: FormDraftStorage): void {
  if (scheduledFormDraftArtifactSweeps.has(storage)) return;
  scheduledFormDraftArtifactSweeps.add(storage);

  let nextStorageIndex: number | null = null;
  let cancelled = false;
  let cancelScheduledSlice = () => {};
  const job = {
    cancel: () => {
      cancelled = true;
      cancelScheduledSlice();
    },
  };
  pendingFormDraftArtifactSweepJobs.set(storage, job);

  const sweepSlice = (deadline: FormDraftIdleDeadline) => {
    cancelScheduledSlice = () => {};
    if (cancelled) return;
    try {
      if (nextStorageIndex === null) nextStorageIndex = storage.length - 1;
      const maxKeys = deadline.didTimeout
        ? 1
        : FORM_DRAFT_ARTIFACT_SWEEP_MAX_KEYS_PER_SLICE;
      const protectedSourceKeys = listActiveFormDraftSources(storage);
      const now = Date.now();
      let scannedKeys = 0;

      while (nextStorageIndex >= 0 && scannedKeys < maxKeys) {
        if (
          !deadline.didTimeout &&
          deadline.timeRemaining() < FORM_DRAFT_ARTIFACT_SWEEP_MIN_IDLE_MS
        ) {
          break;
        }
        nextStorageIndex = Math.min(nextStorageIndex, storage.length - 1);
        if (nextStorageIndex < 0) break;
        const candidateKey = storage.key(nextStorageIndex);
        nextStorageIndex -= 1;
        scannedKeys += 1;
        if (
          candidateKey === null ||
          candidateKey.length > FORM_DRAFT_ARTIFACT_SWEEP_MAX_KEY_CODE_UNITS
        ) {
          continue;
        }
        sweepExpiredFormDraftArtifacts(storage, {
          now,
          protectedSourceKeys,
          candidateKeys: [candidateKey],
          maxArtifactRawCodeUnits:
            FORM_DRAFT_ARTIFACT_SWEEP_MAX_RAW_CODE_UNITS,
          includeClearMarkers: false,
        });
      }
    } catch {
      // proactive sweep는 best-effort다. 현재 폼의 저장/복원 상태를 바꾸지 않는다.
      pendingFormDraftArtifactSweepJobs.delete(storage);
      return;
    }

    if (nextStorageIndex >= 0) {
      cancelScheduledSlice = scheduleFormDraftIdleWork(sweepSlice);
    } else {
      pendingFormDraftArtifactSweepJobs.delete(storage);
    }
  };

  cancelScheduledSlice = scheduleFormDraftIdleWork(sweepSlice);
}

function readBrowserLocalStorage(): FormDraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function prepareFormDraftQuotaRetry(
  storage: FormDraftStorage,
  sourceKey: string,
  protectedRecoveryKeys: ReadonlySet<string>,
): void {
  try {
    sweepExpiredFormDraftArtifacts(storage, {
      protectedSourceKeys: listActiveFormDraftSources(storage, sourceKey),
      protectedRecoveryKeys,
    });
  } catch {
    // 다른 namespace 정리가 실패해도 기존 current-source compaction은 계속 시도한다.
  }
  compactFormDraftRecoveries(storage, sourceKey, {
    protectedKeys: protectedRecoveryKeys,
  });
}

function handleVolatileBeforeUnload(event: BeforeUnloadEvent): void {
  const storage = readBrowserLocalStorage();
  if (storage) {
    try {
      drainInactiveVolatileContinuity(storage, "", new Set());
    } catch {
      // 개별 hook의 beforeunload flush와 아래 unresolved guard가 안전본을 유지한다.
    }
  }
  if (!hasUnresolvedVolatileContinuityState()) return;
  event.preventDefault();
  event.returnValue = "";
}

function syncVolatileBeforeUnloadGuard(): void {
  if (typeof window === "undefined") return;
  const shouldAttach =
    hasVolatileDraftFallbacks() || hasVolatileSubmittedClearMarkers();
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

function rememberVolatileSubmittedClearMarker(
  key: string,
  signature: string,
  clearedAt: number,
): VolatileSubmittedClearMarker {
  const markers = volatileSubmittedClearMarkers.get(key) ?? new Map();
  const previous = markers.get(signature);
  const marker = previous && previous.clearedAt >= clearedAt
    ? previous
    : { signature, clearedAt };
  markers.set(signature, marker);
  volatileSubmittedClearMarkers.set(key, markers);
  syncVolatileBeforeUnloadGuard();
  return marker;
}

function readVolatileSubmittedClearMarker(
  key: string,
  signature: string,
): SubmittedClearCutoff | null {
  const marker = volatileSubmittedClearMarkers.get(key)?.get(signature);
  return marker
    ? { signature: marker.signature, clearedAt: new Date(marker.clearedAt) }
    : null;
}

function forgetVolatileSubmittedClearMarker(
  key: string,
  marker: VolatileSubmittedClearMarker,
): void {
  const markers = volatileSubmittedClearMarkers.get(key);
  if (!markers || markers.get(marker.signature) !== marker) return;
  markers.delete(marker.signature);
  if (markers.size === 0) volatileSubmittedClearMarkers.delete(key);
  syncVolatileBeforeUnloadGuard();
}

function findEffectiveSubmittedClearMarker(
  storage: FormDraftStorage,
  key: string,
  signature: string,
): SubmittedClearCutoff | null {
  const volatileMarker = readVolatileSubmittedClearMarker(key, signature);
  let durableMarker: ReturnType<typeof findFormDraftClearMarker> = null;
  try {
    durableMarker = findFormDraftClearMarker(storage, key, signature);
  } catch (error) {
    if (!volatileMarker) throw error;
  }

  if (!volatileMarker) return durableMarker;
  if (!durableMarker) return volatileMarker;
  return durableMarker.clearedAt.getTime() >= volatileMarker.clearedAt.getTime()
    ? durableMarker
    : volatileMarker;
}

function findEffectiveSubmittedClearMarkerForSnapshot<T>(
  storage: FormDraftStorage,
  key: string,
  raw: string,
): SubmittedClearCutoff | null {
  const stored = parseFormDraft<T>(raw);
  if (!stored) return null;
  const marker = findEffectiveSubmittedClearMarker(
    storage,
    key,
    createFormDraftDataSignature(stored.data),
  );
  if (!marker) return null;
  const savedAt = stored.savedAt?.getTime();
  return savedAt === undefined || savedAt <= marker.clearedAt.getTime()
    ? marker
    : null;
}

function reconcileVolatileSubmittedClearMarkers<T>(
  storage: FormDraftStorage,
  key: string,
  protectedKeys: ReadonlySet<string> = new Set(),
  allowQuotaRetry = true,
): boolean {
  const markers = volatileSubmittedClearMarkers.get(key);
  if (!markers || markers.size === 0) return true;

  for (const marker of [...markers.values()]) {
    let durableMarker: ReturnType<typeof findFormDraftClearMarker> = null;
    try {
      durableMarker = findFormDraftClearMarker(storage, key, marker.signature);
    } catch {
      return false;
    }

    if (
      !durableMarker ||
      durableMarker.clearedAt.getTime() < marker.clearedAt
    ) {
      try {
        writeFormDraftClearMarker(
          storage,
          key,
          marker.signature,
          marker.clearedAt,
        );
      } catch (error) {
        if (allowQuotaRetry && isStorageQuotaError(error)) {
          try {
            prepareFormDraftQuotaRetry(storage, key, protectedKeys);
            writeFormDraftClearMarker(
              storage,
              key,
              marker.signature,
              marker.clearedAt,
            );
          } catch {
            // 부분 기록됐을 수 있으므로 아래 durable 재조회로 확정한다.
          }
        }
      }

      try {
        durableMarker = findFormDraftClearMarker(storage, key, marker.signature);
      } catch {
        return false;
      }
    }

    if (
      !durableMarker ||
      durableMarker.clearedAt.getTime() < marker.clearedAt
    ) {
      return false;
    }

    const effectiveClearedAt = Math.max(
      marker.clearedAt,
      durableMarker.clearedAt.getTime(),
    );
    try {
      forgetSubmittedVolatileDrafts(
        key,
        marker.signature,
        effectiveClearedAt,
      );
      removeFormDraftSnapshotsBySignature(
        storage,
        key,
        marker.signature,
        { savedAtOrBefore: effectiveClearedAt },
      );
      removeFormDraftCanonicalSnapshotBySignature<T>(
        storage,
        key,
        marker.signature,
        { savedAtOrBefore: effectiveClearedAt },
      );
    } catch {
      return false;
    }
    forgetVolatileSubmittedClearMarker(key, marker);
  }

  return !volatileSubmittedClearMarkers.has(key);
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

function listOrphanedVolatileDrafts<T>(
  key: string,
): ClaimableVolatileDraft<T>[] {
  const writers = volatileDraftFallbacks.get(key);
  if (!writers) return [];

  const orphaned: ClaimableVolatileDraft<T>[] = [];
  for (const [writerId, pending] of writers) {
    if (activeVolatileDraftWriters.has(createVolatileWriterKey(key, writerId))) {
      continue;
    }
    orphaned.push({
      writerId,
      pending: pending as PendingDraft<T>,
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
    let submittedMarker: SubmittedClearCutoff | null;
    try {
      submittedMarker = findEffectiveSubmittedClearMarker(
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
        prepareFormDraftQuotaRetry(
          storage,
          key,
          new Set([...protectedKeys, recoveryKey]),
        );
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

function reconcileAllVolatileSubmittedClearMarkers(
  storage: FormDraftStorage,
  currentKey: string,
  currentProtectedKeys: ReadonlySet<string>,
): boolean {
  const activeSources = listActiveFormDraftSources(storage);
  let resolved = true;
  for (const sourceKey of [...volatileSubmittedClearMarkers.keys()]) {
    const isCurrent = sourceKey === currentKey;
    const sourceResolved = reconcileVolatileSubmittedClearMarkers<unknown>(
      storage,
      sourceKey,
      isCurrent ? currentProtectedKeys : new Set(),
      isCurrent || !activeSources.has(sourceKey),
    );
    if (!sourceResolved) resolved = false;
  }
  return resolved;
}

function promoteAllInactiveOrphanedVolatileDrafts(
  storage: FormDraftStorage,
  currentKey: string,
): { changed: boolean; resolved: boolean } {
  const activeSources = listActiveFormDraftSources(storage);
  let changed = false;
  let resolved = true;

  for (const sourceKey of [...volatileDraftFallbacks.keys()]) {
    if (sourceKey === currentKey || activeSources.has(sourceKey)) continue;
    const orphaned = listOrphanedVolatileDrafts<unknown>(sourceKey);
    if (orphaned.length === 0) continue;
    const promotion = promoteClaimableVolatileDrafts(
      storage,
      sourceKey,
      orphaned,
      new Set(),
    );
    if (promotion.changed) changed = true;
    if (
      !promotion.storageReadable ||
      listOrphanedVolatileDrafts(sourceKey).length > 0
    ) {
      resolved = false;
    }
  }

  return { changed, resolved };
}

function drainInactiveVolatileContinuity(
  storage: FormDraftStorage,
  currentKey: string,
  currentProtectedKeys: ReadonlySet<string>,
): boolean {
  const submittedMarkersResolved = reconcileAllVolatileSubmittedClearMarkers(
    storage,
    currentKey,
    currentProtectedKeys,
  );
  const drafts = promoteAllInactiveOrphanedVolatileDrafts(storage, currentKey);
  return submittedMarkersResolved && drafts.resolved &&
    !hasUnresolvedVolatileContinuityState();
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

function getMaxVolatileDraftQueuedAtBySignature(
  key: string,
  signature: string,
): number | null {
  const writers = volatileDraftFallbacks.get(key);
  if (!writers) return null;
  let latest: number | null = null;
  for (const pending of writers.values()) {
    try {
      if (getPendingDraftSignature(pending) !== signature) continue;
      if (latest === null || pending.queuedAt > latest) latest = pending.queuedAt;
    } catch {
      // 해석할 수 없는 다른 writer의 volatile data는 해당 signature로 추정하지 않는다.
    }
  }
  return latest;
}

function hasVolatileDraftFallbacks(): boolean {
  for (const writers of volatileDraftFallbacks.values()) {
    if (writers.size > 0) return true;
  }
  return false;
}

function hasVolatileSubmittedClearMarkers(): boolean {
  for (const markers of volatileSubmittedClearMarkers.values()) {
    if (markers.size > 0) return true;
  }
  return false;
}

function hasOrphanedVolatileDraftFallbacks(): boolean {
  for (const [key, writers] of volatileDraftFallbacks) {
    for (const writerId of writers.keys()) {
      if (
        !activeVolatileDraftWriters.has(createVolatileWriterKey(key, writerId))
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasUnresolvedVolatileContinuityState(): boolean {
  return hasVolatileSubmittedClearMarkers() ||
    hasOrphanedVolatileDraftFallbacks();
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
  onRestoreRef.current = onRestore;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
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
    if (accountClearedRef.current) return true;
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
      !volatileSubmittedClearMarkers.has(key) &&
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
    mountedRef.current = true;
    activeVolatileDraftWriters.add(createVolatileWriterKey(key, writerId));
    if (effectStorage) {
      registerActiveFormDraftSource(effectStorage, key);
      scheduleFormDraftArtifactSweep(effectStorage);
    }
    activeRecoveryKeyRef.current = null;
    protectedRecoveryKeysRef.current = new Set();
    pendingRef.current = null;
    accountClearedRef.current = false;
    setAccountCleared(false);
    lastKnownCanonicalRawRef.current = null;
    updateIncompatibleCanonical(
      knownIncompatibleCanonicalRaws.get(key) ?? null,
    );
    localSnapshotRawRef.current = null;
    lastDataSignatureRef.current = null;
    observedSavedAtBySignatureRef.current = new Map();
    setStatus("idle");
    setSavedAt(null);
    setRestored(false);
    setRecoveries([]);

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
        window.localStorage.setItem(nextRecoveryKey, preservedRaw);
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        prepareFormDraftQuotaRetry(
          window.localStorage,
          key,
          protectedRecoveryKeysRef.current,
        );
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
    const handleStorage = (event: StorageEvent) => {
      if (accountClearedRef.current) return;
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

      clearFlushTimers();
      const pending = pendingRef.current;
      if (pending) forgetVolatileDraft(key, writerId, pending);
      pendingRef.current = null;
      activeRecoveryKeyRef.current = null;
      protectedRecoveryKeysRef.current = new Set();
      knownIncompatibleCanonicalRaws.delete(key);
      incompatibleCanonicalRawRef.current = null;
      lastKnownCanonicalRawRef.current = null;
      localSnapshotRawRef.current = null;
      lastDataSignatureRef.current = null;
      observedSavedAtBySignatureRef.current = new Map();
      accountClearedRef.current = detail.lock === true;
      setAccountCleared(detail.lock === true);
      setHasIncompatibleCanonical(false);
      setSavedAt(null);
      setRestored(false);
      setRecoveries([]);
      setStatus(detail.lock === true ? "error" : "idle");
      onResetRef.current?.();
      return true;
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
    window.addEventListener(FORM_DRAFT_CHANGE_EVENT, handleLocalDraftChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      flush();
      activeVolatileDraftWriters.delete(createVolatileWriterKey(key, writerId));
      if (effectStorage) unregisterActiveFormDraftSource(effectStorage, key);
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
      if (accountClearedRef.current) {
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
    [clearDebounceTimer, debounceMs, flush, key, maxWaitMs, writerId],
  );

  const clear = useCallback((options: {
    reason?: "empty" | "discard" | "submitted";
    submittedData?: T;
    submittedAliases?: readonly T[];
  } = {}) => {
    if (accountClearedRef.current) return;
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
      if (accountClearedRef.current) return;
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
            window.localStorage.setItem(preservedKey, preservedRaw);
          } catch (error) {
            if (!isStorageQuotaError(error)) throw error;
            prepareFormDraftQuotaRetry(
              window.localStorage,
              key,
              protectedRecoveryKeysRef.current,
            );
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
      if (accountClearedRef.current) return;
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
