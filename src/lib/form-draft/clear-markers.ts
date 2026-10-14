/** 제출된 snapshot의 causal cutoff와 tombstone 보존. */
import {
  FORM_DRAFT_CLEAR_MARKER_VERSION,
  type FormDraftStorage,
  type FormDraftClearMarker,
  FORM_DRAFT_CLEAR_MARKER_TTL_MS,
  type FormDraftRecoveryStorage,
} from "./contract";
import {
  createFormDraftClearMarkerKey,
  assertFormDraftSourceOwnerMayPersist,
  createFormDraftClearMarkerEntryKey,
  createFormDraftRecoveryPrefix,
  collectFormDraftRecoveryKeys,
  createFormDraftClearMarkerEntryPrefix,
} from "./keys";
import {
  hasFutureEnvelopeVersion,
  isRecord,
  parseFormDraft,
  createFormDraftDataSignature,
} from "./codec";

type FormDraftClearMarkerEnvelope = {
  version: typeof FORM_DRAFT_CLEAR_MARKER_VERSION;
  signature: string;
  clearedAt: number;
};

export type FormDraftClearMarkerInput = {
  signature: string;
  clearedAt: number;
};

/** 여러 제출 표현의 append-only marker를 기록하고 namespace 정리는 한 번만 수행한다. */
export function writeFormDraftClearMarkers(
  storage: FormDraftStorage,
  sourceKey: string,
  inputs: readonly FormDraftClearMarkerInput[],
): FormDraftClearMarker[] {
  if (inputs.length === 0) return [];
  for (const { clearedAt } of inputs) {
    if (!Number.isFinite(clearedAt)) {
      throw new TypeError("Form draft clear marker time must be finite");
    }
  }
  const markers = inputs.map(({ signature, clearedAt }) => {
    const envelope: FormDraftClearMarkerEnvelope = {
      version: FORM_DRAFT_CLEAR_MARKER_VERSION,
      signature,
      clearedAt,
    };
    const raw = JSON.stringify(envelope);
    return {
      version: FORM_DRAFT_CLEAR_MARKER_VERSION,
      signature,
      clearedAt: new Date(clearedAt),
      raw,
    } satisfies FormDraftClearMarker;
  });
  const headKey = createFormDraftClearMarkerKey(sourceKey);
  const newestClearedAt = Math.max(...inputs.map(({ clearedAt }) => clearedAt));
  const promoteLegacyHead = (headRaw: string | null) => {
    const marker = headRaw
      ? parseFormDraftClearMarker(headRaw, newestClearedAt)
      : null;
    if (!marker) return;
    assertFormDraftSourceOwnerMayPersist(storage, sourceKey);
    storage.setItem(
      createFormDraftClearMarkerEntryKey(
        sourceKey,
        marker.signature,
        marker.clearedAt.getTime(),
      ),
      marker.raw,
    );
  };

  promoteLegacyHead(storage.getItem(headKey));
  for (const marker of markers) {
    assertFormDraftSourceOwnerMayPersist(storage, sourceKey);
    storage.setItem(
      createFormDraftClearMarkerEntryKey(
        sourceKey,
        marker.signature,
        marker.clearedAt.getTime(),
      ),
      marker.raw,
    );
  }
  const latestHeadRaw = storage.getItem(headKey);
  promoteLegacyHead(latestHeadRaw);
  if (
    !latestHeadRaw ||
    !hasFutureEnvelopeVersion(latestHeadRaw, FORM_DRAFT_CLEAR_MARKER_VERSION)
  ) {
    assertFormDraftSourceOwnerMayPersist(storage, sourceKey);
    storage.setItem(headKey, markers.at(-1)!.raw);
  }
  pruneFormDraftClearMarkers(storage, sourceKey, newestClearedAt);
  return markers;
}

/** 제출 완료 snapshot을 recovery 보존 기간 동안 식별하는 marker를 기록한다. */
export function writeFormDraftClearMarker(
  storage: FormDraftStorage,
  sourceKey: string,
  signature: string,
  clearedAt = Date.now(),
): FormDraftClearMarker {
  return writeFormDraftClearMarkers(storage, sourceKey, [
    { signature, clearedAt },
  ])[0]!;
}

