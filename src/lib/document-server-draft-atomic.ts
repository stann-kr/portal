import { and, eq, lte } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import {
  documentServerDraftOperations,
  documentServerDrafts,
} from "@/db/schema";
import {
  DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
  DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS,
  type DocumentServerDraftOperationType,
  type DocumentServerDraftResultState,
} from "@/lib/document-server-draft-constants";
import {
  canonicalizeDocumentServerDraftPayload,
  parseDocumentServerDraftDeviceId,
  type DocumentServerDraftMutationResult,
  type DocumentServerDraftSnapshot,
} from "@/lib/document-server-draft-contract";
import type { DocumentDraftKind } from "@/lib/form-draft";

type AtomicStatement = {
  query: string;
  params?: readonly unknown[];
};

type StoredDraft = {
  sourceKey: string;
  kind: DocumentDraftKind;
  contextId: string;
  payloadJson: string;
  payloadHash: string;
  draftVersion: number;
  baseResourceVersion: number | null;
  writerDeviceId: string;
  updatedAt: Date;
  expiresAt: Date;
};

type StoredOperation = {
  operationId: string;
  sourceKey: string;
  operationType: DocumentServerDraftOperationType;
  requestHash: string;
  requestHashVersion: number;
  resultVersion: number;
  resultState: DocumentServerDraftResultState;
};

export type SaveDocumentServerDraftWrite = {
  ownerId: string;
  sourceKey: string;
  kind: DocumentDraftKind;
  contextId: string;
  operationId: string;
  requestHash: string;
  expectedDraftVersion: number;
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
  now: Date;
};

const CONDITIONAL_WRITE_SENTINEL: AtomicStatement = {
  query:
    "INSERT INTO document_batch_abort_guard (reason) " +
    "SELECT 'DOCUMENT_SERVER_DRAFT_CONDITIONAL_WRITE' WHERE changes() <> 1",
};

function asReadDb(context: DbContext): DrizzleDb {
  return context.db as unknown as DrizzleDb;
}

function epochSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

function toSnapshot(draft: StoredDraft): DocumentServerDraftSnapshot {
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

async function executeAtomically(
  context: DbContext,
  statements: readonly AtomicStatement[],
): Promise<void> {
  if (context.kind === "d1") {
    await context.db.$client.batch(
      statements.map((statement) =>
        context.db.$client
          .prepare(statement.query)
          .bind(...(statement.params ?? [])),
      ),
    );
    return;
  }

  context.db.$client.transaction(() => {
    for (const statement of statements) {
      context.db.$client
        .prepare(statement.query)
        .run(...(statement.params ?? []));
    }
  })();
}

async function findStoredDraft(
  context: DbContext,
  ownerId: string,
  sourceKey: string,
): Promise<StoredDraft | null> {
  const [draft] = await asReadDb(context)
    .select({
      sourceKey: documentServerDrafts.sourceKey,
      kind: documentServerDrafts.documentKind,
      contextId: documentServerDrafts.contextId,
      payloadJson: documentServerDrafts.payloadJson,
      payloadHash: documentServerDrafts.payloadHash,
      draftVersion: documentServerDrafts.draftVersion,
      baseResourceVersion: documentServerDrafts.baseResourceVersion,
      writerDeviceId: documentServerDrafts.writerDeviceId,
      updatedAt: documentServerDrafts.updatedAt,
      expiresAt: documentServerDrafts.expiresAt,
    })
    .from(documentServerDrafts)
    .where(
      and(
        eq(documentServerDrafts.ownerId, ownerId),
        eq(documentServerDrafts.sourceKey, sourceKey),
      ),
    )
    .limit(1);
  return draft ?? null;
}

async function findOperation(
  context: DbContext,
  ownerId: string,
  operationId: string,
): Promise<StoredOperation | null> {
  const [operation] = await asReadDb(context)
    .select({
      operationId: documentServerDraftOperations.operationId,
      sourceKey: documentServerDraftOperations.sourceKey,
      operationType: documentServerDraftOperations.operationType,
      requestHash: documentServerDraftOperations.requestHash,
      requestHashVersion: documentServerDraftOperations.requestHashVersion,
      resultVersion: documentServerDraftOperations.resultVersion,
      resultState: documentServerDraftOperations.resultState,
    })
    .from(documentServerDraftOperations)
    .where(
      and(
        eq(documentServerDraftOperations.ownerId, ownerId),
        eq(documentServerDraftOperations.operationId, operationId),
      ),
    )
    .limit(1);
  return operation ?? null;
}

function isActiveDraft(draft: StoredDraft | null, now: Date): draft is StoredDraft {
  return Boolean(draft && draft.expiresAt.getTime() > now.getTime());
}

async function readCurrentSnapshot(
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

async function replayExistingOperation(
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

async function classifyWriteFailure(
  context: DbContext,
  input: {
    ownerId: string;
    sourceKey: string;
    operationId: string;
    operationType: DocumentServerDraftOperationType;
    requestHash: string;
    expectedDraftVersion: number;
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
  if (current && current.draftVersion !== input.expectedDraftVersion) {
    return { ok: false, reason: "VERSION_CONFLICT", current };
  }
  if (!current && input.expectedDraftVersion !== 0) {
    return { ok: false, reason: "VERSION_CONFLICT", current: null };
  }
  return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE", current };
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

export async function pruneExpiredDocumentServerDraftState(
  context: DbContext,
  now: Date,
  ownerId?: string,
): Promise<void> {
  const cutoff = now;
  const operationPredicate = ownerId
    ? and(
        eq(documentServerDraftOperations.ownerId, ownerId),
        lte(documentServerDraftOperations.expiresAt, cutoff),
      )
    : lte(documentServerDraftOperations.expiresAt, cutoff);
  const draftPredicate = ownerId
    ? and(
        eq(documentServerDrafts.ownerId, ownerId),
        lte(documentServerDrafts.expiresAt, cutoff),
      )
    : lte(documentServerDrafts.expiresAt, cutoff);
  await asReadDb(context)
    .delete(documentServerDraftOperations)
    .where(operationPredicate);
  await asReadDb(context).delete(documentServerDrafts).where(draftPredicate);
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
  if (current && current.draftVersion !== write.expectedDraftVersion) {
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
        WHERE owner_id = ? AND source_key = ? AND draft_version = ? AND expires_at > ?
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
  if (current && current.draftVersion !== write.expectedDraftVersion) {
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
        "WHERE owner_id = ? AND source_key = ? AND draft_version = ? AND expires_at > ?",
      params: [
        write.ownerId,
        write.sourceKey,
        write.expectedDraftVersion,
        nowSeconds,
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
    current: null,
  };
}
