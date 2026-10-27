import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import {
  calendarConnections,
  calendarMappings,
  calendarRemoteSeries,
  calendarSyncLinks,
  lessons,
  profiles,
} from "@/db/schema";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";
import { FakeCalendar } from "@/lib/calendar-sync/fake-calendar-client";
import { CalendarProviderError } from "@/lib/calendar-sync/types";

type PortalTestDb = IsolatedPortalD1["db"];

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
const APP_PASSWORD = "abcd-efgh-ijkl-mnop";

let activeDb: PortalTestDb | null = null;
let activeSession = createSession("student-1", "student");
let syncActions: typeof import("@/lib/actions/calendarSync");
let lessonActions: typeof import("@/lib/actions/lessons");
let calendarEventActions: typeof import("@/lib/actions/calendarEvents");
let clientFactory: typeof import("@/lib/calendar-sync/client-factory");
const previousKey = process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY;
const previousFetch = globalThis.fetch;

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

before(async () => {
  // 실제 Google·iCloud로 나가는 요청이 없어야 한다.
  globalThis.fetch = (async () => {
    throw new Error("network is disabled in calendar sync tests");
  }) as typeof fetch;
  [syncActions, lessonActions, calendarEventActions, clientFactory] = await Promise.all([
    import("@/lib/actions/calendarSync"),
    import("@/lib/actions/lessons"),
    import("@/lib/actions/calendarEvents"),
    import("@/lib/calendar-sync/client-factory"),
  ]);
});

after(() => {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY;
  else process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY = previousKey;
  clientFactory?.setCalendarClientFactoryForTests(null);
  clientFactory?.setICloudDiscoveryForTests(null);
  mock.restoreAll();
});

async function setup(context: TestContext, session: AuthSession, options: { key?: boolean } = {}) {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = session;
  if (options.key === false) delete process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY;
  else process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY = TEST_KEY;
  const remote = new FakeCalendar();
  clientFactory.setCalendarClientFactoryForTests(async () => remote);
  clientFactory.setICloudDiscoveryForTests(async ({ appPassword }) => {
    if (appPassword !== APP_PASSWORD) {
      const { CalendarAuthError } = await import("@/lib/calendar-sync/types");
      throw new CalendarAuthError("rejected", { status: 401 });
    }
    return { calendarHomeUrl: "https://p01-caldav.icloud.com/123/calendars/" };
  });
  context.after(async () => {
    activeDb = null;
    clientFactory.setCalendarClientFactoryForTests(null);
    clientFactory.setICloudDiscoveryForTests(null);
    await isolated.dispose();
  });
  const db = isolated.db;
  for (const [id, role] of [["admin-1", "admin"], ["student-1", "student"], ["student-2", "student"]] as const) {
    await db.insert(profiles).values({ id, email: `${id}@example.com`, displayName: id, role });
  }
  return { db, remote };
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function connectAndMap(db: PortalTestDb, studentId = "student-1"): Promise<{ connectionId: string; mappingId: string }> {
  const connected = await syncActions.connectICloudCalendar({}, form({ appleId: "teacher@icloud.com", appPassword: APP_PASSWORD }));
  assert.ok(connected.success, connected.error);
  const [connection] = await db.select().from(calendarConnections);
  const saved = await syncActions.saveCalendarMapping({}, form({ connectionId: connection.id, studentId, remoteCalendarId: "cal-1" }));
  assert.ok(saved.success, saved.error);
  const [mapping] = await db.select().from(calendarMappings).where(eq(calendarMappings.studentId, studentId));
  return { connectionId: connection.id, mappingId: mapping.id };
}

test("학생은 연결·매핑·동기화 관리자 action을 부를 수 없다", { concurrency: false }, async (context) => {
  await setup(context, createSession("student-1", "student"));
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["overview", () => syncActions.getCalendarSyncOverview()],
    ["list", () => syncActions.listRemoteCalendars("any")],
    ["icloud", () => syncActions.connectICloudCalendar({}, form({ appleId: "x@icloud.com", appPassword: APP_PASSWORD }))],
    ["google", () => syncActions.completeGoogleCalendarConnection({ code: "code", codeVerifier: "verifier" })],
    ["disconnect", () => syncActions.disconnectCalendarConnection("any")],
    ["save", () => syncActions.saveCalendarMapping({}, form({ connectionId: "c", studentId: "student-1", remoteCalendarId: "cal-1" }))],
    ["remove", () => syncActions.removeCalendarMapping("any")],
    ["syncNow", () => syncActions.syncCalendarMappingNow("any")],
  ];
  for (const [name, call] of calls) {
    await assert.rejects(call(), /Admin only/u, `${name}는 관리자 전용`);
  }
  assert.equal((await requireActiveDb().select().from(calendarConnections)).length, 0);
});

