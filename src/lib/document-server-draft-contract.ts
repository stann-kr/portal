import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { parseCreationOperationId } from "@/lib/creation-operation";
import {
  parseDocumentDraftKey,
  serializeNormalizedFormDraftData,
} from "@/lib/form-draft";
import type { DocumentServerDraftKind } from "@/db/schema";
import {
  DOCUMENT_SERVER_DRAFT_MAX_PAYLOAD_BYTES,
  DOCUMENT_SERVER_DRAFT_PAYLOAD_VERSION,
  DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
  type DocumentServerDraftOperationType,
} from "@/lib/document-server-draft-constants";

export type DocumentServerDraftSnapshot = {
  sourceKey: string;
  kind: DocumentServerDraftKind;
  contextId: string;
  payloadJson: string;
  payloadHash: string;
  draftVersion: number;
  baseResourceVersion: number | null;
  writerDeviceId: string;
  updatedAt: number;
  expiresAt: number;
};

export type DocumentServerDraftMutationFailureReason =
  | "INVALID_INPUT"
  | "PAYLOAD_TOO_LARGE"
  | "VERSION_CONFLICT"
  | "OPERATION_PAYLOAD_CONFLICT"
  | "INTERNAL_INVARIANT_FAILURE";

export type DocumentServerDraftMutationResult =
  | {
      ok: true;
      replayed: boolean;
      operationResultVersion: number;
      current: DocumentServerDraftSnapshot | null;
    }
  | {
      ok: false;
      reason: DocumentServerDraftMutationFailureReason;
      current: DocumentServerDraftSnapshot | null;
    };

export type ReadDocumentServerDraftResult =
  | { ok: true; draft: DocumentServerDraftSnapshot | null }
  | { ok: false; reason: "INVALID_INPUT" | "INTERNAL_INVARIANT_FAILURE" };

export type SaveDocumentServerDraftInput = {
  sourceKey: string;
  operationId: string;
  expectedDraftVersion: number;
  expectedPayloadHash?: string;
  payloadJson: string;
  baseResourceVersion: number | null;
  writerDeviceId: string;
};

export function parseDocumentServerDraftExpectedHash(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export type DiscardDocumentServerDraftInput = {
  sourceKey: string;
  operationId: string;
  expectedDraftVersion: number;
  targetPayloadHashes?: readonly string[];
  /**
   * 폐기를 큐에 넣는 시점에 같은 sourceKey로 전송 중이거나 큐에 있던 UPSERT의 operation ID(서버 fence).
   * 서버는 이 ID들의 receipt를 DISCARD로 선점해 늦게 도착한 저장이 서버본을 되살리지 못하게 하고,
   * 현재 서버본이 이 ID가 만든 것이고 그 본문 hash가 `targetPayloadHashes`에 있으면 version이 달라도 삭제한다
   * (클라이언트는 superseded UPSERT의 본문 hash를 대상에 함께 넣는다. 기기 ID나 version·시각만으로는 범위를 넓히지 않는다).
   */
  supersededOperationIds?: readonly string[];
};

export const DOCUMENT_SERVER_DRAFT_MAX_SUPERSEDED_OPERATIONS = 8;

export function parseDocumentServerDraftTargetHashes(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 32 ||
    !value.every((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash))) return null;
  return [...new Set(value as string[])].sort();
}

/** 없으면 undefined, 1~8개의 유효한 operation ID면 중복 제거·정렬한 배열, 그 밖에는 null(잘못된 입력). */
export function parseDocumentServerDraftSupersededOperationIds(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 ||
    value.length > DOCUMENT_SERVER_DRAFT_MAX_SUPERSEDED_OPERATIONS) return null;
  const parsed = value.map((entry) => parseCreationOperationId(entry));
  if (parsed.some((entry) => entry === null)) return null;
  return [...new Set(parsed as string[])].sort();
}

export type CanonicalDocumentServerDraftPayload = {
  data: Record<string, unknown>;
  payloadJson: string;
  payloadHash: string;
};

export function serializeDocumentServerDraftPayload(data: unknown): string {
  const normalizedData = JSON.parse(
    serializeNormalizedFormDraftData(data),
  ) as Record<string, unknown>;
  return serializeNormalizedFormDraftData({
    data: normalizedData,
    version: DOCUMENT_SERVER_DRAFT_PAYLOAD_VERSION,
  });
}

export function parseDocumentServerDraftVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function parseDocumentServerDraftBaseResourceVersion(
  value: unknown,
): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : undefined;
}

export function parseDocumentServerDraftDeviceId(value: unknown): string | null {
  return parseCreationOperationId(value);
}

export function canonicalizeDocumentServerDraftPayload(
  payloadJson: string,
): CanonicalDocumentServerDraftPayload | null {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).version !==
        DOCUMENT_SERVER_DRAFT_PAYLOAD_VERSION
    ) {
      return null;
    }
    const data = (parsed as Record<string, unknown>).data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return null;
    }
    const canonicalJson = serializeDocumentServerDraftPayload(data);
    if (utf8ToBytes(canonicalJson).length > DOCUMENT_SERVER_DRAFT_MAX_PAYLOAD_BYTES) {
      return null;
    }
    return {
      data: JSON.parse(serializeNormalizedFormDraftData(data)) as Record<string, unknown>,
      payloadJson: canonicalJson,
      payloadHash: bytesToHex(sha256(utf8ToBytes(canonicalJson))),
    };
  } catch {
    return null;
  }
}

export function isDocumentServerDraftPayloadTooLarge(payloadJson: string): boolean {
  return utf8ToBytes(payloadJson).length > DOCUMENT_SERVER_DRAFT_MAX_PAYLOAD_BYTES;
}

export function validateDocumentServerDraftSource(
  sourceKey: string,
  ownerId: string,
  ownerRole?: string | null,
) {
  const identity = parseDocumentDraftKey(sourceKey);
  if (!identity || identity.ownerId !== ownerId) return null;
  const { kind } = identity;
  // 댓글·피드백은 이 기기 초안이다. 기존 서버 schema의 문서 종류만 허용한다.
  if (kind === "community-comment" || kind === "assignment-feedback") return null;
  // 공용 가이드는 관리자만 편집하므로 서버 초안도 관리자만 가진다.
  if (kind === "guide-page" && ownerRole !== "admin") return null;
  return { ...identity, kind };
}

export function createDocumentServerDraftRequestHash(input: {
  operationType: DocumentServerDraftOperationType;
  sourceKey: string;
  expectedDraftVersion: number;
  payloadHash?: string;
  baseResourceVersion?: number | null;
  writerDeviceId?: string;
  targetPayloadHashes?: readonly string[];
  expectedPayloadHash?: string;
  supersededOperationIds?: readonly string[];
}): string {
  const canonical = JSON.stringify([
    "document-server-draft",
    DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
    input.operationType,
    input.sourceKey,
    input.expectedDraftVersion,
    input.payloadHash ?? null,
    input.baseResourceVersion ?? null,
    input.writerDeviceId ?? null,
    // 기존 요청의 canonical bytes는 유지하고, 본문에 한정된 삭제 의도만 추가한다.
    ...(input.targetPayloadHashes ? [input.targetPayloadHashes] : []),
    ...(input.expectedPayloadHash ? [input.expectedPayloadHash] : []),
    // 서버 fence 대상도 있을 때만 붙인다(배열 위치가 아니라 key로 구분해 targetPayloadHashes와 섞이지 않는다).
    ...(input.supersededOperationIds ? [{ supersededOperationIds: input.supersededOperationIds }] : []),
  ]);
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}
