import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import { executeDocumentStatementsAtomically } from "@/lib/document-lifecycle-atomic";
import {
  CALENDAR_SYNC_MESSAGES,
  DELETED_FINGERPRINT,
  localFingerprint,
  localRowToRemoteInput,
  runCalendarMappingSync,
  type SyncEngineMode,
} from "./engine";
import { loadRemoteSeriesItems } from "./remote-series-items";
import { markLinksDeletedStatement } from "./sync-runner";
import { FakeCalendar } from "./fake-calendar-client";
import { CalendarAuthError, type CalendarProviderClient } from "./types";

const STUDENT = "student-sync";
const OTHER_STUDENT = "student-other";
const MAPPING = "mapping-1";
const CONNECTION = "connection-1";
const CALENDAR = "cal-1";
const BASE_NOW = new Date("2026-10-27T03:00:00.000Z");

type Harness = {
  sqlite: Database.Database;
  ctx: Extract<DbContext, { kind: "local" }>;
  remote: FakeCalendar;
  clock: { now: Date };
  sync: (options?: { force?: boolean; mode?: SyncEngineMode; deadline?: number; client?: CalendarProviderClient }) => ReturnType<typeof runCalendarMappingSync>;
  rows: <T>(query: string, ...params: unknown[]) => T[];
};

function setup(context: TestContext): Harness {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync(join(process.cwd(), "drizzle")).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
    sqlite.exec(readFileSync(join(process.cwd(), "drizzle", file), "utf8"));
  }
  const insertProfile = sqlite.prepare("INSERT INTO profiles (id, email, display_name, role) VALUES (?, ?, ?, ?)");
  insertProfile.run("admin-1", "admin@example.com", "관리자", "admin");
  insertProfile.run(STUDENT, "student@example.com", "학생", "student");
  insertProfile.run(OTHER_STUDENT, "other@example.com", "다른 학생", "student");
  const past = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1_000);
  sqlite
    .prepare("INSERT INTO calendar_connections (id, owner_id, provider, account_label, encrypted_credentials, credentials_iv, created_at, updated_at) VALUES (?, 'admin-1', 'GOOGLE', 'teacher@example.com', 'x', 'y', ?, ?)")
    .run(CONNECTION, past, past);
  sqlite
    .prepare("INSERT INTO calendar_mappings (id, connection_id, student_id, remote_calendar_id, remote_calendar_name, created_at, updated_at) VALUES (?, ?, ?, ?, '학생 캘린더', ?, ?)")
    .run(MAPPING, CONNECTION, STUDENT, CALENDAR, past, past);
  const ctx: Extract<DbContext, { kind: "local" }> = { kind: "local", db: drizzle(sqlite, { schema }) };
  const remote = new FakeCalendar();
  const clock = { now: new Date(BASE_NOW) };
  return {
    sqlite,
    ctx,
    remote,
    clock,
    sync: (options = {}) => runCalendarMappingSync({
      ctx,
      mappingId: MAPPING,
      getClient: async () => options.client ?? remote,
      now: () => clock.now,
      force: options.force ?? true,
      mode: options.mode,
      deadline: options.deadline,
    }),
    rows: <T,>(query: string, ...params: unknown[]) => sqlite.prepare(query).all(...params) as T[],
  };
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1_000);

function insertLesson(harness: Harness, id: string, start: Date, studentId = STUDENT): void {
  harness.sqlite.prepare("INSERT INTO lessons (id, student_id, scheduled_at) VALUES (?, ?, ?)").run(id, studentId, seconds(start));
}

function insertEvent(harness: Harness, id: string, values: { title: string; start: Date; end?: Date | null; description?: string | null }): void {
  harness.sqlite
    .prepare("INSERT INTO calendar_events (id, user_id, event_type, title, start_time, end_time, description) VALUES (?, ?, 'PRACTICE', ?, ?, ?, ?)")
    .run(id, STUDENT, values.title, seconds(values.start), values.end ? seconds(values.end) : null, values.description ?? null);
}

type LinkRecord = { local_kind: string; local_id: string; remote_id: string | null; etag: string | null; local_fingerprint: string };

function links(harness: Harness): LinkRecord[] {
  return harness.rows<LinkRecord>("SELECT local_kind, local_id, remote_id, etag, local_fingerprint FROM calendar_sync_links ORDER BY local_id");
}

const at = (iso: string) => new Date(iso);

