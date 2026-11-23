/**
 * 학생 수강 종료(보관)·복원(0032 `profiles.account_status`)을 격리 D1(실제 D1 SQL)에서 확인한다.
 * 수강 종료는 기록을 하나도 지우지 않고 로그인·session·목록·선택지·업무함·알림·그룹 판정·캘린더 동기화에서만 뺀다.
 * 그룹 멤버 자리는 남고, 복원하면 모두 그대로 돌아온다.
 */
import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import {
  accountDeletionJobs,
  assignments,
  calendarConnections,
  calendarMappings,
  feedbacks,
  guideAccess,
  lessonGroupMembers,
  lessonGroups,
  lessons,
  privateNotes,
  profiles,
  pushSubscriptions,
  qnaThreads,
} from "@/db/schema";
import { createQnaReplyAtomically, createQnaThreadAtomically } from "@/lib/qna-atomic";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession | null = null;
let studentActions: typeof import("@/lib/actions/students");
let groupActions: typeof import("@/lib/actions/lessonGroups");
let assignmentActions: typeof import("@/lib/actions/assignments");
let notesActions: typeof import("@/lib/actions/all-notes");
let qnaActions: typeof import("@/lib/actions/qna");
let activeProfile: typeof import("@/lib/active-profile");
let roster: typeof import("@/lib/student-roster");
let pushStore: typeof import("@/lib/push/store");
let mappingSync: typeof import("@/lib/calendar-sync/mapping-sync");
let archivedRecords: typeof import("@/lib/archived-student-records");
const resyncedStudents: string[][] = [];
const prunedStudents: string[] = [];

class RedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`NEXT_REDIRECT ${path}`);
  }
}

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
mock.module("next/navigation", {
  namedExports: {
    redirect: (path: string) => {
      throw new RedirectSignal(path);
    },
  },
});
mock.module("@/lib/calendar-sync/sync-runner", {
  namedExports: {
    schedulePushStudentCalendarChanges: async () => undefined,
    schedulePushStudentsCalendarChanges: async (studentIds: string[]) => {
      resyncedStudents.push([...studentIds]);
    },
    schedulePruneDeletedStudentCalendarCopies: async (studentId: string) => {
      prunedStudents.push(studentId);
    },
    stopGroupCalendarChannels: async () => undefined,
    restoreGroupCalendarChannels: async () => undefined,
    markLinksDeletedStatement: () => ({ query: "SELECT 1", params: [] }),
  },
});
mock.module("@/lib/push/notify", { namedExports: { notifyPush: async () => undefined } });

const realFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`테스트 중 외부 요청 금지: ${String(input)}`);
  }) as typeof fetch;
  studentActions = await import("@/lib/actions/students");
  groupActions = await import("@/lib/actions/lessonGroups");
  assignmentActions = await import("@/lib/actions/assignments");
  notesActions = await import("@/lib/actions/all-notes");
  qnaActions = await import("@/lib/actions/qna");
  activeProfile = await import("@/lib/active-profile");
  roster = await import("@/lib/student-roster");
  pushStore = await import("@/lib/push/store");
  mappingSync = await import("@/lib/calendar-sync/mapping-sync");
  archivedRecords = await import("@/lib/archived-student-records");
});

