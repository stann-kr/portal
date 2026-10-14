import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { count, eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import { credentialFingerprint } from "@/lib/credential-fingerprint";
import type { AuthSession } from "@/lib/auth-guard";
import {
  assignments,
  calendarEvents,
  categories,
  comments,
  curriculums,
  diggingColumns,
  diggingTracks,
  feedbacks,
  lessons,
  posts,
  profiles,
} from "@/db/schema";
import {
  createIsolatedPortalD1,
  type IsolatedPortalD1,
} from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession = createSession("student-1", "student");
let calendarActions: typeof import("@/lib/actions/calendarEvents");
let curriculumActions: typeof import("@/lib/actions/curriculum");
let diggingActions: typeof import("@/lib/actions/digging");
let lessonActions: typeof import("@/lib/actions/lessons");
let commentActions: typeof import("@/lib/actions/comments");
let feedbackActions: typeof import("@/lib/actions/feedbacks");
let assignmentActions: typeof import("@/lib/actions/assignments");
let studentActions: typeof import("@/lib/actions/students");
let activeProfileModule: typeof import("@/lib/active-profile");
let postActions: typeof import("@/lib/actions/posts");
let categoryActions: typeof import("@/lib/actions/categories");
let passwordActions: typeof import("@/lib/actions/password");

function createSession(id: string, role: "admin" | "student"): AuthSession {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id,
      role,
      name: role === "admin" ? "Admin" : "Student",
      email: `${id}@example.com`,
      image: null,
    },
  };
}

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

let signInCalls: unknown[][] = [];
let signInImpl: (...args: unknown[]) => Promise<unknown> = async () => "/dashboard";
mock.module("@/auth", {
  namedExports: {
    auth: async () => activeSession,
    signIn: async (...args: unknown[]) => {
      signInCalls.push(args);
      return signInImpl(...args);
    },
  },
});
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", {
  namedExports: { revalidatePath: () => undefined },
});

before(async () => {
  [calendarActions, curriculumActions, diggingActions, lessonActions, commentActions, feedbackActions, assignmentActions, studentActions, activeProfileModule, postActions, categoryActions, passwordActions] =
    await Promise.all([
      import("@/lib/actions/calendarEvents"),
      import("@/lib/actions/curriculum"),
      import("@/lib/actions/digging"),
      import("@/lib/actions/lessons"),
      import("@/lib/actions/comments"),
      import("@/lib/actions/feedbacks"),
      import("@/lib/actions/assignments"),
      import("@/lib/actions/students"),
      import("@/lib/active-profile"),
      import("@/lib/actions/posts"),
      import("@/lib/actions/categories"),
      import("@/lib/actions/password"),
    ]);
});

after(() => mock.restoreAll());

async function setupDatabase(
  context: TestContext,
  session: AuthSession,
): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = session;
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  return isolated.db;
}

async function seedProfile(
  db: PortalTestDb,
  id: string,
  role: "admin" | "student" = "student",
): Promise<void> {
  await db.insert(profiles).values({
    id,
    email: `${id}@example.com`,
    displayName: id,
    role,
  });
}

test("댓글 삭제는 게시물 대상과 작성자 권한을 함께 검증하고 휴지통 대화를 보존한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await seedProfile(db, "admin-1", "admin");
  await db.insert(posts).values(["post-1", "post-2"].map((id) => ({
    id, authorId: "student-1", category: "general", boardType: "GENERAL" as const,
    title: "레슨 기록", contentHtml: "<p>본문</p>",
  })));
  await db.insert(comments).values({ id: "comment-1", postId: "post-1", authorId: "student-1", contentHtml: "<p>보존할 대화</p>" });
  await commentActions.deleteComment("comment-1", "post-2");
  assert.equal((await db.select().from(comments)).length, 1);
  activeSession = createSession("student-2", "student");
  await commentActions.deleteComment("comment-1", "post-1");
  assert.equal((await db.select().from(comments)).length, 1);
  activeSession = createSession("admin-1", "admin");
  await commentActions.deleteComment("comment-1", "post-2");
  assert.equal((await db.select().from(comments)).length, 1);
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, "post-1"));
  await commentActions.deleteComment("comment-1", "post-1");
  assert.equal((await db.select().from(comments)).length, 1);
  await db.update(posts).set({ deletedAt: null }).where(eq(posts.id, "post-1"));
  await commentActions.deleteComment("comment-1", "post-1");
  assert.equal((await db.select().from(comments)).length, 0);
});

test("피드백 삭제·조회는 과제 대상과 학생 ownership을 보존한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "admin-1", "admin");
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(assignments).values([
    { id: "assignment-1", studentId: "student-1", mediaUrl: "https://example.test/1" },
    { id: "assignment-2", studentId: "student-2", mediaUrl: "https://example.test/2" },
  ]);
  await db.insert(feedbacks).values({ id: "feedback-1", assignmentId: "assignment-1", timeMarker: 90, content: "보존할 피드백" });
  await feedbackActions.deleteFeedback("feedback-1", "assignment-2");
  assert.equal((await db.select().from(feedbacks)).length, 1);
  activeSession = createSession("student-2", "student");
  await assert.rejects(feedbackActions.getFeedbacksByAssignment("assignment-1"), /Unauthorized/);
  await assert.rejects(feedbackActions.deleteFeedback("feedback-1", "assignment-1"), /Admin only/);
  activeSession = createSession("student-1", "student");
  assert.equal((await feedbackActions.getFeedbacksByAssignment("assignment-1"))[0]?.content, "보존할 피드백");
  activeSession = createSession("admin-1", "admin");
  await feedbackActions.deleteFeedback("feedback-1", "assignment-1");
  assert.equal((await db.select().from(feedbacks)).length, 0);
});

