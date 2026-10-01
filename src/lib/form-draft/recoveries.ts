/** 복구본 조회와 TTL·중복·보존 상한 정책. */
import {
  type FormDraftRecovery,
  FORM_DRAFT_RECOVERY_TTL_MS,
  type FormDraftRecoveryStorage,
  type FormDraftRecoveryRetentionOptions,
  FORM_DRAFT_MAX_DIVERGENT_RECOVERIES,
  FORM_DRAFT_RECOVERY_RECENT_MS,
  type FormDraftClearMarker,
  type FormDraftRecoveryCompactionResult,
} from "./contract";
import {
  parseFormDraft,
  createFormDraftDataSignature,
  hasFutureFormDraftVersion,
} from "./codec";
import {
  isFormDraftRecoveryKey,
  collectFormDraftRecoveryKeys,
  isImmutableFormDraftRecoveryKey,
} from "./keys";
import {
  type FormDraftCausalSnapshotIndex,
  indexParsedFormDraftCausalSnapshot,
  pruneFormDraftClearMarkerState,
} from "./clear-markers";

function parseFormDraftRecoveryRaw<T>(
  storageKey: string,
  raw: string,
  now: number,
): FormDraftRecovery<T> | null {
  const stored = parseFormDraft<T>(raw);
  const savedAt = stored?.savedAt;
  const savedAtMs = savedAt?.getTime();
  const retainedAt = stored?.retainedAt ?? savedAt;
  const retainedAtMs = retainedAt?.getTime();
  if (
    !stored ||
    stored.legacy ||
    !savedAt ||
    savedAtMs === undefined ||
    !Number.isFinite(savedAtMs) ||
    !retainedAt ||
    retainedAtMs === undefined ||
    !Number.isFinite(retainedAtMs) ||
    now - retainedAtMs > FORM_DRAFT_RECOVERY_TTL_MS
  ) {
    return null;
  }

  return {
    storageKey,
    data: stored.data,
    savedAt,
    retainedAt,
    raw,
    signature: createFormDraftDataSignature(stored.data),
  };
}

/** namespace와 TTL을 검증해 선택한 복구본을 읽되 storage에서는 삭제하지 않는다. */
export function readFormDraftRecovery<T>(
  storage: Pick<FormDraftRecoveryStorage, "getItem">,
  sourceKey: string,
  storageKey: string,
  now = Date.now(),
): FormDraftRecovery<T> | null {
  if (!isFormDraftRecoveryKey(sourceKey, storageKey)) return null;

  const raw = storage.getItem(storageKey);
  return raw ? parseFormDraftRecoveryRaw<T>(storageKey, raw, now) : null;
}

type ResolvedFormDraftRecoveryRetention = {
  now: number;
  maxDivergent: number;
  recentMs: number;
  protectedKeys: Set<string>;
};

type RetainedFormDraftRecovery<T> = FormDraftRecovery<T> & {
  protected: boolean;
  recent: boolean;
};

function resolveFormDraftRecoveryRetention(
  optionsOrNow: number | FormDraftRecoveryRetentionOptions | undefined,
): ResolvedFormDraftRecoveryRetention {
  const options = typeof optionsOrNow === "number" ? { now: optionsOrNow } : optionsOrNow;
  const now = options?.now ?? Date.now();
  const requestedMax = options?.maxDivergent ?? FORM_DRAFT_MAX_DIVERGENT_RECOVERIES;
  const requestedRecentMs = options?.recentMs ?? FORM_DRAFT_RECOVERY_RECENT_MS;
  return {
    now,
    maxDivergent: Number.isFinite(requestedMax)
      ? Math.max(0, Math.floor(requestedMax))
      : FORM_DRAFT_MAX_DIVERGENT_RECOVERIES,
    recentMs: Number.isFinite(requestedRecentMs)
      ? Math.max(0, requestedRecentMs)
      : FORM_DRAFT_RECOVERY_RECENT_MS,
    protectedKeys: new Set(options?.protectedKeys ?? []),
  };
}