after(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

/** 김학생(a)·이학생(b)은 화요일반, 박학생(c)은 혼자. a에게 레슨·노트·검토 대기 제출·미답변 질문·알림 구독·캘린더 매핑이 있다. */
async function setupDatabase(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = createSession("admin-1", "admin");
  resyncedStudents.length = 0;
  prunedStudents.length = 0;
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  const db = isolated.db;
  await db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-a", email: "a@example.com", displayName: "김학생", role: "student" },
    { id: "student-b", email: "b@example.com", displayName: "이학생", role: "student" },
    { id: "student-c", email: "c@example.com", displayName: "박학생", role: "student" },
  ]);
  await db.insert(lessonGroups).values({ id: "group-1", name: "화요일반" });
  await db.insert(lessonGroupMembers).values([
    { studentId: "student-a", groupId: "group-1" },
    { studentId: "student-b", groupId: "group-1" },
  ]);
  await db.insert(lessons).values({ id: "lesson-a", studentId: "student-a", scheduledAt: new Date("2026-12-01T10:00:00.000Z") });
  await db.insert(privateNotes).values({
    id: "note-a", studentId: "student-a", authorId: "admin-1", title: "김학생 레슨 메모", contentHtml: "<p>메모</p>",
    noteDate: new Date("2026-11-10T03:00:00.000Z"),
  });
  await db.insert(assignments).values([
    { id: "submission-a", studentId: "student-a", mediaUrl: "https://youtu.be/a", submittedAt: new Date("2026-11-15T00:00:00.000Z") },
    { id: "submission-c", studentId: "student-c", mediaUrl: "https://youtu.be/c", submittedAt: new Date("2026-11-15T00:00:00.000Z") },
  ]);
  await db.insert(qnaThreads).values({ id: "qna-a", studentId: "student-a", title: "김학생 질문", status: "OPEN" });
  await db.insert(pushSubscriptions).values([
    { id: "sub-a", profileId: "student-a", endpoint: "https://push.example.com/a", ...keys },
    { id: "sub-b", profileId: "student-b", endpoint: "https://push.example.com/b", ...keys },
  ]);
  await db.insert(calendarConnections).values({
    id: "conn-1", ownerId: "admin-1", provider: "GOOGLE", accountLabel: "teacher@gmail.com",
    encryptedCredentials: "sealed", credentialsIv: "iv",
  });
  await db.insert(calendarMappings).values({
    id: "mapping-a", connectionId: "conn-1", studentId: "student-a", remoteCalendarId: "cal-a", remoteCalendarName: "김학생",
  });
  return db;
}

async function expectRedirect(promise: Promise<unknown>, path: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof RedirectSignal && error.path === path);
}

const ctx = () => ({ kind: "d1" as const, db: requireActiveDb() });

