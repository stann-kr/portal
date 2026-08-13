import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DrizzleDb } from "@/db/client";
import * as schema from "@/db/schema";
import { queryStudentRosterStats } from "./student-roster";

test("roster 통계는 large fixture도 학생별 반복 scan 없이 고정 4개 aggregate query로 만든다", async (context) => {
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
    CREATE TABLE profiles (id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT, role TEXT NOT NULL, created_at INTEGER);
    CREATE TABLE curriculums (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, week_num INTEGER NOT NULL, title TEXT NOT NULL, is_completed INTEGER NOT NULL, created_at INTEGER);
    CREATE TABLE lessons (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, scheduled_at INTEGER NOT NULL, google_event_id TEXT, created_at INTEGER);
    CREATE TABLE assignments (id TEXT PRIMARY KEY, student_id TEXT NOT NULL, media_url TEXT NOT NULL, submitted_at INTEGER);
    CREATE TABLE feedbacks (id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, time_marker INTEGER NOT NULL, content TEXT NOT NULL, created_at INTEGER);
  `);
  const insertProfile = sqlite.prepare("INSERT INTO profiles (id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)");
  const insertModule = sqlite.prepare("INSERT INTO curriculums (id, student_id, week_num, title, is_completed) VALUES (?, ?, ?, ?, ?)");
  const insertLesson = sqlite.prepare("INSERT INTO lessons (id, student_id, scheduled_at) VALUES (?, ?, ?)");
  const insertAssignment = sqlite.prepare("INSERT INTO assignments (id, student_id, media_url, submitted_at) VALUES (?, ?, ?, ?)");
  const insertFeedback = sqlite.prepare("INSERT INTO feedbacks (id, assignment_id, time_marker, content) VALUES (?, ?, 0, '완료')");
  const nowEpoch = Math.floor(new Date("2026-08-13T00:00:00.000Z").getTime() / 1_000);
  sqlite.transaction(() => {
    insertProfile.run("admin", "admin@example.com", "관리자", "admin", nowEpoch);
    insertProfile.run("student-none", "none@example.com", "미지정", "student", nowEpoch + 1);
    insertProfile.run("student-complete", "complete@example.com", "완료", "student", nowEpoch + 2);
    insertProfile.run("student-open", "open@example.com", "진행", "student", nowEpoch + 3);
    insertModule.run("complete-1", "student-complete", 1, "기초", 1);
    insertModule.run("open-2", "student-open", 2, "믹싱", 0);
    insertModule.run("open-1", "student-open", 1, "기초", 0);
    insertLesson.run("past", "student-open", nowEpoch - 10);
    insertLesson.run("future-late", "student-open", nowEpoch + 200);
    insertLesson.run("future-next", "student-open", nowEpoch + 100);
    insertAssignment.run("pending", "student-open", "pending.mp4", nowEpoch);
    insertAssignment.run("answered", "student-open", "answered.mp4", nowEpoch);
    insertFeedback.run("feedback", "answered");

    for (let index = 0; index < 120; index += 1) {
      const studentId = `synthetic-${index}`;
      insertProfile.run(studentId, `${studentId}@example.com`, studentId, "student", nowEpoch + 10 + index);
      insertModule.run(`module-${index}`, studentId, 1, "기초", index % 2);
      insertLesson.run(`lesson-${index}`, studentId, nowEpoch + 1_000 + index);
      insertAssignment.run(`assignment-${index}`, studentId, `${index}.mp4`, nowEpoch);
      if (index % 2 === 0) insertFeedback.run(`feedback-${index}`, `assignment-${index}`);
    }
  })();
  selectStatements.length = 0;

  const rows = await queryStudentRosterStats(
    drizzle(sqlite, { schema }) as unknown as DrizzleDb,
    new Date(nowEpoch * 1_000),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  assert.equal(rows.length, 123);
  assert.equal(byId.get("student-none")?.currentModule, "진도 미지정");
  assert.equal(byId.get("student-complete")?.currentModule, "모든 과정 완료");
  assert.equal(byId.get("student-open")?.currentModule, "1주차: 기초");
  assert.equal(byId.get("student-open")?.nextLessonDate?.getTime(), (nowEpoch + 100) * 1_000);
  assert.equal(byId.get("student-open")?.pendingFeedbackCount, 1);
  assert.equal(selectStatements.length, 4);
  assert.ok(selectStatements.every((statement) => !/correlated/iu.test(statement)));
});
