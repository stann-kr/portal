import {
  createFormDraftDataSignature,
  createFormDraftRecoveryPreview,
  listDocumentDraftArtifacts,
  parseFormDraft,
  readFormDraftClearMarkers,
  type DocumentDraftArtifact,
  type DocumentDraftKind,
  type FormDraftRecoveryPreview,
  type FormDraftStorage,
} from "@/lib/form-draft";
import {
  readDocumentServerDraftDeviceStorageOwnerId,
} from "@/lib/document-server-draft-queue";

export type LocalDocumentDraftSummary = {
  sourceKey: string;
  kind: DocumentDraftKind;
  contextId: string;
  savedAt: Date | null;
  preview: FormDraftRecoveryPreview;
  artifactCount: number;
  hasIncompatibleArtifact: boolean;
};

export type LocalDocumentDraftListResult = {
  drafts: LocalDocumentDraftSummary[];
  failedKeys: string[];
  enumerationFailed: boolean;
};

export type LocalDocumentDraftCleanupResult = {
  sourceKeys: string[];
  removedKeys: string[];
  failedKeys: string[];
  enumerationFailed: boolean;
};

type LocalDocumentDraftCandidate = {
  artifact: DocumentDraftArtifact;
  parsed: ReturnType<typeof parseFormDraft<unknown>>;
  signature: string | null;
};

function readLocalDocumentDraftCandidates(
  storage: FormDraftStorage,
  artifacts: readonly DocumentDraftArtifact[],
  failedKeys: string[],
): LocalDocumentDraftCandidate[] {
  const candidates: LocalDocumentDraftCandidate[] = [];
  for (const artifact of artifacts) {
    if (
      artifact.artifactKind === "clear-marker" ||
      artifact.artifactKind === "server-queue"
    ) {
      continue;
    }
    try {
      const raw = storage.getItem(artifact.storageKey);
      if (raw === null) continue;
      const parsed = parseFormDraft<unknown>(raw);
      candidates.push({
        artifact,
        parsed,
        signature: parsed ? createFormDraftDataSignature(parsed.data) : null,
      });
    } catch {
      failedKeys.push(artifact.storageKey);
    }
  }
  return candidates;
}