test("수강 종료는 기록을 지우지 않고 로그인·목록·업무함·알림·그룹 판정·캘린더 동기화에서만 뺀다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);

  // 수강 종료 전: 김학생이 목록·업무함·알림 대상에 있다(대조군).
  assert.deepEqual((await studentActions.getStudentRosterStats()).map((row) => row.id).sort(), ["student-a", "student-b", "student-c"]);
  assert.equal(await roster.queryAdminWorkCount(db), 3, "제출 2건과 미답변 질문 1건");

  activeSession = createSession("student-b", "student");
  await assert.rejects(studentActions.archiveStudent("student-a"), /Admin only/);

  activeSession = createSession("admin-1", "admin");
  await expectRedirect(studentActions.archiveStudent("student-a"), "/dashboard/admin?section=students");
  assert.deepEqual(resyncedStudents, [["student-b", "student-a"]], "남은 그룹 멤버와 본인 캘린더를 다시 맞춘다");

  const [stored] = await db.select().from(profiles).where(eq(profiles.id, "student-a"));
  assert.equal(stored?.accountStatus, "ARCHIVED");
  assert.ok(stored?.archivedAt instanceof Date);

  // 로그인·session: 같은 경계(parseActiveProfile)가 ARCHIVED를 막는다.
  assert.equal(await activeProfile.findActiveProfileByEmail("a@example.com", db), null, "로그인할 수 없다");
  assert.equal(await activeProfile.findActiveSessionProfileById("student-a", db), null, "기존 session은 다음 확인에서 끝난다");
  assert.ok(await activeProfile.findActiveSessionProfileById("student-b", db), "다른 학생은 그대로다");

  // 목록·선택지·숫자.
  assert.deepEqual((await studentActions.getStudentRosterStats()).map((row) => row.id).sort(), ["student-b", "student-c"]);
  assert.deepEqual((await studentActions.getStudentOptions()).map((row) => row.id), ["student-c", "student-b"]);
  assert.equal(await studentActions.getStudentCount(), 2);
  assert.deepEqual((await studentActions.getArchivedStudents()).map((row) => row.id), ["student-a"]);
  assert.equal(await studentActions.getArchivedStudentCount(), 1);

  // 업무함: 검토 대기 제출·미답변 질문에서 빠진다(기록은 남는다).
  assert.deepEqual((await assignmentActions.getPendingFeedbackAssignments()).map((row) => row.id), ["submission-c"]);
  assert.equal(await roster.queryAdminWorkCount(db), 1);

  // 전체 노트: 수강 종료한 학생의 개인 노트는 빠진다.
  const notes = await notesActions.getAllStudentNotes({});
  assert.deepEqual(notes.students.map((student) => student.id).sort(), ["student-b", "student-c"]);
  assert.equal(notes.notes.some((note) => note.id === "note-a"), false);

  // 알림: 구독은 남기고 보내지만 않는다.
  const targets = await pushStore.listPushTargets(db, { kind: "role", role: "student" });
  assert.deepEqual(targets.map((target) => target.profileId), ["student-b"]);
  assert.equal((await db.select().from(pushSubscriptions)).length, 2);

  // 그룹: 자리는 남고 인원·그룹레슨 판정에서는 빠진다. 수강 종료한 학생은 새로 고를 수 없다.
  const [group] = await groupActions.getLessonGroups();
  assert.deepEqual(group?.memberIds, ["student-b"]);
  const rejected = await groupActions.saveLessonGroupAction({ groupId: "group-1", name: "화요일반", memberIds: ["student-a", "student-b"] });
  assert.equal(rejected.ok, false);
  const saved = await groupActions.saveLessonGroupAction({ groupId: "group-1", name: "화요일반", memberIds: ["student-b", "student-c"] });
  assert.equal(saved.ok, true);
  const seats = await db.select({ studentId: lessonGroupMembers.studentId }).from(lessonGroupMembers).where(eq(lessonGroupMembers.groupId, "group-1"));
  assert.deepEqual(seats.map((seat) => seat.studentId).sort(), ["student-a", "student-b", "student-c"], "그룹을 고쳐도 수강 종료한 학생 자리는 남는다");

  // 캘린더: 매핑은 남기고 동기화만 멈춘다(외부 요청 없이 건너뛴다).
  assert.deepEqual(await mappingSync.listAllActiveMappingIds(ctx()), []);
  const skipped = await mappingSync.syncCalendarMapping(ctx(), "mapping-a");
  assert.deepEqual(skipped, { status: "skipped", localChanged: false, reason: "archived" });

  // 기록은 하나도 지우지 않는다.
  assert.equal((await db.select().from(lessons).where(eq(lessons.studentId, "student-a"))).length, 1);
  assert.equal((await db.select().from(privateNotes).where(eq(privateNotes.studentId, "student-a"))).length, 1);
  assert.equal((await db.select().from(assignments).where(eq(assignments.studentId, "student-a"))).length, 1);
  assert.equal((await db.select().from(qnaThreads).where(eq(qnaThreads.studentId, "student-a"))).length, 1);
  assert.equal((await db.select().from(calendarMappings)).length, 1);

  // 두 번 눌러도 한 번만, 관리자 계정은 대상이 아니다.
  assert.deepEqual(await studentActions.archiveStudent("student-a"), {
    ok: false,
    error: "이미 수강을 종료했거나 찾을 수 없는 학생입니다. 학생 목록을 새로 고쳐 주세요.",
  });
  assert.equal((await studentActions.archiveStudent("admin-1")).ok, false);
  const [admin] = await db.select().from(profiles).where(eq(profiles.id, "admin-1"));
  assert.equal(admin?.accountStatus, "ACTIVE");
});