/** 유효 기간 안의 document-scoped clear marker만 반환한다. */
export function parseFormDraftClearMarker(
  raw: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  const marker = parseCurrentFormDraftClearMarker(raw);
  if (
    !marker ||
    now - marker.clearedAt.getTime() > FORM_DRAFT_CLEAR_MARKER_TTL_MS
  ) {
    return null;
  }
  return marker;
}

export function parseCurrentFormDraftClearMarker(
  raw: string,
): FormDraftClearMarker | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== FORM_DRAFT_CLEAR_MARKER_VERSION ||
      typeof parsed.signature !== "string" ||
      typeof parsed.clearedAt !== "number" ||
      !Number.isFinite(parsed.clearedAt)
    ) {
      return null;
    }

    const clearedAt = new Date(parsed.clearedAt);
    if (!Number.isFinite(clearedAt.getTime())) return null;
    return {
      version: FORM_DRAFT_CLEAR_MARKER_VERSION,
      signature: parsed.signature,
      clearedAt,
      raw,
    };
  } catch {
    return null;
  }
}

export type FormDraftCausalSnapshotIndex = {
  hasUnverifiableSnapshot: boolean;
  earliestSavedAtBySignature: Map<string, number>;
  observedRawByStorageKey?: Map<string, string>;
};

export function indexParsedFormDraftCausalSnapshot(
  index: FormDraftCausalSnapshotIndex,
  signature: string,
  savedAt: number,
): void {
  const previous = index.earliestSavedAtBySignature.get(signature);
  if (previous === undefined || savedAt < previous) {
    index.earliestSavedAtBySignature.set(signature, savedAt);
  }
}

function indexFormDraftCausalSnapshotRaw(
  index: FormDraftCausalSnapshotIndex,
  raw: string,
  maxArtifactRawCodeUnits?: number,
): void {
  if (
    maxArtifactRawCodeUnits !== undefined &&
    raw.length > maxArtifactRawCodeUnits
  ) {
    // proactive 정리의 동기 작업 상한을 넘으면 marker와 무관하다고 추론하지 않는다.
    index.hasUnverifiableSnapshot = true;
    return;
  }
  const stored = parseFormDraft<unknown>(raw);
  if (!stored) {
    // future·손상 envelope는 data/signature/causal timestamp의 무관성을
    // 증명할 수 없다. tombstone 삭제는 저장공간 회수보다 보수적으로 판단한다.
    index.hasUnverifiableSnapshot = true;
    return;
  }

  indexParsedFormDraftCausalSnapshot(
    index,
    createFormDraftDataSignature(stored.data),
    stored.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
  );
}

/**
 * source의 causal snapshot을 한 번만 직렬화해 marker 수와 무관한 lookup index를 만든다.
 * 해석할 수 없는 rolling snapshot은 marker와 무관하다고 증명할 수 없다고 기록한다.
 */
export function createFormDraftCausalSnapshotIndex(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  maxArtifactRawCodeUnits?: number,
): FormDraftCausalSnapshotIndex {
  const causalIndex: FormDraftCausalSnapshotIndex = {
    hasUnverifiableSnapshot: false,
    earliestSavedAtBySignature: new Map(),
  };
  const canonicalRaw = storage.getItem(sourceKey);
  if (canonicalRaw) {
    indexFormDraftCausalSnapshotRaw(
      causalIndex,
      canonicalRaw,
      maxArtifactRawCodeUnits,
    );
  }

  const recoveryPrefix = createFormDraftRecoveryPrefix(sourceKey);
  for (let index = 0; index < storage.length; index += 1) {
    const recoveryKey = storage.key(index);
    if (!recoveryKey?.startsWith(recoveryPrefix)) continue;
    const recoveryRaw = storage.getItem(recoveryKey);
    if (recoveryRaw) {
      indexFormDraftCausalSnapshotRaw(
        causalIndex,
        recoveryRaw,
        maxArtifactRawCodeUnits,
      );
    }
  }
  return causalIndex;
}

