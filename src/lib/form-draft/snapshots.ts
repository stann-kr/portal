/** shadow-first 저장과 관측한 snapshot의 조건부 삭제. */
import {
  type FormDraftRecoveryStorage,
  type RemoveFormDraftSnapshotsOptions,
  type FormDraftStorage,
  type PersistFormDraftRawSnapshotOptions,
  type PersistFormDraftSnapshotResult,
  type PersistFormDraftSnapshotOptions,
} from "./contract";
import {
  parseFormDraft,
  createFormDraftDataSignature,
  serializeFormDraft,
} from "./codec";
import {
  isImmutableFormDraftRecoveryKey,
  collectFormDraftRecoveryKeys,
  isFormDraftRecoveryKey,
  assertImmutableFormDraftRecoveryRaw,
  assertFormDraftSourceOwnerMayPersist,
} from "./keys";

/** signature·cutoff가 일치하는 canonical snapshot만 CAS 삭제한다. */
export function removeFormDraftCanonicalSnapshotBySignature<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  signature: string,
  options: RemoveFormDraftSnapshotsOptions = {},
): boolean {
  const cutoff = options.savedAtOrBefore;
  if (cutoff !== undefined && !Number.isFinite(cutoff)) {
    throw new TypeError("Form draft snapshot cutoff must be finite");
  }

  const observedRaw = storage.getItem(sourceKey);
  const stored = observedRaw ? parseFormDraft<T>(observedRaw) : null;
  if (!observedRaw || !stored) return false;
  if (createFormDraftDataSignature(stored.data) !== signature) return false;

  const savedAt = stored.savedAt?.getTime();
  if (cutoff !== undefined && savedAt !== undefined && savedAt > cutoff) {
    return false;
  }
  if (storage.getItem(sourceKey) !== observedRaw) return false;
  storage.removeItem(sourceKey);
  return true;
}

type FormDraftSnapshotClearCandidate = {
  storageKey: string;
  raw: string;
  signature: string;
  savedAt: number;
  canonical: boolean;
};

export type FormDraftSnapshotClearPlan = {
  sourceKey: string;
  cutoffs: ReadonlyMap<string, number>;
  candidates: readonly FormDraftSnapshotClearCandidate[];
};

/**
 * signature별 인과 cutoff 계산과 삭제 후보 파싱을 한 namespace snapshot에서 함께 수행한다.
 * 실제 삭제는 marker 기록 뒤 applyFormDraftSnapshotClearPlan으로 CAS 확정한다.
 */
export function prepareFormDraftSnapshotClearPlan(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  requestedCutoffs: ReadonlyMap<string, number>,
): FormDraftSnapshotClearPlan {
  const cutoffs = new Map<string, number>();
  for (const [signature, cutoff] of requestedCutoffs) {
    if (!Number.isFinite(cutoff)) {
      throw new TypeError("Form draft snapshot cutoff must be finite");
    }
    cutoffs.set(signature, cutoff);
  }
  const candidates: FormDraftSnapshotClearCandidate[] = [];
  const observeRaw = (
    storageKey: string,
    raw: string | null,
    canonical: boolean,
  ) => {
    const stored = raw ? parseFormDraft<unknown>(raw) : null;
    if (!raw || !stored) return;
    const signature = createFormDraftDataSignature(stored.data);
    const previous = cutoffs.get(signature);
    if (previous === undefined) return;
    const savedAt = stored.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (savedAt > previous) cutoffs.set(signature, savedAt);
    if (
      canonical ||
      isImmutableFormDraftRecoveryKey(sourceKey, storageKey)
    ) {
      candidates.push({ storageKey, raw, signature, savedAt, canonical });
    }
  };

  observeRaw(sourceKey, storage.getItem(sourceKey), true);
  for (const storageKey of collectFormDraftRecoveryKeys(storage, sourceKey)) {
    observeRaw(storageKey, storage.getItem(storageKey), false);
  }
  return { sourceKey, cutoffs, candidates };
}

export function applyFormDraftSnapshotClearPlan(
  storage: Pick<FormDraftRecoveryStorage, "getItem" | "removeItem">,
  plan: FormDraftSnapshotClearPlan,
  cutoffs: ReadonlyMap<string, number> = plan.cutoffs,
): { canonicalRemoved: boolean; removedRecoveryKeys: string[] } {
  let canonicalRemoved = false;
  const removedRecoveryKeys: string[] = [];
  for (const candidate of plan.candidates) {
    const cutoff = cutoffs.get(candidate.signature);
    if (cutoff === undefined || candidate.savedAt > cutoff) continue;
    if (storage.getItem(candidate.storageKey) !== candidate.raw) continue;
    storage.removeItem(candidate.storageKey);
    if (candidate.canonical) canonicalRemoved = true;
    else removedRecoveryKeys.push(candidate.storageKey);
  }
  return { canonicalRemoved, removedRecoveryKeys };
}