test("수강 종료 때 예정 레슨 지우기를 켜면 그 학생의 지금 이후 레슨만 지우고 지난 레슨·다른 멤버 레슨은 남긴다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const day = 24 * 60 * 60 * 1_000;
  const groupStart = new Date(Date.now() + 7 * day);
  // 준비 데이터의 고정 날짜 레슨은 시간이 지나면 지난 레슨이 되므로 지금 기준 레슨으로 바꾼다.
  await db.delete(lessons).where(eq(lessons.id, "lesson-a"));
  await db.insert(lessons).values([
    { id: "lesson-a-past", studentId: "student-a", scheduledAt: new Date(Date.now() - 7 * day) },
    { id: "lesson-a-group", studentId: "student-a", scheduledAt: groupStart },
    { id: "lesson-b-group", studentId: "student-b", scheduledAt: groupStart },
    { id: "lesson-c-solo", studentId: "student-c", scheduledAt: new Date(Date.now() + 3 * day) },
  ]);
  const lessonIds = async () => (await db.select({ id: lessons.id }).from(lessons)).map((row) => row.id).sort();
  const before = await lessonIds();

  // 끄고 종료하면(기본) 레슨은 하나도 지우지 않고 원격 정리도 하지 않는다.
  await expectRedirect(studentActions.archiveStudent("student-c", false), "/dashboard/admin?section=students");
  assert.deepEqual(await lessonIds(), before);
  assert.deepEqual(prunedStudents, []);

  // 켜고 종료하면 김학생의 지금 이후 레슨(개인·그룹 몫)만 지운다. 이학생의 같은 시각 그룹레슨은 남는다.
  await expectRedirect(studentActions.archiveStudent("student-a", true), "/dashboard/admin?section=students");
  const after = ["lesson-a-past", "lesson-b-group", "lesson-c-solo"];
  assert.deepEqual(await lessonIds(), after);
  assert.deepEqual(prunedStudents, ["student-a"], "지운 레슨의 원격 사본 정리를 응답 뒤로 예약한다");
  const [stored] = await db.select().from(profiles).where(eq(profiles.id, "student-a"));
  assert.equal(stored?.accountStatus, "ARCHIVED");

  // 이미 수강을 종료한 학생은 다시 지우지 않는다(대상 확인에서 멈춘다).
  assert.equal((await studentActions.archiveStudent("student-a", true)).ok, false);
  assert.deepEqual(await lessonIds(), after);
});