function removeObservedFormDraftValue(
  storage: Pick<FormDraftRecoveryStorage, "getItem" | "removeItem">,
  storageKey: string,
  observedRaw: string,
): boolean {
  if (storage.getItem(storageKey) !== observedRaw) return false;
  storage.removeItem(storageKey);
  return true;
}

function collectValidFormDraftRecoveries<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  retention: ResolvedFormDraftRecoveryRetention,
  invalidOrExpiredKeys?: string[],
  causalIndex?: FormDraftCausalSnapshotIndex,
): RetainedFormDraftRecovery<T>[] {
  const valid: RetainedFormDraftRecovery<T>[] = [];
  for (const storageKey of collectFormDraftRecoveryKeys(storage, sourceKey)) {
    const observedRaw = storage.getItem(storageKey);
    const recovery = observedRaw
      ? parseFormDraftRecoveryRaw<T>(storageKey, observedRaw, retention.now)
      : null;
    if (!observedRaw || !recovery) {
      if (observedRaw && hasFutureFormDraftVersion(observedRaw)) {
        if (causalIndex) {
          causalIndex.hasUnverifiableSnapshot = true;
          causalIndex.observedRawByStorageKey?.set(storageKey, observedRaw);
        }
        continue;
      }
      let removed = false;
      if (
        observedRaw &&
        isImmutableFormDraftRecoveryKey(sourceKey, storageKey) &&
        removeObservedFormDraftValue(storage, storageKey, observedRaw)
      ) {
        invalidOrExpiredKeys?.push(storageKey);
        removed = true;
      }
      if (causalIndex && observedRaw && !removed) {
        const currentRaw = storage.getItem(storageKey);
        if (currentRaw !== null) {
          causalIndex.hasUnverifiableSnapshot = true;
          causalIndex.observedRawByStorageKey?.set(storageKey, currentRaw);
        }
      }
      continue;
    }

    if (causalIndex) {
      causalIndex.observedRawByStorageKey?.set(storageKey, recovery.raw);
      indexParsedFormDraftCausalSnapshot(
        causalIndex,
        recovery.signature,
        recovery.savedAt.getTime(),
      );
    }
    valid.push({
      ...recovery,
      protected: retention.protectedKeys.has(storageKey),
      recent: retention.now - recovery.retainedAt.getTime() <= retention.recentMs,
    });
  }

  valid.sort((left, right) => right.retainedAt.getTime() - left.retainedAt.getTime());
  return valid;
}

type FormDraftCanonicalMetadata = {
  signature: string;
  savedAt: Date | null;
};

function getFormDraftCanonicalMetadata<T>(
  raw: string | null,
  causalIndex?: FormDraftCausalSnapshotIndex,
  sourceKey?: string,
): FormDraftCanonicalMetadata | null {
  const stored = raw ? parseFormDraft<T>(raw) : null;
  if (causalIndex && sourceKey && raw) {
    causalIndex.observedRawByStorageKey?.set(sourceKey, raw);
    if (stored) {
      indexParsedFormDraftCausalSnapshot(
        causalIndex,
        createFormDraftDataSignature(stored.data),
        stored.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
      );
    } else {
      causalIndex.hasUnverifiableSnapshot = true;
    }
  }
  if (!stored) return null;
  return {
    signature: createFormDraftDataSignature(stored.data),
    savedAt: stored.savedAt,
  };
}

function getLiveFormDraftCanonicalSignature(
  canonical: FormDraftCanonicalMetadata | null,
  markersBySignature: ReadonlyMap<string, FormDraftClearMarker>,
): string | null {
  if (!canonical) return null;
  const marker = markersBySignature.get(canonical.signature);
  if (!marker) return canonical.signature;
  return canonical.savedAt && canonical.savedAt.getTime() > marker.clearedAt.getTime()
    ? canonical.signature
    : null;
}

