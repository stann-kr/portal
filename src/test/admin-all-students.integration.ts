/**
 * 관리자 일정 "전체 학생"과 전체 노트 목록을 격리 D1(실제 D1 SQL·bind 제한)에서 확인한다.
 * 대상 학생을 서버가 직접 정하는지, 학생 묶음(90명)을 나눠 읽는지, 상관 서브쿼리(아직 안 낸 과제)가 D1에서 맞게 도는지 본다.
 */
import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import {
  assignments,
  assignmentTasks,
  calendarEvents,
  lessons,
  privateNotes,
  profiles,
} from "@/db/schema";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession = createSession("admin-1", "admin");
let unifiedActions: typeof import("@/lib/actions/unifiedItems");
let notesActions: typeof import("@/lib/actions/all-notes");
let store: typeof import("@/lib/unified-items-store");
let queryModule: typeof import("@/lib/unified-items-query");

function createSession(id: string, role: "admin" | "student"): AuthSession {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: { id, role, name: id, email: `${id}@example.com`, image: null },
  };
}

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", {
  namedExports: { auth: async () => activeSession, signIn: async () => "/dashboard" },
});
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });

const realFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`테스트 중 외부 요청 금지: ${String(input)}`);
  }) as typeof fetch;
  unifiedActions = await import("@/lib/actions/unifiedItems");
  notesActions = await import("@/lib/actions/all-notes");
  store = await import("@/lib/unified-items-store");
  queryModule = await import("@/lib/unified-items-query");
});

after(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

async function setupDatabase(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = createSession("admin-1", "admin");
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-1", email: "student-1@example.com", displayName: "민지", role: "student" },
    { id: "student-2", email: "student-2@example.com", displayName: "준호", role: "student" },
  ]);
  return isolated.db;
}

const at = (iso: string) => new Date(iso);
const RANGE = { start: "2026-10-01", end: "2026-12-31" };

test("전체 학생 일정은 활성 학생 항목을 섞어 돌려주고 학생 칩용 space와 기간·권한을 지킨다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await db.insert(lessons).values([
    { id: "lesson-1", studentId: "student-1", scheduledAt: at("2026-11-10T10:00:00.000Z") },
    { id: "lesson-2", studentId: "student-2", scheduledAt: at("2026-11-11T10:00:00.000Z") },
    { id: "lesson-outside", studentId: "student-1", scheduledAt: at("2027-03-01T10:00:00.000Z") },
  ]);
  await db.insert(calendarEvents).values([
    { id: "event-2", userId: "student-2", eventType: "PRACTICE", title: "연습", startTime: at("2026-11-12T09:00:00.000Z") },
    // 관리자 본인 일정은 학생 일정이 아니므로 섞이지 않는다.
    { id: "event-admin", userId: "admin-1", eventType: "PRACTICE", title: "관리자 일정", startTime: at("2026-11-12T09:00:00.000Z") },
  ]);
  await db.insert(privateNotes).values([
    { id: "note-1", studentId: "student-1", authorId: "admin-1", title: "레슨 메모", contentHtml: "<p>메모</p>", noteDate: at("2026-11-10T03:00:00.000Z") },
  ]);
  await db.insert(assignmentTasks).values([
    { id: "task-open", studentId: "student-2", title: "연습 일지", submissionFormat: "TEXT", dueAt: at("2026-11-20T00:00:00.000Z") },
    { id: "task-done", studentId: "student-2", title: "믹스셋", submissionFormat: "MIX", dueAt: at("2026-11-21T00:00:00.000Z") },
  ]);
  await db.insert(assignments).values([
    { id: "submission-1", studentId: "student-2", taskId: "task-done", mediaUrl: "https://youtu.be/abc", submittedAt: at("2026-11-19T00:00:00.000Z") },
  ]);

  const result = await unifiedActions.getUnifiedItemsForAllStudents(RANGE);
  const keys = result.items.map((item) => `${item.space.studentId}:${item.source.entity}:${item.id}`).sort();
  assert.deepEqual(keys, [
    "student-1:LESSON:lesson-1",
    "student-1:PRIVATE_NOTE:note-1",
    "student-2:ASSIGNMENT:submission-1",
    "student-2:ASSIGNMENT_TASK:task-open",
    "student-2:CALENDAR_EVENT:event-2",
    "student-2:LESSON:lesson-2",
  ].sort(), "두 학생 항목이 섞여 나오고, 기간 밖·관리자 본인 일정·이미 낸 과제는 빠진다(D1 상관 서브쿼리)");
  assert.equal(result.items.find((item) => item.id === "lesson-2")?.space.label, "준호", "항목마다 학생 이름(칩)이 붙는다");
  assert.ok(result.items.every((item) => item.source.kind === "PORTAL"), "외부 캘린더 항목은 싣지 않는다");
  assert.equal(result.truncated, false);
  assert.equal(result.start, "2026-10-01T00:00:00.000Z");

  // 학생 계정은 전체 학생 일정을 읽을 수 없다.
  activeSession = createSession("student-1", "student");
  await assert.rejects(() => unifiedActions.getUnifiedItemsForAllStudents(RANGE));
  activeSession = createSession("admin-1", "admin");

  // 한 번에 읽는 기간은 넉 달(124일)까지다.
  await assert.rejects(() => unifiedActions.getUnifiedItemsForAllStudents({ start: "2026-01-01", end: "2026-12-31" }), RangeError);

  // 지운 학생(계정 폐기 = profile 삭제)은 대상에서 빠진다. 학생 role이 아닌 계정도 빠진다.
  await db.update(profiles).set({ role: "admin" }).where(eq(profiles.id, "student-2"));
  const withoutSecond = await unifiedActions.getUnifiedItemsForAllStudents(RANGE);
  assert.deepEqual([...new Set(withoutSecond.items.map((item) => item.space.studentId))], ["student-1"]);
});

