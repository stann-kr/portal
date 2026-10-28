"use server";

import { createDbContext } from "@/db/client";
import { requireAuth } from "@/lib/auth-guard";
import { parseCreationOperationId } from "@/lib/creation-operation";
import {
  canonicalizeDocumentServerDraftPayload,
  createDocumentServerDraftRequestHash,
  isDocumentServerDraftPayloadTooLarge,
  parseDocumentServerDraftBaseResourceVersion,
  parseDocumentServerDraftDeviceId,
  parseDocumentServerDraftVersion,
  parseDocumentServerDraftTargetHashes,
  parseDocumentServerDraftExpectedHash,
  validateDocumentServerDraftSource,
  type DiscardDocumentServerDraftInput,
  type DocumentServerDraftMutationResult,
  type ReadDocumentServerDraftResult,
  type SaveDocumentServerDraftInput,
} from "@/lib/document-server-draft-contract";
import {
  discardDocumentServerDraftAtomically,
  getActiveDocumentServerDraft,
  pruneExpiredDocumentServerDraftState,
  saveDocumentServerDraftAtomically,
} from "@/lib/document-server-draft-atomic";

const DOCUMENT_SERVER_DRAFT_MAX_SOURCE_KEY_LENGTH = 2_048;

function hasValidSourceKeyLength(sourceKey: string): boolean {
  return sourceKey.length > 0 &&
    sourceKey.length <= DOCUMENT_SERVER_DRAFT_MAX_SOURCE_KEY_LENGTH;
}

function payloadBaseRevisionMatches(
  payload: Record<string, unknown>,
  baseResourceVersion: number | null,
): boolean {
  if (!("baseRevision" in payload)) return baseResourceVersion === null;
  const payloadVersion = payload.baseRevision;
  return typeof payloadVersion === "number" &&
    Number.isSafeInteger(payloadVersion) &&
    payloadVersion >= 1 &&
    payloadVersion === baseResourceVersion;
}

export async function readDocumentServerDraft(
  sourceKey: string,
): Promise<ReadDocumentServerDraftResult> {
  const session = await requireAuth();
  if (
    typeof sourceKey !== "string" ||
    !hasValidSourceKeyLength(sourceKey) ||
    !validateDocumentServerDraftSource(sourceKey, session.user.id, session.user.role)
  ) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  const context = createDbContext();
  const now = new Date();
  try {
    await pruneExpiredDocumentServerDraftState(context, now, session.user.id);
    return {
      ok: true,
      draft: await getActiveDocumentServerDraft(
        context,
        session.user.id,
        sourceKey,
        now,
      ),
    };
  } catch {
    console.error("[document-server-draft] read failed");
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
  }
}

export async function saveDocumentServerDraft(
  input: SaveDocumentServerDraftInput,
): Promise<DocumentServerDraftMutationResult> {
  const session = await requireAuth();
  const identity = typeof input?.sourceKey === "string" &&
    hasValidSourceKeyLength(input.sourceKey)
    ? validateDocumentServerDraftSource(input.sourceKey, session.user.id, session.user.role)
    : null;
  const operationId = parseCreationOperationId(input?.operationId);
  const expectedDraftVersion = parseDocumentServerDraftVersion(
    input?.expectedDraftVersion,
  );
  const baseResourceVersion = parseDocumentServerDraftBaseResourceVersion(
    input?.baseResourceVersion,
  );
  const writerDeviceId = parseDocumentServerDraftDeviceId(input?.writerDeviceId);
  const expectedPayloadHash = parseDocumentServerDraftExpectedHash(input?.expectedPayloadHash);
  if (
    !identity ||
    !operationId ||
    expectedDraftVersion === null ||
    baseResourceVersion === undefined ||
    !writerDeviceId ||
    expectedPayloadHash === null ||
    (expectedDraftVersion === 0 && expectedPayloadHash !== undefined) ||
    typeof input?.payloadJson !== "string"
  ) {
    return { ok: false, reason: "INVALID_INPUT", current: null };
  }
  if (isDocumentServerDraftPayloadTooLarge(input.payloadJson)) {
    return { ok: false, reason: "PAYLOAD_TOO_LARGE", current: null };
  }
  const payload = canonicalizeDocumentServerDraftPayload(input.payloadJson);
  if (!payload || !payloadBaseRevisionMatches(payload.data, baseResourceVersion)) {
    return { ok: false, reason: "INVALID_INPUT", current: null };
  }

  const context = createDbContext();
  const now = new Date();
  try {
    await pruneExpiredDocumentServerDraftState(context, now, session.user.id);
    return await saveDocumentServerDraftAtomically(context, {
      ownerId: session.user.id,
      sourceKey: input.sourceKey,
      kind: identity.kind,
      contextId: identity.contextId,
      operationId,
      requestHash: createDocumentServerDraftRequestHash({
        operationType: "UPSERT",
        sourceKey: input.sourceKey,
        expectedDraftVersion,
        payloadHash: payload.payloadHash,
        baseResourceVersion,
        writerDeviceId,
        expectedPayloadHash,
      }),
      expectedDraftVersion,
      expectedPayloadHash,
      payloadJson: payload.payloadJson,
      payloadHash: payload.payloadHash,
      baseResourceVersion,
      writerDeviceId,
      now,
    });
  } catch {
    console.error("[document-server-draft] save failed");
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE", current: null };
  }
}

export async function discardDocumentServerDraft(
  input: DiscardDocumentServerDraftInput,
): Promise<DocumentServerDraftMutationResult> {
  const session = await requireAuth();
  const identity = typeof input?.sourceKey === "string" &&
    hasValidSourceKeyLength(input.sourceKey)
    ? validateDocumentServerDraftSource(input.sourceKey, session.user.id, session.user.role)
    : null;
  const operationId = parseCreationOperationId(input?.operationId);
  const expectedDraftVersion = parseDocumentServerDraftVersion(
    input?.expectedDraftVersion,
  );
  const targetPayloadHashes = parseDocumentServerDraftTargetHashes(input?.targetPayloadHashes);
  if (!identity || !operationId || expectedDraftVersion === null || targetPayloadHashes === null) {
    return { ok: false, reason: "INVALID_INPUT", current: null };
  }

  const context = createDbContext();
  const now = new Date();
  try {
    await pruneExpiredDocumentServerDraftState(context, now, session.user.id);
    return await discardDocumentServerDraftAtomically(context, {
      ownerId: session.user.id,
      sourceKey: input.sourceKey,
      operationId,
      requestHash: createDocumentServerDraftRequestHash({
        operationType: "DISCARD",
        sourceKey: input.sourceKey,
        expectedDraftVersion,
        targetPayloadHashes,
      }),
      expectedDraftVersion,
      targetPayloadHashes,
      now,
    });
  } catch {
    console.error("[document-server-draft] discard failed");
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE", current: null };
  }
}
