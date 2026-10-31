import { createCreationOperationId, parseCreationOperationId } from "@/lib/creation-operation";
import { assertAccountOwnerMayPersist } from "@/lib/account-terminal-lock";
import {
  createDocumentServerDraftQueueKey,
  parseDocumentDraftKey,
  readDocumentServerDraftQueueSourceKey,
  type FormDraftStorage,
} from "@/lib/form-draft";
import {
  canonicalizeDocumentServerDraftPayload,
  parseDocumentServerDraftBaseResourceVersion,
  parseDocumentServerDraftDeviceId,
  parseDocumentServerDraftVersion,
  parseDocumentServerDraftExpectedHash,
  parseDocumentServerDraftSupersededOperationIds as parseSupersededOperationIds,
  parseDocumentServerDraftTargetHashes as parseTargetPayloadHashes,
  serializeDocumentServerDraftPayload,
} from "@/lib/document-server-draft-contract";
import { DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS } from "@/lib/document-server-draft-constants";

export const DOCUMENT_SERVER_DRAFT_QUEUE_VERSION = 1;
export const DOCUMENT_SERVER_DRAFT_DEVICE_STORAGE_KEY_PREFIX =
  "portal:document-server-draft-device-id:";
export const DOCUMENT_SERVER_DRAFT_QUEUE_CHANGE_EVENT =
  "portal:document-server-draft-queue-change";
export const DOCUMENT_SERVER_DRAFT_QUEUE_TTL_MS =
  DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS * 1_000;

type QueuedDocumentServerDraftBase = {
  version: typeof DOCUMENT_SERVER_DRAFT_QUEUE_VERSION;
  sourceKey: string;
  operationId: string;
  expectedDraftVersion: number;
  queuedAt: number;
  conflictCount: number;
};

export type QueuedDocumentServerDraftUpsert = QueuedDocumentServerDraftBase & {
  operationType: "UPSERT";
  payloadJson: string;
  payloadHash: string;
  baseResourceVersion: number | null;
  writerDeviceId: string;
  expectedPayloadHash?: string;
};

export type QueuedDocumentServerDraftDiscard = QueuedDocumentServerDraftBase & {
  operationType: "DISCARD";
  /**
   * 삭제 의도를 이 본문에 한정한다. 생략된 이전 요청은 원 version만 대상으로 한다.
   * 제출 정리는 전송 중·큐에 있던 이전 입력의 본문 hash도 여기에 넣어, 늦게 반영된 이전 입력은 지우되
   * 같은 기기(같은 브라우저의 다른 탭)의 다른 본문은 보존한다. 기기 ID로 삭제 범위를 넓히지 않는다.
   */
  targetPayloadHashes?: string[];
  /** 서버 fence 대상 UPSERT operation ID(`DiscardDocumentServerDraftInput.supersededOperationIds`). */
  supersededOperationIds?: string[];
};

export type QueuedDocumentServerDraft =
  | QueuedDocumentServerDraftUpsert
  | QueuedDocumentServerDraftDiscard;

export type StoredQueuedDocumentServerDraft = {
  entry: QueuedDocumentServerDraft;
  raw: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidQueueTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseConflictCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 3
    ? value
    : null;
}

export function serializeQueuedDocumentServerDraft(
  entry: QueuedDocumentServerDraft,
): string {
  return JSON.stringify(entry);
}