function validatePrecomputedFormDraftCausalSnapshotIndex(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  index: FormDraftCausalSnapshotIndex,
): void {
  const observed = index.observedRawByStorageKey;
  if (!observed) return;

  const currentKeys = new Set<string>();
  const canonicalRaw = storage.getItem(sourceKey);
  if (canonicalRaw !== null) currentKeys.add(sourceKey);
  if (canonicalRaw !== (observed.get(sourceKey) ?? null)) {
    index.hasUnverifiableSnapshot = true;
    return;
  }

  for (const storageKey of collectFormDraftRecoveryKeys(storage, sourceKey)) {
    const raw = storage.getItem(storageKey);
    if (raw === null) continue;
    currentKeys.add(storageKey);
    if (raw !== observed.get(storageKey)) {
      index.hasUnverifiableSnapshot = true;
      return;
    }
  }
  for (const storageKey of observed.keys()) {
    if (storageKey !== sourceKey && !currentKeys.has(storageKey)) {
      index.hasUnverifiableSnapshot = true;
      return;
    }
  }
}

export function hasFormDraftSnapshotGuardedByClearMarker(
  causalIndex: FormDraftCausalSnapshotIndex,
  marker: Pick<FormDraftClearMarker, "signature" | "clearedAt">,
): boolean {
  if (causalIndex.hasUnverifiableSnapshot) return true;
  const earliestSavedAt = causalIndex.earliestSavedAtBySignature.get(
    marker.signature,
  );
  return earliestSavedAt !== undefined &&
    earliestSavedAt <= marker.clearedAt.getTime();
}

function readEffectiveFormDraftClearMarker(
  raw: string,
  now: number,
  getCausalIndex: () => FormDraftCausalSnapshotIndex,
): FormDraftClearMarker | null {
  const marker = parseCurrentFormDraftClearMarker(raw);
  if (!marker) return null;
  if (now - marker.clearedAt.getTime() <= FORM_DRAFT_CLEAR_MARKER_TTL_MS) {
    return marker;
  }
  return hasFormDraftSnapshotGuardedByClearMarker(getCausalIndex(), marker)
    ? marker
    : null;
}

function collectFormDraftClearMarkerKeys(
  storage: Pick<FormDraftRecoveryStorage, "length" | "key">,
  sourceKey: string,
): string[] {
  const markerKey = createFormDraftClearMarkerKey(sourceKey);
  const entryPrefix = createFormDraftClearMarkerEntryPrefix(sourceKey);
  const keys = [markerKey];

  for (let index = 0; index < storage.length; index += 1) {
    const candidateKey = storage.key(index);
    if (candidateKey?.startsWith(entryPrefix)) keys.push(candidateKey);
  }
  return keys;
}

/** TTL 안의 제출 tombstone을 signature별 최신 시각으로 반환한다. */
export function readFormDraftClearMarkers(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  now = Date.now(),
): FormDraftClearMarker[] {
  const markersBySignature = new Map<string, FormDraftClearMarker>();
  let causalIndex: FormDraftCausalSnapshotIndex | null = null;
  const getCausalIndex = () => {
    causalIndex ??= createFormDraftCausalSnapshotIndex(storage, sourceKey);
    return causalIndex;
  };
  for (const markerKey of collectFormDraftClearMarkerKeys(storage, sourceKey)) {
    const raw = storage.getItem(markerKey);
    const marker = raw
      ? readEffectiveFormDraftClearMarker(raw, now, getCausalIndex)
      : null;
    if (!marker) continue;

    const previous = markersBySignature.get(marker.signature);
    if (!previous || marker.clearedAt.getTime() > previous.clearedAt.getTime()) {
      markersBySignature.set(marker.signature, marker);
    }
  }

  return [...markersBySignature.values()]
    .sort((left, right) => right.clearedAt.getTime() - left.clearedAt.getTime());
}

/** 유효 기간 안의 가장 최근 document-scoped clear marker를 반환한다. */
export function readFormDraftClearMarker(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  return readFormDraftClearMarkers(storage, sourceKey, now)[0] ?? null;
}

/** 특정 data signature의 최근 제출 tombstone을 반환한다. */
export function findFormDraftClearMarker(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  signature: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  return readFormDraftClearMarkers(storage, sourceKey, now)
    .find((marker) => marker.signature === signature) ?? null;
}