test("수강 종료한 학생의 보기 전용 기록은 관리자만, 수강 종료한 학생만 읽고 그 학생의 개인 기록만 돌려준다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const day = (value: string) => new Date(`2026-11-${value}T03:00:00.000Z`);
  await db.insert(privateNotes).values([
    // 그룹 노트·휴지통 노트·다른 학생 노트는 빠진다.
    { id: "note-a-group", studentId: "student-a", authorId: "admin-1", groupId: "group-1", title: "화요일반 노트", contentHtml: "<p>그룹</p>" },
    { id: "note-a-trash", studentId: "student-a", authorId: "admin-1", title: "지운 노트", contentHtml: "<p>x</p>", deletedAt: day("12"), deletedById: "admin-1" },
    { id: "note-b", studentId: "student-b", authorId: "admin-1", title: "이학생 노트", contentHtml: "<p>b</p>" },
  ]);
  await db.insert(feedbacks).values([
    { id: "fb-a-2", assignmentId: "submission-a", timeMarker: 95, content: "브레이크 잔음", createdAt: day("17") },
    { id: "fb-a-1", assignmentId: "submission-a", timeMarker: null, content: "전체 흐름 좋음", createdAt: day("16") },
    { id: "fb-c", assignmentId: "submission-c", timeMarker: null, content: "박학생 피드백", createdAt: day("16") },
  ]);
  await db.insert(qnaThreads).values([
    { id: "qna-a-trash", studentId: "student-a", title: "지운 질문", status: "OPEN", deletedAt: day("13"), deletedById: "student-a" },
    { id: "qna-b", studentId: "student-b", title: "이학생 질문", status: "OPEN" },
  ]);
  // 답글은 실제 작성 경로(receipt 포함)로만 들어간다.
  const qnaContext = { kind: "d1" as const, db };
  const asked = await createQnaThreadAtomically(qnaContext, {
    actor: { id: "student-a", isAdmin: false }, threadId: "qna-a-asked", replyId: "reply-a-question",
    operationId: crypto.randomUUID(), title: "잔음 처리 질문", contentHtml: "<p>질문 본문</p>",
    attachmentUrl: null, attachmentObjectId: null, now: day("14"),
  });
  assert.equal(asked.ok, true);
  const answered = await createQnaReplyAtomically(qnaContext, {
    actor: { id: "admin-1", isAdmin: true }, threadId: "qna-a-asked", replyId: "reply-a-answer",
    operationId: crypto.randomUUID(), contentHtml: "<p>답변</p>", attachmentUrl: null, attachmentObjectId: null, now: day("15"),
  });
  assert.equal(answered.ok, true);
  const otherAsked = await createQnaThreadAtomically(qnaContext, {
    actor: { id: "student-b", isAdmin: false }, threadId: "qna-b-asked", replyId: "reply-b",
    operationId: crypto.randomUUID(), title: "이학생 질문 2", contentHtml: "<p>b 질문</p>",
    attachmentUrl: null, attachmentObjectId: null, now: day("14"),
  });
  assert.equal(otherAsked.ok, true);

  // 수강 중인 학생은 보기 전용 상세가 아니다(원래 학생 상세에서 본다).
  assert.equal(await archivedRecords.loadArchivedStudentRecords("student-a", "notes"), null);
  assert.equal(await archivedRecords.isArchivedStudent("student-a"), false);
  await expectRedirect(studentActions.archiveStudent("student-a"), "/dashboard/admin?section=students");

  // 학생 session은 수강 종료한 학생의 기록을 읽을 수 없다.
  activeSession = createSession("student-b", "student");
  await assert.rejects(archivedRecords.loadArchivedStudentRecords("student-a", "notes"), /Admin only/);
  activeSession = createSession("admin-1", "admin");

  const notes = await archivedRecords.loadArchivedStudentRecords("student-a", "notes");
  assert.ok(notes && notes.tab === "notes");
  assert.equal(notes.student.name, "김학생");
  assert.ok(notes.student.archivedAt instanceof Date);
  assert.deepEqual(notes.counts, { notes: 1, assignments: 1, qna: 2 }, "탭 숫자는 줄 수와 같다");
  assert.deepEqual(notes.rows.map((row) => [row.id, row.title, row.contentHtml]), [["note-a", "김학생 레슨 메모", "<p>메모</p>"]]);
  assert.equal(notes.rows[0]?.date.toISOString(), "2026-11-10T03:00:00.000Z", "노트 날짜가 있으면 그 날짜");

  const submitted = await archivedRecords.loadArchivedStudentRecords("student-a", "assignments");
  assert.ok(submitted && submitted.tab === "assignments");
  assert.deepEqual(submitted.rows.map((row) => row.id), ["submission-a"]);
  assert.deepEqual(submitted.rows[0]?.feedbacks.map((feedback) => [feedback.id, feedback.timeMarker, feedback.content]), [
    ["fb-a-1", null, "전체 흐름 좋음"],
    ["fb-a-2", 95, "브레이크 잔음"],
  ], "그 제출의 피드백만 남긴 순서대로");

  const qna = await archivedRecords.loadArchivedStudentRecords("student-a", "qna");
  assert.ok(qna && qna.tab === "qna");
  assert.deepEqual(qna.rows.map((row) => row.id), ["qna-a", "qna-a-asked"], "최근에 바뀐 질문부터");
  assert.equal(qna.rows.length, qna.counts.qna);
  assert.deepEqual(qna.rows[1]?.replies.map((reply) => [reply.id, reply.authorRole]), [
    ["reply-a-question", "student"],
    ["reply-a-answer", "admin"],
  ], "질문 다음 답변");

  // 수강 중인 학생·관리자·없는 id는 읽지 않는다.
  for (const id of ["student-b", "admin-1", "missing", ""]) {
    assert.equal(await archivedRecords.loadArchivedStudentRecords(id, "notes"), null, id);
  }
  assert.equal(await archivedRecords.isArchivedStudent("student-a"), true);

  // 복원하면 다시 보기 전용 상세 대상이 아니다.
  assert.equal((await studentActions.restoreStudent("student-a")).ok, true);
  assert.equal(await archivedRecords.loadArchivedStudentRecords("student-a", "notes"), null);
});

