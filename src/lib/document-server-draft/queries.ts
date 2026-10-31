import { and, eq, inArray, lte } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import type { DocumentServerDraftKind } from "@/db/schema";
import type {
  DocumentServerDraftOperationType,
  DocumentServerDraftResultState,
} from "@/lib/document-server-draft-constants";
import {
  documentServerDrafts,
  documentServerDraftOperations,
} from "@/db/schema";

export type StoredDraft = {
  sourceKey: string;
  kind: DocumentServerDraftKind;
  contextId: string;
  payloadJson: string;
  payloadHash: string;
  draftVersion: number;
  baseResourceVersion: number | null;
  writerDeviceId: string;
  updatedAt: Date;
  expiresAt: Date;
};

export type StoredOperation = {
  operationId: string;
  sourceKey: string;
  operationType: DocumentServerDraftOperationType;
  requestHash: string;
  requestHashVersion: number;
  resultVersion: number;
  resultState: DocumentServerDraftResultState;
};

function asReadDb(context: DbContext): DrizzleDb {
  return context.db as unknown as DrizzleDb;
}

export async function findStoredDraft(
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

export async function findOperation(
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

export type StoredOperationWithTime = StoredOperation & { createdAt: Date };

/** 서버 fence(b): 폐기가 superseded로 지목한 operation ID들의 receipt를 한 번에 읽는다. */
export async function findOperationsByIds(
  context: DbContext,
  ownerId: string,
  operationIds: readonly string[],
): Promise<StoredOperationWithTime[]> {
  if (operationIds.length === 0) return [];
  return asReadDb(context)
    .select({
      operationId: documentServerDraftOperations.operationId,
      sourceKey: documentServerDraftOperations.sourceKey,
      operationType: documentServerDraftOperations.operationType,
      requestHash: documentServerDraftOperations.requestHash,
      requestHashVersion: documentServerDraftOperations.requestHashVersion,
      resultVersion: documentServerDraftOperations.resultVersion,
      resultState: documentServerDraftOperations.resultState,
      createdAt: documentServerDraftOperations.createdAt,
    })
    .from(documentServerDraftOperations)
    .where(
      and(
        eq(documentServerDraftOperations.ownerId, ownerId),
        inArray(documentServerDraftOperations.operationId, [...operationIds]),
      ),
    );
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