test("학생이 90명을 넘으면 학생 id를 나눠 bind해 D1 bind 제한 안에서 모두 읽는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const extra = Array.from({ length: 95 }, (_, index) => `bulk-${String(index).padStart(3, "0")}`);
  // D1 batch도 statement당 bind 100개 제한이 있어 나눠 넣는다.
  for (let index = 0; index < extra.length; index += 20) {
    await db.insert(profiles).values(extra.slice(index, index + 20).map((id) => ({ id, email: `${id}@example.com`, displayName: id, role: "student" })));
  }
  for (let index = 0; index < extra.length; index += 30) {
    await db.insert(lessons).values(extra.slice(index, index + 30).map((id, offset) => ({
      id: `lesson-${id}`,
      studentId: id,
      scheduledAt: at(`2026-11-${String(1 + ((index + offset) % 28)).padStart(2, "0")}T10:00:00.000Z`),
    })));
  }
  const result = await unifiedActions.getUnifiedItemsForAllStudents(RANGE);
  assert.equal(new Set(result.items.map((item) => item.space.studentId)).size, 95, "97명 중 레슨이 있는 95명 모두 나온다");
  assert.equal(result.items.length, 95);

  // store를 직접 불러도 묶음 상한을 넘는 id는 거부한다(실수로 100개 넘게 bind하지 않게).
  const ids = ["student-1", "student-2", ...extra];
  const direct = await store.queryInternalUnifiedItemsForStudents(
    db,
    ids,
    queryModule.resolveAllStudentsItemsQuery(RANGE),
  );
  assert.equal(direct.items.length, 95);
  assert.equal(store.STUDENT_ID_CHUNK <= 90, true);
});

test("전체 노트는 활성 학생 노트를 최근 수정순·학생·종류로 돌려주고 학생 필터는 서버가 확인한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await db.insert(privateNotes).values([
    { id: "note-a", studentId: "student-1", authorId: "admin-1", title: "레슨 정리", contentHtml: "<p>EQ</p>", updatedAt: at("2026-11-01T00:00:00.000Z") },
    { id: "note-b", studentId: "student-2", authorId: "student-2", title: "연습 기록", contentHtml: "<p>믹스</p>", updatedAt: at("2026-11-03T00:00:00.000Z") },
    { id: "note-trash", studentId: "student-2", authorId: "student-2", title: "지운 노트", contentHtml: "<p>x</p>", deletedAt: at("2026-11-04T00:00:00.000Z") },
  ]);

  const all = await notesActions.getAllStudentNotes();
  assert.deepEqual(all.notes.map((note) => [note.id, note.studentId, note.kind]), [
    ["note-b", "student-2", "STUDENT"],
    ["note-a", "student-1", "STANN"],
  ]);
  assert.deepEqual(all.students.map((student) => student.id).sort(), ["student-1", "student-2"]);
  assert.equal(all.selectedStudentId, null);

  const filtered = await notesActions.getAllStudentNotes({ studentId: "student-1" });
  assert.deepEqual(filtered.notes.map((note) => note.id), ["note-a"]);
  assert.equal(filtered.selectedStudentId, "student-1");
  // 학생이 아닌 id(관리자)를 필터로 보내도 그 노트를 열지 않고 전체로 돌아간다.
  const bogus = await notesActions.getAllStudentNotes({ studentId: "admin-1" });
  assert.equal(bogus.selectedStudentId, null);

  activeSession = createSession("student-1", "student");
  await assert.rejects(() => notesActions.getAllStudentNotes());
});
