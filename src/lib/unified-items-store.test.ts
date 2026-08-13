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
