/** 계정별 문서 namespace와 내용에 결합된 불변 recovery key. */
import {
  type DocumentDraftKind,
  DOCUMENT_DRAFT_KINDS,
  type DocumentDraftKeyIdentity,
  type FormDraftStorage,
  type FormDraftRecoveryStorage,
} from "./contract";
import {
  assertAccountOwnerMayPersist,
} from "@/lib/account-terminal-lock";
import {
  bytesToHex,
  utf8ToBytes,
} from "@noble/hashes/utils";
import {
  sha256,
} from "@noble/hashes/sha256";

export function createDocumentDraftKey(
  kind: DocumentDraftKind,
  ownerId: string,
  contextId = "new",
): string {
  const safeOwnerId = encodeURIComponent(ownerId);
  const safeContextId = encodeURIComponent(contextId);
  return `draft:document:${kind}:${safeOwnerId}:${safeContextId}`;
}

function isDocumentDraftKind(value: string): value is DocumentDraftKind {
  return (DOCUMENT_DRAFT_KINDS as readonly string[]).includes(value);
}

/**
 * canonical 문서 draft key에서 계정·문서 경계를 복원한다.
 * key를 다시 만들었을 때 정확히 일치하는 값만 받아 malformed namespace를
 * 다른 계정의 artifact로 잘못 분류하지 않는다.
 */
export function parseDocumentDraftKey(
  sourceKey: string,
): DocumentDraftKeyIdentity | null {
  const namespacePrefix = "draft:document:";
  if (!sourceKey.startsWith(namespacePrefix)) return null;

  const parts = sourceKey.slice(namespacePrefix.length).split(":");
  if (parts.length !== 3) return null;
  const [kind, encodedOwnerId, encodedContextId] = parts;
  if (!kind || !isDocumentDraftKind(kind)) return null;

  try {
    const ownerId = decodeURIComponent(encodedOwnerId ?? "");
    const contextId = decodeURIComponent(encodedContextId ?? "");
    return createDocumentDraftKey(kind, ownerId, contextId) === sourceKey
      ? { kind, ownerId, contextId }
      : null;
  } catch {
    return null;
  }
}

/** owner-scoped document key는 terminal deletion lock 뒤 다시 쓰지 않는다. */
export function assertFormDraftSourceOwnerMayPersist(
  storage: Pick<FormDraftStorage, "getItem">,
  sourceKey: string,
): void {
  const identity = parseDocumentDraftKey(sourceKey);
  if (identity) assertAccountOwnerMayPersist(storage, identity.ownerId);
}

export function createFormDraftClearMarkerKey(sourceKey: string): string {
  return `draft:document-clear-marker:${encodeURIComponent(sourceKey)}`;
}

export function createDocumentServerDraftQueueKey(sourceKey: string): string {
  return `draft:document-server-queue:${encodeURIComponent(sourceKey)}`;
}

export function readDocumentServerDraftQueueSourceKey(
  storageKey: string,
): string | null {
  const prefix = "draft:document-server-queue:";
  if (!storageKey.startsWith(prefix)) return null;
  try {
    const sourceKey = decodeURIComponent(storageKey.slice(prefix.length));
    return createDocumentServerDraftQueueKey(sourceKey) === storageKey
      ? sourceKey
      : null;
  } catch {
    return null;
  }
}

export function createFormDraftClearMarkerEntryPrefix(sourceKey: string): string {
  return `${createFormDraftClearMarkerKey(sourceKey)}:entry:`;
}

export function createFormDraftClearMarkerEntryKey(
  sourceKey: string,
  signature: string,
  clearedAt: number,
): string {
  return `${createFormDraftClearMarkerEntryPrefix(sourceKey)}${clearedAt}:${encodeURIComponent(signature)}`;
}

export function isFormDraftClearMarkerKey(
  sourceKey: string,
  candidateKey: string,
): boolean {
  return candidateKey === createFormDraftClearMarkerKey(sourceKey) ||
    candidateKey.startsWith(createFormDraftClearMarkerEntryPrefix(sourceKey));
}

export function createFormDraftRecoveryPrefix(sourceKey: string): string {
  return `draft:document-recovery:${encodeURIComponent(sourceKey)}:`;
}

export function createFormDraftRecoveryKey(sourceKey: string, recoveryId: string): string {
  return `${createFormDraftRecoveryPrefix(sourceKey)}${encodeURIComponent(recoveryId)}`;
}

/** raw snapshot과 결합된 불변 recovery key를 만든다. 같은 key에 다른 내용을 덮어쓰지 않는다. */
export function createImmutableFormDraftRecoveryKey(
  sourceKey: string,
  writerId: string,
  raw: string,
): string {
  const rawSignature = bytesToHex(sha256(utf8ToBytes(raw)));
  return createFormDraftRecoveryKey(
    sourceKey,
    `snapshot:${rawSignature}:${writerId}`,
  );
}

