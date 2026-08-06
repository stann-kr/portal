import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import {
  createQnaReplyAtomically,
  createQnaThreadAtomically,
} from "./qna-atomic";

type LocalDbContext = Extract<DbContext, { kind: "local" }>;

function setupDatabase(context: TestContext): {
  sqlite: SqliteDatabase;
  dbContext: LocalDbContext;
} {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY NOT NULL
    );
    CREATE TABLE qna_threads (
      id TEXT PRIMARY KEY NOT NULL,
      student_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN' NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE qna_replies (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL REFERENCES qna_threads(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      content_html TEXT NOT NULL,
      attachment_url TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  return {
    sqlite,
    dbContext: { kind: "local", db: drizzle(sqlite, { schema }) },
  };
}

function seedProfile(sqlite: SqliteDatabase, id: string): void {
  sqlite.prepare("INSERT INTO profiles (id) VALUES (?)").run(id);
}

function seedThread(
  sqlite: SqliteDatabase,
  id: string,
  studentId: string,
  status: "OPEN" | "ANSWERED" | "CLOSED" = "OPEN",
): void {
  sqlite
    .prepare(
      "INSERT INTO qna_threads (id, student_id, title, status) VALUES (?, ?, ?, ?)",
    )
    .run(id, studentId, id, status);
}

function seedReply(
  sqlite: SqliteDatabase,
  id: string,
  threadId: string,
  authorId: string,
): void {
  sqlite
    .prepare(
      "INSERT INTO qna_replies (id, thread_id, author_id, content_html) VALUES (?, ?, ?, ?)",
    )
    .run(id, threadId, authorId, "seed");
}

function countRows(
  sqlite: SqliteDatabase,
  table: "qna_threads" | "qna_replies",
  id: string,
): number {
  return sqlite
    .prepare<[string], { value: number }>(
      `SELECT count(*) AS value FROM ${table} WHERE id = ?`,
    )
    .get(id)?.value ?? 0;
}

function getThreadStatus(sqlite: SqliteDatabase, id: string): string | undefined {
  return sqlite
    .prepare<[string], { status: string }>(
      "SELECT status FROM qna_threads WHERE id = ?",
    )
    .get(id)?.status;
}

test("첫 reply insert가 실패하면 새 Q&A thread도 rollback한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedThread(sqlite, "seed-thread", "student-1");
  seedReply(sqlite, "duplicate-reply", "seed-thread", "student-1");

  await assert.rejects(
    createQnaThreadAtomically(dbContext, {
      threadId: "rolled-back-thread",
      replyId: "duplicate-reply",
      studentId: "student-1",
      title: "저장되면 안 되는 질문",
      contentHtml: "<p>본문</p>",
      attachmentUrl: null,
    }),
  );

  assert.equal(countRows(sqlite, "qna_threads", "rolled-back-thread"), 0);
  assert.equal(countRows(sqlite, "qna_replies", "duplicate-reply"), 1);
});

test("reply insert가 실패하면 선행 status 변경도 rollback한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1");
  seedThread(sqlite, "seed-thread", "student-1");
  seedThread(sqlite, "target-thread", "student-1");
  seedReply(sqlite, "duplicate-reply", "seed-thread", "student-1");

  await assert.rejects(
    createQnaReplyAtomically(dbContext, {
      threadId: "target-thread",
      replyId: "duplicate-reply",
      actorId: "admin-1",
      isAdmin: true,
      contentHtml: "<p>관리자 답변</p>",
      attachmentUrl: null,
    }),
  );

  assert.equal(getThreadStatus(sqlite, "target-thread"), "OPEN");
  const repliesOnTarget = sqlite
    .prepare<[string], { value: number }>(
      "SELECT count(*) AS value FROM qna_replies WHERE thread_id = ?",
    )
    .get("target-thread")?.value;
  assert.equal(repliesOnTarget, 0);
});

test("CLOSED thread에는 reply와 status 변경을 남기지 않는다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedThread(sqlite, "closed-thread", "student-1", "CLOSED");

  const created = await createQnaReplyAtomically(dbContext, {
    threadId: "closed-thread",
    replyId: "closed-reply",
    actorId: "student-1",
    isAdmin: false,
    contentHtml: "<p>추가 질문</p>",
    attachmentUrl: null,
  });

  assert.equal(created, false);
  assert.equal(getThreadStatus(sqlite, "closed-thread"), "CLOSED");
  assert.equal(countRows(sqlite, "qna_replies", "closed-reply"), 0);
});

test("다른 학생은 OPEN thread에도 reply를 남길 수 없다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "student-2");
  seedThread(sqlite, "owned-thread", "student-1");

  const created = await createQnaReplyAtomically(dbContext, {
    threadId: "owned-thread",
    replyId: "other-student-reply",
    actorId: "student-2",
    isAdmin: false,
    contentHtml: "<p>권한 없는 답변</p>",
    attachmentUrl: null,
  });

  assert.equal(created, false);
  assert.equal(getThreadStatus(sqlite, "owned-thread"), "OPEN");
  assert.equal(countRows(sqlite, "qna_replies", "other-student-reply"), 0);
});

test("정상 답변은 reply와 ANSWERED status를 함께 반영한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1");
  seedThread(sqlite, "answered-thread", "student-1");

  const created = await createQnaReplyAtomically(dbContext, {
    threadId: "answered-thread",
    replyId: "admin-reply",
    actorId: "admin-1",
    isAdmin: true,
    contentHtml: "<p>관리자 답변</p>",
    attachmentUrl: "https://example.com/attachment",
  });

  assert.equal(created, true);
  assert.equal(getThreadStatus(sqlite, "answered-thread"), "ANSWERED");
  assert.equal(countRows(sqlite, "qna_replies", "admin-reply"), 1);
});