test("로그인 이메일은 공백·대소문자 차이를 허용하되 모호한 계정은 고르지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await db.insert(profiles).values([
    { id: "mixed", email: "Mina@Example.com", displayName: "Mina", role: "student", passwordHash: "hash" },
    { id: "dup-1", email: "Dup@Example.com", displayName: "Dup 1", role: "student", passwordHash: "hash" },
    { id: "dup-2", email: "dup@example.com", displayName: "Dup 2", role: "student", passwordHash: "hash" },
  ]);
  const find = (email: string) => activeProfileModule.findActiveProfileByEmail(email, db);
  assert.equal((await find("mina@example.com"))?.id, "mixed");
  assert.equal((await find("  MINA@EXAMPLE.COM "))?.id, "mixed");
  assert.equal((await find("dup@example.com"))?.id, "dup-2", "정확히 일치하는 계정을 먼저 쓴다");
  assert.equal(await find("DUP@EXAMPLE.COM"), null, "대소문자만 다른 계정이 둘이면 고르지 않는다");
  assert.equal(await find("   "), null);
});

test("학생 생성은 이메일을 정규화하고 대소문자만 다른 중복을 거부한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "admin-1", "admin");
  await db.insert(profiles).values({ id: "legacy", email: "Legacy@Example.com", displayName: "Legacy", role: "student" });
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  assert.deepEqual(
    await studentActions.createStudent({}, form({ displayName: "레거시", email: "legacy@example.com" })),
    { error: "이미 존재하는 이메일입니다." },
  );
  assert.deepEqual(
    await studentActions.createStudent({}, form({ displayName: "잘못", email: "not-an-email" })),
    { error: "올바른 이메일 주소를 입력해 주세요." },
  );
  const result = await studentActions.createStudent({}, form({ displayName: "  새 학생  ", email: "  New.Student@Example.COM " }));
  const [created] = await db.select().from(profiles).where(eq(profiles.email, "new.student@example.com"));
  assert.equal(created?.displayName, "새 학생");
  assert.equal(created?.role, "student");
  assert.equal(result.created?.studentId, created?.id);
  assert.match(result.created?.invitePath ?? "", new RegExp(`^/invite#${created?.id}\\.[A-Za-z0-9_-]{43}$`, "u"));
  assert.match(created?.passwordHash ?? "", /^invite:\d+:\$2[aby]\$/u, "가입 전에는 가입 링크 secret의 hash만 저장한다");
});

test("가입 링크는 학생이 한 번만 직접 비밀번호를 정하게 하고 만료·재발급·관리자 권한을 지킨다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "admin-1", "admin");
  signInCalls = [];
  context.after(() => { signInCalls = []; signInImpl = async () => "/dashboard"; });
  const inviteActions = await import("@/lib/actions/invite");
  const { verifyStoredPassword } = await import("@/lib/password-storage");
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const storedHash = async (id: string) => (await db.select({ hash: profiles.passwordHash }).from(profiles).where(eq(profiles.id, id)))[0].hash;
  const tokenOf = (path: string | undefined) => (path ?? "").slice("/invite#".length);

  const minji = (await studentActions.createStudent({}, form({ displayName: "민지", email: "minji@example.com" }))).created!;
  const token = tokenOf(minji.invitePath);
  assert.equal(await verifyStoredPassword(token.split(".")[1], await storedHash(minji.studentId)), false, "가입 링크 secret으로는 로그인할 수 없다");
  assert.equal((await studentActions.getStudentAccountState(minji.studentId)).kind, "invite");
  assert.deepEqual(await inviteActions.getInviteStatus(token), { status: "valid", displayName: "민지", email: "minji@example.com" });
  assert.deepEqual(await inviteActions.getInviteStatus(`${token}x`), { status: "invalid" });
  assert.deepEqual(await inviteActions.getInviteStatus("not-a-token"), { status: "invalid" });

  assert.equal((await inviteActions.completeInvite({}, form({ token, newPassword: "short", confirmPassword: "short" }))).field, "newPassword");
  assert.equal((await inviteActions.completeInvite({}, form({ token, newPassword: "minji-pass-1", confirmPassword: "other-pass" }))).field, "confirmPassword");
  assert.deepEqual(await inviteActions.completeInvite({}, form({ token, newPassword: "minji-pass-1", confirmPassword: "minji-pass-1" })), { success: true });
  assert.ok(await verifyStoredPassword("minji-pass-1", await storedHash(minji.studentId)));
  assert.equal((await studentActions.getStudentAccountState(minji.studentId)).kind, "active");
  assert.deepEqual(signInCalls, [["credentials", { email: "minji@example.com", password: "minji-pass-1", redirect: false }]]);
  assert.equal((await inviteActions.completeInvite({}, form({ token, newPassword: "takeover-pass", confirmPassword: "takeover-pass" }))).linkUnusable, "invalid", "한 번 쓴 링크는 다시 쓸 수 없다");
  assert.ok(await verifyStoredPassword("minji-pass-1", await storedHash(minji.studentId)));
  await assert.rejects(studentActions.reissueStudentInvite(minji.studentId), /Invite unavailable/u, "가입한 학생은 임시 비밀번호 발급을 쓴다");

  const jun = (await studentActions.createStudent({}, form({ displayName: "준", email: "jun@example.com" }))).created!;
  const expired = (await storedHash(jun.studentId))!.replace(/^invite:\d+:/u, "invite:1:");
  await db.update(profiles).set({ passwordHash: expired }).where(eq(profiles.id, jun.studentId));
  assert.deepEqual(await inviteActions.getInviteStatus(tokenOf(jun.invitePath)), { status: "expired" });
  assert.equal((await inviteActions.completeInvite({}, form({ token: tokenOf(jun.invitePath), newPassword: "jun-pass-1", confirmPassword: "jun-pass-1" }))).linkUnusable, "expired");

  activeSession = createSession(minji.studentId, "student");
  await assert.rejects(studentActions.reissueStudentInvite(jun.studentId), /Admin only/u);
  activeSession = createSession("admin-1", "admin");
  const reissued = await studentActions.reissueStudentInvite(jun.studentId);
  assert.deepEqual(await inviteActions.getInviteStatus(tokenOf(jun.invitePath)), { status: "invalid" }, "다시 발급하면 이전 링크는 쓸 수 없다");
  assert.deepEqual(await inviteActions.getInviteStatus(tokenOf(reissued)), { status: "valid", displayName: "준", email: "jun@example.com" });
});

