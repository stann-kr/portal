import { and, eq, notInArray, sql } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import {
  documentOperationLedger,
  documentTombstones,
  privateNoteRevisions,
  privateNotes,
  profiles,
  type DocumentOperationType,
} from "@/db/schema";
import {
  PRIVATE_NOTE_REQUEST_HASH_VERSION,
  PRIVATE_NOTE_SNAPSHOT_HASH_VERSION,
  PRIVATE_NOTE_STORAGE_QUOTA_BYTES,
  PRIVATE_NOTE_TRASH_RETENTION_SECONDS,
  createPrivateNoteRequestHash,
  createPrivateNoteRequestHashForVersion,
  createPrivateNoteSnapshotHash,
  createPrivateNoteSnapshotHashForVersion,
  deriveDocumentOperationRecordId,
  derivePrivateNoteRevisionId,
  getPrivateNoteSnapshotBytes,
  type PrivateNoteCanonicalRequest,
  type PrivateNoteCanonicalSnapshot,
} from "@/lib/private-note-continuity";

type AtomicActor = {
  id: string;
  isAdmin: boolean;
};

type AtomicStatement = {
  query: string;
  params?: readonly unknown[];
};

type NoteHead = {
  id: string;
  studentId: string;
  authorId: string;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  deletedAt: Date | null;
};

export type PrivateNoteResourceState = "ACTIVE" | "TRASHED" | "PURGED";

export type PrivateNoteMutationFailureReason =
  | "VERSION_CONFLICT"
  | "TRASHED"
  | "PURGED"
  | "OPERATION_PAYLOAD_CONFLICT"
  | "OPERATION_VERSION_UNSUPPORTED"
  | "RETENTION_NOT_EXPIRED"
  | "RETENTION_EXPIRED"
  | "DOCUMENT_TOO_LARGE"
  | "STORAGE_QUOTA_EXCEEDED"
  | "NOT_FOUND_OR_FORBIDDEN"
  | "INTERNAL_INVARIANT_FAILURE";

export type PrivateNoteMutationResult =
  | {
      ok: true;
      noteId: string;
      replayed: boolean;
      resourceState: PrivateNoteResourceState;
      operationResultRevision: number;
      currentRevision: number | null;
      createdAt?: Date;
    }
  | {
      ok: false;
      reason: PrivateNoteMutationFailureReason;
      noteId?: string;
      currentRevision?: number;
    };

type CreatePrivateNoteWrite = {
  actor: AtomicActor;
  subjectId: string;
  noteId: string;
  operationId: string;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  now: Date;
};

type UpdatePrivateNoteWrite = {
  actor: AtomicActor;
  noteId: string;
  operationId: string;
  baseRevision: number;
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  now: Date;
};

type LifecyclePrivateNoteWrite = {
  actor: AtomicActor;
  noteId: string;
  operationId: string;
  baseRevision: number;
  now: Date;
};

type RestorePrivateNoteRevisionWrite = LifecyclePrivateNoteWrite & {
  revisionNumber: number;
};

const CONDITIONAL_WRITE_SENTINEL: AtomicStatement = {
  query:
    "INSERT INTO document_batch_abort_guard (reason) " +
    "SELECT 'CONDITIONAL_WRITE' WHERE changes() <> 1",
};

function epochSeconds(value: Date | null): number | null {
  return value ? Math.floor(value.getTime() / 1000) : null;
}

function persistedDate(value: Date): Date {
  return new Date(epochSeconds(value)! * 1000);
}