test("학생 조회는 다른 studentId를 무시하고 본인 동기화 항목만, 관리자는 실제 학생만 대상으로 한다", { concurrency: false }, async (context) => {
  const { db, remote } = await setup(context, createSession("admin-1", "admin"));
  await connectAndMap(db, "student-1");
  remote.calendars.push({ id: "cal-2", name: "두 번째", readOnly: false });
  const [connection] = await db.select().from(calendarConnections);
  const saved = await syncActions.saveCalendarMapping({}, form({ connectionId: connection.id, studentId: "student-2", remoteCalendarId: "cal-2" }));
  assert.ok(saved.success, saved.error);
  const mappings = await db.select().from(calendarMappings);
  const seriesIcs = (summary: string) => [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "BEGIN:VEVENT", `UID:${summary}@example.com`,
    "DTSTAMP:20261001T000000Z", "DTSTART:20261102T100000Z", "DTEND:20261102T110000Z", "RRULE:FREQ=WEEKLY;COUNT=2",
    `SUMMARY:${summary}`, "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  for (const mapping of mappings) {
    await db.insert(calendarRemoteSeries).values({
      mappingId: mapping.id,
      remoteId: `series-${mapping.studentId}`,
      seriesKey: `${mapping.studentId}@example.com`,
      icsText: seriesIcs(mapping.studentId),
    });
  }

  activeSession = createSession("student-1", "student");
  const result = await syncActions.syncAndGetExternalItems({
    studentId: "student-2",
    query: { start: "2026-10-01", end: "2027-01-31" },
  });
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((item) => item.space?.studentId === "student-1" && item.title === "student-1"));
  assert.ok(result.items.every((item) => item.source?.kind === "ICLOUD_CALENDAR"));
  const status = await syncActions.getStudentCalendarSyncStatus("student-2");
  assert.equal(status.mappings.length, 1);
  assert.equal(status.mappings[0].remoteCalendarName, "학생 캘린더");

  activeSession = createSession("admin-1", "admin");
  const adminView = await syncActions.syncAndGetExternalItems({ studentId: "student-2", query: { start: "2026-10-01", end: "2027-01-31" } });
  assert.ok(adminView.items.length > 0 && adminView.items.every((item) => item.space?.studentId === "student-2"));
  await assert.rejects(syncActions.syncAndGetExternalItems({ studentId: "admin-1" }), /Student not found/u);
  await assert.rejects(syncActions.getStudentCalendarSyncStatus("missing-student"), /Student not found/u);
  const invalid = await syncActions.saveCalendarMapping({}, form({ connectionId: connection.id, studentId: "missing-student", remoteCalendarId: "cal-1" }));
  assert.equal(invalid.error, "학생을 찾을 수 없습니다.");
});

test("암호화 key가 없으면 연결이 꺼지고 '설정 필요' 오류를 돌려준다", { concurrency: false }, async (context) => {
  await setup(context, createSession("admin-1", "admin"), { key: false });
  const overview = await syncActions.getCalendarSyncOverview();
  assert.equal(overview.availability.encryptionConfigured, false);
  assert.deepEqual(overview.connections, []);
  const result = await syncActions.connectICloudCalendar({}, form({ appleId: "teacher@icloud.com", appPassword: APP_PASSWORD }));
  assert.match(result.error ?? "", /설정 필요/u);
  assert.equal((await requireActiveDb().select().from(calendarConnections)).length, 0);
});

