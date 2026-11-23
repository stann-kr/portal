/**
 * 반쪽 흐름 보완(캔버스 FlowGaps1123)을 격리 D1(실제 D1 SQL)에서 확인한다.
 * - 과제 완료·다시 열기·지우기: 제출 막기, 정기 회차를 지우면 다시 만들지 않기, 다른 학생 범위 거절
 * - 디깅 피드백: 관리자만 쓰기, 학생은 자기 것만 읽기, 고치기·지우기 compare-and-set, 디깅한 날 모으기(KST 날짜)
 * - 댓글 고치기: 작성자 본인만, 본 내용과 같을 때만
 * - 디깅 컬럼 이름 고치기·순서 바꾸기: 학생 본인 컬럼만
 */
import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import type { PushAudience } from "@/lib/push/store";
import type { PushMessage } from "@/lib/push/messages";
import {
  assignmentOccurrenceSkips,
  assignmentRecurrences,
  assignmentTasks,
  assignments,
  comments,
  diggingColumns,
  diggingFeedbacks,
  diggingPlaylists,
  diggingTracks,
  posts,
  profiles,
} from "@/db/schema";
import { dayKeyFromNumber, dayNumberFromKey, kstTodayKey } from "@/lib/assignment-recurrence";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession = createSession("admin-1", "admin");
let sent: { audience: PushAudience; message: PushMessage }[] = [];
let taskActions: typeof import("@/lib/actions/assignmentTasks");
let feedbackActions: typeof import("@/lib/actions/digging-feedback");
let commentActions: typeof import("@/lib/actions/comments");
let diggingActions: typeof import("@/lib/actions/digging");

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

mock.module("@/auth", { namedExports: { auth: async () => activeSession } });
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
mock.module("next/navigation", { namedExports: { redirect: (path: string) => { throw new Error(`예상하지 않은 redirect: ${path}`); } } });
mock.module("@/lib/push/notify", {
  namedExports: {
    notifyPush: async (audience: PushAudience, message: PushMessage) => {
      sent.push({ audience, message });
    },
  },
});

const realFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`테스트 중 외부 요청 금지: ${String(input)}`);
  }) as typeof fetch;
  [taskActions, feedbackActions, commentActions, diggingActions] = await Promise.all([
    import("@/lib/actions/assignmentTasks"),
    import("@/lib/actions/digging-feedback"),
    import("@/lib/actions/comments"),
    import("@/lib/actions/digging"),
  ]);
});

after(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

async function setup(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  sent = [];
  activeSession = createSession("admin-1", "admin");
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-1", email: "student-1@example.com", displayName: "민지", role: "student" },
    { id: "student-2", email: "student-2@example.com", displayName: "준호", role: "student" },
    { id: "student-old", email: "old@example.com", displayName: "지난 학생", role: "student", accountStatus: "ARCHIVED", archivedAt: new Date("2026-10-01T00:00:00.000Z") },
  ]);
  return isolated.db;
}

function textForm(text: string): FormData {
  const data = new FormData();
  data.set("text", text);
  return data;
}

const shiftDayKey = (key: string, days: number) => dayKeyFromNumber(dayNumberFromKey(key)! + days);

