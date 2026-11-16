import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import type { AuthSession } from "@/lib/auth-guard";
import { calendarEvents, calendarGroupEvents, curriculums, lessonGroupMembers, lessonGroups, lessons, privateNotes, profiles } from "@/db/schema";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession | null = null;
let actions: typeof import("@/lib/actions/lessonGroups");
let lessonActions: typeof import("@/lib/actions/lessons");
const pushed: { profileIds: string[]; tag: string }[] = [];

function createSession(id: string, role: "admin" | "student"): AuthSession {
  return { expires: "2099-01-01T00:00:00.000Z", user: { id, role, name: id, email: `${id}@example.com`, image: null } };
}

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", { namedExports: { auth: async () => activeSession, signIn: async () => "/dashboard" } });
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
mock.module("@/lib/calendar-sync/sync-runner", {
  namedExports: {
    schedulePushStudentCalendarChanges: async () => undefined,
    schedulePushStudentsCalendarChanges: async () => undefined,
    stopGroupCalendarChannels: async () => undefined,
    restoreGroupCalendarChannels: async () => undefined,
    markLinksDeletedStatement: () => ({ query: "SELECT 1", params: [] }),
  },
});
mock.module("@/lib/push/notify", {
  namedExports: {
    notifyPush: async (audience: { kind: string; profileIds?: string[]; role?: string }, message: { tag: string }) => {
      pushed.push({ profileIds: audience.profileIds ?? [`role:${audience.role}`], tag: message.tag });
    },
  },
});

before(async () => {
  actions = await import("@/lib/actions/lessonGroups");
  lessonActions = await import("@/lib/actions/lessons");
});
after(() => mock.restoreAll());

async function setupDatabase(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = null;
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "관리자", role: "admin" },
    { id: "student-a", email: "a@example.com", displayName: "김학생", role: "student" },
    { id: "student-b", email: "b@example.com", displayName: "이학생", role: "student" },
    { id: "student-c", email: "c@example.com", displayName: "박학생", role: "student" },
    { id: "student-d", email: "d@example.com", displayName: null, role: "student" },
  ]);
  return isolated.db;
}

test("그룹 만들기·고치기·해제는 관리자만 하고 학생은 그룹 하나에만 속한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);

  activeSession = createSession("student-a", "student");
  await assert.rejects(actions.saveLessonGroupAction({ groupId: null, name: "화요일반", memberIds: ["student-a", "student-b"] }), /Admin only/);
  await assert.rejects(actions.getLessonGroups(), /Admin only/);

  activeSession = createSession("admin-1", "admin");
  assert.deepEqual(await actions.saveLessonGroupAction({ groupId: null, name: " ", memberIds: ["student-a", "student-b"] }), { ok: false, error: "그룹 이름을 1–60자로 적어 주세요." });
  assert.deepEqual(await actions.saveLessonGroupAction({ groupId: null, name: "혼자", memberIds: ["student-a"] }), { ok: false, error: "학생을 2명 이상 골라 주세요." });
  assert.equal((await actions.saveLessonGroupAction({ groupId: null, name: "관리자 섞기", memberIds: ["student-a", "admin-1"] })).ok, false);

  const created = await actions.saveLessonGroupAction({ groupId: null, name: "  화요일반 ", memberIds: ["student-a", "student-b"] });
  assert.equal(created.ok, true);
  const groupId = created.ok ? created.id! : "";
  assert.deepEqual(await actions.getLessonGroups(), [{ id: groupId, name: "화요일반", memberIds: ["student-a", "student-b"] }]);

  // 이미 다른 그룹에 있는 학생은 새 그룹에 넣을 수 없고, 아무것도 쓰지 않는다.
  assert.deepEqual(
    await actions.saveLessonGroupAction({ groupId: null, name: "목요일반", memberIds: ["student-b", "student-c"] }),
    { ok: false, error: "이학생은(는) 이미 다른 그룹에 있습니다." },
  );
  assert.equal((await db.select().from(lessonGroups)).length, 1);

  // 고치기: 이름 바꾸고 B를 빼고 C를 넣는다.
  assert.equal((await actions.saveLessonGroupAction({ groupId, name: "화요일 2:1", memberIds: ["student-a", "student-c"] })).ok, true);
  const members = (await db.select().from(lessonGroupMembers)).map((row) => [row.studentId, row.groupId]).sort();
  assert.deepEqual(members, [["student-a", groupId], ["student-c", groupId]]);

  // 그룹 노트가 남아 있으면 해제하지 않는다.
  await db.insert(privateNotes).values({ id: "note-g", studentId: "student-a", authorId: "student-a", groupId, title: "그룹", contentHtml: "<p>x</p>" });
  const blocked = await actions.deleteLessonGroupAction(groupId);
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? "" : blocked.error, /그룹 노트 1개/);
  assert.equal((await db.select().from(lessonGroups)).length, 1);

  await db.delete(privateNotes);
  assert.deepEqual(await actions.deleteLessonGroupAction(groupId), { ok: true });
  assert.equal((await db.select().from(lessonGroups)).length, 0);
  assert.equal((await db.select().from(lessonGroupMembers)).length, 0);
});

