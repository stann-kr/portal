import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import {
  createQnaReplyAtomically,
  createQnaThreadAtomically,
  purgeQnaThreadAtomically,
  restoreTrashedQnaThreadAtomically,
  setQnaStatusAtomically,
  trashQnaThreadAtomically,
} from "./qna-atomic";

type LocalDbContext = Extract<DbContext, { kind: "local" }>;

function setupDatabase(context: TestContext): {
  sqlite: SqliteDatabase;
  dbContext: LocalDbContext;
} {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  const migrationDirectory = join(process.cwd(), "drizzle");
  for (const migrationFile of readdirSync(migrationDirectory)
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort()) {
    sqlite.exec(readFileSync(join(migrationDirectory, migrationFile), "utf8"));
  }

  return {
    sqlite,
    dbContext: { kind: "local", db: drizzle(sqlite, { schema }) },
  };
}

function seedProfile(
  sqlite: SqliteDatabase,
  id: string,
  role: "admin" | "student" = "student",
): void {
  sqlite
    .prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, ?)")
    .run(id, `${id}@example.com`, role);
}

function actor(id: string, isAdmin = false) {
  return { id, isAdmin };
}

function operationId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

let operationSequence = 100;

async function createThread(
  dbContext: LocalDbContext,
  input: {
    studentId: string;
    threadId: string;
    replyId?: string;
    operationId?: string;
    now?: Date;
  },
) {
  return createQnaThreadAtomically(dbContext, {
    actor: actor(input.studentId),
    threadId: input.threadId,
    replyId: input.replyId ?? `${input.threadId}-question`,
    operationId: input.operationId ?? operationId(operationSequence++),
    title: input.threadId,
    contentHtml: "<p>질문</p>",
    attachmentUrl: null,
    now: input.now ?? new Date("2026-01-01T00:00:00.000Z"),
  });
}

function countRows(
  sqlite: SqliteDatabase,
  table: "document_operation_ledger" | "qna_thread_events" | "qna_threads" | "qna_replies",
  column: "id" | "operation_id" | "thread_id",
  id: string,
): number {
  return sqlite
    .prepare<[string], { value: number }>(
      `SELECT count(*) AS value FROM ${table} WHERE ${column} = ?`,
    )
    .get(id)?.value ?? 0;
}

function getThread(
  sqlite: SqliteDatabase,
  id: string,
): { status: string; version: number; deleted_at: number | null } | undefined {
  return sqlite
    .prepare<[string], { status: string; version: number; deleted_at: number | null }>(
      "SELECT status, version, deleted_at FROM qna_threads WHERE id = ?",
    )
    .get(id);
}

test("첫 reply가 기존 ID와 충돌하면 새 Q&A thread와 receipt를 남기지 않는다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const seeded = await createThread(dbContext, {
    studentId: "student-1",
    threadId: "seed-thread",
    replyId: "duplicate-reply",
  });
  assert.equal(seeded.ok, true);

  const result = await createThread(dbContext, {
    studentId: "student-1",
    threadId: "rolled-back-thread",
    replyId: "duplicate-reply",
    operationId: operationId(2),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "OPERATION_PAYLOAD_CONFLICT");
    assert.equal(result.threadId, "rolled-back-thread");
  }
  assert.equal(countRows(sqlite, "qna_threads", "id", "rolled-back-thread"), 0);
  assert.equal(
    countRows(sqlite, "document_operation_ledger", "operation_id", operationId(2)),
    0,
  );
});

test("reply ID가 다른 thread와 충돌하면 status와 event가 함께 rollback된다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "seed-thread",
      replyId: "duplicate-reply",
    })).ok,
    true,
  );
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "target-thread",
    })).ok,
    true,
  );

  const result = await createQnaReplyAtomically(dbContext, {
    actor: actor("admin-1", true),
    threadId: "target-thread",
    replyId: "duplicate-reply",
    operationId: operationId(2),
    contentHtml: "<p>관리자 답변</p>",
    attachmentUrl: null,
    now: new Date("2026-01-01T00:01:00.000Z"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "OPERATION_PAYLOAD_CONFLICT");
  assert.deepEqual(getThread(sqlite, "target-thread"), {
    status: "OPEN",
    version: 1,
    deleted_at: null,
  });
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "target-thread"), 1);
});

