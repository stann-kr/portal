import type { DbContext } from "@/db/client";
import type { DocumentServerDraftKind } from "@/db/schema";
import {
  type DocumentServerDraftOperationType,
  type DocumentServerDraftResultState,
  DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
  DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS,
} from "@/lib/document-server-draft-constants";
import type {
  DocumentServerDraftSnapshot,
  DocumentServerDraftMutationResult,
} from "@/lib/document-server-draft-contract";
import {
  findStoredDraft,
  findOperation,
} from "@/lib/document-server-draft/queries";
import {
  isActiveDraft,
  toSnapshot,
  replayExistingOperation,
  classifyWriteFailure,
  readCurrentSnapshot,
} from "@/lib/document-server-draft/state";
import {
  executeDocumentStatementsAtomically as executeAtomically,
  type DocumentAtomicStatement as AtomicStatement,
} from "@/lib/document-lifecycle-atomic";

export { pruneExpiredDocumentServerDraftState } from "@/lib/document-server-draft/queries";

export type SaveDocumentServerDraftWrite = {
  ownerId: string;
  sourceKey: string;
  kind: DocumentServerDraftKind;
  contextId: string;
  operationId: string;
  requestHash: string;
  expectedDraftVersion: number;
  expectedPayloadHash?: string;
  payloadJson: string;
  payloadHash: string;
  baseResourceVersion: number | null;
  writerDeviceId: string;
  now: Date;
};

export type DiscardDocumentServerDraftWrite = {
  ownerId: string;
  sourceKey: string;
  operationId: string;
  requestHash: string;
  expectedDraftVersion: number;
  targetPayloadHashes?: readonly string[];
  now: Date;
};

const CONDITIONAL_WRITE_SENTINEL: AtomicStatement = {
  query:
    "INSERT INTO document_batch_abort_guard (reason) " +
    "SELECT 'DOCUMENT_SERVER_DRAFT_CONDITIONAL_WRITE' WHERE changes() <> 1",
};

function epochSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

