/** 페이지 세션의 volatile 복구본·제출 marker·계정 경계와 이탈 보호를 소유한다. */
"use client";

import {
  createFormDraftDataSignature,
  parseFormDraft,
  serializeFormDraft,
} from "./codec";
import type { FormDraftStorage } from "./contract";
import {
  findFormDraftClearMarker,
  writeFormDraftClearMarker,
} from "./clear-markers";
import {
  removeFormDraftSnapshotsBySignature,
  removeFormDraftCanonicalSnapshotBySignature,
} from "./snapshots";
import {
  parseDocumentDraftKey,
  createImmutableFormDraftRecoveryKey,
  assertFormDraftSourceOwnerMayPersist,
} from "./keys";
import {
  readBrowserLocalStorage,
  isStorageQuotaError,
  prepareFormDraftQuotaRetry,
  listActiveFormDraftSources,
} from "./storage-maintenance";

export const FORM_DRAFT_CHANGE_EVENT = "portal:form-draft-change";

export const FORM_DRAFT_BROADCAST_CHANNEL = "portal:form-draft";

export type FormDraftChangeDetail = {
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

export type PendingDraft<T> = {
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

export function getPendingDraftSignature<T>(pending: PendingDraft<T>): string {
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

let volatileBeforeUnloadGuardAttached = false;

export function readKnownIncompatibleCanonical(key: string): string | null {
  return knownIncompatibleCanonicalRaws.get(key) ?? null;
}

export function rememberKnownIncompatibleCanonical(
  key: string,
  raw: string | null,
): void {
  if (raw === null) knownIncompatibleCanonicalRaws.delete(key);
  else knownIncompatibleCanonicalRaws.set(key, raw);
}

export function registerVolatileDraftWriter(key: string, writerId: string): void {
  activeVolatileDraftWriters.add(createVolatileWriterKey(key, writerId));
}

export function unregisterVolatileDraftWriter(key: string, writerId: string): void {
  activeVolatileDraftWriters.delete(createVolatileWriterKey(key, writerId));
}

export function hasVolatileSubmittedClearMarkerForSource(key: string): boolean {
  return volatileSubmittedClearMarkers.has(key);
}

export function shouldClearFormDraftSource(
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

export function clearVolatileFormDraftContinuity(
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

export function rememberVolatileSubmittedClearMarker(
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

export function readVolatileSubmittedClearMarker(
  key: string,
  signature: string,
): SubmittedClearCutoff | null {
  const marker = volatileSubmittedClearMarkers.get(key)?.get(signature);
  return marker
    ? { signature: marker.signature, clearedAt: new Date(marker.clearedAt) }
    : null;
}

export function forgetVolatileSubmittedClearMarker(
  key: string,
  marker: VolatileSubmittedClearMarker,
): void {
  const markers = volatileSubmittedClearMarkers.get(key);
  if (!markers || markers.get(marker.signature) !== marker) return;
  markers.delete(marker.signature);
  if (markers.size === 0) volatileSubmittedClearMarkers.delete(key);
  syncVolatileBeforeUnloadGuard();
}

export function findEffectiveSubmittedClearMarker(
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

export function findEffectiveSubmittedClearMarkerForSnapshot<T>(
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

export function reconcileVolatileSubmittedClearMarkers<T>(
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

export function rememberVolatileDraft<T>(
  key: string,
  writerId: string,
  pending: PendingDraft<T>,
): void {
  const writers = volatileDraftFallbacks.get(key) ?? new Map();
  writers.set(writerId, pending as PendingDraft<unknown>);
  volatileDraftFallbacks.set(key, writers);
  syncVolatileBeforeUnloadGuard();
}

export function readVolatileDraft<T>(
  key: string,
  writerId: string,
): PendingDraft<T> | null {
  return (
    (volatileDraftFallbacks.get(key)?.get(writerId) as
      | PendingDraft<T>
      | undefined) ?? null
  );
}

export function claimLatestOrphanedVolatileDraft<T>(
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

export type ClaimableVolatileDraft<T> = {
  writerId: string;
  pending: PendingDraft<T>;
};

export function listClaimableVolatileDrafts<T>(
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

export function promoteClaimableVolatileDrafts<T>(
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
        assertFormDraftSourceOwnerMayPersist(storage, key);
        storage.setItem(recoveryKey, raw);
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        prepareFormDraftQuotaRetry(
          storage,
          key,
          new Set([...protectedKeys, recoveryKey]),
        );
        assertFormDraftSourceOwnerMayPersist(storage, key);
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

export function drainInactiveVolatileContinuity(
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

export function forgetVolatileDraft(
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

export function forgetSubmittedVolatileDrafts(
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

export function getMaxVolatileDraftQueuedAtBySignature(
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

export function hasUnresolvedVolatileContinuityState(): boolean {
  return hasVolatileSubmittedClearMarkers() ||
    hasOrphanedVolatileDraftFallbacks();
}