test("CLOSED thread에는 reply와 새 event를 남기지 않는다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "closed-thread",
    })).ok,
    true,
  );
  const closed = await setQnaStatusAtomically(dbContext, {
    actor: actor("admin-1", true),
    threadId: "closed-thread",
    operationId: operationId(2),
    baseRevision: 1,
    status: "CLOSED",
    now: new Date("2026-01-01T00:01:00.000Z"),
  });
  assert.equal(closed.ok, true);

  const result = await createQnaReplyAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "closed-thread",
    replyId: "closed-reply",
    operationId: operationId(3),
    contentHtml: "<p>추가 질문</p>",
    attachmentUrl: null,
    now: new Date("2026-01-01T00:02:00.000Z"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "CLOSED");
  assert.deepEqual(getThread(sqlite, "closed-thread"), {
    status: "CLOSED",
    version: 2,
    deleted_at: null,
  });
  assert.equal(countRows(sqlite, "qna_replies", "id", "closed-reply"), 0);
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "closed-thread"), 2);
});

test("다른 학생은 OPEN thread에도 reply를 남길 수 없다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "student-2");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "owned-thread",
    })).ok,
    true,
  );

  const result = await createQnaReplyAtomically(dbContext, {
    actor: actor("student-2"),
    threadId: "owned-thread",
    replyId: "other-student-reply",
    operationId: operationId(2),
    contentHtml: "<p>권한 없는 답변</p>",
    attachmentUrl: null,
    now: new Date("2026-01-01T00:01:00.000Z"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "NOT_FOUND_OR_FORBIDDEN");
  assert.deepEqual(getThread(sqlite, "owned-thread"), {
    status: "OPEN",
    version: 1,
    deleted_at: null,
  });
  assert.equal(countRows(sqlite, "qna_replies", "id", "other-student-reply"), 0);
});

test("정상 관리자 답변은 reply, ANSWERED status, event, receipt를 함께 반영한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "answered-thread",
    })).ok,
    true,
  );

  const result = await createQnaReplyAtomically(dbContext, {
    actor: actor("admin-1", true),
    threadId: "answered-thread",
    replyId: "admin-reply",
    operationId: operationId(2),
    contentHtml: "<p>관리자 답변</p>",
    attachmentUrl: "https://example.com/attachment",
    now: new Date("2026-01-01T00:01:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(getThread(sqlite, "answered-thread"), {
    status: "ANSWERED",
    version: 2,
    deleted_at: null,
  });
  assert.equal(countRows(sqlite, "qna_replies", "id", "admin-reply"), 1);
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "answered-thread"), 2);
  assert.equal(
    sqlite
      .prepare<[], { value: number }>(
        `SELECT count(*) AS value FROM document_operation_ledger WHERE operation_id = '${operationId(2)}'`,
      )
      .get()?.value,
    1,
  );
});

test("Q&A trash/restore/만료 purge는 답변과 event를 보존한 뒤 tombstone과 함께 정리한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "lifecycle-thread",
    })).ok,
    true,
  );

  const trashed = await trashQnaThreadAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "lifecycle-thread",
    operationId: operationId(2),
    baseRevision: 1,
    now: new Date("2026-01-02T00:00:00.000Z"),
  });
  assert.equal(trashed.ok, true);
  assert.equal(countRows(sqlite, "qna_replies", "thread_id", "lifecycle-thread"), 1);
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "lifecycle-thread"), 2);

  const restored = await restoreTrashedQnaThreadAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "lifecycle-thread",
    operationId: operationId(3),
    baseRevision: 2,
    now: new Date("2026-01-03T00:00:00.000Z"),
  });
  assert.equal(restored.ok, true);

  const trashedAgain = await trashQnaThreadAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "lifecycle-thread",
    operationId: operationId(4),
    baseRevision: 3,
    now: new Date("2026-01-04T00:00:00.000Z"),
  });
  assert.equal(trashedAgain.ok, true);

  const purged = await purgeQnaThreadAtomically(dbContext, {
    actor: actor("admin-1", true),
    threadId: "lifecycle-thread",
    operationId: operationId(5),
    baseRevision: 4,
    now: new Date("2026-02-04T00:00:01.000Z"),
  });
  assert.equal(purged.ok, true);
  assert.equal(countRows(sqlite, "qna_threads", "id", "lifecycle-thread"), 0);
  assert.equal(countRows(sqlite, "qna_replies", "thread_id", "lifecycle-thread"), 0);
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "lifecycle-thread"), 0);
  assert.equal(
    sqlite
      .prepare<[], { value: number }>(
        "SELECT count(*) AS value FROM document_tombstones WHERE resource_type = 'QNA_THREAD' AND resource_id = 'lifecycle-thread'",
      )
      .get()?.value,
    1,
  );
});