test("학생은 본인 그룹의 이름과 멤버 표시 이름만 보고, 다른 학생의 그룹은 못 본다", { concurrency: false }, async (context) => {
  await setupDatabase(context);
  activeSession = createSession("admin-1", "admin");
  const created = await actions.saveLessonGroupAction({ groupId: null, name: "화요일반", memberIds: ["student-a", "student-d"] });
  assert.equal(created.ok, true);
  const groupId = created.ok ? created.id! : "";

  activeSession = createSession("student-a", "student");
  const mine = await actions.getStudentLessonGroup("student-a");
  assert.deepEqual(mine, {
    id: groupId,
    name: "화요일반",
    members: [{ id: "student-a", name: "김학생" }, { id: "student-d", name: "이름 미등록" }],
  });
  assert.equal(JSON.stringify(mine).includes("@example.com"), false);
  await assert.rejects(actions.getStudentLessonGroup("student-d"), /Forbidden|Unauthorized/);

  activeSession = createSession("student-c", "student");
  assert.equal(await actions.getStudentLessonGroup("student-c"), null);
  await assert.rejects(actions.getStudentLessonGroup("student-a"), /Forbidden|Unauthorized/);
});

test("학생 홈은 멤버 모두 같은 시각인 다가오는 레슨만 그룹레슨으로 보고 함께하는 학생 이름만 받는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  activeSession = createSession("admin-1", "admin");
  assert.equal((await actions.saveLessonGroupAction({ groupId: null, name: "화요일반", memberIds: ["student-a", "student-b"] })).ok, true);
  const shared = new Date("2026-11-18T10:00:00.000Z");
  const soloA = new Date("2026-11-19T10:00:00.000Z");
  const past = new Date("2026-11-10T10:00:00.000Z");
  await db.insert(lessons).values([
    { id: "l-a1", studentId: "student-a", scheduledAt: shared },
    { id: "l-b1", studentId: "student-b", scheduledAt: shared },
    { id: "l-a2", studentId: "student-a", scheduledAt: soloA },
    { id: "l-b2", studentId: "student-b", scheduledAt: new Date("2026-11-19T11:00:00.000Z") },
    { id: "l-a0", studentId: "student-a", scheduledAt: past },
    { id: "l-b0", studentId: "student-b", scheduledAt: past },
    { id: "l-c1", studentId: "student-c", scheduledAt: shared },
  ]);
  const now = new Date("2026-11-16T00:00:00.000Z");

  activeSession = createSession("student-a", "student");
  const home = await actions.getMyHomeLessonGroup(now);
  assert.deepEqual(home, { name: "화요일반", partnerNames: ["이학생"], sharedLessonStarts: [shared.getTime()] });
  assert.equal(JSON.stringify(home).includes("@example.com"), false);

  activeSession = createSession("student-c", "student");
  assert.equal(await actions.getMyHomeLessonGroup(now), null);
  activeSession = createSession("admin-1", "admin");
  assert.equal(await actions.getMyHomeLessonGroup(now), null);
});

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test("그룹레슨: 관리자 예약·이동·삭제는 멤버 모두, 학생 이동은 본인 레슨만, 다가오는 레슨은 한 번으로 센다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  activeSession = createSession("admin-1", "admin");
  const created = await actions.saveLessonGroupAction({ groupId: null, name: "화요일반", memberIds: ["student-a", "student-b"] });
  const groupId = created.ok ? created.id! : "";
  const lessonTimes = async () => (await db.select().from(lessons))
    .map((row) => [row.studentId, row.scheduledAt.toISOString()] as const)
    .sort((x, y) => x[0].localeCompare(y[0]));

  // 학생은 그룹레슨을 만들 수 없다.
  activeSession = createSession("student-a", "student");
  await assert.rejects(lessonActions.createGroupLesson(groupId, {}, form({ scheduledAt: "2099-11-18T19:00" })), /Admin only/);

  activeSession = createSession("admin-1", "admin");
  pushed.length = 0;
  const made = await lessonActions.createGroupLesson(groupId, {}, form({ scheduledAt: "2099-11-18T19:00" }));
  assert.equal(made.success, true);
  assert.deepEqual(made.lessons?.map((lesson) => lesson.studentId).sort(), ["student-a", "student-b"]);
  assert.deepEqual(await lessonTimes(), [["student-a", "2099-11-18T10:00:00.000Z"], ["student-b", "2099-11-18T10:00:00.000Z"]]);
  assert.deepEqual(pushed.map((entry) => entry.profileIds[0]).sort(), ["student-a", "student-b"]);
  assert.deepEqual(await lessonActions.createGroupLesson("no-group", {}, form({ scheduledAt: "2099-11-18T19:00" })), { error: "그룹을 찾지 못했습니다. 목록을 새로고침해 주세요." });

  // 혼자 레슨(다른 학생)도 하나 있어 다가오는 레슨은 그룹 1 + 혼자 1 = 2.
  await db.insert(lessons).values({ id: "solo-c", studentId: "student-c", scheduledAt: new Date("2099-11-20T10:00:00.000Z") });
  assert.equal(await lessonActions.getUpcomingLessonCount(), 2);

  // 관리자가 옮기면 둘 다 옮겨진다.
  const lessonA = made.lessons!.find((lesson) => lesson.studentId === "student-a")!.id;
  assert.equal((await lessonActions.moveLesson(lessonA, "student-a", "2099-11-19T20:00")).success, true);
  assert.deepEqual((await lessonTimes()).filter(([id]) => id !== "student-c"), [["student-a", "2099-11-19T11:00:00.000Z"], ["student-b", "2099-11-19T11:00:00.000Z"]]);

  // 학생이 옮기면 본인 레슨만 바뀌고, 그 뒤엔 그룹레슨이 아니다.
  activeSession = createSession("student-b", "student");
  const lessonB = made.lessons!.find((lesson) => lesson.studentId === "student-b")!.id;
  assert.equal((await lessonActions.moveLesson(lessonB, "student-b", "2099-11-19T21:00")).success, true);
  assert.deepEqual((await lessonTimes()).filter(([id]) => id !== "student-c"), [["student-a", "2099-11-19T11:00:00.000Z"], ["student-b", "2099-11-19T12:00:00.000Z"]]);
  activeSession = createSession("admin-1", "admin");
  assert.equal(await lessonActions.getUpcomingLessonCount(), 3);

  // 다시 같은 시각으로 맞춘 뒤 관리자가 지우면 둘 다 지워진다. 다른 학생 레슨은 남는다.
  assert.equal((await lessonActions.moveLesson(lessonB, "student-b", "2099-11-19T20:00")).success, true);
  await lessonActions.deleteLesson(lessonA, "student-a");
  assert.deepEqual(await lessonTimes(), [["student-c", "2099-11-20T10:00:00.000Z"]]);
});

