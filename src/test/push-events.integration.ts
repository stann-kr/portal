import assert from "node:assert/strict";
import { before, mock, test, type TestContext } from "node:test";
import type { AuthSession } from "@/lib/auth-guard";
import { assignmentTasks, assignments, categories, lessons, profiles } from "@/db/schema";
import { CREATION_OPERATION_FIELD } from "@/lib/creation-operation";
import type { PushMessage } from "@/lib/push/messages";
import type { PushAudience } from "@/lib/push/notify";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

/**
 * 저장 action이 누구에게 어떤 알림을 보내는지(받는 사람·보낸 사람 제외·같은 작업 재전송 때 다시 보내지 않음)를 확인한다.
 * 실제 발송(암호화·푸시 서비스)은 src/lib/push 단위 테스트와 브라우저 확인이 맡는다.
 */
type PortalTestDb = IsolatedPortalD1["db"];
type SentPush = { audience: PushAudience; message: PushMessage; exclude?: string };

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession = createSession("student-1", "student");
let sent: SentPush[] = [];
let feedbackActions: typeof import("@/lib/actions/feedbacks");
let taskActions: typeof import("@/lib/actions/assignmentTasks");
let assignmentActions: typeof import("@/lib/actions/assignments");
let lessonActions: typeof import("@/lib/actions/lessons");
let qnaActions: typeof import("@/lib/actions/qna");
let postActions: typeof import("@/lib/actions/posts");
let reviewActions: typeof import("@/lib/actions/assignment-review");
let commentActions: typeof import("@/lib/actions/comments");

function createSession(id: string, role: "admin" | "student", name = id): AuthSession {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: { id, role, name, email: `${id}@example.com`, image: null },
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
mock.module("next/navigation", {
  namedExports: {
    redirect: (path: string) => {
      throw new Error(`예상하지 않은 redirect: ${path}`);
    },
  },
});
mock.module("@/lib/calendar-sync/sync-runner", {
  namedExports: {
    schedulePushStudentCalendarChanges: async () => undefined,
    markLinksDeletedStatement: () => ({ query: "SELECT 1", params: [] }),
  },
});
mock.module("@/lib/push/notify", {
  namedExports: {
    notifyPush: async (audience: PushAudience, message: PushMessage, options: { excludeProfileId?: string } = {}) => {
      sent.push({ audience, message, exclude: options.excludeProfileId });
    },
  },
});

before(async () => {
  [feedbackActions, taskActions, assignmentActions, lessonActions, qnaActions, postActions, reviewActions, commentActions] = await Promise.all([
    import("@/lib/actions/feedbacks"),
    import("@/lib/actions/assignmentTasks"),
    import("@/lib/actions/assignments"),
    import("@/lib/actions/lessons"),
    import("@/lib/actions/qna"),
    import("@/lib/actions/posts"),
    import("@/lib/actions/assignment-review"),
    import("@/lib/actions/comments"),
  ]);
});

async function setup(context: TestContext): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  sent = [];
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-1", email: "student-1@example.com", displayName: "김학생", role: "student" },
  ]);
  return isolated.db;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

test("피드백: 관리자가 남기면 과제 주인 학생에게 과제 제목으로 보내고, 같은 작업 재전송은 다시 보내지 않는다", { concurrency: false }, async (context) => {
  const db = await setup(context);
  await db.insert(assignmentTasks).values({ id: "task-1", studentId: "student-1", title: "6주차 믹스 녹음", submissionFormat: "TEXT" });
  await db.insert(assignments).values({ id: "sub-1", studentId: "student-1", taskId: "task-1", textHtml: "<p>제출</p>" });
  activeSession = createSession("admin-1", "admin", "Stann");
  const fields = { [CREATION_OPERATION_FIELD]: crypto.randomUUID(), content: "좋아요", timeMarker: "" };

  assert.deepEqual(await feedbackActions.createFeedback("sub-1", {}, form(fields)), { success: true });
  assert.deepEqual(sent, [{
    audience: { kind: "profiles", profileIds: ["student-1"] },
    message: { category: "feedback", title: "새 피드백", body: "‘6주차 믹스 녹음’에 피드백이 달렸습니다.", url: "/dashboard/student/assignments/sub-1", tag: "feedback:sub-1" },
    exclude: "admin-1",
  }]);

  assert.deepEqual(await feedbackActions.createFeedback("sub-1", {}, form(fields)), { success: true });
  assert.equal(sent.length, 1, "같은 operationId 재전송");
});