test("관리자는 안 낸 과제를 완료·다시 열기 하고, 완료된 과제는 제출을 받지 않으며 제출한 과제는 완료로 바꾸지 않는다", async (context) => {
  const db = await setup(context);
  await db.insert(assignmentTasks).values([
    { id: "t-open", studentId: "student-1", title: "연습 일지", submissionFormat: "TEXT", dueAt: new Date("2026-11-20T00:00:00.000Z") },
    { id: "t-done", studentId: "student-1", title: "제출한 과제", submissionFormat: "TEXT", dueAt: null },
  ]);
  await db.insert(assignments).values({ id: "a-done", studentId: "student-1", taskId: "t-done", textHtml: "<p>냄</p>", submittedAt: new Date() });

  // 다른 학생 범위로는 완료하지 못한다.
  assert.equal((await taskActions.closeAssignmentTask("student-2", "t-open")).success, false);
  assert.equal((await db.select().from(assignmentTasks).where(eq(assignmentTasks.id, "t-open")))[0]?.closedAt, null);

  assert.equal((await taskActions.closeAssignmentTask("student-1", "t-open")).success, true);
  assert.equal((await taskActions.closeAssignmentTask("student-1", "t-open")).success, true, "다시 눌러도 성공");
  const [closed] = await db.select().from(assignmentTasks).where(eq(assignmentTasks.id, "t-open"));
  assert.ok(closed?.closedAt instanceof Date);
  assert.equal(closed?.version, 2, "완료는 version을 한 번만 올린다");
  assert.equal((await taskActions.closeAssignmentTask("student-1", "t-done")).success, false, "제출한 과제는 완료로 바꾸지 않는다");

  // 학생은 완료된 과제를 내지 못하고, 목록에는 완료 상태로 보인다.
  activeSession = createSession("student-1", "student");
  assert.match((await taskActions.submitAssignmentTask("t-open", {}, textForm("늦게 냄"))).error ?? "", /완료로 처리/u);
  assert.equal((await db.select().from(assignments).where(eq(assignments.taskId, "t-open"))).length, 0);
  const mine = await taskActions.getMyAssignmentTasks();
  assert.ok(mine.find((task) => task.id === "t-open")?.closedAt instanceof Date);
  await assert.rejects(taskActions.closeAssignmentTask("student-1", "t-open"), /Admin only/u, "학생은 완료하지 못한다");

  // 다시 열면 낼 수 있다.
  activeSession = createSession("admin-1", "admin");
  assert.equal((await taskActions.reopenAssignmentTask("student-1", "t-open")).success, true);
  activeSession = createSession("student-1", "student");
  assert.equal((await taskActions.submitAssignmentTask("t-open", {}, textForm("다시 열려서 냄"))).success, true);
});

test("정기 과제 회차를 지우면 그 날짜는 다시 만들지 않고, 규칙을 지우면 지운 날짜 기록도 함께 사라진다", async (context) => {
  const db = await setup(context);
  const today = kstTodayKey(new Date());
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await db.insert(assignmentRecurrences).values({
    id: "rule-1",
    studentId: "student-1",
    title: "매일 연습 기록",
    submissionFormat: "TEXT",
    startDate: shiftDayKey(today, -3),
    intervalWeeks: 1,
    weekdays: 127,
    dueTime: "21:00",
    createdById: "admin-1",
    createdAt: tenDaysAgo,
    updatedAt: tenDaysAgo,
  });
  await taskActions.getAssignmentTasksForStudent("student-1");
  const ruleTasks = () => db.select().from(assignmentTasks).where(eq(assignmentTasks.recurrenceId, "rule-1"));
  const generated = await ruleTasks();
  const target = generated.find((task) => task.occurrenceDate === shiftDayKey(today, -2));
  assert.ok(target);

  // 다른 학생 범위로는 회차를 지우지 못하고 지운 날짜도 남지 않는다.
  assert.equal((await taskActions.deleteAssignmentTask("student-2", target.id)).success, false);
  assert.equal((await db.select().from(assignmentOccurrenceSkips)).length, 0);

  assert.equal((await taskActions.deleteAssignmentTask("student-1", target.id)).success, true);
  assert.deepEqual(
    (await db.select().from(assignmentOccurrenceSkips)).map((skip) => [skip.recurrenceId, skip.occurrenceDate]),
    [["rule-1", target.occurrenceDate]],
  );
  // 학생·관리자 화면이 다시 읽어도 그 날짜는 돌아오지 않는다.
  await taskActions.getAssignmentTasksForStudent("student-1");
  activeSession = createSession("student-1", "student");
  await taskActions.getMyAssignmentTasks();
  const after = await ruleTasks();
  assert.equal(after.length, generated.length - 1);
  assert.equal(after.some((task) => task.occurrenceDate === target.occurrenceDate), false);

  // 완료한 회차는 규칙을 고쳐도 남는다(마감 전 미제출 회차만 다시 만든다).
  activeSession = createSession("admin-1", "admin");
  const tomorrowTask = after.find((task) => task.occurrenceDate === shiftDayKey(today, 1));
  assert.ok(tomorrowTask, "모든 요일 규칙이라 내일 회차가 있다");
  {
    assert.equal((await taskActions.closeAssignmentTask("student-1", tomorrowTask.id)).success, true);
    const form = new FormData();
    for (const [key, value] of Object.entries({ title: "바뀐 기록", submissionFormat: "TEXT", startDate: shiftDayKey(today, -3), intervalWeeks: "1", dueTime: "21:00", version: "1" })) form.set(key, value);
    for (const day of ["0", "1", "2", "3", "4", "5", "6"]) form.append("weekdays", day);
    assert.equal((await taskActions.updateAssignmentRecurrence("student-1", "rule-1", {}, form)).success, true);
    const [kept] = await db.select().from(assignmentTasks).where(eq(assignmentTasks.id, tomorrowTask.id));
    assert.equal(kept?.title, "매일 연습 기록", "완료한 회차는 그대로");
  }

  assert.equal((await taskActions.deleteAssignmentRecurrence("student-1", "rule-1")).success, true);
  assert.equal((await db.select().from(assignmentOccurrenceSkips)).length, 0, "규칙을 지우면 지운 날짜 기록도 지운다");
});