function asReadDb(context: DbContext): DrizzleDb {
  return context.db as unknown as DrizzleDb;
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

async function findNote(context: DbContext, noteId: string): Promise<NoteHead | null> {
  const db = asReadDb(context);
  const [note] = await db
    .select({
      id: privateNotes.id,
      studentId: privateNotes.studentId,
      authorId: privateNotes.authorId,
      title: privateNotes.title,
      contentHtml: privateNotes.contentHtml,
      noteDate: privateNotes.noteDate,
      createdAt: privateNotes.createdAt,
      updatedAt: privateNotes.updatedAt,
      version: privateNotes.version,
      deletedAt: privateNotes.deletedAt,
    })
    .from(privateNotes)
    .where(eq(privateNotes.id, noteId))
    .limit(1);

  return note ?? null;
}

async function findTombstone(context: DbContext, noteId: string) {
  const db = asReadDb(context);
  const [tombstone] = await db
    .select({
      resourceId: documentTombstones.resourceId,
      subjectId: documentTombstones.subjectId,
      ownerId: documentTombstones.ownerId,
      sourceVersion: documentTombstones.sourceVersion,
    })
    .from(documentTombstones)
    .where(
      and(
        eq(documentTombstones.resourceType, "PRIVATE_NOTE"),
        eq(documentTombstones.resourceId, noteId),
      ),
    )
    .limit(1);
  return tombstone ?? null;
}

async function getStorageUsageBytes(
  context: DbContext,
  subjectId: string,
): Promise<number> {
  const db = asReadDb(context);
  const [headUsage] = await db
    .select({
      bytes: sql<number>`coalesce(sum(length(cast(${privateNotes.title} as blob)) + length(cast(${privateNotes.contentHtml} as blob))), 0)`,
    })
    .from(privateNotes)
    .where(eq(privateNotes.studentId, subjectId));
  const [revisionUsage] = await db
    .select({
      bytes: sql<number>`coalesce(sum(length(cast(${privateNoteRevisions.title} as blob)) + length(cast(${privateNoteRevisions.contentHtml} as blob))), 0)`,
    })
    .from(privateNoteRevisions)
    .innerJoin(privateNotes, eq(privateNoteRevisions.noteId, privateNotes.id))
    .where(
      and(
        eq(privateNotes.studentId, subjectId),
        notInArray(privateNoteRevisions.changeType, ["TRASH", "RESTORE_TRASH"]),
      ),
    );

  return Number(headUsage?.bytes ?? 0) + Number(revisionUsage?.bytes ?? 0);
}

function canReadSubject(actor: AtomicActor, subjectId: string): boolean {
  return actor.isAdmin || actor.id === subjectId;
}

function canMutateNote(actor: AtomicActor, note: NoteHead): boolean {
  return actor.isAdmin || actor.id === note.authorId;
}

async function resolveReceiptReplay(
  context: DbContext,
  input: {
    actor: AtomicActor;
    operationId: string;
    operationType: DocumentOperationType;
    request: PrivateNoteCanonicalRequest;
  },
): Promise<PrivateNoteMutationResult | null> {
  const db = asReadDb(context);
  const [receipt] = await db
    .select()
    .from(documentOperationLedger)
    .where(
      and(
        eq(documentOperationLedger.actorId, input.actor.id),
        eq(documentOperationLedger.operationId, input.operationId),
      ),
    )
    .limit(1);

  if (!receipt) return null;
  if (!canReadSubject(input.actor, receipt.subjectId)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  const requestHash = createPrivateNoteRequestHashForVersion(
    input.request,
    receipt.requestHashVersion,
  );
  if (!requestHash) {
    return { ok: false, reason: "OPERATION_VERSION_UNSUPPORTED" };
  }
  if (
    receipt.operationType !== input.operationType ||
    receipt.requestHash !== requestHash
  ) {
    return {
      ok: false,
      reason: "OPERATION_PAYLOAD_CONFLICT",
      noteId: receipt.resourceId,
    };
  }

  const note = await findNote(context, receipt.resourceId);
  const tombstone = note ? null : await findTombstone(context, receipt.resourceId);

  if (input.operationType === "PURGE") {
    if (!input.actor.isAdmin || !tombstone) {
      return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    }
    return {
      ok: true,
      noteId: receipt.resourceId,
      replayed: true,
      resourceState: "PURGED",
      operationResultRevision: receipt.resultRevision,
      currentRevision: null,
    };
  }

  if (tombstone) {
    return { ok: false, reason: "PURGED", noteId: receipt.resourceId };
  }
  if (!note || note.studentId !== receipt.subjectId) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (input.operationType !== "CREATE" && !canMutateNote(input.actor, note)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }

  if (input.operationType === "TRASH") {
    return {
      ok: true,
      noteId: note.id,
      replayed: true,
      resourceState: note.deletedAt ? "TRASHED" : "ACTIVE",
      operationResultRevision: receipt.resultRevision,
      currentRevision: note.version,
      createdAt: note.createdAt,
    };
  }
  if (input.operationType === "RESTORE_TRASH") {
    return {
      ok: true,
      noteId: note.id,
      replayed: true,
      resourceState: note.deletedAt ? "TRASHED" : "ACTIVE",
      operationResultRevision: receipt.resultRevision,
      currentRevision: note.version,
      createdAt: note.createdAt,
    };
  }
  if (note.deletedAt) {
    return { ok: false, reason: "TRASHED", noteId: note.id, currentRevision: note.version };
  }

  return {
    ok: true,
    noteId: note.id,
    replayed: true,
    resourceState: "ACTIVE",
    operationResultRevision: receipt.resultRevision,
    currentRevision: note.version,
    createdAt: note.createdAt,
  };
}

function ledgerInsertStatement(input: {
  recordId: string;
  operationId: string;
  actorId: string;
  subjectId: string;
  operationType: DocumentOperationType;
  noteId: string;
  requestHash: string;
  resultRevision: number;
  now: Date;
}): AtomicStatement {
  return {
    query: `
      INSERT INTO document_operation_ledger (
        id, operation_id, actor_id, subject_id, resource_type,
        operation_type, resource_id, request_hash, request_hash_version,
        result_revision, created_at
      ) VALUES (?, ?, ?, ?, 'PRIVATE_NOTE', ?, ?, ?, ?, ?, ?)
    `,
    params: [
      input.recordId,
      input.operationId,
      input.actorId,
      input.subjectId,
      input.operationType,
      input.noteId,
      input.requestHash,
      PRIVATE_NOTE_REQUEST_HASH_VERSION,
      input.resultRevision,
      epochSeconds(input.now),
    ],
  };
}

function revisionInsertStatement(input: {
  revisionId: string;
  noteId: string;
  revisionNumber: number;
  changeType: Exclude<DocumentOperationType, "PURGE">;
  snapshot: PrivateNoteCanonicalSnapshot;
  actorId: string;
  restoredFromRevision?: number | null;
  operationRecordId: string;
  now: Date;
}): AtomicStatement {
  return {
    query: `
      INSERT INTO private_note_revisions (
        id, note_id, revision_number, change_type, title, content_html,
        note_date, deleted_at, snapshot_hash, snapshot_hash_version,
        actor_id, restored_from_revision, operation_record_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      input.revisionId,
      input.noteId,
      input.revisionNumber,
      input.changeType,
      input.snapshot.title,
      input.snapshot.contentHtml,
      epochSeconds(input.snapshot.noteDate),
      epochSeconds(input.snapshot.deletedAt),
      createPrivateNoteSnapshotHash(input.snapshot),
      PRIVATE_NOTE_SNAPSHOT_HASH_VERSION,
      input.actorId,
      input.restoredFromRevision ?? null,
      input.operationRecordId,
      epochSeconds(input.now),
    ],
  };
}

async function classifyMissingMutation(
  context: DbContext,
  actor: AtomicActor,
  noteId: string,
  baseRevision?: number,
): Promise<PrivateNoteMutationResult> {
  const note = await findNote(context, noteId);
  if (note) {
    if (!canReadSubject(actor, note.studentId) || !canMutateNote(actor, note)) {
      return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    }
    if (note.deletedAt) {
      return { ok: false, reason: "TRASHED", noteId, currentRevision: note.version };
    }
    if (baseRevision !== undefined && note.version !== baseRevision) {
      return {
        ok: false,
        reason: "VERSION_CONFLICT",
        noteId,
        currentRevision: note.version,
      };
    }
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
  }

  const tombstone = await findTombstone(context, noteId);
  if (tombstone && canReadSubject(actor, tombstone.subjectId)) {
    return { ok: false, reason: "PURGED", noteId };
  }
  return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
}

export async function createPrivateNoteAtomically(
  context: DbContext,
  write: CreatePrivateNoteWrite,
): Promise<PrivateNoteMutationResult> {
  const request: PrivateNoteCanonicalRequest = {
    operationType: "CREATE",
    resourceId: write.noteId,
    subjectId: write.subjectId,
    baseRevision: null,
    title: write.title,
    contentHtml: write.contentHtml,
    noteDate: write.noteDate,
  };
  const requestHash = createPrivateNoteRequestHash(request);
  const replay = await resolveReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "CREATE",
    request,
  });
  if (replay) return replay;

  const tombstone = await findTombstone(context, write.noteId);
  if (tombstone) {
    return canReadSubject(write.actor, tombstone.subjectId)
      ? { ok: false, reason: "PURGED", noteId: write.noteId }
      : { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }

  const existing = await findNote(context, write.noteId);
  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  if (existing) {
    if (
      existing.studentId !== write.subjectId ||
      existing.authorId !== write.actor.id ||
      !canReadSubject(write.actor, existing.studentId)
    ) {
      return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    }
    if (existing.deletedAt) {
      return { ok: false, reason: "TRASHED", noteId: write.noteId, currentRevision: existing.version };
    }
    const samePayload =
      existing.title === write.title &&
      existing.contentHtml === write.contentHtml &&
      epochSeconds(existing.noteDate) === epochSeconds(write.noteDate);
    if (!samePayload) {
      return {
        ok: false,
        reason: "OPERATION_PAYLOAD_CONFLICT",
        noteId: write.noteId,
        currentRevision: existing.version,
      };
    }

    try {
      await executeAtomically(context, [
        {
          query: `
            INSERT INTO document_operation_ledger (
              id, operation_id, actor_id, subject_id, resource_type,
              operation_type, resource_id, request_hash, request_hash_version,
              result_revision, created_at
            )
            SELECT ?, ?, ?, student_id, 'PRIVATE_NOTE', 'CREATE', id, ?, ?, version, ?
            FROM private_notes
            WHERE id = ? AND student_id = ? AND author_id = ?
              AND deleted_at IS NULL AND title = ? AND content_html = ?
              AND note_date IS ?
          `,
          params: [
            recordId,
            write.operationId,
            write.actor.id,
            requestHash,
            PRIVATE_NOTE_REQUEST_HASH_VERSION,
            epochSeconds(write.now),
            write.noteId,
            write.subjectId,
            write.actor.id,
            write.title,
            write.contentHtml,
            epochSeconds(write.noteDate),
          ],
        },
        CONDITIONAL_WRITE_SENTINEL,
      ]);
      return {
        ok: true,
        noteId: write.noteId,
        replayed: true,
        resourceState: "ACTIVE",
        operationResultRevision: existing.version,
        currentRevision: existing.version,
        createdAt: existing.createdAt,
      };
    } catch {
      return (
        (await resolveReceiptReplay(context, {
          actor: write.actor,
          operationId: write.operationId,
          operationType: "CREATE",
          request,
        })) ?? { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" }
      );
    }
  }

  const snapshot: PrivateNoteCanonicalSnapshot = {
    title: write.title,
    contentHtml: write.contentHtml,
    noteDate: write.noteDate,
    deletedAt: null,
  };
  const newStorageBytes = getPrivateNoteSnapshotBytes(snapshot) * 2;
  const revisionId = derivePrivateNoteRevisionId(write.actor.id, write.operationId);

  try {
    await executeAtomically(context, [
      ledgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: write.subjectId,
        operationType: "CREATE",
        noteId: write.noteId,
        requestHash,
        resultRevision: 1,
        now: write.now,
      }),
      {
        query: `
          INSERT INTO private_notes (
            id, student_id, author_id, title, content_html, note_date,
            created_at, updated_at, version, deleted_at, deleted_by_id
          )
          SELECT ?, profile.id, ?, ?, ?, ?, ?, ?, 1, NULL, NULL
          FROM profiles AS profile
          WHERE profile.id = ? AND (? = 1 OR profile.id = ?)
            AND (
              coalesce((
                SELECT sum(length(cast(title AS blob)) + length(cast(content_html AS blob)))
                FROM private_notes WHERE student_id = ?
              ), 0)
              + coalesce((
                SELECT sum(length(cast(revision.title AS blob)) + length(cast(revision.content_html AS blob)))
                FROM private_note_revisions AS revision
                JOIN private_notes AS note ON note.id = revision.note_id
                WHERE note.student_id = ?
                  AND revision.change_type NOT IN ('TRASH', 'RESTORE_TRASH')
              ), 0)
              + ?
            ) <= ?
        `,
        params: [
          write.noteId,
          write.actor.id,
          write.title,
          write.contentHtml,
          epochSeconds(write.noteDate),
          epochSeconds(write.now),
          epochSeconds(write.now),
          write.subjectId,
          Number(write.actor.isAdmin),
          write.actor.id,
          write.subjectId,
          write.subjectId,
          newStorageBytes,
          PRIVATE_NOTE_STORAGE_QUOTA_BYTES,
        ],
      },
      CONDITIONAL_WRITE_SENTINEL,
      revisionInsertStatement({
        revisionId,
        noteId: write.noteId,
        revisionNumber: 1,
        changeType: "CREATE",
        snapshot,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);

    return {
      ok: true,
      noteId: write.noteId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: 1,
      currentRevision: 1,
      createdAt: persistedDate(write.now),
    };
  } catch {
    const racedReplay = await resolveReceiptReplay(context, {
      actor: write.actor,
      operationId: write.operationId,
      operationType: "CREATE",
      request,
    });
    if (racedReplay) return racedReplay;
    const [profile] = await asReadDb(context)
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, write.subjectId))
      .limit(1);
    if (!profile || !canReadSubject(write.actor, write.subjectId)) {
      return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
    }
    const usage = await getStorageUsageBytes(context, write.subjectId);
    if (usage + newStorageBytes > PRIVATE_NOTE_STORAGE_QUOTA_BYTES) {
      return { ok: false, reason: "STORAGE_QUOTA_EXCEEDED" };
    }
    return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
  }
}

export async function updatePrivateNoteAtomically(
  context: DbContext,
  write: UpdatePrivateNoteWrite,
): Promise<PrivateNoteMutationResult> {
  const existing = await findNote(context, write.noteId);
  const tombstone = existing ? null : await findTombstone(context, write.noteId);
  const subjectId = existing?.studentId ?? tombstone?.subjectId ?? "unknown";
  const request: PrivateNoteCanonicalRequest = {
    operationType: "UPDATE",
    resourceId: write.noteId,
    subjectId,
    baseRevision: write.baseRevision,
    title: write.title,
    contentHtml: write.contentHtml,
    noteDate: write.noteDate,
  };
  const requestHash = createPrivateNoteRequestHash(request);
  const replay = await resolveReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "UPDATE",
    request,
  });
  if (replay) return replay;
  if (!existing) {
    return classifyMissingMutation(context, write.actor, write.noteId, write.baseRevision);
  }
  if (!canReadSubject(write.actor, existing.studentId) || !canMutateNote(write.actor, existing)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (existing.deletedAt) {
    return { ok: false, reason: "TRASHED", noteId: write.noteId, currentRevision: existing.version };
  }
  if (existing.version !== write.baseRevision) {
    return {
      ok: false,
      reason: "VERSION_CONFLICT",
      noteId: write.noteId,
      currentRevision: existing.version,
    };
  }

  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  const alreadyCurrent =
    existing.title === write.title &&
    existing.contentHtml === write.contentHtml &&
    epochSeconds(existing.noteDate) === epochSeconds(write.noteDate);

  if (alreadyCurrent) {
    try {
      await executeAtomically(context, [
        {
          query: `
            INSERT INTO document_operation_ledger (
              id, operation_id, actor_id, subject_id, resource_type,
              operation_type, resource_id, request_hash, request_hash_version,
              result_revision, created_at
            )
            SELECT ?, ?, ?, student_id, 'PRIVATE_NOTE', 'UPDATE', id, ?, ?, version, ?
            FROM private_notes
            WHERE id = ? AND version = ? AND deleted_at IS NULL
              AND (author_id = ? OR ? = 1)
              AND title = ? AND content_html = ? AND note_date IS ?
          `,
          params: [
            recordId,
            write.operationId,
            write.actor.id,
            requestHash,
            PRIVATE_NOTE_REQUEST_HASH_VERSION,
            epochSeconds(write.now),
            write.noteId,
            write.baseRevision,
            write.actor.id,
            Number(write.actor.isAdmin),
            write.title,
            write.contentHtml,
            epochSeconds(write.noteDate),
          ],
        },
        CONDITIONAL_WRITE_SENTINEL,
      ]);
      return {
        ok: true,
        noteId: write.noteId,
        replayed: false,
        resourceState: "ACTIVE",
        operationResultRevision: existing.version,
        currentRevision: existing.version,
        createdAt: existing.createdAt,
      };
    } catch {
      return (
        (await resolveReceiptReplay(context, {
          actor: write.actor,
          operationId: write.operationId,
          operationType: "UPDATE",
          request,
        })) ??
        (await classifyMissingMutation(
          context,
          write.actor,
          write.noteId,
          write.baseRevision,
        ))
      );
    }
  }

  const nextRevision = existing.version + 1;
  const snapshot: PrivateNoteCanonicalSnapshot = {
    title: write.title,
    contentHtml: write.contentHtml,
    noteDate: write.noteDate,
    deletedAt: null,
  };
  const nextSnapshotBytes = getPrivateNoteSnapshotBytes(snapshot);
  const revisionId = derivePrivateNoteRevisionId(write.actor.id, write.operationId);

  try {
    await executeAtomically(context, [
      ledgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.studentId,
        operationType: "UPDATE",
        noteId: write.noteId,
        requestHash,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query: `
          UPDATE private_notes
          SET title = ?, content_html = ?, note_date = ?, updated_at = ?,
              version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL
            AND (author_id = ? OR ? = 1)
            AND (
              coalesce((
                SELECT sum(length(cast(head.title AS blob)) + length(cast(head.content_html AS blob)))
                FROM private_notes AS head
                WHERE head.student_id = private_notes.student_id
              ), 0)
              + coalesce((
                SELECT sum(length(cast(revision.title AS blob)) + length(cast(revision.content_html AS blob)))
                FROM private_note_revisions AS revision
                JOIN private_notes AS owner ON owner.id = revision.note_id
                WHERE owner.student_id = private_notes.student_id
                  AND revision.change_type NOT IN ('TRASH', 'RESTORE_TRASH')
              ), 0)
              - length(cast(private_notes.title AS blob))
              - length(cast(private_notes.content_html AS blob))
              + (? * 2)
            ) <= ?
        `,
        params: [
          write.title,
          write.contentHtml,
          epochSeconds(write.noteDate),
          epochSeconds(write.now),
          write.noteId,
          write.baseRevision,
          write.actor.id,
          Number(write.actor.isAdmin),
          nextSnapshotBytes,
          PRIVATE_NOTE_STORAGE_QUOTA_BYTES,
        ],
      },
      CONDITIONAL_WRITE_SENTINEL,
      revisionInsertStatement({
        revisionId,
        noteId: write.noteId,
        revisionNumber: nextRevision,
        changeType: "UPDATE",
        snapshot,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);

    return {
      ok: true,
      noteId: write.noteId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
      createdAt: existing.createdAt,
    };
  } catch {
    const racedReplay = await resolveReceiptReplay(context, {
      actor: write.actor,
      operationId: write.operationId,
      operationType: "UPDATE",
      request,
    });
    if (racedReplay) return racedReplay;
    const current = await findNote(context, write.noteId);
    if (
      current &&
      canMutateNote(write.actor, current) &&
      !current.deletedAt &&
      current.version === write.baseRevision
    ) {
      const usage = await getStorageUsageBytes(context, current.studentId);
      const currentBytes = getPrivateNoteSnapshotBytes(current);
      if (
        usage - currentBytes + nextSnapshotBytes * 2 >
        PRIVATE_NOTE_STORAGE_QUOTA_BYTES
      ) {
        return { ok: false, reason: "STORAGE_QUOTA_EXCEEDED" };
      }
    }
    return classifyMissingMutation(context, write.actor, write.noteId, write.baseRevision);
  }
}

export async function trashPrivateNoteAtomically(
  context: DbContext,
  write: LifecyclePrivateNoteWrite,
): Promise<PrivateNoteMutationResult> {
  const existing = await findNote(context, write.noteId);
  const tombstone = existing ? null : await findTombstone(context, write.noteId);
  const subjectId = existing?.studentId ?? tombstone?.subjectId ?? "unknown";
  const request: PrivateNoteCanonicalRequest = {
    operationType: "TRASH",
    resourceId: write.noteId,
    subjectId,
    baseRevision: write.baseRevision,
  };
  const requestHash = createPrivateNoteRequestHash(request);
  const replay = await resolveReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "TRASH",
    request,
  });
  if (replay) return replay;
  if (!existing) {
    return classifyMissingMutation(context, write.actor, write.noteId, write.baseRevision);
  }
  if (!canReadSubject(write.actor, existing.studentId) || !canMutateNote(write.actor, existing)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (existing.deletedAt) {
    return { ok: false, reason: "TRASHED", noteId: write.noteId, currentRevision: existing.version };
  }
  if (existing.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", noteId: write.noteId, currentRevision: existing.version };
  }

  const nextRevision = existing.version + 1;
  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  const snapshot: PrivateNoteCanonicalSnapshot = {
    title: existing.title,
    contentHtml: existing.contentHtml,
    noteDate: existing.noteDate,
    deletedAt: write.now,
  };

  try {
    await executeAtomically(context, [
      ledgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.studentId,
        operationType: "TRASH",
        noteId: write.noteId,
        requestHash,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query: `
          UPDATE private_notes
          SET deleted_at = ?, deleted_by_id = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL
            AND (author_id = ? OR ? = 1)
        `,
        params: [
          epochSeconds(write.now),
          write.actor.id,
          epochSeconds(write.now),
          write.noteId,
          write.baseRevision,
          write.actor.id,
          Number(write.actor.isAdmin),
        ],
      },
      CONDITIONAL_WRITE_SENTINEL,
      revisionInsertStatement({
        revisionId: derivePrivateNoteRevisionId(write.actor.id, write.operationId),
        noteId: write.noteId,
        revisionNumber: nextRevision,
        changeType: "TRASH",
        snapshot,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      noteId: write.noteId,
      replayed: false,
      resourceState: "TRASHED",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
      createdAt: existing.createdAt,
    };
  } catch {
    return (
      (await resolveReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType: "TRASH",
        request,
      })) ??
      (await classifyMissingMutation(context, write.actor, write.noteId, write.baseRevision))
    );
  }
}

export async function restoreTrashedPrivateNoteAtomically(
  context: DbContext,
  write: LifecyclePrivateNoteWrite,
): Promise<PrivateNoteMutationResult> {
  const existing = await findNote(context, write.noteId);
  const tombstone = existing ? null : await findTombstone(context, write.noteId);
  const subjectId = existing?.studentId ?? tombstone?.subjectId ?? "unknown";
  const request: PrivateNoteCanonicalRequest = {
    operationType: "RESTORE_TRASH",
    resourceId: write.noteId,
    subjectId,
    baseRevision: write.baseRevision,
  };
  const requestHash = createPrivateNoteRequestHash(request);
  const replay = await resolveReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "RESTORE_TRASH",
    request,
  });
  if (replay) return replay;
  if (!existing) {
    return classifyMissingMutation(context, write.actor, write.noteId, write.baseRevision);
  }
  if (!canReadSubject(write.actor, existing.studentId) || !canMutateNote(write.actor, existing)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (!existing.deletedAt) {
    return { ok: false, reason: "VERSION_CONFLICT", noteId: write.noteId, currentRevision: existing.version };
  }
  if (existing.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", noteId: write.noteId, currentRevision: existing.version };
  }
  if (
    epochSeconds(existing.deletedAt)! <=
    epochSeconds(write.now)! - PRIVATE_NOTE_TRASH_RETENTION_SECONDS
  ) {
    return { ok: false, reason: "RETENTION_EXPIRED", noteId: write.noteId, currentRevision: existing.version };
  }

  const nextRevision = existing.version + 1;
  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  const snapshot: PrivateNoteCanonicalSnapshot = {
    title: existing.title,
    contentHtml: existing.contentHtml,
    noteDate: existing.noteDate,
    deletedAt: null,
  };

  try {
    await executeAtomically(context, [
      ledgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.studentId,
        operationType: "RESTORE_TRASH",
        noteId: write.noteId,
        requestHash,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query: `
          UPDATE private_notes
          SET deleted_at = NULL, deleted_by_id = NULL, updated_at = ?, version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
            AND deleted_at > ? AND (author_id = ? OR ? = 1)
        `,
        params: [
          epochSeconds(write.now),
          write.noteId,
          write.baseRevision,
          epochSeconds(write.now)! - PRIVATE_NOTE_TRASH_RETENTION_SECONDS,
          write.actor.id,
          Number(write.actor.isAdmin),
        ],
      },
      CONDITIONAL_WRITE_SENTINEL,
      revisionInsertStatement({
        revisionId: derivePrivateNoteRevisionId(write.actor.id, write.operationId),
        noteId: write.noteId,
        revisionNumber: nextRevision,
        changeType: "RESTORE_TRASH",
        snapshot,
        actorId: write.actor.id,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);
    return {
      ok: true,
      noteId: write.noteId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
      createdAt: existing.createdAt,
    };
  } catch {
    return (
      (await resolveReceiptReplay(context, {
        actor: write.actor,
        operationId: write.operationId,
        operationType: "RESTORE_TRASH",
        request,
      })) ??
      (await classifyMissingMutation(context, write.actor, write.noteId, write.baseRevision))
    );
  }
}

export async function restorePrivateNoteRevisionAtomically(
  context: DbContext,
  write: RestorePrivateNoteRevisionWrite,
): Promise<PrivateNoteMutationResult> {
  const existing = await findNote(context, write.noteId);
  const tombstone = existing ? null : await findTombstone(context, write.noteId);
  const subjectId = existing?.studentId ?? tombstone?.subjectId ?? "unknown";
  const request: PrivateNoteCanonicalRequest = {
    operationType: "RESTORE_REVISION",
    resourceId: write.noteId,
    subjectId,
    baseRevision: write.baseRevision,
    restoredFromRevision: write.revisionNumber,
  };
  const requestHash = createPrivateNoteRequestHash(request);
  const replay = await resolveReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "RESTORE_REVISION",
    request,
  });
  if (replay) return replay;
  if (!existing) {
    return classifyMissingMutation(context, write.actor, write.noteId, write.baseRevision);
  }
  if (!canReadSubject(write.actor, existing.studentId) || !canMutateNote(write.actor, existing)) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (existing.deletedAt) {
    return { ok: false, reason: "TRASHED", noteId: write.noteId, currentRevision: existing.version };
  }
  if (existing.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", noteId: write.noteId, currentRevision: existing.version };
  }

  const [sourceRevision] = await asReadDb(context)
    .select({
      changeType: privateNoteRevisions.changeType,
      title: privateNoteRevisions.title,
      contentHtml: privateNoteRevisions.contentHtml,
      noteDate: privateNoteRevisions.noteDate,
      deletedAt: privateNoteRevisions.deletedAt,
      snapshotHash: privateNoteRevisions.snapshotHash,
      snapshotHashVersion: privateNoteRevisions.snapshotHashVersion,
    })
    .from(privateNoteRevisions)
    .where(
      and(
        eq(privateNoteRevisions.noteId, write.noteId),
        eq(privateNoteRevisions.revisionNumber, write.revisionNumber),
      ),
    )
    .limit(1);
  if (!sourceRevision) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (sourceRevision.changeType !== "BASELINE") {
    if (
      sourceRevision.snapshotHash === null ||
      sourceRevision.snapshotHashVersion === null
    ) {
      return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
    }
    const sourceSnapshotHash = createPrivateNoteSnapshotHashForVersion(
      {
        title: sourceRevision.title,
        contentHtml: sourceRevision.contentHtml,
        noteDate: sourceRevision.noteDate,
        deletedAt: sourceRevision.deletedAt,
      },
      sourceRevision.snapshotHashVersion,
    );
    if (!sourceSnapshotHash) {
      return { ok: false, reason: "OPERATION_VERSION_UNSUPPORTED" };
    }
    if (sourceSnapshotHash !== sourceRevision.snapshotHash) {
      return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
    }
  }

  const nextRevision = existing.version + 1;
  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  const snapshot: PrivateNoteCanonicalSnapshot = {
    title: sourceRevision.title,
    contentHtml: sourceRevision.contentHtml,
    noteDate: sourceRevision.noteDate,
    deletedAt: null,
  };
  const nextSnapshotBytes = getPrivateNoteSnapshotBytes(snapshot);

  try {
    await executeAtomically(context, [
      ledgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.studentId,
        operationType: "RESTORE_REVISION",
        noteId: write.noteId,
        requestHash,
        resultRevision: nextRevision,
        now: write.now,
      }),
      {
        query: `
          UPDATE private_notes
          SET title = ?, content_html = ?, note_date = ?, updated_at = ?,
              version = version + 1
          WHERE id = ? AND version = ? AND deleted_at IS NULL
            AND (author_id = ? OR ? = 1)
            AND EXISTS (
              SELECT 1 FROM private_note_revisions
              WHERE note_id = private_notes.id AND revision_number = ?
                AND title = ? AND content_html = ? AND note_date IS ?
            )
            AND (
              coalesce((
                SELECT sum(length(cast(head.title AS blob)) + length(cast(head.content_html AS blob)))
                FROM private_notes AS head
                WHERE head.student_id = private_notes.student_id
              ), 0)
              + coalesce((
                SELECT sum(length(cast(revision.title AS blob)) + length(cast(revision.content_html AS blob)))
                FROM private_note_revisions AS revision
                JOIN private_notes AS owner ON owner.id = revision.note_id
                WHERE owner.student_id = private_notes.student_id
                  AND revision.change_type NOT IN ('TRASH', 'RESTORE_TRASH')
              ), 0)
              - length(cast(private_notes.title AS blob))
              - length(cast(private_notes.content_html AS blob))
              + (? * 2)
            ) <= ?
        `,
        params: [
          sourceRevision.title,
          sourceRevision.contentHtml,
          epochSeconds(sourceRevision.noteDate),
          epochSeconds(write.now),
          write.noteId,
          write.baseRevision,
          write.actor.id,
          Number(write.actor.isAdmin),
          write.revisionNumber,
          sourceRevision.title,
          sourceRevision.contentHtml,
          epochSeconds(sourceRevision.noteDate),
          nextSnapshotBytes,
          PRIVATE_NOTE_STORAGE_QUOTA_BYTES,
        ],
      },
      CONDITIONAL_WRITE_SENTINEL,
      revisionInsertStatement({
        revisionId: derivePrivateNoteRevisionId(write.actor.id, write.operationId),
        noteId: write.noteId,
        revisionNumber: nextRevision,
        changeType: "RESTORE_REVISION",
        snapshot,
        actorId: write.actor.id,
        restoredFromRevision: write.revisionNumber,
        operationRecordId: recordId,
        now: write.now,
      }),
    ]);

    return {
      ok: true,
      noteId: write.noteId,
      replayed: false,
      resourceState: "ACTIVE",
      operationResultRevision: nextRevision,
      currentRevision: nextRevision,
      createdAt: existing.createdAt,
    };
  } catch {
    const racedReplay = await resolveReceiptReplay(context, {
      actor: write.actor,
      operationId: write.operationId,
      operationType: "RESTORE_REVISION",
      request,
    });
    if (racedReplay) return racedReplay;
    const current = await findNote(context, write.noteId);
    if (
      current &&
      canMutateNote(write.actor, current) &&
      !current.deletedAt &&
      current.version === write.baseRevision
    ) {
      const usage = await getStorageUsageBytes(context, current.studentId);
      const currentBytes = getPrivateNoteSnapshotBytes(current);
      if (
        usage - currentBytes + nextSnapshotBytes * 2 >
        PRIVATE_NOTE_STORAGE_QUOTA_BYTES
      ) {
        return { ok: false, reason: "STORAGE_QUOTA_EXCEEDED" };
      }
    }
    return classifyMissingMutation(context, write.actor, write.noteId, write.baseRevision);
  }
}

export async function purgePrivateNoteAtomically(
  context: DbContext,
  write: LifecyclePrivateNoteWrite,
): Promise<PrivateNoteMutationResult> {
  const existing = await findNote(context, write.noteId);
  const tombstone = existing ? null : await findTombstone(context, write.noteId);
  const subjectId = existing?.studentId ?? tombstone?.subjectId ?? "unknown";
  const request: PrivateNoteCanonicalRequest = {
    operationType: "PURGE",
    resourceId: write.noteId,
    subjectId,
    baseRevision: write.baseRevision,
  };
  const requestHash = createPrivateNoteRequestHash(request);
  const replay = await resolveReceiptReplay(context, {
    actor: write.actor,
    operationId: write.operationId,
    operationType: "PURGE",
    request,
  });
  if (replay) return replay;
  if (!write.actor.isAdmin) {
    return { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (!existing) {
    return tombstone
      ? { ok: false, reason: "PURGED", noteId: write.noteId }
      : { ok: false, reason: "NOT_FOUND_OR_FORBIDDEN" };
  }
  if (!existing.deletedAt) {
    return { ok: false, reason: "RETENTION_NOT_EXPIRED", noteId: write.noteId, currentRevision: existing.version };
  }
  if (existing.version !== write.baseRevision) {
    return { ok: false, reason: "VERSION_CONFLICT", noteId: write.noteId, currentRevision: existing.version };
  }
  const retentionCutoff = epochSeconds(write.now)! - PRIVATE_NOTE_TRASH_RETENTION_SECONDS;
  if (epochSeconds(existing.deletedAt)! > retentionCutoff) {
    return { ok: false, reason: "RETENTION_NOT_EXPIRED", noteId: write.noteId, currentRevision: existing.version };
  }

  const recordId = deriveDocumentOperationRecordId(write.actor.id, write.operationId);
  try {
    await executeAtomically(context, [
      ledgerInsertStatement({
        recordId,
        operationId: write.operationId,
        actorId: write.actor.id,
        subjectId: existing.studentId,
        operationType: "PURGE",
        noteId: write.noteId,
        requestHash,
        resultRevision: existing.version,
        now: write.now,
      }),
      {
        query: `
          INSERT INTO document_tombstones (
            resource_type, resource_id, subject_id, owner_id, source_created_at,
            source_version, purged_at, purged_by_id
          ) VALUES ('PRIVATE_NOTE', ?, ?, ?, ?, ?, ?, ?)
        `,
        params: [
          write.noteId,
          existing.studentId,
          existing.authorId,
          epochSeconds(existing.createdAt),
          existing.version,
          epochSeconds(write.now),
          write.actor.id,
        ],
      },
      {
        query: `
          DELETE FROM private_notes
          WHERE id = ? AND version = ? AND deleted_at IS NOT NULL
            AND deleted_at <= ?
        `,
        params: [write.noteId, write.baseRevision, retentionCutoff],
      },
      CONDITIONAL_WRITE_SENTINEL,
    ]);

    return {
      ok: true,
      noteId: write.noteId,
      replayed: false,
      resourceState: "PURGED",
      operationResultRevision: existing.version,
      currentRevision: null,
    };
  } catch {
    const racedReplay = await resolveReceiptReplay(context, {
      actor: write.actor,
      operationId: write.operationId,
      operationType: "PURGE",
      request,
    });
    if (racedReplay) return racedReplay;
    const current = await findNote(context, write.noteId);
    if (current?.deletedAt && current.version === write.baseRevision) {
      if (epochSeconds(current.deletedAt)! > retentionCutoff) {
        return { ok: false, reason: "RETENTION_NOT_EXPIRED" };
      }
      return { ok: false, reason: "INTERNAL_INVARIANT_FAILURE" };
    }
    return classifyMissingMutation(context, write.actor, write.noteId, write.baseRevision);
  }
}