test("확인함: 표시할 때만 과제 주인 학생에게 피드백 알림과 같은 tag로 한 번 보내고, 재전송·취소는 보내지 않는다", { concurrency: false }, async (context) => {
  const db = await setup(context);
  await db.insert(assignmentTasks).values({ id: "task-ack", studentId: "student-1", title: "7주차 믹스", submissionFormat: "TEXT" });
  await db.insert(assignments).values({ id: "sub-ack", studentId: "student-1", taskId: "task-ack", textHtml: "<p>제출</p>" });
  activeSession = createSession("admin-1", "admin", "Stann");

  assert.equal((await reviewActions.setAssignmentReviewed("sub-ack", true)).success, true);
  assert.deepEqual(sent, [{
    audience: { kind: "profiles", profileIds: ["student-1"] },
    message: { category: "feedback", title: "Stann이 과제를 확인했습니다", body: "‘7주차 믹스’", url: "/dashboard/student/assignments/sub-ack", tag: "feedback:sub-ack" },
    exclude: "admin-1",
  }]);
  assert.equal((await reviewActions.setAssignmentReviewed("sub-ack", true)).success, true);
  assert.equal(sent.length, 1, "같은 값 재전송");
  assert.equal((await reviewActions.setAssignmentReviewed("sub-ack", false)).success, true);
  assert.equal(sent.length, 1, "취소는 알리지 않는다");
  assert.equal((await reviewActions.setAssignmentReviewed("sub-ack", true)).success, true);
  assert.equal(sent.length, 2, "취소 뒤 다시 표시하면 다시 알린다");
});

test("과제: 새 과제는 학생에게, 학생 제출은 관리자에게 보낸다(재전송은 한 번만)", { concurrency: false }, async (context) => {
  await setup(context);
  activeSession = createSession("admin-1", "admin", "Stann");
  const create = { [CREATION_OPERATION_FIELD]: crypto.randomUUID(), title: "드랍 연습", submissionFormat: "TEXT" };
  const created = await taskActions.createAssignmentTask("student-1", {}, form(create));
  assert.equal(created.success, true, JSON.stringify(created));
  await taskActions.createAssignmentTask("student-1", {}, form(create));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.audience, { kind: "profiles", profileIds: ["student-1"] });
  assert.equal(sent[0]!.message.title, "새 과제");
  assert.equal(sent[0]!.exclude, "admin-1");

  activeSession = createSession("student-1", "student", "김학생");
  const submitted = await taskActions.submitAssignmentTask(created.id!, {}, form({ text: "<p>연습했습니다</p>" }));
  assert.equal(submitted.success, true, JSON.stringify(submitted));
  await taskActions.submitAssignmentTask(created.id!, {}, form({ text: "<p>연습했습니다</p>" }));
  assert.equal(sent.length, 2, "같은 제출 재전송");
  assert.deepEqual(sent[1], {
    audience: { kind: "role", role: "admin" },
    message: { category: "assignment", title: "과제 제출", body: "김학생님 과제 제출: ‘드랍 연습’", url: `/dashboard/student/assignments/${submitted.id}`, tag: `submission:${submitted.id}` },
    exclude: "student-1",
  });

  const free = await assignmentActions.submitAssignment({}, form({ text: "<p>자유 연습</p>" }));
  assert.equal(free.success, true, JSON.stringify(free));
  assert.equal(sent[2]!.message.body, "김학생님 과제 제출: 자유 과제");
});