test("디깅 피드백은 관리자만 날짜마다 하나 남기고, 학생은 자기 피드백만 읽으며, 고치기·지우기는 본 시각과 같을 때만 된다", async (context) => {
  const db = await setup(context);
  // 2026-11-22 20:00 UTC = 2026-11-23 05:00 KST. 트랙 날짜는 KST로 묶인다.
  await db.insert(diggingTracks).values([
    { id: "track-1", userId: "student-1", values: "{}", createdAt: new Date("2026-11-22T20:00:00.000Z") },
    { id: "track-2", userId: "student-1", values: "{}", createdAt: new Date("2026-11-22T21:00:00.000Z") },
    { id: "track-3", userId: "student-2", values: "{}", createdAt: new Date("2026-11-20T01:00:00.000Z") },
    { id: "track-old", userId: "student-old", values: "{}", createdAt: new Date("2026-11-20T01:00:00.000Z") },
  ]);
  await db.insert(diggingPlaylists).values({
    id: "playlist-1", userId: "student-1", provider: "beatport", url: "https://www.beatport.com/playlists/share/1", title: "Mix", dugOn: "2026-11-21",
  });

  // 학생은 피드백을 쓰지 못한다.
  activeSession = createSession("student-1", "student");
  await assert.rejects(feedbackActions.saveDiggingFeedback("student-1", { dugOn: "2026-11-23", body: "셀프", expectedUpdatedAt: null }));
  await assert.rejects(feedbackActions.getAdminDiggingOverview());

  activeSession = createSession("admin-1", "admin");
  // 날짜·내용 검증.
  assert.equal((await feedbackActions.saveDiggingFeedback("student-1", { dugOn: "2026-02-30", body: "x", expectedUpdatedAt: null })).ok, false);
  assert.equal((await feedbackActions.saveDiggingFeedback("student-1", { dugOn: "2026-11-23", body: "   ", expectedUpdatedAt: null })).ok, false);
  // 수강 종료·없는 학생에게는 쓰지 못한다.
  await assert.rejects(feedbackActions.saveDiggingFeedback("student-old", { dugOn: "2026-11-20", body: "x", expectedUpdatedAt: null }));

  const created = await feedbackActions.saveDiggingFeedback("student-1", { dugOn: "2026-11-23", body: "고른 트랙 좋아요", expectedUpdatedAt: null });
  assert.equal(created.ok, true);
  assert.equal(sent.length, 1, "새로 남기면 학생에게 알린다");
  assert.deepEqual(sent[0]?.audience, { kind: "profiles", profileIds: ["student-1"] });
  assert.equal(sent[0]?.message.url, "/dashboard/student/digging#digging-day-2026-11-23");
  // 같은 날 두 번째 "새로 남기기"는 덮지 않고 충돌로 돌려준다.
  assert.equal((await feedbackActions.saveDiggingFeedback("student-1", { dugOn: "2026-11-23", body: "덮기", expectedUpdatedAt: null })).ok, false);

  const first = created.ok ? created.feedback! : null;
  assert.ok(first);
  const edited = await feedbackActions.saveDiggingFeedback("student-1", { dugOn: "2026-11-23", body: "고친 피드백", expectedUpdatedAt: first.updatedAt.getTime() });
  assert.equal(edited.ok, true);
  assert.equal(sent.length, 1, "고치기는 다시 알리지 않는다");
  assert.ok(edited.ok && edited.feedback!.updatedAt.getTime() > first.updatedAt.getTime(), "고친 시각은 늘 커진다");
  // 옛 시각으로 고치거나 지우면 충돌.
  assert.equal((await feedbackActions.saveDiggingFeedback("student-1", { dugOn: "2026-11-23", body: "옛 화면", expectedUpdatedAt: first.updatedAt.getTime() })).ok, false);
  assert.equal((await feedbackActions.deleteDiggingFeedback("student-1", { dugOn: "2026-11-23", expectedUpdatedAt: first.updatedAt.getTime() })).ok, false);
  // 다른 학생 범위로는 고치지 못한다.
  assert.equal((await feedbackActions.saveDiggingFeedback("student-2", { dugOn: "2026-11-23", body: "x", expectedUpdatedAt: edited.ok ? edited.feedback!.updatedAt.getTime() : 0 })).ok, false);
  assert.equal((await db.select().from(diggingFeedbacks)).length, 1);

  // 디깅한 날: 트랙(KST 날짜)·플레이리스트(dug_on)·피드백을 합치고 수강 종료한 학생은 뺀다.
  const overview = await feedbackActions.getAdminDiggingOverview();
  assert.deepEqual(overview.students.map((student) => student.id).sort(), ["student-1", "student-2"]);
  assert.deepEqual(
    overview.days.map((day) => [day.studentId, day.dugOn, day.trackCount, day.playlistCount, day.feedback?.body ?? null]),
    [
      ["student-1", "2026-11-23", 2, 0, "고친 피드백"],
      ["student-1", "2026-11-21", 0, 1, null],
      ["student-2", "2026-11-20", 1, 0, null],
    ],
  );
  const filtered = await feedbackActions.getAdminDiggingOverview({ studentId: "student-2" });
  assert.equal(filtered.selectedStudentId, "student-2");
  assert.deepEqual(filtered.days.map((day) => day.studentId), ["student-2"]);
  assert.equal((await feedbackActions.getAdminDiggingOverview({ studentId: "student-old" })).selectedStudentId, null, "수강 종료한 학생은 고를 수 없다");

  // 학생은 자기 피드백만 읽는다.
  activeSession = createSession("student-1", "student");
  assert.deepEqual((await feedbackActions.getDiggingFeedbacks("student-1")).map((feedback) => feedback.body), ["고친 피드백"]);
  activeSession = createSession("student-2", "student");
  await assert.rejects(feedbackActions.getDiggingFeedbacks("student-1"));

  activeSession = createSession("admin-1", "admin");
  const latest = edited.ok ? edited.feedback!.updatedAt.getTime() : 0;
  assert.equal((await feedbackActions.deleteDiggingFeedback("student-1", { dugOn: "2026-11-23", expectedUpdatedAt: latest })).ok, true);
  assert.equal((await db.select().from(diggingFeedbacks)).length, 0);
});