test("레슨 예약·시간 변경은 관리자와 대상 학생 레슨으로 제한하고 결과를 상태로 돌려준다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "admin-1", "admin");
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  const form = (scheduledAt: string) => {
    const data = new FormData();
    data.set("scheduledAt", scheduledAt);
    return data;
  };

  const created = await lessonActions.createLesson("student-1", {}, form("2026-10-09T19:30"));
  assert.equal(created.success, true);
  assert.equal(created.lesson?.scheduledAt, "2026-10-09T10:30:00.000Z");
  const lessonId = created.lesson!.id;
  await db.insert(lessons).values({ id: "other-lesson", studentId: "student-2", scheduledAt: new Date("2026-10-11T10:00:00.000Z") });

  assert.deepEqual(await lessonActions.rescheduleLesson(lessonId, "student-1", {}, form("not-a-date")), { error: "유효하지 않은 날짜입니다." });
  assert.match(
    (await lessonActions.rescheduleLesson("other-lesson", "student-1", {}, form("2026-10-12T19:00"))).error ?? "",
    /찾을 수 없습니다/u,
    "다른 학생의 레슨은 학생 ID를 바꿔 보내도 바뀌지 않는다",
  );
  const moved = await lessonActions.rescheduleLesson(lessonId, "student-1", {}, form("2026-10-12T20:00"));
  assert.equal(moved.lesson?.scheduledAt, "2026-10-12T11:00:00.000Z");

  const rows = await db.select().from(lessons).orderBy(lessons.id);
  assert.deepEqual(
    rows.map((row) => [row.id === lessonId ? "created" : row.id, row.scheduledAt.toISOString()]).sort(),
    [["created", "2026-10-12T11:00:00.000Z"], ["other-lesson", "2026-10-11T10:00:00.000Z"]],
  );

  activeSession = createSession("student-1", "student");
  await assert.rejects(lessonActions.rescheduleLesson(lessonId, "student-1", {}, form("2026-10-13T20:00")), /Admin only/u);
});

test("대시보드 게시물 요약은 본문 없이 범위·정렬·개수를 제한한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  await seedProfile(db, "student-1");
  const base = { authorId: "student-1", category: "general", contentHtml: "<p>긴 본문</p>" };
  await db.insert(posts).values([
    { ...base, id: "general-old", boardType: "GENERAL", title: "자유 1", createdAt: new Date("2026-08-01T00:00:00.000Z") },
    { ...base, id: "feedback-new", boardType: "FEEDBACK", title: "믹스셋", createdAt: new Date("2026-08-03T00:00:00.000Z") },
    { ...base, id: "general-trashed", boardType: "GENERAL", title: "삭제됨", createdAt: new Date("2026-08-04T00:00:00.000Z"), deletedAt: new Date("2026-08-05T00:00:00.000Z") },
    { ...base, id: "notice-pinned", boardType: "ANNOUNCEMENT", title: "고정 공지", isPinned: true, createdAt: new Date("2026-07-01T00:00:00.000Z") },
    { ...base, id: "notice-new", boardType: "ANNOUNCEMENT", title: "새 공지", createdAt: new Date("2026-08-06T00:00:00.000Z") },
  ]);

  const community = await postActions.getRecentCommunityPostSummaries(20);
  assert.deepEqual(community.map((post) => post.id), ["feedback-new", "general-old"]);
  assert.equal("contentHtml" in community[0]!, false, "대시보드 목록은 게시물 본문을 싣지 않는다");
  assert.deepEqual((await postActions.getRecentCommunityPostSummaries(1)).map((post) => post.id), ["feedback-new"]);
  assert.deepEqual((await postActions.getAnnouncementSummaries(2)).map((post) => post.id), ["notice-pinned", "notice-new"]);
  assert.equal((await postActions.getAnnouncementSummaries(Number.NaN)).length, 1, "잘못된 limit은 최소 1개로 닫힌다");
});