test("원격 단일 일정 첫 가져오기는 학생 NOTE 일정과 link를 만들고 두 번째 동기화는 아무것도 다시 만들지 않는다", async (context) => {
  const harness = setup(context);
  const remoteEvent = harness.remote.remoteAdd({ title: "  합주  ", description: "B룸", start: at("2026-11-02T10:00:00Z"), end: at("2026-11-02T12:00:00Z") });

  const first = await harness.sync();
  assert.equal(first.status, "synced");
  assert.equal(first.localChanged, true);
  const events = harness.rows<{ id: string; user_id: string; event_type: string; title: string; description: string; start_time: number; end_time: number }>("SELECT * FROM calendar_events");
  assert.equal(events.length, 1);
  assert.equal(events[0].user_id, STUDENT);
  assert.equal(events[0].event_type, "NOTE");
  assert.equal(events[0].title, "합주");
  assert.equal(events[0].description, "B룸");
  assert.equal(events[0].start_time, seconds(remoteEvent.start));
  assert.equal(events[0].end_time, seconds(remoteEvent.end));
  assert.deepEqual(links(harness).map((link) => [link.local_kind, link.remote_id, link.etag]), [["EVENT", remoteEvent.remoteId, remoteEvent.etag]]);
  assert.equal(harness.remote.writeCount(), 0, "가져온 일정을 원격에 다시 보내지 않는다");

  const mapping = harness.rows<{ cursor: string; last_synced_at: number; last_error: string | null }>("SELECT cursor, last_synced_at, last_error FROM calendar_mappings")[0];
  assert.ok(mapping.cursor !== null);
  assert.equal(mapping.last_synced_at, seconds(BASE_NOW));
  assert.equal(mapping.last_error, null);

  const second = await harness.sync();
  assert.equal(second.localChanged, false);
  assert.equal(harness.rows("SELECT id FROM calendar_events").length, 1);
  assert.equal(harness.remote.writeCount(), 0);
});

test("로컬 레슨 생성은 portalRef를 담아 원격에 한 번만 만들고 다음 동기화는 루프·중복을 만들지 않는다", async (context) => {
  const harness = setup(context);
  const start = at("2026-11-03T09:00:00Z");
  insertLesson(harness, "lesson-1", start);

  const first = await harness.sync();
  assert.equal(first.status, "synced");
  assert.equal(first.localChanged, false);
  const created = [...harness.remote.events.values()];
  assert.equal(created.length, 1);
  assert.equal(created[0].portalRef, "lesson:lesson-1");
  assert.equal(created[0].title, "레슨");
  assert.equal(created[0].start.getTime(), start.getTime());
  assert.equal(created[0].end.getTime() - created[0].start.getTime(), 60 * 60_000);
  const [link] = links(harness);
  assert.equal(link.remote_id, created[0].remoteId);
  assert.equal(link.etag, created[0].etag);
  assert.equal(link.local_fingerprint, await localFingerprint({ kind: "LESSON", id: "lesson-1", start }));

  harness.remote.calls = [];
  const second = await harness.sync();
  assert.equal(second.localChanged, false);
  assert.equal(harness.remote.events.size, 1, "원격 사본이 늘지 않는다");
  assert.equal(harness.rows("SELECT id FROM calendar_events").length, 0, "자기 원격 사본을 일정으로 가져오지 않는다");
  assert.equal(harness.remote.writeCount(), 0);
});

test("로컬 일정 이동은 If-Match로 원격을 고치고 종료 없는 일정은 60분, KST 자정 구간은 종일로 보낸다", async (context) => {
  const harness = setup(context);
  insertEvent(harness, "event-1", { title: "연습", start: at("2026-11-05T11:00:00Z") });
  insertEvent(harness, "event-allday", { title: "공연 준비", start: at("2026-11-06T15:00:00Z"), end: at("2026-11-08T15:00:00Z") });
  await harness.sync();
  const remoteOpen = [...harness.remote.events.values()].find((event) => event.portalRef === "event:event-1")!;
  assert.equal(remoteOpen.end.getTime() - remoteOpen.start.getTime(), 60 * 60_000);
  assert.equal(remoteOpen.allDay, false);
  const remoteAllDay = [...harness.remote.events.values()].find((event) => event.portalRef === "event:event-allday")!;
  assert.equal(remoteAllDay.allDay, true, "KST 11/7 00:00 ~ 11/9 00:00은 종일");

  const moved = at("2026-11-05T13:30:00Z");
  harness.sqlite.prepare("UPDATE calendar_events SET start_time = ?, end_time = ? WHERE id = 'event-1'").run(seconds(moved), seconds(new Date(moved.getTime() + 30 * 60_000)));
  harness.remote.calls = [];
  const result = await harness.sync();
  assert.equal(result.localChanged, false);
  assert.deepEqual(harness.remote.calls.filter((call) => call !== "pull"), ["update"]);
  const updated = harness.remote.events.get(remoteOpen.remoteId)!;
  assert.equal(updated.start.getTime(), moved.getTime());
  assert.equal(updated.end.getTime(), moved.getTime() + 30 * 60_000);
  const link = links(harness).find((entry) => entry.local_id === "event-1")!;
  assert.equal(link.etag, updated.etag);
});