test("댓글은 작성자 본인만 고치고, 고치기 시작할 때 본 내용과 같을 때만 바꾸며 고친 시각을 남긴다", async (context) => {
  const db = await setup(context);
  await db.insert(posts).values({ id: "post-1", authorId: "student-2", category: "general", title: "글", contentHtml: "<p>본문</p>", boardType: "GENERAL" });
  await db.insert(comments).values({ id: "comment-1", postId: "post-1", authorId: "student-1", contentHtml: "<p>처음 &lt;댓글&gt;</p>" });

  // 관리자·다른 학생은 남의 댓글 내용을 고치지 못한다.
  const original = "<p>처음 &lt;댓글&gt;</p>";
  assert.ok("error" in (await commentActions.updateComment("comment-1", "post-1", { content: "관리자 수정", expectedHtml: original })));
  activeSession = createSession("student-2", "student");
  assert.ok("error" in (await commentActions.updateComment("comment-1", "post-1", { content: "남이 수정", expectedHtml: original })));
  assert.equal((await db.select().from(comments))[0]?.updatedAt, null);

  activeSession = createSession("student-1", "student");
  const saved = await commentActions.updateComment("comment-1", "post-1", { content: "고친 <댓글>", expectedHtml: original });
  assert.ok("success" in saved);
  const [row] = await db.select().from(comments);
  assert.equal(row?.contentHtml, "<p>고친 &lt;댓글&gt;</p>");
  assert.ok(row?.updatedAt instanceof Date);
  // 같은 요청 재전송은 성공, 옛 내용을 기준으로 다른 내용을 보내면 충돌.
  assert.ok("success" in (await commentActions.updateComment("comment-1", "post-1", { content: "고친 <댓글>", expectedHtml: original })));
  assert.ok("error" in (await commentActions.updateComment("comment-1", "post-1", { content: "옛 화면 수정", expectedHtml: original })));
  assert.equal((await db.select().from(comments))[0]?.contentHtml, "<p>고친 &lt;댓글&gt;</p>");
  // 다른 게시물 id로는 고치지 못한다.
  assert.ok("error" in (await commentActions.updateComment("comment-1", "post-x", { content: "x", expectedHtml: "<p>고친 &lt;댓글&gt;</p>" })));
});