test("커뮤니티 목록은 keyset으로 겹침 없이 이어 읽고 미리보기 본문만 보낸다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  await seedProfile(db, "student-1");
  const base = Date.UTC(2026, 8, 1) / 1_000;
  const longBody = `<p>${"가".repeat(5_000)}</p>`;
  // 같은 초에 쓴 글(3개씩)이 page 경계를 걸치게 해 ID tie-break까지 확인한다. D1 bind 상한 때문에 나눠 넣는다.
  const generalRows = Array.from({ length: 35 }, (_, index) => ({
    id: `general-${String(index).padStart(2, "0")}`,
    authorId: "student-1",
    category: "general",
    boardType: "GENERAL" as const,
    title: `자유 ${index}`,
    contentHtml: index === 34 ? longBody : "<p>본문</p>",
    createdAt: new Date((base + Math.floor(index / 3)) * 1_000),
  }));
  for (let start = 0; start < generalRows.length; start += 5) {
    await db.insert(posts).values(generalRows.slice(start, start + 5));
  }
  await db.insert(posts).values([
    { id: "other-channel", authorId: "student-1", category: "gear", boardType: "GENERAL" as const, title: "다른 채널", contentHtml: "<p>x</p>", createdAt: new Date((base + 100) * 1_000) },
    { id: "trashed", authorId: "student-1", category: "general", boardType: "GENERAL" as const, title: "휴지통", contentHtml: "<p>x</p>", createdAt: new Date((base + 100) * 1_000), deletedAt: new Date() },
    { id: "mix-old-pinned", authorId: "student-1", category: "general", boardType: "FEEDBACK" as const, title: "고정 믹스셋", contentHtml: "<p>x</p>", isPinned: true, createdAt: new Date(base * 1_000) },
    { id: "mix-new", authorId: "student-1", category: "general", boardType: "FEEDBACK" as const, title: "새 믹스셋", contentHtml: "<p>x</p>", createdAt: new Date((base + 50) * 1_000) },
  ]);

  const first = await postActions.getCommunityPostPage({ boardType: "GENERAL", category: "general" });
  assert.equal(first.posts.length, 30);
  assert.ok(first.nextCursor);
  const second = await postActions.getCommunityPostPage({ boardType: "GENERAL", category: "general", cursor: first.nextCursor });
  assert.equal(second.nextCursor, null);
  const ids = [...first.posts, ...second.posts].map((post) => post.id);
  assert.equal(ids.length, 35);
  assert.equal(new Set(ids).size, 35, "page 경계에서 겹치거나 빠지지 않는다");
  // 작성 시각 내림차순, 같은 초는 ID 내림차순: 이 fixture에서는 색인 역순이다.
  assert.deepEqual(ids, Array.from({ length: 35 }, (_, index) => `general-${String(34 - index).padStart(2, "0")}`));
  assert.equal(ids.includes("other-channel") || ids.includes("trashed"), false);
  const longPreview = first.posts.find((post) => post.id === "general-34");
  assert.ok(longPreview && longPreview.contentHtml.length === 4_096, "목록은 본문 앞 4,096자만 받는다");

  const feedback = await postActions.getCommunityPostPage({ boardType: "FEEDBACK" });
  assert.deepEqual(feedback.posts.map((post) => post.id), ["mix-old-pinned", "mix-new"], "고정 게시물이 먼저 온다");
  await assert.rejects(postActions.getCommunityPostPage({ boardType: "GENERAL", category: "general", cursor: "invalid!" }), /Invalid community cursor/u);
  assert.deepEqual(await postActions.getCommunityPostPage({ boardType: "GENERAL", category: "" }), { posts: [], nextCursor: null });
});

test("학생별 과제 요약은 관리자에게만 최신 제출순과 피드백 수를 돌려준다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "admin-1", "admin");
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(assignments).values([
    { id: "older", studentId: "student-1", mediaUrl: "https://youtu.be/older", submittedAt: new Date("2026-08-01T00:00:00.000Z") },
    { id: "newer", studentId: "student-1", mediaUrl: "https://soundcloud.com/dj/newer", submittedAt: new Date("2026-08-05T00:00:00.000Z") },
    { id: "other", studentId: "student-2", mediaUrl: "https://youtu.be/other", submittedAt: new Date("2026-08-06T00:00:00.000Z") },
  ]);
  await db.insert(feedbacks).values([
    { id: "f-1", assignmentId: "older", timeMarker: 30, content: "첫 피드백" },
    { id: "f-2", assignmentId: "older", timeMarker: 90, content: "둘째 피드백" },
  ]);

  const summaries = await assignmentActions.getAssignmentSummariesByStudent("student-1");
  assert.deepEqual(summaries.map(({ id, feedbackCount }) => [id, feedbackCount]), [["newer", 0], ["older", 2]]);

  await assert.rejects(assignmentActions.getAssignmentSummariesByStudent("admin-1"), /Student not found/u);
  activeSession = createSession("student-1", "student");
  await assert.rejects(assignmentActions.getAssignmentSummariesByStudent("student-1"), /Admin only/u);
});

