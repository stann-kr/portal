import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import { deletePristineStudentAtomically, processDueAccountRawIdErasures } from "@/lib/account-privacy-atomic";
import {
  readStudentDeletionState,
  STUDENT_DELETION_CLEANUP_COLUMNS,
  STUDENT_DELETION_GROUP_COLUMN,
  STUDENT_DELETION_RECORD_COLUMNS,
} from "@/lib/student-deletion";

const NOW = new Date("2026-11-18T03:00:00.000Z");
const NOW_EPOCH = Math.floor(NOW.getTime() / 1000);
const INVITE_HASH = `invite:${NOW_EPOCH + 7 * 86_400}:$2a$10$abcdefghijklmnopqrstuv`;
const ALL_COLUMNS = [...STUDENT_DELETION_RECORD_COLUMNS, STUDENT_DELETION_GROUP_COLUMN, ...STUDENT_DELETION_CLEANUP_COLUMNS];

function migratedDatabase(t: TestContext) {
  const sqlite = new Database(":memory:");
  t.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync(join(process.cwd(), "drizzle")).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
    sqlite.exec(readFileSync(join(process.cwd(), "drizzle", file), "utf8"));
  }
  const context: Extract<DbContext, { kind: "local" }> = { kind: "local", db: drizzle(sqlite, { schema }) };
  const insertProfile = sqlite.prepare(
    "INSERT INTO profiles (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)",
  );
  insertProfile.run("admin-1", "admin@example.com", "$2a$10$admin", "관리자", "admin");
  return { sqlite, context, insertProfile };
}

function referenceCounts(sqlite: Database.Database, studentId: string): Record<string, number> {
  return Object.fromEntries(
    ALL_COLUMNS.map(([table, column]) => [
      `${table}.${column}`,
      (sqlite.prepare(`SELECT count(*) AS value FROM ${table} WHERE ${column} = ?`).get(studentId) as { value: number }).value,
    ]),
  );
}

test("학생 삭제 조건이 학생 id를 담을 수 있는 모든 칸을 한 번씩 다룬다", (t) => {
  const { sqlite } = migratedDatabase(t);
  const listed = ALL_COLUMNS.map(([table, column]) => `${table}.${column}`);
  assert.equal(new Set(listed).size, listed.length, "같은 칸을 두 번 적지 않는다");

  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'profiles'")
    .all() as { name: string }[];
  const found = new Set<string>();
  const personColumn = /^(student|user|author|owner|profile|subject|actor|created_by|updated_by|deleted_by|uploaded_by|purged_by)_id$/u;
  for (const { name } of tables) {
    for (const fk of sqlite.prepare("SELECT \"from\", \"table\" FROM pragma_foreign_key_list(?)").all(name) as { from: string; table: string }[]) {
      if (fk.table === "profiles") found.add(`${name}.${fk.from}`);
    }
    for (const column of sqlite.prepare("SELECT name FROM pragma_table_info(?)").all(name) as { name: string }[]) {
      if (personColumn.test(column.name)) found.add(`${name}.${column.name}`);
    }
  }
  // 지운 기록을 처리한 관리자 칸(purged_by_id)은 학생이 될 수 없어 조건에 넣지 않는다. 있으면 그 행의 subject_id·owner_id가 막는다.
  found.delete("document_tombstones.purged_by_id");
  assert.deepEqual([...found].filter((column) => !listed.includes(column)).sort(), [], "새 칸은 기록·그룹·설정 중 하나로 분류한다");
  assert.deepEqual(listed.filter((column) => !found.has(column)).sort(), [], "목록의 칸이 실제 schema에 있다");
});