test("iCloud 자격 증명은 암호화해 저장하고 overview로 돌려주지 않으며 재연결은 같은 연결을 갱신한다", { concurrency: false }, async (context) => {
  const { db } = await setup(context, createSession("admin-1", "admin"));
  const rejected = await syncActions.connectICloudCalendar({}, form({ appleId: "teacher@icloud.com", appPassword: "wrong-password" }));
  assert.match(rejected.error ?? "", /앱 전용 암호/u);
  assert.doesNotMatch(rejected.error ?? "", /wrong-password/u);

  const { connectionId } = await connectAndMap(db);
  const [stored] = await db.select().from(calendarConnections);
  assert.equal(stored.provider, "ICLOUD");
  assert.equal(stored.accountLabel, "teacher@icloud.com");
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(APP_PASSWORD, "u"));
  assert.doesNotMatch(stored.encryptedCredentials, /teacher|icloud|calendars/u);

  const overview = await syncActions.getCalendarSyncOverview();
  const serialized = JSON.stringify(overview);
  assert.doesNotMatch(serialized, new RegExp(APP_PASSWORD, "u"));
  assert.doesNotMatch(serialized, new RegExp(stored.encryptedCredentials.slice(0, 16), "u"));
  assert.equal(overview.availability.encryptionConfigured, true);
  assert.equal(overview.connections.length, 1);
  assert.equal(overview.connections[0].mappings.length, 1);
  assert.equal(overview.connections[0].mappings[0].studentName, "student-1");

  await db.update(calendarConnections).set({ status: "NEEDS_REAUTH", lastError: "x" }).where(eq(calendarConnections.id, connectionId));
  const reconnected = await syncActions.connectICloudCalendar({}, form({ appleId: "teacher@icloud.com", appPassword: APP_PASSWORD }));
  assert.ok(reconnected.success);
  const rows = await db.select().from(calendarConnections);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, connectionId, "재연결은 같은 연결 id를 유지해 매핑을 보존한다");
  assert.equal(rows[0].status, "ACTIVE");
  assert.equal(rows[0].lastError, null);
  assert.equal((await db.select().from(calendarMappings)).length, 1);

  // 같은 학생·같은 캘린더 중복 매핑은 친절한 오류로 막는다.
  const duplicate = await syncActions.saveCalendarMapping({}, form({ connectionId, studentId: "student-1", remoteCalendarId: "cal-1" }));
  assert.match(duplicate.error ?? "", /이미/u);
  const taken = await syncActions.saveCalendarMapping({}, form({ connectionId, studentId: "student-2", remoteCalendarId: "cal-1" }));
  assert.match(taken.error ?? "", /다른 학생/u);

  const disconnected = await syncActions.disconnectCalendarConnection(connectionId);
  assert.ok(disconnected.success);
  assert.equal((await db.select().from(calendarConnections)).length, 0);
  assert.equal((await db.select().from(calendarMappings)).length, 0);
});

