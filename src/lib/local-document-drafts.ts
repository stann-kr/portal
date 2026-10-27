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
import {
  readAccountCalendarTabStorageOwnerId,
  readAccountNotesViewStorageOwnerId,
} from "@/lib/local-owner-keys";

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

export type LocalDocumentDraftOwnerInspectionResult = {
  storageKeys: string[];
  enumerationFailed: boolean;
};

export type OwnerlessLegacyDocumentDraftListResult = {
  storageKeys: string[];
  enumerationFailed: boolean;
};

export type OwnerlessLegacyDocumentDraftSnapshot = {
  storageKey: string;
  raw: string;
};

export type OwnerlessLegacyDocumentDraftSnapshotResult = {
  snapshots: OwnerlessLegacyDocumentDraftSnapshot[];
  enumerationFailed: boolean;
};

export type OwnerlessLegacyDocumentDraftCleanupResult =
  LocalDocumentDraftCleanupResult & {
    snapshotChanged: boolean;
    currentSnapshots: OwnerlessLegacyDocumentDraftSnapshot[];
  };

export const OWNERLESS_LEGACY_DOCUMENT_DRAFT_EXACT_KEYS = [
  "draft:qna:thread",
] as const;

export const OWNERLESS_LEGACY_DOCUMENT_DRAFT_PREFIXES = [
  "draft:note:full:",
  "draft:note:slide:",
  "draft:qna:reply:",
] as const;

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
  localOwnerPredicate?: (ownerId: string) => boolean,
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
  if (localOwnerPredicate) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const storageKey = storage.key(index);
        if (!storageKey) continue;
        const deviceOwnerId = readDocumentServerDraftDeviceStorageOwnerId(storageKey);
        const calendarOwnerId = readAccountCalendarTabStorageOwnerId(storageKey);
        const notesViewOwnerId = readAccountNotesViewStorageOwnerId(storageKey);
        if (
          (deviceOwnerId && localOwnerPredicate(deviceOwnerId)) ||
          (calendarOwnerId && localOwnerPredicate(calendarOwnerId)) ||
          (notesViewOwnerId && localOwnerPredicate(notesViewOwnerId))
        ) {
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

/** 계정 삭제 직후 재열거 검증에 쓸 owner-scoped durable key 목록을 반환한다. */
export function inspectLocalDocumentDraftsForOwner(
  storage: FormDraftStorage,
  ownerId: string,
): LocalDocumentDraftOwnerInspectionResult {
  try {
    const storageKeys = new Set(
      listDocumentDraftArtifacts(storage)
        .filter((artifact) => artifact.ownerId === ownerId)
        .map((artifact) => artifact.storageKey),
    );
    for (let index = 0; index < storage.length; index += 1) {
      const storageKey = storage.key(index);
      if (!storageKey) continue;
      if (readDocumentServerDraftDeviceStorageOwnerId(storageKey) === ownerId) {
        storageKeys.add(storageKey);
      }
      if (
        readAccountCalendarTabStorageOwnerId(storageKey) === ownerId ||
        readAccountNotesViewStorageOwnerId(storageKey) === ownerId
      ) {
        storageKeys.add(storageKey);
      }
    }
    return {
      storageKeys: [...storageKeys].sort(),
      enumerationFailed: false,
    };
  } catch {
    return { storageKeys: [], enumerationFailed: true };
  }
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

export function isOwnerlessLegacyDocumentDraftKey(storageKey: string): boolean {
  if (
    (OWNERLESS_LEGACY_DOCUMENT_DRAFT_EXACT_KEYS as readonly string[]).includes(
      storageKey,
    )
  ) {
    return true;
  }
  return OWNERLESS_LEGACY_DOCUMENT_DRAFT_PREFIXES.some(
    (prefix) => storageKey.length > prefix.length && storageKey.startsWith(prefix),
  );
}

/** 현재 owner namespace로 자동 귀속할 수 없는 구버전 key만 좁은 allowlist로 찾는다. */
export function listOwnerlessLegacyDocumentDrafts(
  storage: FormDraftStorage,
): OwnerlessLegacyDocumentDraftListResult {
  try {
    const storageKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const storageKey = storage.key(index);
      if (storageKey && isOwnerlessLegacyDocumentDraftKey(storageKey)) {
        storageKeys.push(storageKey);
      }
    }
    return {
      storageKeys: [...new Set(storageKeys)].sort(),
      enumerationFailed: false,
    };
  } catch {
    return { storageKeys: [], enumerationFailed: true };
  }
}

function sameOwnerlessLegacySnapshots(
  left: readonly OwnerlessLegacyDocumentDraftSnapshot[],
  right: readonly OwnerlessLegacyDocumentDraftSnapshot[],
): boolean {
  return left.length === right.length && left.every((snapshot, index) => {
    const candidate = right[index];
    return candidate?.storageKey === snapshot.storageKey &&
      candidate.raw === snapshot.raw;
  });
}

/** 두 번 검증한 exact key+raw snapshot만 destructive 확인 UI에 제공한다. */
export function snapshotOwnerlessLegacyDocumentDrafts(
  storage: FormDraftStorage,
): OwnerlessLegacyDocumentDraftSnapshotResult {
  const listed = listOwnerlessLegacyDocumentDrafts(storage);
  if (listed.enumerationFailed) {
    return { snapshots: [], enumerationFailed: true };
  }

  try {
    const snapshots = listed.storageKeys.flatMap((storageKey) => {
      const raw = storage.getItem(storageKey);
      return raw === null ? [] : [{ storageKey, raw }];
    });
    const verified = listOwnerlessLegacyDocumentDrafts(storage);
    if (
      verified.enumerationFailed ||
      verified.storageKeys.length !== snapshots.length ||
      !verified.storageKeys.every((storageKey, index) =>
        storageKey === snapshots[index]?.storageKey &&
        storage.getItem(storageKey) === snapshots[index]?.raw)
    ) {
      return { snapshots: [], enumerationFailed: true };
    }
    return { snapshots, enumerationFailed: false };
  } catch {
    return { snapshots: [], enumerationFailed: true };
  }
}

/** 확인한 exact key+raw snapshot만 CAS 방식으로 제거하고 새 key는 건드리지 않는다. */
export function removeOwnerlessLegacyDocumentDrafts(
  storage: FormDraftStorage,
  expectedSnapshots: readonly OwnerlessLegacyDocumentDraftSnapshot[],
): OwnerlessLegacyDocumentDraftCleanupResult {
  const current = snapshotOwnerlessLegacyDocumentDrafts(storage);
  if (current.enumerationFailed) {
    return {
      sourceKeys: expectedSnapshots.map(({ storageKey }) => storageKey),
      removedKeys: [],
      failedKeys: [],
      enumerationFailed: true,
      snapshotChanged: false,
      currentSnapshots: [],
    };
  }
  if (!sameOwnerlessLegacySnapshots(expectedSnapshots, current.snapshots)) {
    return {
      sourceKeys: expectedSnapshots.map(({ storageKey }) => storageKey),
      removedKeys: [],
      failedKeys: [],
      enumerationFailed: false,
      snapshotChanged: true,
      currentSnapshots: current.snapshots,
    };
  }

  const removedKeys: string[] = [];
  const failedKeys: string[] = [];
  for (const { storageKey, raw } of expectedSnapshots) {
    try {
      if (storage.getItem(storageKey) !== raw) {
        failedKeys.push(storageKey);
        continue;
      }
      storage.removeItem(storageKey);
      if (storage.getItem(storageKey) === null) removedKeys.push(storageKey);
      else failedKeys.push(storageKey);
    } catch {
      failedKeys.push(storageKey);
    }
  }
  return {
    sourceKeys: expectedSnapshots.map(({ storageKey }) => storageKey),
    removedKeys,
    failedKeys,
    enumerationFailed: false,
    snapshotChanged: false,
    currentSnapshots: [],
  };
}