test("원격에서 레슨을 옮기면 scheduledAt만 반영하고 제목 변경은 무시한다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  await harness.sync();
  const remoteLesson = [...harness.remote.events.values()][0];
  const newStart = at("2026-11-04T10:00:00Z");
  harness.remote.remoteEdit(remoteLesson.remoteId, { start: newStart, end: new Date(newStart.getTime() + 90 * 60_000), title: "바뀐 제목" });

  harness.remote.calls = [];
  const result = await harness.sync();
  assert.equal(result.localChanged, true);
  const lesson = harness.rows<{ scheduled_at: number }>("SELECT scheduled_at FROM lessons WHERE id = 'lesson-1'")[0];
  assert.equal(lesson.scheduled_at, seconds(newStart));
  assert.equal(harness.remote.writeCount(), 0, "원격 변경을 받은 뒤 다시 보내지 않는다");
  const link = links(harness)[0];
  assert.equal(link.etag, harness.remote.events.get(remoteLesson.remoteId)!.etag);
  assert.equal(link.local_fingerprint, await localFingerprint({ kind: "LESSON", id: "lesson-1", start: newStart }));
});

test("원격 삭제는 로컬이 그대로면 로컬 행을 지우고, 로컬이 바뀌었으면(웹 우선) 원격에 다시 만든다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-keep", at("2026-11-03T09:00:00Z"));
  insertLesson(harness, "lesson-changed", at("2026-11-10T09:00:00Z"));
  await harness.sync();
  const byRef = (ref: string) => [...harness.remote.events.values()].find((event) => event.portalRef === ref)!;
  harness.remote.remoteDelete(byRef("lesson:lesson-keep").remoteId);
  harness.remote.remoteDelete(byRef("lesson:lesson-changed").remoteId);
  harness.sqlite.prepare("UPDATE lessons SET scheduled_at = ? WHERE id = 'lesson-changed'").run(seconds(at("2026-11-11T09:00:00Z")));

  const result = await harness.sync();
  assert.equal(result.localChanged, true);
  assert.deepEqual(harness.rows<{ id: string }>("SELECT id FROM lessons ORDER BY id").map((row) => row.id), ["lesson-changed"]);
  const recreated = byRef("lesson:lesson-changed");
  assert.ok(recreated, "바뀐 로컬 레슨은 원격에 다시 만든다");
  assert.equal(recreated.start.getTime(), at("2026-11-11T09:00:00Z").getTime());
  assert.deepEqual(links(harness).map((link) => [link.local_id, link.remote_id]), [["lesson-changed", recreated.remoteId]]);
});

test("로컬 삭제는 DELETED tombstone link로 원격 사본을 지우고 link를 정리한다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  insertEvent(harness, "event-1", { title: "연습", start: at("2026-11-05T11:00:00Z") });
  await harness.sync();
  assert.equal(harness.remote.events.size, 2);

  await executeDocumentStatementsAtomically(harness.ctx, [
    markLinksDeletedStatement("LESSON", "lesson-1", STUDENT),
    { query: "DELETE FROM lessons WHERE id = ? AND student_id = ?", params: ["lesson-1", STUDENT] },
  ]);
  assert.equal(links(harness).find((link) => link.local_id === "lesson-1")?.local_fingerprint, DELETED_FINGERPRINT);
  // tombstone 없이 사라진 로컬 행(다른 경로 삭제)도 원격에서 지운다.
  harness.sqlite.prepare("DELETE FROM calendar_events WHERE id = 'event-1'").run();

  harness.remote.calls = [];
  const result = await harness.sync({ mode: "push" });
  assert.equal(result.status, "synced");
  assert.equal(harness.remote.events.size, 0);
  assert.deepEqual(links(harness), []);
  assert.ok(!harness.remote.calls.includes("pull"), "push 모드는 pull하지 않는다");

  // 원격이 이미 지운 경우(404)도 성공으로 보고 link를 지운다.
  insertLesson(harness, "lesson-2", at("2026-11-06T09:00:00Z"));
  await harness.sync({ mode: "push" });
  const remoteId = links(harness)[0].remote_id!;
  harness.remote.remoteDelete(remoteId);
  await executeDocumentStatementsAtomically(harness.ctx, [
    markLinksDeletedStatement("LESSON", "lesson-2", STUDENT),
    { query: "DELETE FROM lessons WHERE id = ?", params: ["lesson-2"] },
  ]);
  const again = await harness.sync({ mode: "push" });
  assert.equal(again.status, "synced");
  assert.deepEqual(links(harness), []);
});

