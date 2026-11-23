/**
 * 관리자 전체 과제(캔버스 AdminAssignments)를 격리 D1(실제 D1 SQL)에서 확인한다.
 * 관리자만 읽는지, 수강 종료한 학생과 다른 학생 필터를 지키는지, 세 구역(피드백 대기·아직 안 냄·최근 확인)의
 * 상관 서브쿼리와 정렬이 D1에서 맞게 도는지 본다.
 */
import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import type { AuthSession } from "@/lib/auth-guard";
import { assignments, assignmentTasks, feedbacks, profiles } from "@/db/schema";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession = createSession("admin-1", "admin");
let actions: typeof import("@/lib/actions/admin-assignments");

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
  actions = await import("@/lib/actions/admin-assignments");
});

after(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

const at = (iso: string) => new Date(iso);
const NOW = at("2026-11-23T03:00:00.000Z");

async function setupDatabase(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = createSession("admin-1", "admin");
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  const db = isolated.db;
  await db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-1", email: "student-1@example.com", displayName: "민지", role: "student" },
    { id: "student-2", email: "student-2@example.com", displayName: "준호", role: "student" },
    { id: "student-old", email: "old@example.com", displayName: "지난 학생", role: "student", accountStatus: "ARCHIVED", archivedAt: at("2026-10-01T00:00:00.000Z") },
  ]);
  await db.insert(assignmentTasks).values([
    { id: "t-overdue", studentId: "student-1", title: "연습 일지", submissionFormat: "TEXT", dueAt: at("2026-11-20T00:00:00.000Z") },
    { id: "t-nodue", studentId: "student-2", title: "자유 연습", submissionFormat: "TEXT", dueAt: null },
    { id: "t-soon", studentId: "student-2", title: "믹스 다듬기", submissionFormat: "MIX", dueAt: at("2026-11-24T00:00:00.000Z") },
    { id: "t-pending", studentId: "student-1", title: "믹스셋", submissionFormat: "MIX", dueAt: at("2026-11-21T00:00:00.000Z") },
    { id: "t-pending2", studentId: "student-2", title: "트랙 분석", submissionFormat: "TEXT", dueAt: null },
    { id: "t-fb", studentId: "student-1", title: "피드백 받은 셋", submissionFormat: "MIX", dueAt: null },
    { id: "t-ack", studentId: "student-2", title: "확인한 셋", submissionFormat: "MIX", dueAt: null },
    { id: "t-stale", studentId: "student-1", title: "오래된 셋", submissionFormat: "MIX", dueAt: null },
    { id: "t-old", studentId: "student-old", title: "지난 학생 과제", submissionFormat: "TEXT", dueAt: at("2026-09-01T00:00:00.000Z") },
  ]);
  await db.insert(assignments).values([
    { id: "a-pending-new", studentId: "student-2", taskId: "t-pending2", mediaUrl: "https://youtu.be/b", submittedAt: at("2026-11-22T00:00:00.000Z") },
    { id: "a-pending-old", studentId: "student-1", taskId: "t-pending", mediaUrl: "https://youtu.be/a", submittedAt: at("2026-11-19T00:00:00.000Z") },
    { id: "a-free", studentId: "student-1", taskId: null, mediaUrl: "https://youtu.be/f", submittedAt: at("2026-11-21T00:00:00.000Z") },
    { id: "a-fb", studentId: "student-1", taskId: "t-fb", mediaUrl: "https://youtu.be/c", submittedAt: at("2026-11-15T00:00:00.000Z") },
    { id: "a-ack", studentId: "student-2", taskId: "t-ack", mediaUrl: "https://youtu.be/d", submittedAt: at("2026-11-18T00:00:00.000Z"), reviewedAt: at("2026-11-18T05:00:00.000Z") },
    { id: "a-stale", studentId: "student-1", taskId: "t-stale", mediaUrl: "https://youtu.be/e", submittedAt: at("2026-09-01T00:00:00.000Z"), reviewedAt: at("2026-09-02T00:00:00.000Z") },
  ]);
  await db.insert(feedbacks).values([{ id: "fb-1", assignmentId: "a-fb", content: "좋아요" }]);
  return db;
}

test("전체 과제는 수강 중인 학생의 피드백 대기·아직 안 낸 과제·최근 확인한 제출을 순서대로 돌려준다", { concurrency: false }, async (context) => {
  await setupDatabase(context);
  const overview = await actions.getAdminAssignmentsOverview({}, NOW);

  assert.deepEqual(overview.students.map((student) => student.id), ["student-1", "student-2"]);
  assert.equal(overview.selectedStudentId, null);
  // 오래된 제출부터, 과제 없는 제출은 "자유 제출".
  assert.deepEqual(overview.pending.map((row) => [row.id, row.title]), [
    ["a-pending-old", "믹스셋"],
    ["a-free", "자유 제출"],
    ["a-pending-new", "트랙 분석"],
  ]);
  // 마감 지난 것 → 가까운 마감 → 마감 없음. 제출한 과제와 수강 종료한 학생 과제는 없다.
  assert.deepEqual(overview.open.map((row) => row.id), ["t-overdue", "t-soon", "t-nodue"]);
  // 피드백이 있거나 확인한 제출 중 최근 30일, 최신순.
  assert.deepEqual(overview.reviewed.map((row) => row.id), ["a-ack", "a-fb"]);
});

test("전체 과제의 학생 필터는 수강 중인 학생만 받고 모르는 값은 전체로 돌아간다", { concurrency: false }, async (context) => {
  await setupDatabase(context);
  const one = await actions.getAdminAssignmentsOverview({ studentId: "student-2" }, NOW);
  assert.equal(one.selectedStudentId, "student-2");
  assert.deepEqual(one.pending.map((row) => row.id), ["a-pending-new"]);
  assert.deepEqual(one.open.map((row) => row.id), ["t-soon", "t-nodue"]);
  assert.deepEqual(one.reviewed.map((row) => row.id), ["a-ack"]);

  const archived = await actions.getAdminAssignmentsOverview({ studentId: "student-old" }, NOW);
  assert.equal(archived.selectedStudentId, null);
  assert.equal(archived.open.some((row) => row.studentId === "student-old"), false);
});

test("전체 과제는 관리자만 읽는다", { concurrency: false }, async (context) => {
  await setupDatabase(context);
  activeSession = createSession("student-1", "student");
  await assert.rejects(() => actions.getAdminAssignmentsOverview({}, NOW));
});