test("복원하면 로그인·목록·그룹·업무함·알림·캘린더가 기록과 함께 그대로 돌아온다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await expectRedirect(studentActions.archiveStudent("student-a"), "/dashboard/admin?section=students");
  resyncedStudents.length = 0;

  activeSession = createSession("student-b", "student");
  await assert.rejects(studentActions.restoreStudent("student-a"), /Admin only/);

  activeSession = createSession("admin-1", "admin");
  assert.deepEqual(await studentActions.restoreStudent("student-a"), { ok: true, name: "김학생" });
  assert.deepEqual(resyncedStudents, [["student-a", "student-b", "student-a"]], "복원한 학생이 그룹 판정에 다시 들어가 그룹 캘린더를 맞춘다");

  const [stored] = await db.select().from(profiles).where(eq(profiles.id, "student-a"));
  assert.equal(stored?.accountStatus, "ACTIVE");
  assert.equal(stored?.archivedAt, null);
  assert.ok(await activeProfile.findActiveProfileByEmail("a@example.com", db), "다시 로그인할 수 있다");
  assert.deepEqual((await studentActions.getStudentRosterStats()).map((row) => row.id).sort(), ["student-a", "student-b", "student-c"]);
  assert.deepEqual((await groupActions.getLessonGroups())[0]?.memberIds, ["student-a", "student-b"]);
  assert.equal(await roster.queryAdminWorkCount(db), 3);
  assert.deepEqual((await pushStore.listPushTargets(db, { kind: "role", role: "student" })).map((target) => target.profileId).sort(), ["student-a", "student-b"]);
  assert.deepEqual(await mappingSync.listAllActiveMappingIds(ctx()), ["mapping-a"]);
  assert.equal(await studentActions.getArchivedStudentCount(), 0);

  assert.deepEqual(await studentActions.restoreStudent("student-a"), {
    ok: false,
    error: "이미 복원했거나 찾을 수 없는 학생입니다. 목록을 새로 고쳐 주세요.",
  });
});