test("커리큘럼 모듈은 같은 그룹 멤버에게만 함께 추가하고, 그룹 밖 학생이 섞이면 하나도 만들지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  activeSession = createSession("admin-1", "admin");
  assert.equal((await actions.saveLessonGroupAction({ groupId: null, name: "화요일반", memberIds: ["student-a", "student-b"] })).ok, true);
  const curriculumActions = await import("@/lib/actions/curriculum");
  const modules = async () => (await db.select().from(curriculums)).map((row) => [row.studentId, row.weekNum, row.title]).sort();

  const outsider = form({ weekNum: "5", title: "하모닉 믹싱 입문" });
  outsider.append("alsoStudentId", "student-c");
  assert.match((await curriculumActions.createModule("student-a", {}, outsider)).error ?? "", /그룹이 바뀌었습니다/);
  assert.deepEqual(await modules(), []);

  const together = form({ weekNum: "5", title: "하모닉 믹싱 입문" });
  together.append("alsoStudentId", "student-b");
  assert.deepEqual(await curriculumActions.createModule("student-a", {}, together), { success: true });
  assert.deepEqual(await modules(), [["student-a", 5, "하모닉 믹싱 입문"], ["student-b", 5, "하모닉 믹싱 입문"]]);

  // 그룹이 없는 학생은 함께 추가할 수 없다.
  const solo = form({ weekNum: "1", title: "기초" });
  solo.append("alsoStudentId", "student-a");
  assert.match((await curriculumActions.createModule("student-c", {}, solo)).error ?? "", /그룹이 바뀌었습니다/);

  activeSession = createSession("student-a", "student");
  await assert.rejects(curriculumActions.createModule("student-a", {}, together));
});

