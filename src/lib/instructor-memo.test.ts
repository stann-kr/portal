import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DrizzleDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  INSTRUCTOR_MEMO_REVISION_RETENTION,
  listInstructorMemoRevisions,
  readInstructorMemo,
  saveInstructorMemo,
} from "./instructor-memo";

function setup(context: TestContext) {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  const directory = join(process.cwd(), "drizzle");
  for (const file of readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
    sqlite.exec(readFileSync(join(directory, file), "utf8"));
  }
  sqlite.exec(`
    INSERT INTO profiles (id, email, role) VALUES ('admin', 'admin@example.com', 'admin'), ('student', 'student@example.com', 'student');
    INSERT INTO private_notes (id, student_id, author_id, title, content_html) VALUES ('note', 'student', 'admin', '수업', '<p>x</p>');
  `);
  return { sqlite, db: drizzle(sqlite, { schema }) as unknown as DrizzleDb };
}

const minute = 60_000;

test("학생 메모와 노트 메모는 따로 저장되고, 낡은 version은 덮어쓰지 않는다", async (context) => {
  const { db } = setup(context);
  const now = new Date(1_800_000_000_000);
  const studentTarget = { studentId: "student", noteId: null };
  const noteTarget = { studentId: "student", noteId: "note" };

  const created = await saveInstructorMemo(db, { ...studentTarget, contentHtml: "<p>a</p>", baseVersion: 0, actorId: "admin", now });
  assert.equal(created.ok && created.memo.version, 1);
  const noteMemo = await saveInstructorMemo(db, { ...noteTarget, contentHtml: "<p>n</p>", baseVersion: 0, actorId: "admin", now });
  assert.equal(noteMemo.ok, true);

  // 같은 대상을 다시 만들거나 낡은 version으로 저장하면 지금 내용을 돌려준다.
  const duplicate = await saveInstructorMemo(db, { ...studentTarget, contentHtml: "<p>b</p>", baseVersion: 0, actorId: "admin", now });
  assert.equal(!duplicate.ok && duplicate.current?.contentHtml, "<p>a</p>");
  const updated = await saveInstructorMemo(db, { ...studentTarget, contentHtml: "<p>c</p>", baseVersion: 1, actorId: "admin", now });
  assert.equal(updated.ok && updated.memo.version, 2);
  const stale = await saveInstructorMemo(db, { ...studentTarget, contentHtml: "<p>d</p>", baseVersion: 1, actorId: "admin", now });
  assert.equal(!stale.ok && stale.current?.version, 2);

  assert.equal((await readInstructorMemo(db, studentTarget))?.contentHtml, "<p>c</p>");
  assert.equal((await readInstructorMemo(db, noteTarget))?.contentHtml, "<p>n</p>");
});

test("10분 안의 저장은 이력 한 칸에 모이고, 오래된 이력은 정리하되 바로 앞 내용은 남긴다", async (context) => {
  const { db } = setup(context);
  const target = { studentId: "student", noteId: null };
  const start = 1_800_000_000_000;
  let version = 0;
  const save = async (html: string, at: number) => {
    const result = await saveInstructorMemo(db, { ...target, contentHtml: html, baseVersion: version, actorId: "admin", now: new Date(at) });
    assert.equal(result.ok, true);
    if (result.ok) version = result.memo.version;
    return result;
  };
  await save("<p>1</p>", start);
  await save("<p>2</p>", start + 3 * minute);
  const first = await save("<p>3</p>", start + 9 * minute);
  const memoId = first.ok ? first.memo.id : "";
  let revisions = await listInstructorMemoRevisions(db, memoId);
  assert.deepEqual(revisions.map((revision) => revision.contentHtml), ["<p>3</p>"]);

  await save("<p>4</p>", start + 11 * minute);
  revisions = await listInstructorMemoRevisions(db, memoId);
  assert.deepEqual(revisions.map((revision) => revision.contentHtml), ["<p>4</p>", "<p>3</p>"]);

  const later = start + 11 * minute + (INSTRUCTOR_MEMO_REVISION_RETENTION.retainSeconds + 60) * 1000;
  await save("<p>5</p>", later);
  revisions = await listInstructorMemoRevisions(db, memoId);
  // 90일 지난 칸은 지우지만, 덮어쓰기 전 내용(4)은 나이와 관계없이 남는다.
  assert.deepEqual(revisions.map((revision) => revision.contentHtml), ["<p>5</p>", "<p>4</p>"]);

  // 이어서 10분 안에 저장해도 바로 앞 칸(4)은 덮지 않는다.
  await save("<p>6</p>", later + 2 * minute);
  revisions = await listInstructorMemoRevisions(db, memoId);
  assert.deepEqual(revisions.map((revision) => revision.contentHtml), ["<p>6</p>", "<p>4</p>"]);

  // 다음 새 칸이 생기면 그 바로 앞(6)만 기간과 관계없이 남는다.
  await save("<p>7</p>", later + (INSTRUCTOR_MEMO_REVISION_RETENTION.retainSeconds + 60) * 1000);
  revisions = await listInstructorMemoRevisions(db, memoId);
  assert.deepEqual(revisions.map((revision) => revision.contentHtml), ["<p>7</p>", "<p>6</p>"]);
});

test("오래 둔 메모를 지우거나 덮어써도 직전 내용은 이력에 남는다", async (context) => {
  const { db } = setup(context);
  const target = { studentId: "student", noteId: null };
  const start = 1_800_000_000_000;
  const created = await saveInstructorMemo(db, { ...target, contentHtml: "<p>오래 둔 메모</p>", baseVersion: 0, actorId: "admin", now: new Date(start) });
  assert.equal(created.ok, true);
  const memoId = created.ok ? created.memo.id : "";
  const later = start + (INSTRUCTOR_MEMO_REVISION_RETENTION.retainSeconds + 24 * 60 * 60) * 1000;
  const overwritten = await saveInstructorMemo(db, { ...target, contentHtml: "", baseVersion: 1, actorId: "admin", now: new Date(later) });
  assert.equal(overwritten.ok, true);
  const revisions = await listInstructorMemoRevisions(db, memoId);
  assert.deepEqual(revisions.map((revision) => revision.contentHtml), ["", "<p>오래 둔 메모</p>"]);
});

test("노트를 영구 삭제하면 그 노트의 메모와 이력도 함께 지워진다", async (context) => {
  const { db, sqlite } = setup(context);
  const result = await saveInstructorMemo(db, {
    studentId: "student",
    noteId: "note",
    contentHtml: "<p>n</p>",
    baseVersion: 0,
    actorId: "admin",
    now: new Date(1_800_000_000_000),
  });
  assert.equal(result.ok, true);
  sqlite.prepare("DELETE FROM private_notes WHERE id = 'note'").run();
  const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS value FROM ${table}`).get() as { value: number }).value;
  assert.equal(count("instructor_memos"), 0);
  assert.equal(count("instructor_memo_revisions"), 0);
});