test("디깅 컬럼은 학생 본인만 이름을 고치고 순서를 바꾼다(유형은 그대로)", async (context) => {
  const db = await setup(context);
  await db.insert(diggingColumns).values([
    { id: "col-a", userId: "student-1", name: "제목", columnType: "text", sortOrder: 0, isDefault: true },
    { id: "col-b", userId: "student-1", name: "느낌", columnType: "select", options: JSON.stringify(["좋음", "보통"]), sortOrder: 1 },
    { id: "col-c", userId: "student-1", name: "메모", columnType: "textarea", sortOrder: 2 },
    { id: "col-x", userId: "student-2", name: "남의 컬럼", columnType: "text", sortOrder: 0 },
  ]);
  const order = async (userId: string) => (await db.select().from(diggingColumns).where(eq(diggingColumns.userId, userId)))
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((column) => column.id);

  // 관리자는 학생 컬럼을 바꾸지 못한다(트랙 보드는 학생 본인만).
  await assert.rejects(diggingActions.updateDiggingColumn("col-b", { name: "x", options: ["a"] }));
  await assert.rejects(diggingActions.moveDiggingColumn("col-b", "up"));

  activeSession = createSession("student-1", "student");
  await diggingActions.updateDiggingColumn("col-b", { name: "평가", options: ["최고", "좋음", "보통"] });
  const [renamed] = await db.select().from(diggingColumns).where(eq(diggingColumns.id, "col-b"));
  assert.equal(renamed?.name, "평가");
  assert.equal(renamed?.columnType, "select");
  assert.deepEqual(JSON.parse(renamed?.options ?? "[]"), ["최고", "좋음", "보통"]);
  await diggingActions.updateDiggingColumn("col-a", { name: "트랙 제목" });
  assert.equal((await db.select().from(diggingColumns).where(eq(diggingColumns.id, "col-a")))[0]?.name, "트랙 제목", "기본 컬럼도 이름은 고친다");
  await assert.rejects(diggingActions.updateDiggingColumn("col-b", { name: "평가", options: [] }), "선택형은 선택지가 필요하다");
  await assert.rejects(diggingActions.updateDiggingColumn("col-x", { name: "남의 것" }), /찾을 수 없/u);

  await diggingActions.moveDiggingColumn("col-c", "up");
  assert.deepEqual(await order("student-1"), ["col-a", "col-c", "col-b"]);
  await diggingActions.moveDiggingColumn("col-a", "up");
  assert.deepEqual(await order("student-1"), ["col-a", "col-c", "col-b"], "맨 앞은 더 앞으로 가지 않는다");
  await assert.rejects(diggingActions.moveDiggingColumn("col-x", "down"), /찾을 수 없/u);
  assert.deepEqual(await order("student-2"), ["col-x"]);
});