test("레슨: 관리자가 잡거나 옮기면 학생에게, 학생이 옮기면 관리자에게 보낸다", { concurrency: false }, async (context) => {
  const db = await setup(context);
  activeSession = createSession("admin-1", "admin", "Stann");
  const created = await lessonActions.createLesson("student-1", {}, form({ scheduledAt: "2026-11-10T14:00" }));
  assert.equal(created.success, true, JSON.stringify(created));
  assert.deepEqual(sent[0]!.audience, { kind: "profiles", profileIds: ["student-1"] });
  assert.equal(sent[0]!.message.title, "새 레슨 일정");

  const lessonId = created.lesson!.id;
  await lessonActions.moveLesson(lessonId, "student-1", "2026-11-11T15:00");
  assert.deepEqual(sent[1]!.audience, { kind: "profiles", profileIds: ["student-1"] });
  assert.equal(sent[1]!.message.title, "레슨 일정 변경");

  activeSession = createSession("student-1", "student", "김학생");
  await lessonActions.moveLesson(lessonId, "student-1", "2026-11-12T16:00");
  assert.deepEqual(sent[2]!.audience, { kind: "role", role: "admin" });
  assert.match(sent[2]!.message.body, /^김학생님이 레슨을 옮겼습니다: /u);
  assert.equal(sent[2]!.exclude, "student-1");

  // 다른 학생의 레슨은 옮기지 못하고 알림도 없다.
  await db.insert(profiles).values({ id: "student-2", email: "s2@example.com", displayName: "이학생", role: "student" });
  await db.insert(lessons).values({ id: "other-lesson", studentId: "student-2", scheduledAt: new Date("2026-11-10T05:00:00Z") });
  const denied = await lessonActions.moveLesson("other-lesson", "student-2", "2026-11-13T10:00");
  assert.ok(denied.error);
  assert.equal(sent.length, 3);
});

test("Q&A: 학생 질문은 관리자에게, 관리자 답변은 질문한 학생에게, 학생 답글은 관리자에게 보낸다", { concurrency: false }, async (context) => {
  await setup(context);
  activeSession = createSession("student-1", "student", "김학생");
  const questionForm = form({ [CREATION_OPERATION_FIELD]: crypto.randomUUID(), title: "헤드폰 큐 볼륨", contentHtml: "<p>질문</p>" });
  const thread = await qnaActions.createQnaThread({}, questionForm);
  assert.equal(thread.success, true, JSON.stringify(thread));
  await qnaActions.createQnaThread({}, questionForm);
  assert.equal(sent.length, 1, "같은 질문 재전송");
  assert.deepEqual(sent[0]!.audience, { kind: "role", role: "admin" });
  assert.equal(sent[0]!.message.body, "김학생님: ‘헤드폰 큐 볼륨’");
  const threadId = thread.thread!.id;

  activeSession = createSession("admin-1", "admin", "Stann");
  const reply = await qnaActions.createQnaReply(threadId, {}, form({ [CREATION_OPERATION_FIELD]: crypto.randomUUID(), contentHtml: "<p>답변</p>" }));
  assert.equal(reply.success, true, JSON.stringify(reply));
  assert.deepEqual(sent[1], {
    audience: { kind: "profiles", profileIds: ["student-1"] },
    message: { category: "qna", title: "Q&A 답변", body: "‘헤드폰 큐 볼륨’에 답이 달렸습니다.", url: `/dashboard/qna/${threadId}`, tag: `qna:${threadId}` },
    exclude: "admin-1",
  });

  activeSession = createSession("student-1", "student", "김학생");
  await qnaActions.createQnaReply(threadId, {}, form({ [CREATION_OPERATION_FIELD]: crypto.randomUUID(), contentHtml: "<p>감사합니다</p>" }));
  assert.deepEqual(sent[2]!.audience, { kind: "role", role: "admin" });
  assert.equal(sent[2]!.message.body, "김학생님 답글: ‘헤드폰 큐 볼륨’");
});

