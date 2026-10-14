/** 비활성 문서의 만료가 입증된 artifact만 정리한다. */
import {
  isRecord,
} from "./codec";
import {
  FORM_DRAFT_STORAGE_VERSION,
  FORM_DRAFT_RECOVERY_TTL_MS,
  type FormDraftClearMarker,
  FORM_DRAFT_CLEAR_MARKER_TTL_MS,
  type FormDraftRecoveryStorage,
  type SweepExpiredFormDraftArtifactsOptions,
  type SweepExpiredFormDraftArtifactsResult,
} from "./contract";
import {
  parseCurrentFormDraftClearMarker,
  type FormDraftCausalSnapshotIndex,
  createFormDraftCausalSnapshotIndex,
  hasFormDraftSnapshotGuardedByClearMarker,
} from "./clear-markers";
import {
  readFormDraftRecoveryArtifactSourceKey,
  isImmutableFormDraftRecoveryKey,
  hasMatchingImmutableFormDraftRecoveryRaw,
  readFormDraftClearMarkerArtifact,
  createFormDraftClearMarkerEntryKey,
} from "./keys";

function parseExpiredCurrentFormDraftRecovery(
  raw: string,
  now: number,
): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== FORM_DRAFT_STORAGE_VERSION ||
      typeof parsed.savedAt !== "number" ||
      !Number.isFinite(parsed.savedAt) ||
      ("retainedAt" in parsed &&
        (typeof parsed.retainedAt !== "number" ||
          !Number.isFinite(parsed.retainedAt))) ||
      !("data" in parsed)
    ) {
      return false;
    }

    const retainedAt = typeof parsed.retainedAt === "number"
      ? parsed.retainedAt
      : parsed.savedAt;
    return now - retainedAt > FORM_DRAFT_RECOVERY_TTL_MS;
  } catch {
    return false;
  }
}

function parseExpiredCurrentFormDraftClearMarker(
  raw: string,
  now: number,
): FormDraftClearMarker | null {
  const marker = parseCurrentFormDraftClearMarker(raw);
  if (
    !marker ||
    now - marker.clearedAt.getTime() <= FORM_DRAFT_CLEAR_MARKER_TTL_MS
  ) {
    return null;
  }
  return marker;
}

/**
 * 현재 열려 있지 않은 문서 namespace에서 TTL 초과가 입증된 불변 artifact만 정리한다.
 * rolling client 안전을 위해 canonical, future/malformed envelope, legacy mutable recovery는
 * 전역 sweep에서 해석하거나 삭제하지 않는다.
 */
export function sweepExpiredFormDraftArtifacts(
  storage: FormDraftRecoveryStorage,
  options: SweepExpiredFormDraftArtifactsOptions = {},
): SweepExpiredFormDraftArtifactsResult {
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) {
    throw new TypeError("Form draft artifact sweep time must be finite");
  }
  const maxArtifactRawCodeUnits = options.maxArtifactRawCodeUnits;
  if (
    maxArtifactRawCodeUnits !== undefined &&
    (!Number.isSafeInteger(maxArtifactRawCodeUnits) ||
      maxArtifactRawCodeUnits < 0)
  ) {
    throw new TypeError("Form draft artifact raw limit must be a non-negative safe integer");
  }

  const protectedSourceKeys = new Set(options.protectedSourceKeys ?? []);
  const protectedRecoveryKeys = new Set(options.protectedRecoveryKeys ?? []);
  const candidateKeys: string[] = options.candidateKeys === undefined
    ? []
    : [...options.candidateKeys];
  if (options.candidateKeys === undefined) {
    for (let index = 0; index < storage.length; index += 1) {
      const candidateKey = storage.key(index);
      if (candidateKey !== null) candidateKeys.push(candidateKey);
    }
    candidateKeys.sort();
  }

  const result: SweepExpiredFormDraftArtifactsResult = {
    removedRecoveryKeys: [],
    removedClearMarkerKeys: [],
  };
  const causalIndexes = new Map<string, FormDraftCausalSnapshotIndex>();

  for (const storageKey of candidateKeys) {
    const recoverySourceKey = readFormDraftRecoveryArtifactSourceKey(storageKey);
    if (recoverySourceKey !== null) {
      if (
        protectedSourceKeys.has(recoverySourceKey) ||
        protectedRecoveryKeys.has(storageKey) ||
        !isImmutableFormDraftRecoveryKey(recoverySourceKey, storageKey)
      ) {
        continue;
      }

      const observedRaw = storage.getItem(storageKey);
      if (
        !observedRaw ||
        (maxArtifactRawCodeUnits !== undefined &&
          observedRaw.length > maxArtifactRawCodeUnits) ||
        !parseExpiredCurrentFormDraftRecovery(observedRaw, now) ||
        !hasMatchingImmutableFormDraftRecoveryRaw(
          recoverySourceKey,
          storageKey,
          observedRaw,
        ) ||
        storage.getItem(storageKey) !== observedRaw
      ) {
        continue;
      }
      storage.removeItem(storageKey);
      result.removedRecoveryKeys.push(storageKey);
      continue;
    }

    const markerArtifact = readFormDraftClearMarkerArtifact(storageKey);
    if (
      markerArtifact === null ||
      options.includeClearMarkers === false ||
      protectedSourceKeys.has(markerArtifact.sourceKey)
    ) {
      continue;
    }

    const observedRaw = storage.getItem(storageKey);
    if (
      observedRaw &&
      maxArtifactRawCodeUnits !== undefined &&
      observedRaw.length > maxArtifactRawCodeUnits
    ) {
      continue;
    }
    const expiredMarker = observedRaw
      ? parseExpiredCurrentFormDraftClearMarker(observedRaw, now)
      : null;
    if (!observedRaw || !expiredMarker) continue;
    const causalIndex = causalIndexes.get(markerArtifact.sourceKey) ??
      createFormDraftCausalSnapshotIndex(
        storage,
        markerArtifact.sourceKey,
        maxArtifactRawCodeUnits,
      );
    causalIndexes.set(markerArtifact.sourceKey, causalIndex);
    if (
      hasFormDraftSnapshotGuardedByClearMarker(causalIndex, expiredMarker)
    ) {
      continue;
    }
    if (
      markerArtifact.kind === "entry" &&
      createFormDraftClearMarkerEntryKey(
        markerArtifact.sourceKey,
        expiredMarker.signature,
        expiredMarker.clearedAt.getTime(),
      ) !== storageKey
    ) {
      continue;
    }
    if (storage.getItem(storageKey) !== observedRaw) continue;
    storage.removeItem(storageKey);
    result.removedClearMarkerKeys.push(storageKey);
  }

  return result;
}
