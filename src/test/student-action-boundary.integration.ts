import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { count, eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import {
  assignments,
  calendarEvents,
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

mock.module("@/auth", {
  namedExports: { auth: async () => activeSession },
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
  [calendarActions, curriculumActions, diggingActions, lessonActions, commentActions, feedbackActions] =
    await Promise.all([
      import("@/lib/actions/calendarEvents"),
      import("@/lib/actions/curriculum"),
      import("@/lib/actions/digging"),
      import("@/lib/actions/lessons"),
      import("@/lib/actions/comments"),
      import("@/lib/actions/feedbacks"),
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