test("412 충돌에서 로컬이 바뀌었으면 portalRef로 현재 etag를 다시 읽고 로컬 내용으로 덮는다(웹 우선)", async (context) => {
  const harness = setup(context);
  insertEvent(harness, "event-1", { title: "연습", start: at("2026-11-05T11:00:00Z"), end: at("2026-11-05T12:00:00Z") });
  await harness.sync();
  const remoteId = links(harness)[0].remote_id!;
  harness.remote.remoteEdit(remoteId, { title: "원격에서 바꾼 제목" });
  harness.sqlite.prepare("UPDATE calendar_events SET title = '포털에서 바꾼 제목' WHERE id = 'event-1'").run();

  harness.remote.calls = [];
  const result = await harness.sync({ mode: "push" });
  assert.equal(result.status, "synced");
  assert.deepEqual(harness.remote.calls, ["update", "findByPortalRef", "update"]);
  assert.equal(harness.remote.events.get(remoteId)!.title, "포털에서 바꾼 제목");
  assert.equal(harness.rows<{ title: string }>("SELECT title FROM calendar_events")[0].title, "포털에서 바꾼 제목");

  // 다음 전체 동기화에서 원격의 같은 내용을 다시 가져오거나 보내지 않는다.
  harness.remote.calls = [];
  const next = await harness.sync();
  assert.equal(next.localChanged, false);
  assert.equal(harness.remote.writeCount(), 0);
});

test("pull에서 원격·로컬이 함께 바뀌었으면 원격 내용을 버리고 로컬 내용을 보낸다", async (context) => {
  const harness = setup(context);
  insertEvent(harness, "event-1", { title: "연습", start: at("2026-11-05T11:00:00Z"), end: at("2026-11-05T12:00:00Z") });
  await harness.sync();
  const remoteId = links(harness)[0].remote_id!;
  harness.remote.remoteEdit(remoteId, { title: "원격 제목" });
  harness.sqlite.prepare("UPDATE calendar_events SET title = '로컬 제목' WHERE id = 'event-1'").run();
  const result = await harness.sync();
  assert.equal(result.localChanged, false);
  assert.equal(harness.rows<{ title: string }>("SELECT title FROM calendar_events")[0].title, "로컬 제목");
  assert.equal(harness.remote.events.get(remoteId)!.title, "로컬 제목");
});

test("create 응답이 유실되면 다음 동기화가 portalRef로 link를 복구하고 중복을 만들지 않는다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  harness.remote.loseNextCreateResponse = true;
  const first = await harness.sync();
  assert.equal(first.status, "synced");
  assert.equal(harness.remote.events.size, 1);
  assert.equal(links(harness)[0].remote_id, null, "claim한 link는 remote_id 없이 남는다");
  assert.equal(harness.rows<{ last_error: string }>("SELECT last_error FROM calendar_mappings")[0].last_error, CALENDAR_SYNC_MESSAGES.partial);

  const second = await harness.sync();
  assert.equal(second.status, "synced");
  assert.equal(harness.remote.events.size, 1, "원격에 두 번째 사본을 만들지 않는다");
  const remote = [...harness.remote.events.values()][0];
  assert.equal(links(harness)[0].remote_id, remote.remoteId);
  assert.equal(harness.rows("SELECT id FROM calendar_events").length, 0);

  // push 모드(pull 없음)에서도 findByPortalRef로 복구한다.
  insertLesson(harness, "lesson-2", at("2026-11-04T09:00:00Z"));
  harness.remote.loseNextCreateResponse = true;
  await harness.sync({ mode: "push" });
  harness.remote.calls = [];
  await harness.sync({ mode: "push" });
  assert.deepEqual(harness.remote.calls, ["findByPortalRef", "update"]);
  assert.equal([...harness.remote.events.values()].filter((event) => event.portalRef === "lesson:lesson-2").length, 1);
});