test("학생은 피드백 전 본인 제출만 삭제하고 관리자·다른 학생은 지우지 못한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-2", "student"));
  await seedProfile(db, "admin-1", "admin");
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(assignments).values([
    { id: "pending", studentId: "student-1", mediaUrl: "https://youtu.be/aqz-KE-bpKQ" },
    { id: "reviewed", studentId: "student-1", mediaUrl: "https://soundcloud.com/dj/reviewed" },
  ]);
  await db.insert(feedbacks).values({ id: "f-reviewed", assignmentId: "reviewed", timeMarker: 30, content: "보존할 피드백" });
  const remainingIds = async () => (await db.select({ id: assignments.id }).from(assignments)).map((row) => row.id).sort();

  assert.equal((await assignmentActions.deleteMyAssignment("pending")).success, false, "다른 학생");
  activeSession = createSession("admin-1", "admin");
  assert.equal((await assignmentActions.deleteMyAssignment("pending")).success, false, "관리자");
  activeSession = createSession("student-1", "student");
  const reviewed = await assignmentActions.deleteMyAssignment("reviewed");
  assert.equal(reviewed.success, false);
  assert.match(reviewed.success ? "" : reviewed.error, /피드백이 등록된 제출/u);
  assert.deepEqual(await remainingIds(), ["pending", "reviewed"]);
  assert.equal((await db.select().from(feedbacks)).length, 1);

  assert.deepEqual(await assignmentActions.deleteMyAssignment("pending"), { success: true });
  assert.deepEqual(await remainingIds(), ["reviewed"]);
  const repeated = await assignmentActions.deleteMyAssignment("pending");
  assert.match(repeated.success ? "" : repeated.error, /찾을 수 없는 제출/u);
});

test("피드백은 잘못된 재생 시점을 저장하지 않고 긴 믹스셋의 시점을 정확히 보존한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "admin-1", "admin");
  await seedProfile(db, "student-1");
  await db.insert(assignments).values({ id: "assignment-1", studentId: "student-1", mediaUrl: "https://example.test/1" });
  const form = (timeMarker: string) => {
    const data = new FormData();
    data.set("operationId", crypto.randomUUID());
    data.set("timeMarker", timeMarker);
    data.set("content", "전환 지점에서 저음을 교환해 주세요.");
    return data;
  };
  for (const value of ["", "abc", "-1", "01:99", "01:30:00", "1.5", "9007199254740992"]) {
    const result = await feedbackActions.createFeedback("assignment-1", {}, form(value));
    assert.ok(result.error, value);
  }
  assert.equal((await db.select().from(feedbacks)).length, 0);
  assert.ok((await feedbackActions.createFeedback("missing", {}, form("01:30"))).error);
  for (const value of ["100:30", "90", "00:00"]) {
    assert.equal((await feedbackActions.createFeedback("assignment-1", {}, form(value))).success, true);
  }
  assert.deepEqual((await feedbackActions.getFeedbacksByAssignment("assignment-1")).map((item) => item.timeMarker), [0, 90, 6030]);
});

test("댓글·피드백은 응답 유실 후 같은 제출을 한 번만 저장하고 다른 원문 재사용을 거부한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await seedProfile(db, "admin-1", "admin");
  await db.insert(posts).values({ id: "retry-post", authorId: "student-1", category: "general", boardType: "GENERAL", title: "질문", contentHtml: "<p>본문</p>" });
  await db.insert(assignments).values({ id: "retry-assignment", studentId: "student-1", mediaUrl: "https://example.test/mix" });
  const form = (operationId: string, content = "이 부분을 다시 연습할게요.", timeMarker = "01:30") => {
    const data = new FormData();
    data.set("operationId", operationId);
    data.set("content", content);
    data.set("timeMarker", timeMarker);
    return data;
  };
  const commentId = crypto.randomUUID();
  assert.ok((await commentActions.createComment("retry-post", {}, form("invalid"))).error);
  await assert.rejects(async () => {
    assert.equal((await commentActions.createComment("retry-post", {}, form(commentId))).success, true);
    throw new Error("response lost after commit");
  }, /response lost/);
  const retries = await Promise.all([1, 2].map(() => commentActions.createComment("retry-post", {}, form(commentId))));
  assert.ok(retries.every((result) => result.success));
  assert.equal(retries[0].commentId, retries[1].commentId);
  assert.equal((await db.select().from(comments)).length, 1);
  assert.ok((await commentActions.createComment("retry-post", {}, form(commentId, "다른 본문"))).error);
  assert.match((await db.select().from(comments))[0].contentHtml, /다시 연습/u);
  activeSession = createSession("student-2", "student");
  const anotherActor = await commentActions.createComment("retry-post", {}, form(commentId));
  assert.equal(anotherActor.success, true);
  assert.notEqual(anotherActor.commentId, retries[0].commentId);
  assert.equal((await commentActions.createComment("retry-post", {}, form(crypto.randomUUID()))).success, true, "같은 내용의 의도적인 새 댓글은 허용한다");
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, "retry-post"));
  assert.ok((await commentActions.createComment("retry-post", {}, form(commentId))).error);
  assert.equal((await db.select().from(comments)).length, 3);

  activeSession = createSession("admin-1", "admin");
  const feedbackId = crypto.randomUUID();
  assert.ok((await feedbackActions.createFeedback("retry-assignment", {}, form("invalid"))).error);
  assert.equal((await feedbackActions.createFeedback("retry-assignment", {}, form(feedbackId))).success, true);
  assert.equal((await feedbackActions.createFeedback("retry-assignment", {}, form(feedbackId, undefined, "90"))).success, true);
  assert.ok((await feedbackActions.createFeedback("retry-assignment", {}, form(feedbackId, "다른 본문"))).error);
  assert.ok((await feedbackActions.createFeedback("retry-assignment", {}, form(feedbackId, undefined, "02:30"))).error);
  assert.equal((await db.select().from(feedbacks)).length, 1);
  assert.equal((await feedbackActions.createFeedback("retry-assignment", {}, form(crypto.randomUUID()))).success, true);
  assert.equal((await db.select().from(feedbacks)).length, 2);
});