/**
 * signature별 cutoff 이전의 immutable recovery를 namespace 한 번의 열거로 CAS 삭제한다.
 * rolling legacy mutable recovery는 물리 보존하고 tombstone으로만 숨긴다.
 */
export function removeFormDraftSnapshotsBySignatures(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  cutoffs: ReadonlyMap<string, number>,
): string[] {
  for (const cutoff of cutoffs.values()) {
    if (!Number.isFinite(cutoff)) {
      throw new TypeError("Form draft snapshot cutoff must be finite");
    }
  }

  const removedKeys: string[] = [];
  for (const storageKey of collectFormDraftRecoveryKeys(storage, sourceKey)) {
    if (!isImmutableFormDraftRecoveryKey(sourceKey, storageKey)) continue;
    const observedRaw = storage.getItem(storageKey);
    const observed = observedRaw ? parseFormDraft<unknown>(observedRaw) : null;
    if (!observedRaw || !observed) continue;
    const cutoff = cutoffs.get(createFormDraftDataSignature(observed.data));
    if (cutoff === undefined) continue;
    const savedAt = observed.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (savedAt > cutoff) continue;
    if (storage.getItem(storageKey) !== observedRaw) continue;
    storage.removeItem(storageKey);
    removedKeys.push(storageKey);
  }
  return removedKeys;
}

/**
 * 제출·명시 폐기된 data와 같은 recovery mirror만 문서 namespace에서 제거한다.
 * 삭제 직전에 raw를 다시 비교해 그 사이 다른 data로 바뀐 recovery는 보존한다.
 */
export function removeFormDraftSnapshotsBySignature(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  signature: string,
  options: RemoveFormDraftSnapshotsOptions = {},
): string[] {
  const cutoff = options.savedAtOrBefore;
  if (cutoff !== undefined && !Number.isFinite(cutoff)) {
    throw new TypeError("Form draft snapshot cutoff must be finite");
  }
  return removeFormDraftSnapshotsBySignatures(
    storage,
    sourceKey,
    new Map([[signature, cutoff ?? Number.MAX_VALUE]]),
  );
}

/**
 * 이미 직렬화한 snapshot을 own shadow에 먼저 쓴 뒤 optimistic canonical write를 시도한다.
 * canonical compare/write 사이에 다른 writer가 개입해도 shadow는 유지된다.
 */
export function persistFormDraftRawSnapshot(
  storage: FormDraftStorage,
  options: PersistFormDraftRawSnapshotOptions,
): PersistFormDraftSnapshotResult {
  const { sourceKey, recoveryKey, raw, expectedRaw } = options;
  if (!isFormDraftRecoveryKey(sourceKey, recoveryKey)) {
    throw new Error("Form draft recovery key does not belong to the source document");
  }
  assertImmutableFormDraftRecoveryRaw(sourceKey, recoveryKey, raw);

  const existingRecoveryRaw = storage.getItem(recoveryKey);
  if (existingRecoveryRaw !== null && existingRecoveryRaw !== raw) {
    throw new Error("Immutable form draft recovery key cannot be overwritten");
  }

  assertFormDraftSourceOwnerMayPersist(storage, sourceKey);
  storage.setItem(recoveryKey, raw);

  const currentRaw = storage.getItem(sourceKey);
  if (hasFormDraftStorageConflict(expectedRaw, currentRaw)) {
    return { status: "conflict", raw, currentRaw, recoveryKey };
  }

  assertFormDraftSourceOwnerMayPersist(storage, sourceKey);
  storage.setItem(sourceKey, raw);
  const persistedCanonicalRaw = storage.getItem(sourceKey);
  return {
    status: persistedCanonicalRaw === raw ? "saved" : "conflict",
    raw,
    currentRaw: persistedCanonicalRaw,
    recoveryKey,
  };
}

/** data를 versioned envelope로 만든 뒤 shadow-first로 저장한다. */
export function persistFormDraftSnapshot<T>(
  storage: FormDraftStorage,
  options: PersistFormDraftSnapshotOptions<T>,
): PersistFormDraftSnapshotResult {
  const raw = serializeFormDraft(options.data, options.savedAt);
  return persistFormDraftRawSnapshot(storage, { ...options, raw });
}

/** 마지막으로 관찰한 값과 현재 storage 값이 다르면 다른 탭의 변경으로 본다. */
export function hasFormDraftStorageConflict(
  expectedRaw: string | null,
  currentRaw: string | null,
): boolean {
  return expectedRaw !== currentRaw;
}