test("원격 반복 일정은 로컬 행 없이 series 사본만 두고 읽기 전용 항목으로 펼친다", async (context) => {
  const harness = setup(context);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    "UID:series-1@example.com",
    "DTSTAMP:20261001T000000Z",
    "DTSTART:20261102T100000Z",
    "DTEND:20261102T110000Z",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "SUMMARY:주간 연습",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  harness.remote.remoteAdd({
    remoteId: "series-master",
    title: "주간 연습",
    start: at("2026-11-02T10:00:00Z"),
    end: at("2026-11-02T11:00:00Z"),
    recurring: true,
    seriesIcs: ics,
    seriesKey: "series-1@example.com",
  });
  const result = await harness.sync();
  assert.equal(result.localChanged, false);
  assert.equal(harness.rows("SELECT id FROM calendar_events").length, 0);
  assert.deepEqual(links(harness), []);
  assert.equal(harness.rows("SELECT remote_id FROM calendar_remote_series").length, 1);

  const items = await loadRemoteSeriesItems(harness.ctx.db as never, {
    studentId: STUDENT,
    spaceLabel: "학생",
    window: { start: at("2026-10-01T00:00:00Z"), end: at("2027-01-01T00:00:00Z") },
  });
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.source?.kind === "GOOGLE_CALENDAR" && item.metadata?.external === true));
  assert.equal(harness.remote.writeCount(), 0);

  harness.remote.remoteDelete("series-master");
  await harness.sync();
  assert.equal(harness.rows("SELECT remote_id FROM calendar_remote_series").length, 0);
});

test("원격 종일 일정은 KST 자정과 배타적 끝으로 저장하고 다시 보내지 않는다", async (context) => {
  const harness = setup(context);
  harness.remote.remoteAdd({
    title: "휴가",
    start: at("2026-11-09T15:00:00Z"),
    end: at("2026-11-11T15:00:00Z"),
    allDay: true,
    allDayStartDate: "2026-11-10",
    allDayEndDate: "2026-11-12",
  });
  await harness.sync();
  const [event] = harness.rows<{ start_time: number; end_time: number }>("SELECT start_time, end_time FROM calendar_events");
  assert.equal(event.start_time, seconds(at("2026-11-09T15:00:00Z")));
  assert.equal(event.end_time, seconds(at("2026-11-11T15:00:00Z")));
  assert.equal(localRowToRemoteInput({ kind: "EVENT", id: "x", title: "휴가", description: null, start: at("2026-11-09T15:00:00Z"), end: at("2026-11-11T15:00:00Z") }).allDay, true);
  harness.remote.calls = [];
  await harness.sync();
  assert.equal(harness.remote.writeCount(), 0);
});

test("인증 실패는 연결을 NEEDS_REAUTH로 바꾸고 로컬 데이터는 그대로 둔다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  insertEvent(harness, "event-1", { title: "연습", start: at("2026-11-05T11:00:00Z") });
  harness.remote.failAll = new CalendarAuthError("revoked", { status: 401 });

  const result = await harness.sync();
  assert.equal(result.status, "failed");
  assert.ok(result.status === "failed" && result.authFailed);
  const connection = harness.rows<{ status: string; last_error: string }>("SELECT status, last_error FROM calendar_connections")[0];
  assert.equal(connection.status, "NEEDS_REAUTH");
  assert.equal(connection.last_error, CALENDAR_SYNC_MESSAGES.auth);
  const mapping = harness.rows<{ last_error: string; sync_lease_until: number | null; cursor: string | null }>("SELECT last_error, sync_lease_until, cursor FROM calendar_mappings")[0];
  assert.equal(mapping.last_error, CALENDAR_SYNC_MESSAGES.auth);
  assert.equal(mapping.sync_lease_until, null, "lease는 항상 풀린다");
  assert.equal(mapping.cursor, null);
  assert.equal(harness.rows("SELECT id FROM lessons").length, 1);
  assert.equal(harness.rows("SELECT id FROM calendar_events").length, 1);
  assert.doesNotMatch(JSON.stringify(harness.rows("SELECT * FROM calendar_mappings")), /revoked/u);

  harness.remote.failAll = null;
  const skipped = await harness.sync();
  assert.deepEqual(skipped, { status: "skipped", localChanged: false, reason: "inactive" });
});