export function parseQueuedDocumentServerDraft(
  raw: string,
  expectedSourceKey?: string,
): QueuedDocumentServerDraft | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== DOCUMENT_SERVER_DRAFT_QUEUE_VERSION) {
      return null;
    }
    if (
      typeof value.sourceKey !== "string" ||
      !parseDocumentDraftKey(value.sourceKey) ||
      (expectedSourceKey !== undefined && value.sourceKey !== expectedSourceKey)
    ) {
      return null;
    }
    const operationId = parseCreationOperationId(value.operationId);
    const expectedDraftVersion = parseDocumentServerDraftVersion(
      value.expectedDraftVersion,
    );
    const conflictCount = parseConflictCount(value.conflictCount);
    if (
      !operationId ||
      expectedDraftVersion === null ||
      conflictCount === null ||
      !isValidQueueTimestamp(value.queuedAt)
    ) {
      return null;
    }

    const base = {
      version: DOCUMENT_SERVER_DRAFT_QUEUE_VERSION,
      sourceKey: value.sourceKey,
      operationId,
      expectedDraftVersion,
      queuedAt: value.queuedAt,
      conflictCount,
    } as const;
    if (value.operationType === "DISCARD") {
      const targetPayloadHashes = parseTargetPayloadHashes(value.targetPayloadHashes);
      const supersededOperationIds = parseSupersededOperationIds(value.supersededOperationIds);
      if (targetPayloadHashes === null || supersededOperationIds === null) return null;
      return {
        ...base,
        operationType: "DISCARD",
        ...(targetPayloadHashes ? { targetPayloadHashes } : {}),
        ...(supersededOperationIds ? { supersededOperationIds } : {}),
      };
    }
    if (
      value.operationType !== "UPSERT" ||
      typeof value.payloadJson !== "string" ||
      typeof value.payloadHash !== "string"
    ) {
      return null;
    }
    const payload = canonicalizeDocumentServerDraftPayload(value.payloadJson);
    const baseResourceVersion = parseDocumentServerDraftBaseResourceVersion(
      value.baseResourceVersion,
    );
    const writerDeviceId = parseDocumentServerDraftDeviceId(value.writerDeviceId);
    const expectedPayloadHash = parseDocumentServerDraftExpectedHash(value.expectedPayloadHash);
    if (
      !payload ||
      payload.payloadJson !== value.payloadJson ||
      payload.payloadHash !== value.payloadHash ||
      baseResourceVersion === undefined ||
      !writerDeviceId ||
      expectedPayloadHash === null ||
      (expectedDraftVersion === 0 && expectedPayloadHash !== undefined)
    ) {
      return null;
    }
    return {
      ...base,
      operationType: "UPSERT",
      payloadJson: payload.payloadJson,
      payloadHash: payload.payloadHash,
      baseResourceVersion,
      writerDeviceId,
      ...(expectedPayloadHash ? { expectedPayloadHash } : {}),
    };
  } catch {
    return null;
  }
}

export function readQueuedDocumentServerDraft(
  storage: Pick<FormDraftStorage, "getItem">,
  sourceKey: string,
  now = Date.now(),
): StoredQueuedDocumentServerDraft | null {
  const raw = storage.getItem(createDocumentServerDraftQueueKey(sourceKey));
  if (raw === null) return null;
  const entry = parseQueuedDocumentServerDraft(raw, sourceKey);
  return entry && entry.queuedAt + DOCUMENT_SERVER_DRAFT_QUEUE_TTL_MS > now
    ? { entry, raw }
    : null;
}

function writeQueueEntry(
  storage: Pick<FormDraftStorage, "getItem" | "setItem">,
  entry: QueuedDocumentServerDraft,
): StoredQueuedDocumentServerDraft {
  const identity = parseDocumentDraftKey(entry.sourceKey);
  if (!identity) throw new TypeError("서버 초안 queue에는 owner가 필요합니다.");
  const raw = serializeQueuedDocumentServerDraft(entry);
  assertAccountOwnerMayPersist(storage, identity.ownerId);
  storage.setItem(createDocumentServerDraftQueueKey(entry.sourceKey), raw);
  return { entry, raw };
}

