import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { parseCreationOperationId } from "@/lib/creation-operation";
import {
  parseDocumentDraftKey,
  serializeNormalizedFormDraftData,
  type DocumentDraftKind,
} from "@/lib/form-draft";
import {
  DOCUMENT_SERVER_DRAFT_MAX_PAYLOAD_BYTES,
  DOCUMENT_SERVER_DRAFT_PAYLOAD_VERSION,
  DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
  type DocumentServerDraftOperationType,
} from "@/lib/document-server-draft-constants";

export type DocumentServerDraftSnapshot = {
  sourceKey: string;
  kind: DocumentDraftKind;
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
  payloadJson: string;
  baseResourceVersion: number | null;
  writerDeviceId: string;
};

export type DiscardDocumentServerDraftInput = {
  sourceKey: string;
  operationId: string;
  expectedDraftVersion: number;
};

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
) {
  const identity = parseDocumentDraftKey(sourceKey);
  return identity?.ownerId === ownerId ? identity : null;
}

export function createDocumentServerDraftRequestHash(input: {
  operationType: DocumentServerDraftOperationType;
  sourceKey: string;
  expectedDraftVersion: number;
  payloadHash?: string;
  baseResourceVersion?: number | null;
  writerDeviceId?: string;
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
  ]);
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}