test("lease가 잡혀 있으면 동시 실행을 건너뛰고 throttle은 조회 동기화만 60초 막는다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slowClient: CalendarProviderClient = {
    ...Object.fromEntries((["listCalendars", "pull", "create", "update", "remove", "findByPortalRef"] as const).map((name) => [name, (...args: unknown[]) => (harness.remote[name] as (...rest: unknown[]) => unknown)(...args)])),
    kind: "GOOGLE",
    pull: async (...args: Parameters<CalendarProviderClient["pull"]>) => {
      await gate;
      return harness.remote.pull(...args);
    },
  } as CalendarProviderClient;
  const running = harness.sync({ client: slowClient });
  await new Promise((resolve) => setImmediate(resolve));
  const concurrent = await harness.sync();
  assert.deepEqual(concurrent, { status: "skipped", localChanged: false, reason: "lease" });
  release();
  const finished = await running;
  assert.equal(finished.status, "synced");
  assert.equal(harness.remote.events.size, 1, "동시 실행이 원격 사본을 두 번 만들지 않는다");

  harness.clock.now = new Date(BASE_NOW.getTime() + 30_000);
  assert.deepEqual(await harness.sync({ force: false }), { status: "skipped", localChanged: false, reason: "throttled" });
  harness.clock.now = new Date(BASE_NOW.getTime() + 61_000);
  assert.equal((await harness.sync({ force: false })).status, "synced");

  // 만료된 lease는 다시 잡을 수 있다.
  harness.sqlite.prepare("UPDATE calendar_mappings SET sync_lease_until = ?, sync_lease_id = 'stale'").run(seconds(BASE_NOW));
  harness.clock.now = new Date(BASE_NOW.getTime() + 200_000);
  assert.equal((await harness.sync()).status, "synced");
});

test("다른 학생의 portalRef 사본은 가져오지도 link하지도 않고, window 밖 원격 새 일정은 가져오지 않는다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-other", at("2026-11-03T09:00:00Z"), OTHER_STUDENT);
  harness.remote.remoteAdd({ title: "레슨", start: at("2026-11-03T09:00:00Z"), end: at("2026-11-03T10:00:00Z"), portalRef: "lesson:lesson-other" });
  harness.remote.remoteAdd({ title: "먼 미래", start: at("2028-06-01T09:00:00Z"), end: at("2028-06-01T10:00:00Z") });
  const result = await harness.sync();
  assert.equal(result.localChanged, false);
  assert.deepEqual(links(harness), []);
  assert.equal(harness.rows("SELECT id FROM calendar_events").length, 0);
  assert.equal(harness.rows<{ scheduled_at: number }>("SELECT scheduled_at FROM lessons")[0].scheduled_at, seconds(at("2026-11-03T09:00:00Z")));
});

test("deadline이 지나면 새 원격 쓰기를 시작하지 않고 남은 항목은 다음 동기화가 보낸다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  insertLesson(harness, "lesson-2", at("2026-11-04T09:00:00Z"));
  const result = await harness.sync({ mode: "push", deadline: BASE_NOW.getTime() });
  assert.equal(result.status, "synced");
  assert.equal(harness.remote.events.size, 0);
  assert.equal(harness.rows<{ sync_lease_until: number | null }>("SELECT sync_lease_until FROM calendar_mappings")[0].sync_lease_until, null);
  await harness.sync({ mode: "push" });
  assert.equal(harness.remote.events.size, 2);
});

test("전체 재동기화에서 원격이 window 밖으로 옮긴 포털 사본은 지우지 않고 portalRef로 다시 잇는다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-far", at("2026-11-10T09:00:00Z"));
  await harness.sync();
  const [created] = [...harness.remote.events.values()];
  const farStart = new Date(BASE_NOW.getTime() + 500 * 86_400_000);
  harness.remote.events.set(created.remoteId, { ...created, start: farStart, end: new Date(farStart.getTime() + 3_600_000) });
  harness.sqlite.prepare("UPDATE calendar_mappings SET cursor = NULL WHERE id = ?").run(MAPPING);

  const result = await harness.sync();
  assert.equal(result.status, "synced");
  assert.equal(harness.rows("SELECT id FROM lessons WHERE id = 'lesson-far'").length, 1, "로컬 레슨이 남는다");
  const [link] = links(harness);
  assert.equal(link.remote_id, created.remoteId);
  assert.equal(harness.remote.events.size, 1, "원격 사본을 새로 만들지 않는다");
});
