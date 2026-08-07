import { createCreationOperationId, parseCreationOperationId } from "@/lib/creation-operation";
import {
  createDocumentServerDraftQueueKey,
  parseDocumentDraftKey,
  type FormDraftStorage,
} from "@/lib/form-draft";
import {
  canonicalizeDocumentServerDraftPayload,
  parseDocumentServerDraftBaseResourceVersion,
  parseDocumentServerDraftDeviceId,
  parseDocumentServerDraftVersion,
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
};

export type QueuedDocumentServerDraftDiscard = QueuedDocumentServerDraftBase & {
  operationType: "DISCARD";
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
      return { ...base, operationType: "DISCARD" };
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
    if (
      !payload ||
      payload.payloadJson !== value.payloadJson ||
      payload.payloadHash !== value.payloadHash ||
      baseResourceVersion === undefined ||
      !writerDeviceId
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
  storage: Pick<FormDraftStorage, "setItem">,
  entry: QueuedDocumentServerDraft,
): StoredQueuedDocumentServerDraft {
  const raw = serializeQueuedDocumentServerDraft(entry);
  storage.setItem(createDocumentServerDraftQueueKey(entry.sourceKey), raw);
  return { entry, raw };
}

export function enqueueDocumentServerDraftUpsert(
  storage: Pick<FormDraftStorage, "getItem" | "setItem">,
  input: {
    sourceKey: string;
    data: unknown;
    expectedDraftVersion: number;
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
  if (
    expectedDraftVersion === null ||
    baseResourceVersion === undefined ||
    !writerDeviceId ||
    conflictCount === null
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
  },
): StoredQueuedDocumentServerDraft {
  if (!parseDocumentDraftKey(input.sourceKey)) {
    throw new TypeError("유효한 문서 초안 source가 필요합니다.");
  }
  const expectedDraftVersion = parseDocumentServerDraftVersion(
    input.expectedDraftVersion,
  );
  const conflictCount = parseConflictCount(input.conflictCount ?? 0);
  if (expectedDraftVersion === null || conflictCount === null) {
    throw new TypeError("유효한 서버 초안 queue metadata가 필요합니다.");
  }
  const current = readQueuedDocumentServerDraft(storage, input.sourceKey);
  if (
    current?.entry.operationType === "DISCARD" &&
    current.entry.expectedDraftVersion === expectedDraftVersion &&
    current.entry.conflictCount === conflictCount
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
  });
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