test("관리자 모듈 수정은 대상 학생의 모듈만 바꾸고 완료 상태와 잘못된 입력을 보존한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "admin-1", "admin");
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(curriculums).values([
    { id: "module-1", studentId: "student-1", weekNum: 1, title: "비트 매칭", isCompleted: true },
    { id: "module-2", studentId: "student-2", weekNum: 1, title: "다른 학생 모듈" },
  ]);
  const form = (weekNum: string, title: string) => {
    const data = new FormData();
    data.set("weekNum", weekNum);
    data.set("title", title);
    return data;
  };
  const rows = async () => (await db.select().from(curriculums)).map(({ id, weekNum, title, isCompleted }) => [id, weekNum, title, isCompleted]).sort();

  for (const [weekNum, title] of [["0", "제목"], ["1.5", "제목"], ["2", " "], ["2", "x".repeat(121)]]) {
    assert.ok((await curriculumActions.updateModule("module-1", "student-1", {}, form(weekNum, title))).error, `${weekNum}/${title.length}`);
  }
  assert.ok((await curriculumActions.updateModule("module-2", "student-1", {}, form("3", "가로채기"))).error, "다른 학생의 모듈");
  assert.deepEqual(await curriculumActions.updateModule("module-1", "student-1", {}, form("2", "  EQ 전환  ")), { success: true });
  assert.deepEqual(await rows(), [["module-1", 2, "EQ 전환", true], ["module-2", 1, "다른 학생 모듈", false]]);

  activeSession = createSession("student-1", "student");
  await assert.rejects(curriculumActions.updateModule("module-1", "student-1", {}, form("4", "학생 변경")), /Admin only/u);
  assert.deepEqual((await rows())[0], ["module-1", 2, "EQ 전환", true]);
});

test("채널 수정은 관리자만 이름·설명·순서를 바꾸고 게시물이 참조하는 주소 식별자는 유지한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "admin-1", "admin");
  await seedProfile(db, "student-1");
  await db.insert(categories).values({ id: "channel-1", slug: "gear", name: "장비", description: "", sortOrder: 0 });
  const form = (name: string, sortOrder = "3", description = "셋업 이야기") => {
    const data = new FormData();
    data.set("name", name);
    data.set("description", description);
    data.set("sortOrder", sortOrder);
    data.set("slug", "changed-slug");
    return data;
  };
  assert.ok((await categoryActions.updateCategory("channel-1", {}, form(""))).error);
  assert.ok((await categoryActions.updateCategory("channel-1", {}, form("장비", "1.5"))).error);
  assert.ok((await categoryActions.updateCategory("missing", {}, form("장비"))).error);
  assert.deepEqual(await categoryActions.updateCategory("channel-1", {}, form(" 장비·셋업 ")), { success: true });
  const [channel] = await db.select().from(categories);
  assert.deepEqual([channel.slug, channel.name, channel.description, channel.sortOrder], ["gear", "장비·셋업", "셋업 이야기", 3]);

  activeSession = createSession("student-1", "student");
  await assert.rejects(categoryActions.updateCategory("channel-1", {}, form("학생 변경")), /Admin only/u);
});

test("비밀번호 변경은 현재 비밀번호를 확인하고 새 hash로 현재 기기만 다시 로그인시킨다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const originalHash = await bcrypt.hash("first-password", 4);
  await db.insert(profiles).values({ id: "student-1", email: "student-1@example.com", displayName: "학생", role: "student", passwordHash: originalHash });
  signInCalls = [];
  context.after(() => { signInCalls = []; signInImpl = async () => "/dashboard"; });
  const form = (currentPassword: string, newPassword: string, confirmPassword = newPassword) => {
    const data = new FormData();
    data.set("currentPassword", currentPassword);
    data.set("newPassword", newPassword);
    data.set("confirmPassword", confirmPassword);
    return data;
  };
  const storedHash = async () => (await db.select({ hash: profiles.passwordHash }).from(profiles))[0].hash;

  assert.equal((await passwordActions.changeOwnPassword({}, form("wrong-password", "second-password"))).field, "currentPassword");
  assert.equal((await passwordActions.changeOwnPassword({}, form("first-password", "short"))).field, "newPassword");
  assert.equal((await passwordActions.changeOwnPassword({}, form("first-password", "second-password", "different"))).field, "confirmPassword");
  assert.equal((await passwordActions.changeOwnPassword({}, form("first-password", "first-password"))).field, "newPassword");
  assert.equal(await storedHash(), originalHash, "거부한 요청은 hash를 바꾸지 않는다");
  assert.equal(signInCalls.length, 0);

  assert.deepEqual(await passwordActions.changeOwnPassword({}, form("first-password", "second-password")), { success: true });
  const nextHash = await storedHash();
  assert.ok(nextHash && await bcrypt.compare("second-password", nextHash));
  assert.notEqual(credentialFingerprint(nextHash), credentialFingerprint(originalHash), "다른 기기의 이전 session 지문이 맞지 않게 된다");
  assert.deepEqual(signInCalls, [["credentials", { email: "student-1@example.com", password: "second-password", redirect: false }]]);

  signInImpl = async () => { throw new Error("CredentialsSignin"); };
  assert.deepEqual(await passwordActions.changeOwnPassword({}, form("second-password", "third-password")), { success: true, signInRequired: true });
  assert.ok(await bcrypt.compare("third-password", (await storedHash())!));
});