function createOperationInsertStatement(input: {
  ownerId: string;
  operationId: string;
  sourceKey: string;
  operationType: DocumentServerDraftOperationType;
  requestHash: string;
  resultVersion: number;
  resultState: DocumentServerDraftResultState;
  nowSeconds: number;
}): AtomicStatement {
  return {
    query: `
      INSERT INTO document_server_draft_operations (
        owner_id, operation_id, source_key, operation_type,
        request_hash, request_hash_version, result_version, result_state,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      input.ownerId,
      input.operationId,
      input.sourceKey,
      input.operationType,
      input.requestHash,
      DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
      input.resultVersion,
      input.resultState,
      input.nowSeconds,
      input.nowSeconds + DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS,
    ],
  };
}

export async function getActiveDocumentServerDraft(
  context: DbContext,
  ownerId: string,
  sourceKey: string,
  now: Date,
): Promise<DocumentServerDraftSnapshot | null> {
  const draft = await findStoredDraft(context, ownerId, sourceKey);
  return isActiveDraft(draft, now) ? toSnapshot(draft) : null;
}

export async function saveDocumentServerDraftAtomically(
  context: DbContext,
  write: SaveDocumentServerDraftWrite,
): Promise<DocumentServerDraftMutationResult> {
  const existingOperation = await findOperation(
    context,
    write.ownerId,
    write.operationId,
  );
  if (existingOperation) {
    return replayExistingOperation(context, existingOperation, {
      ...write,
      operationType: "UPSERT",
    });
  }

  const stored = await findStoredDraft(context, write.ownerId, write.sourceKey);
  const current = isActiveDraft(stored, write.now) ? stored : null;
  if (current && (current.draftVersion !== write.expectedDraftVersion ||
    current.payloadHash !== write.expectedPayloadHash)) {
    return {
      ok: false,
      reason: "VERSION_CONFLICT",
      current: current ? toSnapshot(current) : null,
    };
  }
  if (!current && write.expectedDraftVersion !== 0) {
    return { ok: false, reason: "VERSION_CONFLICT", current: null };
  }

  const nowSeconds = epochSeconds(write.now);
  const expiresAt = nowSeconds + DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS;
  const samePayload = Boolean(
    current &&
      current.payloadHash === write.payloadHash &&
      current.baseResourceVersion === write.baseResourceVersion,
  );
  const resultVersion = samePayload
    ? write.expectedDraftVersion
    : write.expectedDraftVersion + 1;
  const operationStatement = createOperationInsertStatement({
    ...write,
    operationType: "UPSERT",
    resultVersion,
    resultState: "PRESENT",
    nowSeconds,
  });

  const statements: AtomicStatement[] = [];
  if (!current && stored) {
    statements.push({
      query:
        "DELETE FROM document_server_drafts " +
        "WHERE owner_id = ? AND source_key = ? AND expires_at <= ?",
      params: [write.ownerId, write.sourceKey, nowSeconds],
    });
  }
  statements.push(operationStatement);

  if (!current) {
    statements.push({
      query: `
        INSERT INTO document_server_drafts (
          owner_id, source_key, document_kind, context_id,
          payload_json, payload_hash, draft_version, base_resource_version,
          writer_device_id, created_at, updated_at, expires_at
        )
        SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM profiles WHERE id = ?)
      `,
      params: [
        write.ownerId,
        write.sourceKey,
        write.kind,
        write.contextId,
        write.payloadJson,
        write.payloadHash,
        write.baseResourceVersion,
        write.writerDeviceId,
        nowSeconds,
        nowSeconds,
        expiresAt,
        write.ownerId,
      ],
    });
    statements.push(CONDITIONAL_WRITE_SENTINEL);
  } else if (samePayload) {
    statements[statements.length - 1] = {
      query: `
        INSERT INTO document_server_draft_operations (
          owner_id, operation_id, source_key, operation_type,
          request_hash, request_hash_version, result_version, result_state,
          created_at, expires_at
        )
        SELECT ?, ?, ?, 'UPSERT', ?, ?, ?, 'PRESENT', ?, ?
        FROM document_server_drafts
        WHERE owner_id = ? AND source_key = ? AND draft_version = ?
          AND payload_hash = ? AND base_resource_version IS ? AND expires_at > ?
      `,
      params: [
        write.ownerId,
        write.operationId,
        write.sourceKey,
        write.requestHash,
        DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
        resultVersion,
        nowSeconds,
        expiresAt,
        write.ownerId,
        write.sourceKey,
        write.expectedDraftVersion,
        write.payloadHash,
        write.baseResourceVersion,
        nowSeconds,
      ],
    };
    statements.push(CONDITIONAL_WRITE_SENTINEL);
  } else {
    statements.push({
      query: `
        UPDATE document_server_drafts
        SET payload_json = ?, payload_hash = ?, draft_version = draft_version + 1,
            base_resource_version = ?, writer_device_id = ?,
            updated_at = ?, expires_at = ?
        WHERE owner_id = ? AND source_key = ? AND draft_version = ? AND expires_at > ? AND payload_hash = ?
      `,
      params: [
        write.payloadJson,
        write.payloadHash,
        write.baseResourceVersion,
        write.writerDeviceId,
        nowSeconds,
        expiresAt,
        write.ownerId,
        write.sourceKey,
        write.expectedDraftVersion,
        nowSeconds,
        write.expectedPayloadHash ?? null,
      ],
    });
    statements.push(CONDITIONAL_WRITE_SENTINEL);
  }

  try {
    await executeAtomically(context, statements);
  } catch {
    return classifyWriteFailure(context, {
      ...write,
      operationType: "UPSERT",
    });
  }

  return {
    ok: true,
    replayed: false,
    operationResultVersion: resultVersion,
    current: await readCurrentSnapshot(
      context,
      write.ownerId,
      write.sourceKey,
      write.now,
    ),
  };
}

export async function discardDocumentServerDraftAtomically(
  context: DbContext,
  write: DiscardDocumentServerDraftWrite,
): Promise<DocumentServerDraftMutationResult> {
  const existingOperation = await findOperation(
    context,
    write.ownerId,
    write.operationId,
  );
  if (existingOperation) {
    return replayExistingOperation(context, existingOperation, {
      ...write,
      operationType: "DISCARD",
    });
  }

  const stored = await findStoredDraft(context, write.ownerId, write.sourceKey);
  const current = isActiveDraft(stored, write.now) ? stored : null;
  if (current && (current.draftVersion !== write.expectedDraftVersion ||
    (write.targetPayloadHashes && !write.targetPayloadHashes.includes(current.payloadHash)))) {
    return {
      ok: false,
      reason: "VERSION_CONFLICT",
      current: current ? toSnapshot(current) : null,
    };
  }
  if (!current && write.expectedDraftVersion !== 0) {
    return { ok: false, reason: "VERSION_CONFLICT", current: null };
  }

  const nowSeconds = epochSeconds(write.now);
  const expiresAt = nowSeconds + DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS;
  const operationStatement = current
    ? createOperationInsertStatement({
        ...write,
        operationType: "DISCARD",
        resultVersion: write.expectedDraftVersion,
        resultState: "DISCARDED",
        nowSeconds,
      })
    : {
        query: `
          INSERT INTO document_server_draft_operations (
            owner_id, operation_id, source_key, operation_type,
            request_hash, request_hash_version, result_version, result_state,
            created_at, expires_at
          )
          SELECT ?, ?, ?, 'DISCARD', ?, ?, 0, 'DISCARDED', ?, ?
          WHERE EXISTS (SELECT 1 FROM profiles WHERE id = ?)
        `,
        params: [
          write.ownerId,
          write.operationId,
          write.sourceKey,
          write.requestHash,
          DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
          nowSeconds,
          expiresAt,
          write.ownerId,
        ],
      } satisfies AtomicStatement;

  const statements: AtomicStatement[] = [];
  if (!current && stored) {
    statements.push({
      query:
        "DELETE FROM document_server_drafts " +
        "WHERE owner_id = ? AND source_key = ? AND expires_at <= ?",
      params: [write.ownerId, write.sourceKey, nowSeconds],
    });
  }
  statements.push(operationStatement);
  if (current) {
    statements.push({
      query:
        "DELETE FROM document_server_drafts " +
        "WHERE owner_id = ? AND source_key = ? AND draft_version = ? AND expires_at > ?" +
        (write.targetPayloadHashes ? ` AND payload_hash IN (${write.targetPayloadHashes.map(() => "?").join(", ")})` : ""),
      params: [
        write.ownerId,
        write.sourceKey,
        write.expectedDraftVersion,
        nowSeconds,
        ...(write.targetPayloadHashes ?? []),
      ],
    });
    statements.push(CONDITIONAL_WRITE_SENTINEL);
  } else {
    statements.push(CONDITIONAL_WRITE_SENTINEL);
  }

  try {
    await executeAtomically(context, statements);
  } catch {
    return classifyWriteFailure(context, {
      ...write,
      operationType: "DISCARD",
    });
  }

  return {
    ok: true,
    replayed: false,
    operationResultVersion: current?.draftVersion ?? 0,
    current: await readCurrentSnapshot(context, write.ownerId, write.sourceKey, write.now),
  };
}