test("레슨·일정 쓰기는 매핑이 있으면 원격에 push하고 provider 실패는 로컬 action을 실패시키지 않는다", { concurrency: false }, async (context) => {
  const { db, remote } = await setup(context, createSession("admin-1", "admin"));
  await db.insert(lessons).values({ id: "lesson-existing", studentId: "student-1", scheduledAt: new Date(Date.now() + 2 * 86_400_000) });
  const { mappingId } = await connectAndMap(db);
  assert.equal(remote.events.size, 1, "매핑 저장 뒤 첫 동기화가 기존 레슨을 보낸다");

  const created = await lessonActions.createLesson("student-1", {}, form({ scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }));
  assert.ok(created.success);
  const lessonId = created.lesson!.id;
  const pushed = [...remote.events.values()].find((event) => event.portalRef === `lesson:${lessonId}`);
  assert.ok(pushed, "레슨 생성이 원격에 바로 반영된다");

  const movedTo = new Date(Date.now() + 4 * 86_400_000);
  movedTo.setUTCSeconds(0, 0);
  const moved = await lessonActions.moveLesson(lessonId, "student-1", movedTo.toISOString());
  assert.ok(moved.success);
  assert.equal(remote.events.get(pushed.remoteId)!.start.getTime(), movedTo.getTime());

  await lessonActions.deleteLesson(lessonId, "student-1");
  assert.equal(remote.events.has(pushed.remoteId), false, "레슨 삭제가 원격 사본을 지운다");
  assert.equal((await db.select().from(calendarSyncLinks).where(eq(calendarSyncLinks.localId, lessonId))).length, 0);

  // 학생 본인 일정도 같은 매핑으로 보낸다.
  activeSession = createSession("student-1", "student");
  const event = await calendarEventActions.createCalendarEvent({}, form({
    title: "개인 연습",
    eventType: "PRACTICE",
    startTime: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  }));
  assert.ok(event.id, event.error);
  assert.ok([...remote.events.values()].some((entry) => entry.portalRef === `event:${event.id}`));
  await calendarEventActions.deleteCalendarEvent(event.id!);
  assert.ok(![...remote.events.values()].some((entry) => entry.portalRef === `event:${event.id}`));

  // provider 장애: 로컬 쓰기는 성공하고 오류는 매핑 last_error에만 남는다.
  activeSession = createSession("admin-1", "admin");
  remote.failAll = new CalendarProviderError("provider down with secret-body", { status: 503 });
  const createdWhileDown = await lessonActions.createLesson("student-1", {}, form({ scheduledAt: new Date(Date.now() + 6 * 86_400_000).toISOString() }));
  assert.ok(createdWhileDown.success);
  assert.equal((await db.select().from(lessons).where(eq(lessons.id, createdWhileDown.lesson!.id))).length, 1);
  const [mapping] = await db.select().from(calendarMappings).where(eq(calendarMappings.id, mappingId));
  assert.ok(mapping.lastError);
  assert.doesNotMatch(mapping.lastError ?? "", /secret-body/u);
  await lessonActions.deleteLesson(createdWhileDown.lesson!.id, "student-1");
  assert.equal((await db.select().from(lessons).where(eq(lessons.id, createdWhileDown.lesson!.id))).length, 0, "원격 실패와 무관하게 로컬 삭제는 끝난다");
  const tombstones = await db.select().from(calendarSyncLinks).where(eq(calendarSyncLinks.localId, createdWhileDown.lesson!.id));
  assert.ok(tombstones.every((link) => link.localFingerprint === "DELETED"));

  // 복구 뒤 관리자 수동 동기화가 남은 일을 처리한다.
  remote.failAll = null;
  const now = await syncActions.syncCalendarMappingNow(mappingId);
  assert.ok(now.success, now.error);
  assert.equal((await db.select().from(calendarSyncLinks).where(eq(calendarSyncLinks.localId, createdWhileDown.lesson!.id))).length, 0);
  assert.equal([...remote.events.values()].filter((entry) => entry.portalRef?.startsWith("lesson:")).length, 1);
});

test("매핑이 없는 학생의 쓰기 action은 원격 client를 만들지 않는다", { concurrency: false }, async (context) => {
  await setup(context, createSession("admin-1", "admin"));
  let factoryCalls = 0;
  clientFactory.setCalendarClientFactoryForTests(async () => {
    factoryCalls += 1;
    return new FakeCalendar();
  });
  const created = await lessonActions.createLesson("student-2", {}, form({ scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }));
  assert.ok(created.success);
  await lessonActions.deleteLesson(created.lesson!.id, "student-2");
  assert.equal(factoryCalls, 0);
});