test("관리자 임시 비밀번호 발급은 학생만 대상으로 기존 로그인을 만료시키고 학생이 새 비밀번호를 정해야 포털을 쓴다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  const originalHash = await bcrypt.hash("forgotten-password", 4);
  await db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "관리자", role: "admin", passwordHash: "admin-hash" },
    { id: "student-1", email: "student-1@example.com", displayName: "학생", role: "student", passwordHash: originalHash },
  ]);
  signInCalls = [];
  context.after(() => { signInCalls = []; signInImpl = async () => "/dashboard"; });
  const storedHash = async (id: string) => (await db.select({ hash: profiles.passwordHash }).from(profiles).where(eq(profiles.id, id)))[0].hash;
  const { isTemporaryPasswordHash, verifyStoredPassword } = await import("@/lib/password-storage");

  await assert.rejects(studentActions.resetStudentPassword("admin-1"), /Student not found/u);
  assert.equal(await storedHash("admin-1"), "admin-hash");
  activeSession = createSession("student-1", "student");
  await assert.rejects(studentActions.resetStudentPassword("student-1"), /Admin only/u);
  assert.equal(await storedHash("student-1"), originalHash);

  activeSession = createSession("admin-1", "admin");
  assert.equal((await studentActions.getStudentAccountState("student-1")).kind, "active");
  const temporaryPassword = await studentActions.resetStudentPassword("student-1");
  const temporaryHash = await storedHash("student-1");
  assert.ok(isTemporaryPasswordHash(temporaryHash));
  assert.equal(temporaryHash?.includes(temporaryPassword), false, "원문은 저장하지 않는다");
  assert.ok(await verifyStoredPassword(temporaryPassword, temporaryHash));
  assert.equal(await verifyStoredPassword("forgotten-password", temporaryHash), false);
  assert.notEqual(credentialFingerprint(temporaryHash), credentialFingerprint(originalHash), "학생의 기존 로그인 지문이 맞지 않게 된다");
  assert.equal((await studentActions.getStudentAccountState("student-1")).kind, "temporary");

  // 임시 비밀번호 계정의 로그인은 다른 주소를 거치지 않고 새 비밀번호 설정으로 이동한다.
  const { loginWithCredentials } = await import("@/lib/actions/session");
  const login = (email: string) => {
    const data = new FormData();
    data.set("email", email);
    data.set("password", "entered-password");
    data.set("callbackUrl", "/dashboard/student?tab=notes");
    return loginWithCredentials({}, data);
  };
  await login("Student-1@Example.com");
  await login("admin-1@example.com");
  assert.deepEqual(signInCalls.map((call) => (call[1] as { redirectTo?: string }).redirectTo), ["/account/password", "/dashboard/student?tab=notes"]);
  signInCalls = [];

  // 임시 비밀번호 session은 포털 기능에 쓸 수 없고 새 비밀번호 설정만 할 수 있다.
  activeSession = createSession("student-1", "student");
  activeSession.user.passwordChangeRequired = true;
  await assert.rejects(curriculumActions.getMyCurriculum(), /Unauthorized/u);
  const form = (currentPassword: string, newPassword: string) => {
    const data = new FormData();
    data.set("currentPassword", currentPassword);
    data.set("newPassword", newPassword);
    data.set("confirmPassword", newPassword);
    return data;
  };
  assert.deepEqual(await passwordActions.changeOwnPassword({}, form("wrong-temporary", "my-new-password")), { error: "임시 비밀번호가 올바르지 않습니다.", field: "currentPassword" });
  assert.equal((await passwordActions.changeOwnPassword({}, form(temporaryPassword, temporaryPassword))).field, "newPassword");
  assert.deepEqual(await passwordActions.changeOwnPassword({}, form(temporaryPassword, "my-new-password")), { success: true });
  const ownHash = await storedHash("student-1");
  assert.equal(isTemporaryPasswordHash(ownHash), false);
  assert.ok(await verifyStoredPassword("my-new-password", ownHash));
  assert.deepEqual(signInCalls, [["credentials", { email: "student-1@example.com", password: "my-new-password", redirect: false }]]);

  activeSession = createSession("admin-1", "admin");
  assert.equal((await studentActions.getStudentAccountState("student-1")).kind, "active");
});

test("로그인 시도 한도 초과는 입력한 이메일을 유지하고 다시 시도할 시점을 안내한다", { concurrency: false }, async (context) => {
  await setupDatabase(context, createSession("student-1", "student"));
  const { CredentialsSignin } = await import("next-auth");
  class Limited extends CredentialsSignin { code = "rate_limited"; }
  signInImpl = async () => { throw new Limited(); };
  context.after(() => { signInCalls = []; signInImpl = async () => "/dashboard"; });
  const { loginWithCredentials } = await import("@/lib/actions/session");
  const data = new FormData();
  data.set("email", "student-1@example.com");
  data.set("password", "entered-password");
  assert.deepEqual(await loginWithCredentials({}, data), {
    error: "시도가 너무 많습니다. 1분 뒤 다시 시도해 주세요.",
    email: "student-1@example.com",
  });
});

test("관리자 child delete는 전달한 학생과 실제 owner가 다르면 행을 보존한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "admin-1", "admin");
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(curriculums).values({
    id: "module-2",
    studentId: "student-2",
    weekNum: 1,
    title: "Student 2 module",
  });
  await db.insert(lessons).values({
    id: "lesson-2",
    studentId: "student-2",
    scheduledAt: new Date("2026-08-20T01:00:00.000Z"),
  });

  await curriculumActions.deleteModule("module-2", "student-1");
  await lessonActions.deleteLesson("lesson-2", "student-1");
  assert.equal(
    (await db.select().from(curriculums).where(eq(curriculums.id, "module-2"))).length,
    1,
  );
  assert.equal(
    (await db.select().from(lessons).where(eq(lessons.id, "lesson-2"))).length,
    1,
  );

  await curriculumActions.deleteModule("module-2", "student-2");
  await lessonActions.deleteLesson("lesson-2", "student-2");
  assert.equal((await db.select().from(curriculums)).length, 0);
  assert.equal((await db.select().from(lessons)).length, 0);
});