test("멤버를 바꾸면 새 멤버는 아직 시작하지 않은 그룹 일정 사본을 받고 빠진 멤버의 사본은 개인 일정으로 남는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  activeSession = createSession("admin-1", "admin");
  const created = await actions.saveLessonGroupAction({ groupId: null, name: "화요일반", memberIds: ["student-a", "student-b"] });
  assert.equal(created.ok, true);
  const groupId = created.ok ? created.id! : "";
  const future = new Date(Date.now() + 3 * 86_400_000);
  const past = new Date(Date.now() - 3 * 86_400_000);
  await db.insert(calendarGroupEvents).values([
    { id: "ge-future", groupId, title: "합주", startTime: future },
    { id: "ge-past", groupId, title: "지난 합주", startTime: past },
  ]);
  await db.insert(calendarEvents).values([
    { id: "c-a-future", userId: "student-a", eventType: "NOTE", title: "합주", startTime: future, groupEventId: "ge-future" },
    { id: "c-b-future", userId: "student-b", eventType: "NOTE", title: "합주", startTime: future, groupEventId: "ge-future" },
    { id: "c-a-past", userId: "student-a", eventType: "NOTE", title: "지난 합주", startTime: past, groupEventId: "ge-past" },
  ]);

  // B를 빼고 C를 넣는다.
  assert.equal((await actions.saveLessonGroupAction({ groupId, name: "화요일반", memberIds: ["student-a", "student-c"] })).ok, true);
  const rows = (await db.select({ userId: calendarEvents.userId, title: calendarEvents.title, groupEventId: calendarEvents.groupEventId }).from(calendarEvents))
    .map((row) => [row.userId, row.title, row.groupEventId])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])) || String(left[1]).localeCompare(String(right[1])));
  assert.deepEqual(rows, [
    ["student-a", "지난 합주", "ge-past"],
    ["student-a", "합주", "ge-future"],
    ["student-b", "합주", null],
    ["student-c", "합주", "ge-future"],
  ]);

  // 다시 저장해도 사본을 또 만들지 않는다.
  assert.equal((await actions.saveLessonGroupAction({ groupId, name: "화요일반", memberIds: ["student-a", "student-c"] })).ok, true);
  assert.equal((await db.select().from(calendarEvents)).length, 4);
});