export function enqueueDocumentServerDraftUpsert(
  storage: Pick<FormDraftStorage, "getItem" | "setItem">,
  input: {
    sourceKey: string;
    data: unknown;
    expectedDraftVersion: number;
    expectedPayloadHash?: string;
    baseResourceVersion: number | null;
    writerDeviceId: string;
    now?: number;
    conflictCount?: number;
  },
): StoredQueuedDocumentServerDraft {
  if (!parseDocumentDraftKey(input.sourceKey)) {
    throw new TypeError("유효한 문서 초안 source가 필요합니다.");
  }
  const expectedDraftVersion = parseDocumentServerDraftVersion(
    input.expectedDraftVersion,
  );
  const baseResourceVersion = parseDocumentServerDraftBaseResourceVersion(
    input.baseResourceVersion,
  );
  const writerDeviceId = parseDocumentServerDraftDeviceId(input.writerDeviceId);
  const conflictCount = parseConflictCount(input.conflictCount ?? 0);
  const expectedPayloadHash = parseDocumentServerDraftExpectedHash(input.expectedPayloadHash);
  if (
    expectedDraftVersion === null ||
    baseResourceVersion === undefined ||
    !writerDeviceId ||
    conflictCount === null ||
    expectedPayloadHash === null ||
    (expectedDraftVersion === 0 && expectedPayloadHash !== undefined)
  ) {
    throw new TypeError("유효한 서버 초안 queue metadata가 필요합니다.");
  }
  const payloadJson = serializeDocumentServerDraftPayload(input.data);
  const payload = canonicalizeDocumentServerDraftPayload(payloadJson);
  if (!payload) throw new TypeError("서버 초안 payload를 직렬화할 수 없습니다.");

  const current = readQueuedDocumentServerDraft(storage, input.sourceKey);
  if (
    current?.entry.operationType === "UPSERT" &&
    current.entry.expectedDraftVersion === expectedDraftVersion &&
    current.entry.expectedPayloadHash === expectedPayloadHash &&
    current.entry.payloadHash === payload.payloadHash &&
    current.entry.baseResourceVersion === baseResourceVersion &&
    current.entry.writerDeviceId === writerDeviceId &&
    current.entry.conflictCount === conflictCount
  ) {
    return current;
  }

  return writeQueueEntry(storage, {
    version: DOCUMENT_SERVER_DRAFT_QUEUE_VERSION,
    sourceKey: input.sourceKey,
    operationType: "UPSERT",
    operationId: createCreationOperationId(),
    expectedDraftVersion,
    ...(expectedPayloadHash ? { expectedPayloadHash } : {}),
    payloadJson: payload.payloadJson,
    payloadHash: payload.payloadHash,
    baseResourceVersion,
    writerDeviceId,
    queuedAt: input.now ?? Date.now(),
    conflictCount,
  });
}

export function enqueueDocumentServerDraftDiscard(
  storage: Pick<FormDraftStorage, "getItem" | "setItem">,
  input: {
    sourceKey: string;
    expectedDraftVersion: number;
    now?: number;
    conflictCount?: number;
    targetPayloadHashes?: readonly string[];
    supersededOperationIds?: readonly string[];
  },
): StoredQueuedDocumentServerDraft {
  if (!parseDocumentDraftKey(input.sourceKey)) {
    throw new TypeError("유효한 문서 초안 source가 필요합니다.");
  }
  const expectedDraftVersion = parseDocumentServerDraftVersion(
    input.expectedDraftVersion,
  );
  const conflictCount = parseConflictCount(input.conflictCount ?? 0);
  const targetPayloadHashes = parseTargetPayloadHashes(input.targetPayloadHashes);
  const supersededOperationIds = parseSupersededOperationIds(input.supersededOperationIds);
  if (
    expectedDraftVersion === null || conflictCount === null || targetPayloadHashes === null ||
    supersededOperationIds === null
  ) {
    throw new TypeError("유효한 서버 초안 queue metadata가 필요합니다.");
  }
  const current = readQueuedDocumentServerDraft(storage, input.sourceKey);
  if (
    current?.entry.operationType === "DISCARD" &&
    current.entry.expectedDraftVersion === expectedDraftVersion &&
    current.entry.conflictCount === conflictCount &&
    JSON.stringify(current.entry.targetPayloadHashes) === JSON.stringify(targetPayloadHashes) &&
    JSON.stringify(current.entry.supersededOperationIds) === JSON.stringify(supersededOperationIds)
  ) {
    return current;
  }
  return writeQueueEntry(storage, {
    version: DOCUMENT_SERVER_DRAFT_QUEUE_VERSION,
    sourceKey: input.sourceKey,
    operationType: "DISCARD",
    operationId: createCreationOperationId(),
    expectedDraftVersion,
    queuedAt: input.now ?? Date.now(),
    conflictCount,
    ...(targetPayloadHashes ? { targetPayloadHashes } : {}),
    ...(supersededOperationIds ? { supersededOperationIds } : {}),
  });
}