/**
 * quota retry 전에 TTL/손상, 오래된 물리 중복, 오래된 cap 초과본 순으로 안전하게 정리한다.
 * 최근 1시간 및 protected key는 cap·중복 정리로 삭제하지 않는다.
 */
type FormDraftRecoveryCompactionState<T> = {
  result: FormDraftRecoveryCompactionResult;
  liveRecoveries: RetainedFormDraftRecovery<T>[];
  markersBySignature: Map<string, FormDraftClearMarker>;
  canonicalSignature: string | null;
};

function compactFormDraftRecoveryState<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  optionsOrNow?: number | FormDraftRecoveryRetentionOptions,
): FormDraftRecoveryCompactionState<T> {
  const retention = resolveFormDraftRecoveryRetention(optionsOrNow);
  const result: FormDraftRecoveryCompactionResult = {
    removedKeys: [],
    invalidOrExpiredKeys: [],
    duplicateKeys: [],
    excessKeys: [],
    resolvedMarkerKeys: [],
  };
  const causalIndex: FormDraftCausalSnapshotIndex = {
    hasUnverifiableSnapshot: false,
    earliestSavedAtBySignature: new Map(),
    observedRawByStorageKey: new Map(),
  };
  const valid = collectValidFormDraftRecoveries<T>(
    storage,
    sourceKey,
    retention,
    result.invalidOrExpiredKeys,
    causalIndex,
  );
  const canonical = getFormDraftCanonicalMetadata<T>(
    storage.getItem(sourceKey),
    causalIndex,
    sourceKey,
  );
  const markers = pruneFormDraftClearMarkerState(
    storage,
    sourceKey,
    retention.now,
    causalIndex,
  );
  const markersBySignature = new Map(
    markers.map((marker) => [marker.signature, marker] as const),
  );

  const recordRemoval = (
    recovery: RetainedFormDraftRecovery<T>,
    bucket: string[],
  ) => {
    if (recovery.protected || recovery.recent) return false;
    if (!isImmutableFormDraftRecoveryKey(sourceKey, recovery.storageKey)) return false;
    if (!removeObservedFormDraftValue(storage, recovery.storageKey, recovery.raw)) return false;
    bucket.push(recovery.storageKey);
    return true;
  };

  const groups = new Map<string, RetainedFormDraftRecovery<T>[]>();
  for (const recovery of valid) {
    const group = groups.get(recovery.signature) ?? [];
    group.push(recovery);
    groups.set(recovery.signature, group);
  }

  // 같은 data는 causal savedAt이 가장 최신인 snapshot을 대표로 삼는다.
  // 이후 marker가 생겨도 대표만 stale이고 삭제본만 live인 역전이 생기지 않는다.
  for (const group of groups.values()) {
    const representative = group.reduce((latest, recovery) => {
      const savedAtDelta = recovery.savedAt.getTime() - latest.savedAt.getTime();
      if (savedAtDelta > 0) return recovery;
      if (savedAtDelta < 0) return latest;
      const retainedAtDelta =
        recovery.retainedAt.getTime() - latest.retainedAt.getTime();
      if (retainedAtDelta > 0) return recovery;
      if (retainedAtDelta < 0) return latest;
      return recovery.storageKey > latest.storageKey ? recovery : latest;
    });
    for (const duplicate of group) {
      if (duplicate !== representative) recordRemoval(duplicate, result.duplicateKeys);
    }
  }

  // canonical과 recovery는 서로 다른 key라 교체와 삭제를 하나의 CAS로 묶을 수 없다.
  // 같은 내용의 recovery도 후속 marker 뒤에는 유효본이 될 수 있어 물리 보존한다.
  const canonicalSignature = getLiveFormDraftCanonicalSignature(
    canonical,
    markersBySignature,
  );

  for (const marker of markers) {
    const resolved = groups.get(marker.signature) ?? [];
    for (const recovery of resolved) {
      if (recovery.savedAt.getTime() <= marker.clearedAt.getTime()) {
        recordRemoval(recovery, result.resolvedMarkerKeys);
      }
    }
  }

  const liveGroups = [...groups.entries()].flatMap(([signature, group]) => {
    const live = group.filter(
      (recovery) => storage.getItem(recovery.storageKey) === recovery.raw,
    );
    return live.length > 0 ? [{ signature, recoveries: live }] : [];
  });
  const divergentGroups = liveGroups
    .flatMap(({ signature, recoveries }) => {
      if (signature === canonicalSignature) return [];
      const marker = markersBySignature.get(signature);
      const visibleRecoveries = marker
        ? recoveries.filter(
            (recovery) => recovery.savedAt.getTime() > marker.clearedAt.getTime(),
          )
        : recoveries;
      return visibleRecoveries.length > 0
        ? [{
            signature,
            recoveries: visibleRecoveries,
            liveRecoveryCount: recoveries.length,
          }]
        : [];
    })
    .sort(
      (left, right) =>
        right.recoveries[0]!.retainedAt.getTime() -
        left.recoveries[0]!.retainedAt.getTime(),
    );

  for (const group of divergentGroups.slice(retention.maxDivergent)) {
    // recent/protected/mutable duplicate가 남은 group에서 causal 최신 대표만
    // 지우면 후속 marker가 남은 과거본만 숨길 수 있으므로 group 전체를 보존한다.
    if (group.liveRecoveryCount !== 1) continue;
    recordRemoval(group.recoveries[0]!, result.excessKeys);
  }

  result.removedKeys = [
    ...result.invalidOrExpiredKeys,
    ...result.duplicateKeys,
    ...result.resolvedMarkerKeys,
    ...result.excessKeys,
  ];
  const liveRecoveries = valid.filter(
    (recovery) => storage.getItem(recovery.storageKey) === recovery.raw,
  );
  return {
    result,
    liveRecoveries,
    markersBySignature,
    canonicalSignature,
  };
}