test("가입 전·기록 없는 학생은 설정과 함께 지워지고 같은 이메일로 다시 만들 수 있으며 30일 뒤 id가 가려진다", async (t) => {
  const { sqlite, context, insertProfile } = migratedDatabase(t);
  insertProfile.run("student-new", "new@example.com", INVITE_HASH, "새학생", "student");
  // 관리자가 만든 설정: 캘린더 구독 URL, 가이드 공개, (가입 전이라 실제로는 없지만) 알림 설정.
  sqlite.prepare("INSERT INTO calendar_feed_tokens (owner_id, token_digest, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run("student-new", "a".repeat(64), NOW_EPOCH, NOW_EPOCH);
  sqlite.prepare("INSERT INTO guide_access (student_id, mode) VALUES (?, 'ALL')").run("student-new");
  sqlite.prepare("INSERT INTO push_muted_categories (profile_id, category) VALUES (?, 'lesson')").run("student-new");

  assert.deepEqual(await readStudentDeletionState(context, "student-new"), { kind: "deletable" });
  assert.deepEqual(await deletePristineStudentAtomically(context, { studentId: "student-new", now: NOW }), { ok: true });

  assert.equal((sqlite.prepare("SELECT count(*) AS value FROM profiles WHERE id = ?").get("student-new") as { value: number }).value, 0);
  const counts = referenceCounts(sqlite, "student-new");
  // 남는 것은 학생 본인 탈퇴와 같은 삭제 영수증 하나(ERASED, 30일 뒤 id를 가린다).
  assert.deepEqual(Object.entries(counts).filter(([, value]) => value > 0), [["account_deletion_jobs.subject_id", 1]]);
  assert.equal(
    (sqlite.prepare("SELECT status, initiating_token_mode AS mode FROM account_deletion_jobs WHERE subject_id = ?").get("student-new") as { status: string; mode: string }).status,
    "ERASED",
  );

  // 같은 이메일로 새 학생을 만들 수 있다(새 id).
  insertProfile.run("student-again", "new@example.com", INVITE_HASH, "새학생", "student");
  assert.deepEqual(await readStudentDeletionState(context, "student-again"), { kind: "deletable" });

  const erased = await processDueAccountRawIdErasures(context, { now: new Date(NOW.getTime() + 31 * 86_400_000), limit: 10 });
  assert.ok(erased);
  assert.deepEqual(Object.entries(referenceCounts(sqlite, "student-new")).filter(([, value]) => value > 0), []);
  assert.equal(
    (sqlite.prepare("SELECT count(*) AS value FROM account_deletion_jobs WHERE status = 'ALIASED' AND subject_id IS NULL").get() as { value: number }).value,
    1,
  );
});

test("가입한 학생·임시 비밀번호·수강 종료·관리자는 삭제 대상이 아니다", async (t) => {
  const { sqlite, context, insertProfile } = migratedDatabase(t);
  insertProfile.run("student-joined", "joined@example.com", "$2a$10$joined", "가입함", "student");
  insertProfile.run("student-temp", "temp@example.com", "temporary:$2a$10$temp", "임시", "student");
  insertProfile.run("student-archived", "archived@example.com", INVITE_HASH, "종료", "student");
  sqlite.prepare("UPDATE profiles SET account_status = 'ARCHIVED', archived_at = ? WHERE id = ?").run(NOW_EPOCH, "student-archived");

  assert.deepEqual(await readStudentDeletionState(context, "student-joined"), { kind: "signed-up" });
  assert.deepEqual(await readStudentDeletionState(context, "student-temp"), { kind: "signed-up" });
  assert.equal(await readStudentDeletionState(context, "student-archived"), null, "수강 종료한 학생은 복원한 뒤 삭제한다");
  assert.equal(await readStudentDeletionState(context, "admin-1"), null);

  for (const id of ["student-joined", "student-temp", "student-archived", "admin-1"]) {
    assert.deepEqual(await deletePristineStudentAtomically(context, { studentId: id, now: NOW }), { ok: false, reason: "NOT_DELETABLE" }, id);
  }
  assert.equal((sqlite.prepare("SELECT count(*) AS value FROM profiles").get() as { value: number }).value, 4);
  assert.equal((sqlite.prepare("SELECT count(*) AS value FROM account_deletion_jobs").get() as { value: number }).value, 0);
});

test("가입 전이어도 기록·지운 노트의 흔적·그룹 자리가 있으면 이유를 알리고 아무것도 지우지 않는다", async (t) => {
  const { sqlite, context, insertProfile } = migratedDatabase(t);
  for (const id of ["student-lesson", "student-trace", "student-group"]) {
    insertProfile.run(id, `${id}@example.com`, INVITE_HASH, id, "student");
    sqlite.prepare("INSERT INTO guide_access (student_id, mode) VALUES (?, 'ALL')").run(id);
  }
  sqlite.prepare("INSERT INTO lessons (id, student_id, scheduled_at) VALUES ('lesson-1', 'student-lesson', ?)").run(NOW_EPOCH);
  sqlite.prepare(`
    INSERT INTO document_tombstones (resource_type, resource_id, subject_id, owner_id, source_version, purged_at, purged_by_id)
    VALUES ('PRIVATE_NOTE', 'note-gone', 'student-trace', 'admin-1', 1, ?, 'admin-1')
  `).run(NOW_EPOCH);
  sqlite.prepare("INSERT INTO lesson_groups (id, name) VALUES ('group-1', '화요반')").run();
  sqlite.prepare("INSERT INTO lesson_group_members (student_id, group_id) VALUES ('student-group', 'group-1')").run();

  assert.deepEqual(await readStudentDeletionState(context, "student-lesson"), { kind: "has-records" });
  assert.deepEqual(await readStudentDeletionState(context, "student-trace"), { kind: "has-records" });
  assert.deepEqual(await readStudentDeletionState(context, "student-group"), { kind: "in-group", groupName: "화요반" });

  for (const id of ["student-lesson", "student-trace", "student-group"]) {
    assert.deepEqual(await deletePristineStudentAtomically(context, { studentId: id, now: NOW }), { ok: false, reason: "NOT_DELETABLE" }, id);
  }
  // batch 전체가 되돌아가 계정·설정·영수증이 그대로다.
  assert.equal((sqlite.prepare("SELECT count(*) AS value FROM profiles WHERE role = 'student'").get() as { value: number }).value, 3);
  assert.equal((sqlite.prepare("SELECT count(*) AS value FROM guide_access").get() as { value: number }).value, 3);
  assert.equal((sqlite.prepare("SELECT count(*) AS value FROM account_deletion_jobs").get() as { value: number }).value, 0);
});
