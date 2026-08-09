import { and, eq } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import {
  documentOperationLedger,
  documentTombstones,
  type DocumentOperationType,
  type DocumentResourceType,
} from "@/db/schema";

export type DocumentAtomicActor = {
  id: string;
  isAdmin: boolean;
};

export type DocumentAtomicStatement = {
  query: string;
  params?: readonly unknown[];
};

export const DOCUMENT_CONDITIONAL_WRITE_SENTINEL: DocumentAtomicStatement = {
  query:
    "INSERT INTO document_batch_abort_guard (reason) " +
    "SELECT 'CONDITIONAL_WRITE' WHERE changes() <> 1",
};

export function documentEpochSeconds(value: Date | null): number | null {
  return value ? Math.floor(value.getTime() / 1000) : null;
}

export function persistedDocumentDate(value: Date): Date {
  return new Date(documentEpochSeconds(value)! * 1000);
}

export function asDocumentReadDb(context: DbContext): DrizzleDb {
  return context.db as unknown as DrizzleDb;
}

export async function executeDocumentStatementsAtomically(
  context: DbContext,
  statements: readonly DocumentAtomicStatement[],
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

export async function findDocumentOperationReceipt(
  context: DbContext,
  actorId: string,
  operationId: string,
) {
  const [receipt] = await asDocumentReadDb(context)
    .select()
    .from(documentOperationLedger)
    .where(
      and(
        eq(documentOperationLedger.actorId, actorId),
        eq(documentOperationLedger.operationId, operationId),
      ),
    )
    .limit(1);
  return receipt ?? null;
}

export async function findDocumentTombstone(
  context: DbContext,
  resourceType: DocumentResourceType,
  resourceId: string,
) {
  const [tombstone] = await asDocumentReadDb(context)
    .select()
    .from(documentTombstones)
    .where(
      and(
        eq(documentTombstones.resourceType, resourceType),
        eq(documentTombstones.resourceId, resourceId),
      ),
    )
    .limit(1);
  return tombstone ?? null;
}

export function documentLedgerInsertStatement(input: {
  recordId: string;
  operationId: string;
  actorId: string;
  subjectId: string;
  resourceType: DocumentResourceType;
  operationType: DocumentOperationType;
  resourceId: string;
  requestHash: string;
  requestHashVersion: number;
  resultRevision: number;
  now: Date;
}): DocumentAtomicStatement {
  return {
    query: `
      INSERT INTO document_operation_ledger (
        id, operation_id, actor_id, subject_id, resource_type,
        operation_type, resource_id, request_hash, request_hash_version,
        result_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      input.recordId,
      input.operationId,
      input.actorId,
      input.subjectId,
      input.resourceType,
      input.operationType,
      input.resourceId,
      input.requestHash,
      input.requestHashVersion,
      input.resultRevision,
      documentEpochSeconds(input.now),
    ],
  };
}