/** 현재 계정의 canonical·recovery를 문서 namespace별로 묶어 관리 UI에 제공한다. */
export function listLocalDocumentDrafts(
  storage: FormDraftStorage,
  ownerId: string,
): LocalDocumentDraftListResult {
  let artifacts: DocumentDraftArtifact[];
  try {
    artifacts = listDocumentDraftArtifacts(storage).filter(
      (artifact) => artifact.ownerId === ownerId,
    );
  } catch {
    return { drafts: [], failedKeys: [], enumerationFailed: true };
  }

  const artifactsBySource = new Map<string, DocumentDraftArtifact[]>();
  for (const artifact of artifacts) {
    const bucket = artifactsBySource.get(artifact.sourceKey) ?? [];
    bucket.push(artifact);
    artifactsBySource.set(artifact.sourceKey, bucket);
  }

  const failedKeys: string[] = [];
  const drafts: LocalDocumentDraftSummary[] = [];
  for (const [sourceKey, sourceArtifacts] of artifactsBySource) {
    const candidates = readLocalDocumentDraftCandidates(
      storage,
      sourceArtifacts,
      failedKeys,
    );
    if (candidates.length === 0) continue;

    let markerCutoffs = new Map<string, number>();
    try {
      for (const marker of readFormDraftClearMarkers(storage, sourceKey)) {
        const previous = markerCutoffs.get(marker.signature);
        const clearedAt = marker.clearedAt.getTime();
        if (previous === undefined || clearedAt > previous) {
          markerCutoffs.set(marker.signature, clearedAt);
        }
      }
    } catch {
      markerCutoffs = new Map();
      failedKeys.push(sourceKey);
    }
    const validCandidates = candidates.filter(
      (candidate): candidate is LocalDocumentDraftCandidate & {
        parsed: NonNullable<LocalDocumentDraftCandidate["parsed"]>;
        signature: string;
      } => {
        if (candidate.parsed === null || candidate.signature === null) return false;
        const markerCutoff = markerCutoffs.get(candidate.signature);
        if (markerCutoff === undefined) return true;
        const savedAt = candidate.parsed.savedAt?.getTime();
        return savedAt !== undefined && savedAt > markerCutoff;
      },
    );
    const incompatibleCandidates = candidates.filter(
      ({ parsed }) => parsed === null,
    );
    if (validCandidates.length === 0 && incompatibleCandidates.length === 0) {
      continue;
    }
    const latest = validCandidates.reduce<
      (typeof validCandidates)[number] | null
    >((selected, candidate) => {
      if (!selected) return candidate;
      const selectedAt = selected.parsed.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      const candidateAt = candidate.parsed.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      if (candidateAt !== selectedAt) {
        return candidateAt > selectedAt ? candidate : selected;
      }
      if (
        candidate.artifact.artifactKind === "canonical" &&
        selected.artifact.artifactKind !== "canonical"
      ) {
        return candidate;
      }
      return selected;
    }, null);
    const identity = sourceArtifacts[0];
    if (!identity) continue;

    drafts.push({
      sourceKey,
      kind: identity.kind,
      contextId: identity.contextId,
      savedAt: latest?.parsed.savedAt ?? null,
      preview: latest
        ? createFormDraftRecoveryPreview(latest.parsed.data)
        : { title: null, body: null },
      artifactCount: sourceArtifacts.length,
      hasIncompatibleArtifact: incompatibleCandidates.length > 0,
    });
  }

  drafts.sort((left, right) => {
    const savedAtDelta =
      (right.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
      (left.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY);
    return savedAtDelta || left.sourceKey.localeCompare(right.sourceKey);
  });
  return {
    drafts,
    failedKeys: [...new Set(failedKeys)].sort(),
    enumerationFailed: false,
  };
}

function removeMatchingLocalDocumentDraftArtifacts(
  storage: FormDraftStorage,
  predicate: (artifact: DocumentDraftArtifact) => boolean,
  deviceOwnerPredicate?: (ownerId: string) => boolean,
): LocalDocumentDraftCleanupResult {
  let artifacts: DocumentDraftArtifact[];
  try {
    artifacts = listDocumentDraftArtifacts(storage).filter(predicate);
  } catch {
    return {
      sourceKeys: [],
      removedKeys: [],
      failedKeys: [],
      enumerationFailed: true,
    };
  }

  const sourceKeys = [...new Set(artifacts.map(({ sourceKey }) => sourceKey))]
    .sort();
  const storageKeys = new Set(artifacts.map(({ storageKey }) => storageKey));
  if (deviceOwnerPredicate) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const storageKey = storage.key(index);
        if (!storageKey) continue;
        const deviceOwnerId = readDocumentServerDraftDeviceStorageOwnerId(storageKey);
        if (deviceOwnerId && deviceOwnerPredicate(deviceOwnerId)) {
          storageKeys.add(storageKey);
        }
      }
    } catch {
      return {
        sourceKeys,
        removedKeys: [],
        failedKeys: [],
        enumerationFailed: true,
      };
    }
  }
  const removedKeys: string[] = [];
  const failedKeys: string[] = [];

  for (const storageKey of [...storageKeys].sort()) {
    try {
      storage.removeItem(storageKey);
      if (storage.getItem(storageKey) === null) removedKeys.push(storageKey);
      else failedKeys.push(storageKey);
    } catch {
      failedKeys.push(storageKey);
    }
  }

  return {
    sourceKeys,
    removedKeys,
    failedKeys,
    enumerationFailed: false,
  };
}

/** 로그아웃·계정 삭제 경계에서 해당 계정의 모든 draft 표현을 제거한다. */
export function removeLocalDocumentDraftsForOwner(
  storage: FormDraftStorage,
  ownerId: string,
): LocalDocumentDraftCleanupResult {
  return removeMatchingLocalDocumentDraftArtifacts(
    storage,
    (artifact) => artifact.ownerId === ownerId,
    (deviceOwnerId) => deviceOwnerId === ownerId,
  );
}

/** 새 인증 계정과 다른 잔여 draft를 공유 기기에서 제거한다. */
export function removeLocalDocumentDraftsExceptOwner(
  storage: FormDraftStorage,
  ownerId: string,
): LocalDocumentDraftCleanupResult {
  return removeMatchingLocalDocumentDraftArtifacts(
    storage,
    (artifact) => artifact.ownerId !== ownerId,
    (deviceOwnerId) => deviceOwnerId !== ownerId,
  );
}

/** 기기 초안 관리에서 선택한 문서 namespace 전체를 명시적으로 폐기한다. */
export function removeLocalDocumentDraftSource(
  storage: FormDraftStorage,
  ownerId: string,
  sourceKey: string,
): LocalDocumentDraftCleanupResult {
  return removeMatchingLocalDocumentDraftArtifacts(
    storage,
    (artifact) =>
      artifact.ownerId === ownerId && artifact.sourceKey === sourceKey,
  );
}
