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
  findOperationsByIds,
  type StoredDraft,
  type StoredOperationWithTime,
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
  /** 서버 fence 대상(`DiscardDocumentServerDraftInput.supersededOperationIds`). 검증·정렬은 action이 끝낸다. */
  supersededOperationIds?: readonly string[];
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

/**
 * 서버 fence(a): superseded UPSERT의 receipt를 DISCARD/DISCARDED/0으로 "없을 때만" 선점한다. 늦게 도착한 같은
 * operation ID의 저장은 `findOperation`에 걸려 replay 분류 불일치(OPERATION_PAYLOAD_CONFLICT)로 끝나 쓰지 않는다.
 * 0행 INSERT면 중복 trigger도 타지 않으므로 멱등이고, `changes()` 검사와 섞이지 않게 별도 batch로 먼저 보낸다.
 */
function createSupersededFenceStatements(
  write: DiscardDocumentServerDraftWrite,
  nowSeconds: number,
): AtomicStatement[] {
  return (write.supersededOperationIds ?? []).map((operationId) => ({
    query: `
      INSERT INTO document_server_draft_operations (
        owner_id, operation_id, source_key, operation_type,
        request_hash, request_hash_version, result_version, result_state,
        created_at, expires_at
      )
      SELECT ?, ?, ?, 'DISCARD', ?, ?, 0, 'DISCARDED', ?, ?
      WHERE EXISTS (SELECT 1 FROM profiles WHERE id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM document_server_draft_operations WHERE owner_id = ? AND operation_id = ?
        )
    `,
    params: [
      write.ownerId,
      operationId,
      write.sourceKey,
      write.requestHash,
      DOCUMENT_SERVER_DRAFT_REQUEST_HASH_VERSION,
      nowSeconds,
      nowSeconds + DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS,
      write.ownerId,
      write.ownerId,
      operationId,
    ],
  }));
}

/**
 * 서버 fence(b): 현재 서버본이 superseded UPSERT가 만든 것인지. 저장 batch는 receipt `created_at`과 서버본
 * `updated_at`에 같은 초를 쓰고 `result_version`이 그때의 `draft_version`이므로, 같은 sourceKey의 UPSERT receipt가
 * 둘 다 일치하고 **현재 본문 hash가 폐기 대상(`targetPayloadHashes`)에 있을 때** 그 요청이 만든 행으로 본다
 * (클라이언트는 superseded UPSERT의 본문 hash를 대상에 넣어 보낸다). version과 초만으로는 생성 operation을
 * 증명할 수 없다: A 저장(v1)→A 폐기→같은 초에 다른 기기 B가 다른 본문을 저장(새 행 v1)하면 version이 재사용된다.
 * 남는 한계: 같은 초·같은 version에 **같은 본문**을 다시 쓴 행은 superseded로 보고 지운다(본문이 같으므로
 * 폐기 의도에 포함된다). 같은 payload 재저장 receipt는 행을 갱신하지 않아 해당하지 않는다.
 */
function isProducedBySupersededOperation(
  current: StoredDraft,
  write: Pick<DiscardDocumentServerDraftWrite, "sourceKey" | "targetPayloadHashes">,
  operations: readonly StoredOperationWithTime[],
): boolean {
  if (!write.targetPayloadHashes?.includes(current.payloadHash)) return false;
  const updatedAtSeconds = epochSeconds(current.updatedAt);
  return operations.some((operation) =>
    operation.operationType === "UPSERT" &&
    operation.sourceKey === write.sourceKey &&
    operation.resultVersion === current.draftVersion &&
    epochSeconds(operation.createdAt) === updatedAtSeconds);
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

  const nowSeconds = epochSeconds(write.now);
  const fenceStatements = createSupersededFenceStatements(write, nowSeconds);
  // 폐기 의도는 CAS 결과와 무관하게 유효하다: 아래에서 VERSION_CONFLICT로 끝나더라도 늦은 저장은 막아야 한다.
  if (fenceStatements.length > 0) await executeAtomically(context, fenceStatements);

  const stored = await findStoredDraft(context, write.ownerId, write.sourceKey);
  const current = isActiveDraft(stored, write.now) ? stored : null;
  const producedBySuperseded = Boolean(
    current && write.supersededOperationIds?.length &&
      isProducedBySupersededOperation(
        current,
        write,
        await findOperationsByIds(context, write.ownerId, write.supersededOperationIds),
      ),
  );
  if (current && !producedBySuperseded && (current.draftVersion !== write.expectedDraftVersion ||
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

  const expiresAt = nowSeconds + DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS;
  const operationStatement = current
    ? createOperationInsertStatement({
        ...write,
        operationType: "DISCARD",
        resultVersion: current.draftVersion,
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
  if (current && producedBySuperseded) {
    // superseded 요청이 만든 행(본문 hash가 대상에 있음)은 version이 요청과 달라도 지운다. 그 사이 바뀌었으면 changes()=0으로 중단된다.
    statements.push({
      query:
        "DELETE FROM document_server_drafts " +
        "WHERE owner_id = ? AND source_key = ? AND draft_version = ? AND payload_hash = ? AND expires_at > ?",
      params: [write.ownerId, write.sourceKey, current.draftVersion, current.payloadHash, nowSeconds],
    });
    statements.push(CONDITIONAL_WRITE_SENTINEL);
  } else if (current) {
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