function readImmutableFormDraftRecoveryRawSignature(
  sourceKey: string,
  recoveryKey: string,
): string | null {
  const prefix = createFormDraftRecoveryPrefix(sourceKey);
  if (!recoveryKey.startsWith(prefix)) return null;

  try {
    const recoveryId = decodeURIComponent(recoveryKey.slice(prefix.length));
    const match = /^snapshot:([0-9a-f]{64}):/u.exec(recoveryId);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 새 client가 내용별 불변 프로토콜로 만든 recovery key인지 판정한다. */
export function isImmutableFormDraftRecoveryKey(
  sourceKey: string,
  recoveryKey: string,
): boolean {
  return readImmutableFormDraftRecoveryRawSignature(sourceKey, recoveryKey) !== null;
}

export function assertImmutableFormDraftRecoveryRaw(
  sourceKey: string,
  recoveryKey: string,
  raw: string,
): void {
  const expectedSignature = readImmutableFormDraftRecoveryRawSignature(
    sourceKey,
    recoveryKey,
  );
  if (!expectedSignature) return;
  const actualSignature = bytesToHex(sha256(utf8ToBytes(raw)));
  if (expectedSignature !== actualSignature) {
    throw new Error("Immutable form draft recovery key does not match its snapshot");
  }
}

export function hasMatchingImmutableFormDraftRecoveryRaw(
  sourceKey: string,
  recoveryKey: string,
  raw: string,
): boolean {
  const expectedSignature = readImmutableFormDraftRecoveryRawSignature(
    sourceKey,
    recoveryKey,
  );
  if (!expectedSignature) return false;
  return expectedSignature === bytesToHex(sha256(utf8ToBytes(raw)));
}

export function isFormDraftRecoveryKey(sourceKey: string, candidateKey: string): boolean {
  return candidateKey.startsWith(createFormDraftRecoveryPrefix(sourceKey));
}

export function readFormDraftRecoveryArtifactSourceKey(
  candidateKey: string,
): string | null {
  const namespacePrefix = "draft:document-recovery:";
  if (!candidateKey.startsWith(namespacePrefix)) return null;

  const suffix = candidateKey.slice(namespacePrefix.length);
  const separatorIndex = suffix.indexOf(":");
  if (separatorIndex <= 0) return null;

  try {
    const sourceKey = decodeURIComponent(suffix.slice(0, separatorIndex));
    return candidateKey.startsWith(createFormDraftRecoveryPrefix(sourceKey))
      ? sourceKey
      : null;
  } catch {
    return null;
  }
}

type FormDraftClearMarkerArtifact = {
  sourceKey: string;
  kind: "head" | "entry";
};

export function readFormDraftClearMarkerArtifact(
  candidateKey: string,
): FormDraftClearMarkerArtifact | null {
  const namespacePrefix = "draft:document-clear-marker:";
  if (!candidateKey.startsWith(namespacePrefix)) return null;

  const suffix = candidateKey.slice(namespacePrefix.length);
  const entrySeparator = ":entry:";
  const entryIndex = suffix.indexOf(entrySeparator);
  const encodedSourceKey = entryIndex === -1
    ? suffix
    : suffix.slice(0, entryIndex);
  if (!encodedSourceKey) return null;

  try {
    const sourceKey = decodeURIComponent(encodedSourceKey);
    if (candidateKey === createFormDraftClearMarkerKey(sourceKey)) {
      return { sourceKey, kind: "head" };
    }
    if (candidateKey.startsWith(createFormDraftClearMarkerEntryPrefix(sourceKey))) {
      return { sourceKey, kind: "entry" };
    }
    return null;
  } catch {
    return null;
  }
}

export type DocumentDraftArtifact = DocumentDraftKeyIdentity & {
  sourceKey: string;
  storageKey: string;
  artifactKind: "canonical" | "recovery" | "clear-marker" | "server-queue";
};

/** canonical·recovery·clear marker key를 하나의 소유 계정 namespace로 해석한다. */
export function readDocumentDraftArtifact(
  storageKey: string,
): DocumentDraftArtifact | null {
  const canonicalIdentity = parseDocumentDraftKey(storageKey);
  if (canonicalIdentity) {
    return {
      ...canonicalIdentity,
      sourceKey: storageKey,
      storageKey,
      artifactKind: "canonical",
    };
  }

  const recoverySourceKey = readFormDraftRecoveryArtifactSourceKey(storageKey);
  if (recoverySourceKey) {
    const identity = parseDocumentDraftKey(recoverySourceKey);
    if (identity) {
      return {
        ...identity,
        sourceKey: recoverySourceKey,
        storageKey,
        artifactKind: "recovery",
      };
    }
  }

  const queueSourceKey = readDocumentServerDraftQueueSourceKey(storageKey);
  if (queueSourceKey) {
    const identity = parseDocumentDraftKey(queueSourceKey);
    if (identity) {
      return {
        ...identity,
        sourceKey: queueSourceKey,
        storageKey,
        artifactKind: "server-queue",
      };
    }
  }

  const markerArtifact = readFormDraftClearMarkerArtifact(storageKey);
  if (!markerArtifact) return null;
  const identity = parseDocumentDraftKey(markerArtifact.sourceKey);
  return identity
    ? {
        ...identity,
        sourceKey: markerArtifact.sourceKey,
        storageKey,
        artifactKind: "clear-marker",
      }
    : null;
}

/** storage를 한 번 열거해 해석 가능한 문서 draft artifact만 반환한다. */
export function listDocumentDraftArtifacts(
  storage: FormDraftRecoveryStorage,
): DocumentDraftArtifact[] {
  const artifacts: DocumentDraftArtifact[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index);
    if (storageKey === null) continue;
    const artifact = readDocumentDraftArtifact(storageKey);
    if (artifact) artifacts.push(artifact);
  }
  return artifacts;
}

export function collectFormDraftRecoveryKeys(
  storage: Pick<FormDraftRecoveryStorage, "length" | "key">,
  sourceKey: string,
): string[] {
  const prefix = createFormDraftRecoveryPrefix(sourceKey);
  const candidateKeys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const candidateKey = storage.key(index);
    if (candidateKey?.startsWith(prefix)) candidateKeys.push(candidateKey);
  }
  return candidateKeys;
}
