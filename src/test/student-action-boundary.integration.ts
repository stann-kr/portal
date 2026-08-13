import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { count, eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import {
  calendarEvents,
  curriculums,
  diggingColumns,
  diggingTracks,
  lessons,
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
  [calendarActions, curriculumActions, diggingActions, lessonActions] =
    await Promise.all([
      import("@/lib/actions/calendarEvents"),
      import("@/lib/actions/curriculum"),
      import("@/lib/actions/digging"),
      import("@/lib/actions/lessons"),
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
