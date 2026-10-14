import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DrizzleDb } from "@/db/client";
import * as schema from "@/db/schema";
import { resolveUnifiedItemsQuery } from "./unified-items-query";
import { queryInternalUnifiedItems } from "./unified-items-store";

test("통합 일정 store는 source query와 최종 결과 모두에 기간·개수 상한을 적용한다", async (context) => {
  const selectStatements: string[] = [];
  const sqlite = new Database(":memory:", {
    verbose: (statement) => {
      if (typeof statement === "string" && /^select\b/iu.test(statement.trim())) {
        selectStatements.push(statement);
      }
    },
  });
  context.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE calendar_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      description TEXT,
      created_at INTEGER
    );
    CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      google_event_id TEXT,
      created_at INTEGER
    );
  `);
  sqlite.prepare("INSERT INTO profiles (id, email, display_name, role) VALUES (?, ?, ?, 'student')")
    .run("student-1", "student@example.com", "학생");
  const insertEvent = sqlite.prepare(
    "INSERT INTO calendar_events (id, user_id, event_type, title, start_time) VALUES (?, 'student-1', 'PRACTICE', ?, ?)",
  );
  const insertLesson = sqlite.prepare(
    "INSERT INTO lessons (id, student_id, scheduled_at) VALUES (?, 'student-1', ?)",
  );
  sqlite.transaction(() => {
    for (let index = 0; index < 80; index += 1) {
      insertEvent.run(`event-${index}`, `연습 ${index}`, 1_775_000_000 + index);
    }
    for (let index = 0; index < 10; index += 1) {
      insertLesson.run(`lesson-${index}`, 1_775_100_000 + index);
    }
    insertEvent.run("outside", "기간 밖", 1_600_000_000);
  })();
  selectStatements.length = 0;

  const query = resolveUnifiedItemsQuery({
    start: "2026-03-01T00:00:00.000Z",
    end: "2026-05-01T00:00:00.000Z",
    types: ["EVENT"],
    limit: 25,
  });
  const items = await queryInternalUnifiedItems(
    drizzle(sqlite, { schema }) as unknown as DrizzleDb,
    "student-1",
    query,
  );

  assert.equal(items.length, 25);
  assert.ok(items.every((entry) => entry.type === "EVENT"));
  assert.ok(items.every((entry) => entry.date >= query.start && entry.date <= query.end));
  assert.ok(!items.some((entry) => entry.id === "outside"));
  assert.equal(selectStatements.length, 3, "학생 수·이력 크기와 무관하게 profile/event/lesson만 조회해야 한다");
});

test("과제 피드백 개수는 학생·기간 범위를 유지하고 과제 수 이내의 행으로 조회한다", async (context) => {
  let feedbackSelect = "";
  const sqlite = new Database(":memory:", {
    verbose: (statement) => {
      if (typeof statement === "string" && /^select\b[\s\S]*\bfrom "feedbacks"/iu.test(statement)) {
        feedbackSelect = statement;
      }
    },
  });
  context.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE profiles (id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, media_url TEXT NOT NULL, submitted_at INTEGER);
    CREATE TABLE feedbacks (id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, time_marker INTEGER NOT NULL, content TEXT NOT NULL);
    INSERT INTO profiles VALUES ('student-1', 'student@example.com', '학생');
    INSERT INTO assignments VALUES
      ('first', 'student-1', 'first.mp3', 1778000000),
      ('second', 'student-1', 'second.mp3', 1778000100),
      ('no-feedback', 'student-1', 'empty.mp3', 1778000200),
      ('outside-period', 'student-1', 'old.mp3', 1600000000),
      ('other-student', 'student-2', 'other.mp3', 1778000000);
  `);
  const insertFeedback = sqlite.prepare(
    "INSERT INTO feedbacks (id, assignment_id, time_marker, content) VALUES (?, ?, 0, '피드백')",
  );
  sqlite.transaction(() => {
    for (const [assignmentId, count] of [
      ["first", 700], ["second", 300], ["outside-period", 5], ["other-student", 5],
    ] as const) {
      for (let index = 0; index < count; index += 1) {
        insertFeedback.run(`${assignmentId}-${index}`, assignmentId);
      }
    }
  })();

  const items = await queryInternalUnifiedItems(
    drizzle(sqlite, { schema }) as unknown as DrizzleDb,
    "student-1",
    resolveUnifiedItemsQuery({ start: "2026-05-01", end: "2026-05-31", types: ["ASSIGNMENT"] }),
  );

  assert.deepEqual(
    Object.fromEntries(items.map((item) => [item.id, item.metadata.feedbackCount])),
    { first: 700, second: 300, "no-feedback": 0 },
  );
  assert.ok(feedbackSelect, "피드백 조회가 실행되어야 한다");
  const returnedRows = sqlite.prepare(feedbackSelect).all();
  assert.ok(
    returnedRows.length <= items.length,
    `피드백 ${returnedRows.length}행을 전송하지 않고 조회 과제 ${items.length}개 이내로 집계해야 한다`,
  );
});

test("통합 일정의 노트는 본문 앞부분만 읽고 HTML 대신 평문 미리보기를 전달한다", async (context) => {
  let noteSelect = "";
  const sqlite = new Database(":memory:", {
    verbose: (statement) => {
      if (typeof statement === "string" && /^select\b[\s\S]*\bfrom "private_notes"/iu.test(statement)) {
        noteSelect = statement;
      }
    },
  });
  context.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE profiles (id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT);
    CREATE TABLE private_notes (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL, author_id TEXT NOT NULL, title TEXT NOT NULL,
      content_html TEXT NOT NULL, note_date INTEGER, created_at INTEGER NOT NULL, deleted_at INTEGER
    );
    INSERT INTO profiles VALUES ('student-1', 'student@example.com', '학생');
  `);
  const longBody = `<p>첫 문단 &amp; 핵심</p><p>${"긴 기록 ".repeat(5_000)}</p>`;
  sqlite.prepare(
    "INSERT INTO private_notes (id, student_id, author_id, title, content_html, created_at) VALUES ('note-1', 'student-1', 'student-1', '레슨 메모', ?, 1778000000)",
  ).run(longBody);

  const [note] = await queryInternalUnifiedItems(
    drizzle(sqlite, { schema }) as unknown as DrizzleDb,
    "student-1",
    resolveUnifiedItemsQuery({ start: "2026-05-01", end: "2026-05-31", types: ["NOTE"] }),
  );

  assert.equal(note?.type, "NOTE");
  assert.equal("contentHtml" in (note?.metadata ?? {}), false, "노트 HTML 원문을 클라이언트 payload에 싣지 않는다");
  const preview = String(note?.metadata.preview ?? "");
  assert.match(preview, /^첫 문단 & 핵심/u);
  assert.ok(Array.from(preview).length <= 241);
  assert.match(noteSelect, /substr\("(?:private_notes"\.")?content_html", 1, 4096/u, "본문 전체가 아닌 앞부분만 읽는다");
});