test("학생 삭제는 가입 전·기록 없는 학생만 격리 D1에서 지우고, 그사이 레슨이 생기면 아무것도 지우지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  const invite = `invite:${Math.floor(Date.now() / 1000) + 7 * 86_400}:$2a$10$abcdefghijklmnopqrstuv`;
  await db.insert(profiles).values([
    { id: "student-new", email: "new@example.com", displayName: "최학생", role: "student", passwordHash: invite },
    { id: "student-raced", email: "raced@example.com", displayName: "정학생", role: "student", passwordHash: invite },
  ]);
  await db.insert(guideAccess).values([
    { studentId: "student-new", mode: "ALL" },
    { studentId: "student-raced", mode: "ALL" },
  ]);

  activeSession = createSession("student-b", "student");
  await assert.rejects(studentActions.deleteStudent("student-new"), /Admin only/);
  activeSession = createSession("admin-1", "admin");

  assert.deepEqual(await studentActions.getStudentDeletionState("student-new"), { kind: "deletable" });
  assert.deepEqual(await studentActions.getStudentDeletionState("student-a"), { kind: "signed-up" });
  await expectRedirect(studentActions.deleteStudent("student-new"), "/dashboard/admin?section=students");
  assert.equal((await db.select().from(profiles).where(eq(profiles.id, "student-new"))).length, 0);
  assert.equal((await db.select().from(guideAccess).where(eq(guideAccess.studentId, "student-new"))).length, 0);
  const [receipt] = await db.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.subjectId, "student-new"));
  assert.equal(receipt?.status, "ERASED");
  assert.deepEqual(await studentActions.deleteStudent("student-new"), {
    ok: false,
    error: "이미 삭제했거나 찾을 수 없는 학생입니다. 학생 목록을 새로 고쳐 주세요.",
  });

  // 화면을 연 뒤 레슨이 생기면 batch 맨 앞 조건이 막아 계정·설정·영수증 모두 그대로다.
  assert.deepEqual(await studentActions.getStudentDeletionState("student-raced"), { kind: "deletable" });
  await db.insert(lessons).values({ id: "lesson-raced", studentId: "student-raced", scheduledAt: new Date() });
  assert.deepEqual(await studentActions.deleteStudent("student-raced"), {
    ok: false,
    error: "가입했거나 기록이 생겨 삭제하지 않았습니다. 수강 종료를 쓰세요.",
  });
  assert.equal((await db.select().from(profiles).where(eq(profiles.id, "student-raced"))).length, 1);
  assert.equal((await db.select().from(guideAccess).where(eq(guideAccess.studentId, "student-raced"))).length, 1);
  assert.equal((await db.select().from(lessons).where(eq(lessons.id, "lesson-raced"))).length, 1);
  assert.equal((await db.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.subjectId, "student-raced"))).length, 0);
  assert.deepEqual(await studentActions.getStudentDeletionState("student-raced"), { kind: "has-records" });

  // 가입한 학생은 기록이 있어도 없어도 지우지 않는다.
  assert.deepEqual(await studentActions.deleteStudent("student-c"), {
    ok: false,
    error: "가입했거나 기록이 생겨 삭제하지 않았습니다. 수강 종료를 쓰세요.",
  });
  assert.equal((await db.select().from(profiles).where(eq(profiles.id, "student-c"))).length, 1);
});

test("업무함 질문은 열린 질문만, 수강 중인 학생 것만 관리자에게 돌려준다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await db.insert(qnaThreads).values([
    { id: "qna-c-open", studentId: "student-c", title: "박학생 질문", status: "OPEN" },
    { id: "qna-c-answered", studentId: "student-c", title: "답한 질문", status: "ANSWERED" },
    { id: "qna-c-closed", studentId: "student-c", title: "닫은 질문", status: "CLOSED" },
    { id: "qna-c-trashed", studentId: "student-c", title: "지운 질문", status: "OPEN", deletedAt: new Date("2026-11-20T00:00:00.000Z") },
  ]);
  assert.deepEqual((await qnaActions.getOpenQnaThreadsForWorkQueue()).map((thread) => thread.id).sort(), ["qna-a", "qna-c-open"]);

  await db.update(profiles).set({ accountStatus: "ARCHIVED", archivedAt: new Date() }).where(eq(profiles.id, "student-a"));
  assert.deepEqual((await qnaActions.getOpenQnaThreadsForWorkQueue()).map((thread) => thread.id), ["qna-c-open"], "수강 종료한 학생 질문은 뺀다");

  activeSession = createSession("student-c", "student");
  await assert.rejects(qnaActions.getOpenQnaThreadsForWorkQueue(), /Admin only/);
});

test("학생 내 제출 목록은 본문 대신 글이 있는지만 읽고 본인 제출만 돌려준다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context);
  await db.insert(assignments).values([
    { id: "text-c", studentId: "student-c", textHtml: "<p>연습 일지</p>", submittedAt: new Date("2026-11-16T00:00:00.000Z") },
    { id: "empty-text-c", studentId: "student-c", mediaUrl: "https://youtu.be/e", textHtml: "", submittedAt: new Date("2026-11-14T00:00:00.000Z") },
  ]);
  activeSession = createSession("student-c", "student");
  const rows = await assignmentActions.getMyAssignments();
  assert.deepEqual(rows.map((row) => [row.id, row.hasText]), [
    ["text-c", 1],
    ["submission-c", 0],
    ["empty-text-c", 0],
  ]);
  assert.equal("textHtml" in (rows[0] ?? {}), false, "본문은 목록으로 보내지 않는다");
});