/** 제출 cutoff 이전 canonical snapshot을 해결된 ghost로 판정한다. */
export function findFormDraftClearMarkerForSnapshot<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  raw: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  const stored = parseFormDraft<T>(raw);
  if (!stored) return null;

  const marker = findFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(stored.data),
    now,
  );
  if (!marker) return null;

  const savedAt = stored.savedAt?.getTime();
  return savedAt === undefined || savedAt <= marker.clearedAt.getTime()
    ? marker
    : null;
}

/** 만료·손상·cap 초과 tombstone을 CAS 정리하고 최신 marker 목록을 반환한다. */
export function pruneFormDraftClearMarkerState(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  now = Date.now(),
  precomputedCausalIndex?: FormDraftCausalSnapshotIndex,
): FormDraftClearMarker[] {
  const markerKey = createFormDraftClearMarkerKey(sourceKey);
  let causalIndex: FormDraftCausalSnapshotIndex | null = null;
  let precomputedIndexValidated = false;
  const getCausalIndex = () => {
    if (precomputedCausalIndex && !precomputedIndexValidated) {
      validatePrecomputedFormDraftCausalSnapshotIndex(
        storage,
        sourceKey,
        precomputedCausalIndex,
      );
      precomputedIndexValidated = true;
    }
    causalIndex ??=
      precomputedCausalIndex ??
      createFormDraftCausalSnapshotIndex(storage, sourceKey);
    return causalIndex;
  };
  const validArtifacts: Array<{
    storageKey: string;
    marker: FormDraftClearMarker;
  }> = [];

  for (const storageKey of collectFormDraftClearMarkerKeys(storage, sourceKey)) {
    const observedRaw = storage.getItem(storageKey);
    if (!observedRaw) continue;

    const marker = readEffectiveFormDraftClearMarker(
      observedRaw,
      now,
      getCausalIndex,
    );
    if (!marker) {
      if (hasFutureEnvelopeVersion(observedRaw, FORM_DRAFT_CLEAR_MARKER_VERSION)) continue;
      if (storage.getItem(storageKey) === observedRaw) storage.removeItem(storageKey);
      continue;
    }
    validArtifacts.push({ storageKey, marker });
  }

  const validEntries = validArtifacts.filter(
    ({ storageKey }) => storageKey !== markerKey,
  );
  validEntries.sort(
    (left, right) => right.marker.clearedAt.getTime() - left.marker.clearedAt.getTime(),
  );
  const seenSignatures = new Set<string>();
  const duplicateEntries: typeof validEntries = [];
  for (const entry of validEntries) {
    if (seenSignatures.has(entry.marker.signature)) duplicateEntries.push(entry);
    else seenSignatures.add(entry.marker.signature);
  }

  for (const removable of duplicateEntries) {
    if (storage.getItem(removable.storageKey) === removable.marker.raw) {
      storage.removeItem(removable.storageKey);
    }
  }

  const duplicateKeys = new Set(
    duplicateEntries.map(({ storageKey }) => storageKey),
  );
  const markersBySignature = new Map<string, FormDraftClearMarker>();
  for (const artifact of validArtifacts) {
    if (duplicateKeys.has(artifact.storageKey)) continue;
    if (storage.getItem(artifact.storageKey) !== artifact.marker.raw) continue;
    const previous = markersBySignature.get(artifact.marker.signature);
    if (
      !previous ||
      artifact.marker.clearedAt.getTime() > previous.clearedAt.getTime()
    ) {
      markersBySignature.set(artifact.marker.signature, artifact.marker);
    }
  }
  return [...markersBySignature.values()].sort(
    (left, right) => right.clearedAt.getTime() - left.clearedAt.getTime(),
  );
}

export function pruneFormDraftClearMarkers(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  now = Date.now(),
): FormDraftClearMarker[] {
  return pruneFormDraftClearMarkerState(storage, sourceKey, now);
}

/** 단일 marker API 호환 wrapper. */
export function pruneFormDraftClearMarker(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  return pruneFormDraftClearMarkers(storage, sourceKey, now)[0] ?? null;
}

export function removeFormDraftClearMarker(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
): void {
  for (const markerKey of collectFormDraftClearMarkerKeys(storage, sourceKey)) {
    storage.removeItem(markerKey);
  }
}