test("공지: 관리자가 올린 공지는 학생에게 보내고, 같은 공지 재전송은 다시 보내지 않는다", { concurrency: false }, async (context) => {
  await setup(context);
  activeSession = createSession("admin-1", "admin", "Stann");
  const announcement = form({
    [CREATION_OPERATION_FIELD]: crypto.randomUUID(),
    title: "11월 레슨 안내",
    contentHtml: "<p>안내</p>",
    boardType: "ANNOUNCEMENT",
    returnTo: "community-editor",
  });
  const created = await postActions.createPost({}, announcement);
  assert.equal(created.success, true, JSON.stringify(created));
  await postActions.createPost({}, announcement);
  assert.equal(sent.length, 1, "같은 공지 재전송");
  assert.deepEqual(sent[0], {
    audience: { kind: "role", role: "student" },
    message: { category: "announcement", title: "새 공지", body: "‘11월 레슨 안내’", url: `/community/${created.postId}`, tag: `announcement:${created.postId}` },
    exclude: "admin-1",
  });
});

test("커뮤니티: 새 글은 글쓴이를 뺀 모든 계정에, 댓글은 글쓴이와 앞서 댓글 단 사람에게 보낸다", { concurrency: false }, async (context) => {
  const db = await setup(context);
  await db.insert(profiles).values({ id: "student-2", email: "s2@example.com", displayName: "이학생", role: "student" });
  await db.insert(categories).values({ id: "cat-free", slug: "free", name: "자유" });
  activeSession = createSession("student-1", "student", "김학생");
  const postForm = form({
    [CREATION_OPERATION_FIELD]: crypto.randomUUID(),
    title: "이번 주 믹스 공유",
    contentHtml: "<p>들어 주세요</p>",
    boardType: "GENERAL",
    category: "free",
    returnTo: "community-editor",
  });
  const created = await postActions.createPost({}, postForm);
  assert.equal(created.success, true, JSON.stringify(created));
  await postActions.createPost({}, postForm);
  assert.equal(sent.length, 1, "같은 글 재전송");
  assert.deepEqual(sent[0], {
    audience: { kind: "everyone" },
    message: { category: "community_post", title: "커뮤니티 새 글", body: "김학생님: ‘이번 주 믹스 공유’", url: `/community/${created.postId}`, tag: `post:${created.postId}` },
    exclude: "student-1",
  });
  const postId = created.postId!;

  // 이학생이 첫 댓글: 글쓴이(김학생)에게만 간다.
  activeSession = createSession("student-2", "student", "이학생");
  const firstComment = form({ [CREATION_OPERATION_FIELD]: crypto.randomUUID(), content: "좋네요" });
  assert.equal((await commentActions.createComment(postId, {}, firstComment)).success, true);
  await commentActions.createComment(postId, {}, firstComment);
  assert.equal(sent.length, 2, "같은 댓글 재전송");
  assert.deepEqual(sent[1]!.audience, { kind: "profiles", profileIds: ["student-1"] });
  assert.equal(sent[1]!.message.title, "내 글에 새 댓글");
  assert.equal(sent[1]!.message.body, "이학생님 댓글: ‘이번 주 믹스 공유’");
  assert.equal(sent[1]!.exclude, "student-2");

  // Stann 댓글: 글쓴이에게 "내 글에 새 댓글", 앞서 댓글 단 이학생에게 "새 댓글".
  activeSession = createSession("admin-1", "admin", "Stann");
  assert.equal((await commentActions.createComment(postId, {}, form({ [CREATION_OPERATION_FIELD]: crypto.randomUUID(), content: "피드백" }))).success, true);
  assert.equal(sent.length, 4);
  assert.deepEqual(sent[2]!.audience, { kind: "profiles", profileIds: ["student-1"] });
  assert.equal(sent[3]!.message.title, "새 댓글");
  assert.deepEqual(sent[3]!.audience, { kind: "profiles", profileIds: ["student-2"] }, "댓글 쓴 본인은 참여자에서 빠진다");
  assert.equal(sent[3]!.exclude, "admin-1");
});