/** quota retry용 compaction 결과만 반환한다. */
export function compactFormDraftRecoveries<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  optionsOrNow?: number | FormDraftRecoveryRetentionOptions,
): FormDraftRecoveryCompactionResult {
  return compactFormDraftRecoveryState<T>(
    storage,
    sourceKey,
    optionsOrNow,
  ).result;
}

/**
 * recovery를 안전하게 compact하고 canonical/clear marker와 다른 unique data를 최신순으로 반환한다.
 * cap 밖이라도 recent/protected recovery는 목록과 storage에 유지한다.
 */
export function pruneFormDraftRecoveries<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  optionsOrNow?: number | FormDraftRecoveryRetentionOptions,
): FormDraftRecovery<T>[] {
  const {
    liveRecoveries: valid,
    markersBySignature,
    canonicalSignature,
  } = compactFormDraftRecoveryState<T>(
    storage,
    sourceKey,
    optionsOrNow,
  );
  const visibleBySignature = new Map<string, RetainedFormDraftRecovery<T>>();
  for (const recovery of valid) {
      const marker = markersBySignature.get(recovery.signature);
      if (
        marker &&
        recovery.savedAt.getTime() <= marker.clearedAt.getTime()
      ) {
        continue;
      }
      if (canonicalSignature === recovery.signature) {
        continue;
      }

      const selected = visibleBySignature.get(recovery.signature);
      if (
        !selected ||
        recovery.savedAt.getTime() > selected.savedAt.getTime() ||
        (recovery.savedAt.getTime() === selected.savedAt.getTime() &&
          recovery.retainedAt.getTime() > selected.retainedAt.getTime())
      ) {
        visibleBySignature.set(recovery.signature, recovery);
      }
  }

  return [...visibleBySignature.values()]
    .sort((left, right) => right.retainedAt.getTime() - left.retainedAt.getTime())
    .map((recovery) => ({
      storageKey: recovery.storageKey,
      data: recovery.data,
      savedAt: recovery.savedAt,
      retainedAt: recovery.retainedAt,
      raw: recovery.raw,
      signature: recovery.signature,
    }));
}
