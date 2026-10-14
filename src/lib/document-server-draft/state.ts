import type { DbContext } from "@/db/client";
import {
  type StoredDraft,
  findStoredDraft,
  type StoredOperation,
  findOperation,
} from "@/lib/document-server-draft/queries";
import {
  type DocumentServerDraftSnapshot,
  canonicalizeDocumentServerDraftPayload,
  parseDocumentServerDraftDeviceId,
  type DocumentServerDraftMutationResult,
} from "@/lib/document-server-draft-contract";
import {
  type DocumentServerDraftOperationType,
  DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
} from "@/lib/document-server-draft-constants";

export function toSnapshot(draft: StoredDraft): DocumentServerDraftSnapshot {
  const payload = canonicalizeDocumentServerDraftPayload(draft.payloadJson);
  const payloadBaseRevision = payload?.data.baseRevision;
  const baseRevisionMatches = payload && (
    "baseRevision" in payload.data
      ? typeof payloadBaseRevision === "number" &&
        Number.isSafeInteger(payloadBaseRevision) &&
        payloadBaseRevision >= 1 &&
        payloadBaseRevision === draft.baseResourceVersion
      : draft.baseResourceVersion === null
  );
  if (
    !payload ||
    payload.payloadJson !== draft.payloadJson ||
    payload.payloadHash !== draft.payloadHash ||
    !baseRevisionMatches ||
    !parseDocumentServerDraftDeviceId(draft.writerDeviceId)
  ) {
    throw new Error("Stored document server draft violates the payload contract");
  }
  return {
    sourceKey: draft.sourceKey,
    kind: draft.kind,
    contextId: draft.contextId,
    payloadJson: draft.payloadJson,
    payloadHash: draft.payloadHash,
    draftVersion: draft.draftVersion,
    baseResourceVersion: draft.baseResourceVersion,
    writerDeviceId: draft.writerDeviceId,
    updatedAt: draft.updatedAt.getTime(),
    expiresAt: draft.expiresAt.getTime(),
  };
}

export function isActiveDraft(draft: StoredDraft | null, now: Date): draft is StoredDraft {
  return Boolean(draft && draft.expiresAt.getTime() > now.getTime());
}

export async function readCurrentSnapshot(
  context: DbContext,
  ownerId: string,
  sourceKey: string,
  now: Date,
): Promise<DocumentServerDraftSnapshot | null> {
  const draft = await findStoredDraft(context, ownerId, sourceKey);
  return isActiveDraft(draft, now) ? toSnapshot(draft) : null;
}

function classifyOperationReplay(
  operation: StoredOperation,
  expected: {
    sourceKey: string;
    operationType: DocumentServerDraftOperationType;
    requestHash: string;
  },
): "exact" | "conflict" | "unsupported" {
  if (operation.requestHashVersion !== DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION) {
    return "unsupported";
  }
  return operation.sourceKey === expected.sourceKey &&
    operation.operationType === expected.operationType &&
    operation.requestHash === expected.requestHash
    ? "exact"
    : "conflict";
}

export async function replayExistingOperation(
  context: DbContext,
  operation: StoredOperation,
  expected: {
    ownerId: string;
    sourceKey: string;
    operationType: DocumentServerDraftOperationType;
    requestHash: string;
    now: Date;
  },
): Promise<DocumentServerDraftMutationResult> {
  const current = await readCurrentSnapshot(
    context,
    expected.ownerId,
    expected.sourceKey,
    expected.now,
  );
  const classification = classifyOperationReplay(operation, expected);
  if (classification === "conflict") {
    return { ok: false, reason: "OPERATION_PAYLOAD_CONFLICT", current };
  }
  if (classification === "unsupported") {
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE", current };
  }
  return {
    ok: true,
    replayed: true,
    operationResultVersion: operation.resultVersion,
    current,
  };
}

export async function classifyWriteFailure(
  context: DbContext,
  input: {
    ownerId: string;
    sourceKey: string;
    operationId: string;
    operationType: DocumentServerDraftOperationType;
    requestHash: string;
    expectedDraftVersion: number;
    targetPayloadHashes?: readonly string[];
    expectedPayloadHash?: string;
    now: Date;
  },
): Promise<DocumentServerDraftMutationResult> {
  const operation = await findOperation(context, input.ownerId, input.operationId);
  if (operation) return replayExistingOperation(context, operation, input);

  const current = await readCurrentSnapshot(
    context,
    input.ownerId,
    input.sourceKey,
    input.now,
  );
  if (current && (current.draftVersion !== input.expectedDraftVersion ||
    (input.operationType === "UPSERT" && current.payloadHash !== input.expectedPayloadHash) ||
    (input.targetPayloadHashes && !input.targetPayloadHashes.includes(current.payloadHash)))) {
    return { ok: false, reason: "VERSION_CONFLICT", current };
  }
  if (!current && input.expectedDraftVersion !== 0) {
    return { ok: false, reason: "VERSION_CONFLICT", current: null };
  }
  return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE", current };
}