test("일정 update는 rogue field, type, 시간 역전과 다른 owner 행을 변경하지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  const original = {
    id: "event-1",
    userId: "student-1",
    eventType: "PRACTICE" as const,
    title: "Original",
    startTime: new Date("2026-08-13T01:00:00.000Z"),
    endTime: new Date("2026-08-13T02:00:00.000Z"),
  };
  await db.insert(calendarEvents).values([
    original,
    { ...original, id: "event-2", userId: "student-2" },
  ]);

  await assert.rejects(() =>
    calendarActions.updateCalendarEvent(
      "event-1",
      { eventType: "ADMIN" } as never,
    ),
  );
  await assert.rejects(() =>
    calendarActions.updateCalendarEvent(
      "event-1",
      { userId: "student-2" } as never,
    ),
  );
  await assert.rejects(() =>
    calendarActions.updateCalendarEvent("event-1", {
      startTime: new Date("2026-08-13T03:00:00.000Z"),
    }),
  );
  await assert.rejects(() =>
    calendarActions.updateCalendarEvent("event-2", { title: "Stolen" }),
  );

  const rows = await db.select().from(calendarEvents).orderBy(calendarEvents.id);
  assert.deepEqual(
    rows.map(({ id, userId, eventType, title, startTime, endTime }) => ({
      id,
      userId,
      eventType,
      title,
      startTime,
      endTime,
    })),
    [original, { ...original, id: "event-2", userId: "student-2" }],
  );
});

test("일정 상세 수정 form은 본인 일정만 바꾸고 검증 실패를 상태로 돌려준다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  const original = {
    id: "event-1",
    userId: "student-1",
    eventType: "PRACTICE" as const,
    title: "Original",
    startTime: new Date("2026-08-13T01:00:00.000Z"),
    endTime: new Date("2026-08-13T02:00:00.000Z"),
  };
  await db.insert(calendarEvents).values([
    original,
    { ...original, id: "event-2", userId: "student-2" },
  ]);
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const valid = { title: "Moved", eventType: "GIG", startTime: "2026-08-14T19:00", endTime: "2026-08-14T21:00", description: "메모" };

  assert.deepEqual(
    await calendarActions.updateCalendarEventDetails({}, form({ ...valid, eventId: "event-1", endTime: "2026-08-14T18:00" })),
    { error: "종료 시간은 시작 시간 이후여야 합니다." },
  );
  assert.match(
    (await calendarActions.updateCalendarEventDetails({}, form({ ...valid, eventId: "event-2" }))).error ?? "",
    /권한/u,
  );
  const saved = await calendarActions.updateCalendarEventDetails({}, form({ ...valid, eventId: "event-1" }));
  assert.equal(saved.event?.title, "Moved");
  assert.equal(saved.event?.startTime, "2026-08-14T10:00:00.000Z");

  const rows = await db.select().from(calendarEvents).orderBy(calendarEvents.id);
  assert.equal(rows[0]?.title, "Moved");
  assert.equal(rows[0]?.eventType, "GIG");
  assert.equal(rows[0]?.description, "메모");
  assert.equal(rows[1]?.title, "Original", "다른 학생의 일정은 바뀌지 않는다");

  await calendarActions.deleteCalendarEvent("event-2");
  assert.equal((await db.select().from(calendarEvents)).length, 2, "다른 학생의 일정은 삭제되지 않는다");
  await calendarActions.deleteCalendarEvent("event-1");
  assert.deepEqual((await db.select().from(calendarEvents)).map((row) => row.id), ["event-2"]);
});

test("digging write는 student session과 소유 column/type을 요구하고 거부 시 DB가 불변이다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  await seedProfile(db, "admin-1", "admin");
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(diggingColumns).values([
    {
      id: "student-1-title",
      userId: "student-1",
      name: "트랙명",
      columnType: "text",
      sortOrder: 0,
    },
    {
      id: "student-2-rating",
      userId: "student-2",
      name: "별점",
      columnType: "rating",
      sortOrder: 0,
    },
  ]);
  await db.insert(diggingTracks).values({
    id: "track-1",
    userId: "student-1",
    values: JSON.stringify({ "student-1-title": "Original" }),
  });

  await assert.rejects(() =>
    diggingActions.createDiggingTrack({ values: { rogue: "value" } }),
  );
  await assert.rejects(() =>
    diggingActions.updateDiggingTrackValue(
      "track-1",
      "student-2-rating",
      5,
    ),
  );
  assert.equal(
    (await db.select({ value: count() }).from(diggingTracks))[0]?.value,
    1,
  );
  assert.equal(
    (await db.select().from(diggingTracks).where(eq(diggingTracks.id, "track-1")))[0]?.values,
    JSON.stringify({ "student-1-title": "Original" }),
  );

  activeSession = createSession("admin-1", "admin");
  await assert.rejects(() =>
    diggingActions.createDiggingTrack({ values: {} }),
    /학생만/u,
  );
  assert.equal(
    (await db.select({ value: count() }).from(diggingTracks))[0]?.value,
    1,
  );
});