export type StoredQueuedDocumentServerDraftDiscard = StoredQueuedDocumentServerDraft & {
  entry: QueuedDocumentServerDraftDiscard;
};

/** 로그아웃 정리로 지워지기 전에 보낼 수 있도록 이 계정의 서버 초안 폐기 요청만 모은다. */
export function listQueuedDocumentServerDraftDiscardsForOwner(
  storage: Pick<FormDraftStorage, "length" | "key" | "getItem">,
  ownerId: string,
  now = Date.now(),
): StoredQueuedDocumentServerDraftDiscard[] {
  const sourceKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index);
    const sourceKey = storageKey === null ? null : readDocumentServerDraftQueueSourceKey(storageKey);
    if (sourceKey && parseDocumentDraftKey(sourceKey)?.ownerId === ownerId) sourceKeys.push(sourceKey);
  }
  const discards: StoredQueuedDocumentServerDraftDiscard[] = [];
  for (const sourceKey of sourceKeys) {
    const queued = readQueuedDocumentServerDraft(storage, sourceKey, now);
    const entry = queued?.entry;
    if (queued && entry?.operationType === "DISCARD") discards.push({ entry, raw: queued.raw });
  }
  return discards;
}

/** 응답을 받은 요청과 localStorage의 현재 요청이 같은 경우에만 제거한다. */
export function removeQueuedDocumentServerDraftIfUnchanged(
  storage: Pick<FormDraftStorage, "getItem" | "removeItem">,
  sourceKey: string,
  expectedRaw: string,
): boolean {
  const key = createDocumentServerDraftQueueKey(sourceKey);
  if (storage.getItem(key) !== expectedRaw) return false;
  storage.removeItem(key);
  return true;
}

export function getOrCreateDocumentServerDraftDeviceId(
  storage: Pick<FormDraftStorage, "getItem" | "setItem">,
  ownerId: string,
): string {
  const storageKey = createDocumentServerDraftDeviceStorageKey(ownerId);
  const stored = parseDocumentServerDraftDeviceId(
    storage.getItem(storageKey),
  );
  if (stored) return stored;
  const created = createCreationOperationId();
  assertAccountOwnerMayPersist(storage, ownerId);
  storage.setItem(storageKey, created);
  return created;
}

export function createDocumentServerDraftDeviceStorageKey(ownerId: string): string {
  if (!ownerId) throw new TypeError("서버 초안 기기 ID에는 owner가 필요합니다.");
  return `${DOCUMENT_SERVER_DRAFT_DEVICE_STORAGE_KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

export function readDocumentServerDraftDeviceStorageOwnerId(
  storageKey: string,
): string | null {
  if (!storageKey.startsWith(DOCUMENT_SERVER_DRAFT_DEVICE_STORAGE_KEY_PREFIX)) {
    return null;
  }
  try {
    const ownerId = decodeURIComponent(
      storageKey.slice(DOCUMENT_SERVER_DRAFT_DEVICE_STORAGE_KEY_PREFIX.length),
    );
    return createDocumentServerDraftDeviceStorageKey(ownerId) === storageKey
      ? ownerId
      : null;
  } catch {
    return null;
  }
}
