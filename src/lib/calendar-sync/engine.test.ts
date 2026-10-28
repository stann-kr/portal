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
  FULL_RESYNC_MISSING_LOOKUP_CAP,
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
  sync: (options?: { force?: boolean; mode?: SyncEngineMode; deadline?: number; client?: CalendarProviderClient; credentialsCiphertext?: string }) => ReturnType<typeof runCalendarMappingSync>;
  rows: <T>(query: string, ...params: unknown[]) => T[];
  /**
   * 엔진이 로컬 값을 읽은 뒤 다음 원자적 쓰기(batch) 직전에 한 번 실행한다(웹 수정 경합 재현).
   * skip만큼의 원자적 쓰기(예: 원격 삭제 앞의 series 정리)는 건너뛴다.
   */
  beforeNextAtomicWrite: (hook: () => void, skip?: number) => void;
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
  const db = drizzle(sqlite, { schema });
  let pendingHook: (() => void) | null = null;
  let pendingSkip = 0;
  // executeDocumentStatementsAtomically만 $client.transaction을 쓴다. 조회는 drizzle session이 원래 client로 한다.
  db.$client = new Proxy(sqlite, {
    get(target, property) {
      if (property === "transaction") {
        return (fn: () => void) => {
          if (pendingHook && pendingSkip > 0) {
            pendingSkip -= 1;
            return target.transaction(fn);
          }
          const hook = pendingHook;
          pendingHook = null;
          hook?.();
          return target.transaction(fn);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const ctx: Extract<DbContext, { kind: "local" }> = { kind: "local", db };
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
      credentialsCiphertext: () => options.credentialsCiphertext ?? "x",
      now: () => clock.now,
      force: options.force ?? true,
      mode: options.mode,
      deadline: options.deadline,
    }),
    rows: <T,>(query: string, ...params: unknown[]) => sqlite.prepare(query).all(...params) as T[],
    beforeNextAtomicWrite: (hook, skip = 0) => {
      pendingHook = hook;
      pendingSkip = skip;
    },
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

test("412 충돌에서 로컬이 바뀌었으면 remoteId로 현재 etag를 다시 읽고 로컬 내용으로 덮는다(웹 우선)", async (context) => {
  const harness = setup(context);
  insertEvent(harness, "event-1", { title: "연습", start: at("2026-11-05T11:00:00Z"), end: at("2026-11-05T12:00:00Z") });
  await harness.sync();
  const remoteId = links(harness)[0].remote_id!;
  harness.remote.remoteEdit(remoteId, { title: "원격에서 바꾼 제목" });
  harness.sqlite.prepare("UPDATE calendar_events SET title = '포탈에서 바꾼 제목' WHERE id = 'event-1'").run();

  harness.remote.calls = [];
  const result = await harness.sync({ mode: "push" });
  assert.equal(result.status, "synced");
  assert.deepEqual(harness.remote.calls, ["update", "get", "update"]);
  assert.equal(harness.remote.events.get(remoteId)!.title, "포탈에서 바꾼 제목");
  assert.equal(harness.rows<{ title: string }>("SELECT title FROM calendar_events")[0].title, "포탈에서 바꾼 제목");

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

test("create 응답이 유실되면 portalRef로 link를 복구하고 중복을 만들지 않는다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  harness.remote.loseNextCreateResponse = true;
  const first = await harness.sync();
  assert.equal(first.status, "synced");
  assert.equal(harness.remote.events.size, 1);
  // 같은 실행의 꼬리 pull이 이번에 만든 원격 사본을 portalRef로 찾아 claim한 link에 원격 id를 채운다.
  assert.equal(links(harness)[0].remote_id, FakeCalendar.portalRemoteId("lesson:lesson-1"), "꼬리 pull이 link를 복구한다");
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
    ...Object.fromEntries((["listCalendars", "pull", "create", "update", "remove", "findByPortalRef", "get"] as const).map((name) => [name, (...args: unknown[]) => (harness.remote[name] as (...rest: unknown[]) => unknown)(...args)])),
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

test("전체 재동기화에서 원격이 window 밖으로 옮긴 포탈 레슨은 지우지 않고 remoteId로 확인해 옮긴 날짜를 반영한다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-far", at("2026-11-10T09:00:00Z"));
  await harness.sync();
  const [created] = [...harness.remote.events.values()];
  const farStart = new Date(BASE_NOW.getTime() + 500 * 86_400_000);
  harness.remote.remoteEdit(created.remoteId, { start: farStart, end: new Date(farStart.getTime() + 3_600_000) });
  harness.sqlite.prepare("UPDATE calendar_mappings SET cursor = NULL WHERE id = ?").run(MAPPING);

  harness.remote.calls = [];
  const result = await harness.sync();
  assert.equal(result.status, "synced");
  assert.ok(harness.remote.calls.includes("get"), "remoteId로 존재를 확인한다");
  const lesson = harness.rows<{ scheduled_at: number }>("SELECT scheduled_at FROM lessons WHERE id = 'lesson-far'");
  assert.equal(lesson.length, 1, "로컬 레슨이 남는다");
  assert.equal(lesson[0].scheduled_at, seconds(farStart), "원격에서 옮긴 날짜가 포탈에 보인다");
  const [link] = links(harness);
  assert.equal(link.remote_id, created.remoteId);
  assert.equal(link.etag, harness.remote.events.get(created.remoteId)!.etag);
  assert.equal(harness.remote.events.size, 1, "원격 사본을 새로 만들지 않는다");
  assert.equal(harness.remote.writeCount(), 0, "옮긴 내용을 받은 뒤 다시 보내지 않는다");
});

// ── 교차 검토(Sol 3) 필수 지적 회귀 테스트 ──

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let tick = 0; tick < 200; tick += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`기다린 상태가 오지 않았다: ${label}`);
}

test("원격 레슨 이동을 반영하는 사이 웹에서 레슨을 옮기면 웹 값을 덮지 않고 원격에 웹 값을 보낸다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  await harness.sync();
  const [remoteLesson] = [...harness.remote.events.values()];
  harness.remote.remoteEdit(remoteLesson.remoteId, { start: at("2026-11-04T10:00:00Z"), end: at("2026-11-04T11:00:00Z") });
  const webTime = at("2026-11-05T12:00:00Z");
  harness.beforeNextAtomicWrite(() => {
    harness.sqlite.prepare("UPDATE lessons SET scheduled_at = ? WHERE id = 'lesson-1'").run(seconds(webTime));
  });

  const result = await harness.sync();
  assert.equal(result.status, "synced");
  assert.equal(harness.rows<{ scheduled_at: number }>("SELECT scheduled_at FROM lessons")[0].scheduled_at, seconds(webTime), "웹 수정이 남는다");
  assert.equal(harness.remote.events.get(remoteLesson.remoteId)!.start.getTime(), webTime.getTime(), "웹 우선: 원격을 웹 값으로 맞춘다");
  assert.equal(links(harness)[0].local_fingerprint, await localFingerprint({ kind: "LESSON", id: "lesson-1", start: webTime }));
});

test("원격 삭제를 반영하는 사이 웹에서 일정을 고치면 지우지 않고 원격에 다시 만든다", async (context) => {
  const harness = setup(context);
  insertEvent(harness, "event-1", { title: "연습", start: at("2026-11-05T11:00:00Z"), end: at("2026-11-05T12:00:00Z") });
  await harness.sync();
  harness.remote.remoteDelete(links(harness)[0].remote_id!);
  // 첫 원자적 쓰기는 원격 삭제 앞의 series 정리다. 그다음(로컬 삭제 batch) 직전에 웹 수정이 들어온다.
  harness.beforeNextAtomicWrite(() => {
    harness.sqlite.prepare("UPDATE calendar_events SET title = '웹에서 고침' WHERE id = 'event-1'").run();
  }, 1);

  const result = await harness.sync();
  assert.equal(result.status, "synced");
  assert.deepEqual(harness.rows<{ title: string }>("SELECT title FROM calendar_events"), [{ title: "웹에서 고침" }]);
  const recreated = [...harness.remote.events.values()].filter((event) => event.portalRef === "event:event-1");
  assert.equal(recreated.length, 1);
  assert.equal(recreated[0].title, "웹에서 고침");
  assert.equal(links(harness)[0].remote_id, recreated[0].remoteId);
});

test("가져온 일정의 412 충돌은 같은 remoteId를 최신 etag로 덮고 원격·웹에 사본을 만들지 않는다", async (context) => {
  const harness = setup(context);
  const imported = harness.remote.remoteAdd({ title: "합주", start: at("2026-11-02T10:00:00Z"), end: at("2026-11-02T12:00:00Z") });
  await harness.sync();
  harness.remote.remoteEdit(imported.remoteId, { title: "원격에서 고침" });
  harness.sqlite.prepare("UPDATE calendar_events SET title = '웹에서 고침'").run();

  harness.remote.calls = [];
  const pushed = await harness.sync({ mode: "push" });
  assert.equal(pushed.status, "synced");
  assert.deepEqual(harness.remote.calls, ["update", "get", "update"]);
  assert.equal(harness.remote.events.size, 1, "원격 사본을 새로 만들지 않는다");
  assert.equal(harness.remote.events.get(imported.remoteId)!.title, "웹에서 고침");

  await harness.sync();
  assert.equal(harness.rows("SELECT id FROM calendar_events").length, 1, "다음 pull이 원래 원격 일정을 다시 가져오지 않는다");
  assert.equal(harness.remote.events.size, 1);
});

test("가져온 일정을 웹에서 지웠는데 원격이 바뀌었으면(412) 최신 etag로 원격을 지우고 다시 살아나지 않는다", async (context) => {
  const harness = setup(context);
  const imported = harness.remote.remoteAdd({ title: "합주", start: at("2026-11-02T10:00:00Z"), end: at("2026-11-02T12:00:00Z") });
  await harness.sync();
  const [{ id: localId }] = harness.rows<{ id: string }>("SELECT id FROM calendar_events");
  harness.remote.remoteEdit(imported.remoteId, { title: "원격에서 고침" });
  await executeDocumentStatementsAtomically(harness.ctx, [
    markLinksDeletedStatement("EVENT", localId, STUDENT),
    { query: "DELETE FROM calendar_events WHERE id = ?", params: [localId] },
  ]);

  harness.remote.calls = [];
  const pushed = await harness.sync({ mode: "push" });
  assert.equal(pushed.status, "synced");
  assert.deepEqual(harness.remote.calls, ["remove", "get", "remove"]);
  assert.equal(harness.remote.events.size, 0, "웹 삭제가 우선한다");
  assert.deepEqual(links(harness), []);

  await harness.sync();
  assert.equal(harness.rows("SELECT id FROM calendar_events").length, 0, "지운 일정이 다시 살아나지 않는다");
});

test("전체 재동기화에서 window 밖으로 옮긴 가져온 일정은 지우지 않고 옮긴 날짜로 반영한다", async (context) => {
  const harness = setup(context);
  const imported = harness.remote.remoteAdd({ title: "합주", start: at("2026-11-02T10:00:00Z"), end: at("2026-11-02T12:00:00Z") });
  await harness.sync();
  const farStart = at("2028-03-02T10:00:00Z");
  harness.remote.remoteEdit(imported.remoteId, { start: farStart, end: new Date(farStart.getTime() + 2 * 3_600_000) });
  harness.sqlite.prepare("UPDATE calendar_mappings SET cursor = NULL").run();

  const result = await harness.sync();
  assert.equal(result.status, "synced");
  const events = harness.rows<{ start_time: number }>("SELECT start_time FROM calendar_events");
  assert.equal(events.length, 1, "원격에 있는 일정을 지우지 않는다");
  assert.equal(events[0].start_time, seconds(farStart));
  assert.deepEqual(links(harness).map((link) => link.remote_id), [imported.remoteId]);
  assert.equal(harness.remote.events.size, 1);
});

test("전체 재동기화 누락 확인이 상한을 넘으면 남은 항목은 지우지 않고 cursor를 비워 다음 실행이 이어서 확인한다", async (context) => {
  const harness = setup(context);
  const total = FULL_RESYNC_MISSING_LOOKUP_CAP + 2;
  const remoteIds: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const start = new Date(at("2026-11-02T10:00:00Z").getTime() + index * 86_400_000);
    remoteIds.push(harness.remote.remoteAdd({ title: `일정 ${index}`, start, end: new Date(start.getTime() + 3_600_000) }).remoteId);
  }
  await harness.sync();
  assert.equal(links(harness).length, total);
  // 증분 변경 기록 없이 원격에서 사라진 상태(전체 재동기화로만 알 수 있음).
  for (const remoteId of remoteIds) harness.remote.events.delete(remoteId);
  harness.sqlite.prepare("UPDATE calendar_mappings SET cursor = NULL").run();

  const first = await harness.sync();
  assert.ok(first.status === "synced" && first.partial, "남은 확인이 있으면 partial");
  assert.equal(links(harness).length, total - FULL_RESYNC_MISSING_LOOKUP_CAP, "상한을 넘은 항목은 지우지 않는다");
  assert.equal(harness.rows<{ cursor: string | null }>("SELECT cursor FROM calendar_mappings")[0].cursor, null, "증분 cursor로 넘어가지 않는다");

  const second = await harness.sync();
  assert.ok(second.status === "synced" && !second.partial);
  assert.equal(links(harness).length, 0);
  assert.equal(harness.rows("SELECT id FROM calendar_events").length, 0);
  assert.notEqual(harness.rows<{ cursor: string | null }>("SELECT cursor FROM calendar_mappings")[0].cursor, null);
});

test("lease가 만료된 뒤 다른 실행이 이어받으면 이전 실행은 lease 갱신에 실패해 원격에 쓰지 않는다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  let releasePull!: () => void;
  const pullGate = new Promise<void>((resolve) => {
    releasePull = resolve;
  });
  const remote = harness.remote;
  const stalled: CalendarProviderClient = {
    kind: "GOOGLE",
    listCalendars: () => remote.listCalendars(),
    pull: async (...args) => {
      await pullGate;
      return remote.pull(...args);
    },
    create: (...args) => remote.create(...args),
    update: (...args) => remote.update(...args),
    remove: (...args) => remote.remove(...args),
    findByPortalRef: (...args) => remote.findByPortalRef(...args),
    get: (...args) => remote.get(...args),
  };
  const first = harness.sync({ client: stalled });
  await waitFor(() => harness.rows<{ id: string | null }>("SELECT sync_lease_id AS id FROM calendar_mappings")[0].id !== null, "첫 실행 lease");

  harness.clock.now = new Date(BASE_NOW.getTime() + 61_000);
  const second = await harness.sync();
  assert.equal(second.status, "synced", "만료된 lease는 다른 실행이 잡는다");
  assert.equal(harness.remote.events.size, 1);
  insertLesson(harness, "lesson-2", at("2026-11-04T09:00:00Z"));

  harness.remote.calls = [];
  releasePull();
  const stale = await first;
  assert.ok(stale.status === "synced" && stale.partial, "소유권을 잃은 실행은 partial로 멈춘다");
  assert.equal(harness.remote.writeCount(), 0, "이전 실행은 원격에 쓰지 않는다");
  assert.equal(harness.remote.events.size, 1);
});

test("create 도중 lease가 만료되어 두 실행이 같은 레슨을 만들어도 결정적 원격 id라 사본은 하나다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-l", at("2026-11-03T09:00:00Z"));
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  harness.remote.beforeCreate = async () => {
    harness.remote.beforeCreate = null;
    await createGate;
  };
  const first = harness.sync();
  await waitFor(() => harness.remote.calls.includes("create"), "첫 실행 create");

  harness.clock.now = new Date(BASE_NOW.getTime() + 61_000);
  const second = await harness.sync();
  assert.equal(second.status, "synced");
  releaseCreate();
  assert.equal((await first).status, "synced");

  const copies = [...harness.remote.events.values()].filter((event) => event.portalRef === "lesson:lesson-l");
  assert.equal(copies.length, 1, "같은 portalRef 원격 사본은 하나");
  assert.equal(copies[0].remoteId, FakeCalendar.portalRemoteId("lesson:lesson-l"));
  assert.deepEqual(links(harness).map((link) => link.remote_id), [copies[0].remoteId]);
});

// ── 교차 검토(Sol 4) 필수 지적 회귀 테스트: lease를 잃은 실행의 로컬 쓰기 fencing ──

/** 실행 B가 만료된 lease를 이어받은 상태를 만든다(B는 아직 실행 중). */
function takeOverLease(harness: Harness): void {
  harness.sqlite
    .prepare("UPDATE calendar_mappings SET sync_lease_id = 'run-b', sync_lease_until = ? WHERE id = ?")
    .run(seconds(harness.clock.now) + 60, MAPPING);
}

function finishRunB(harness: Harness): void {
  harness.sqlite.prepare("UPDATE calendar_mappings SET sync_lease_id = NULL, sync_lease_until = NULL WHERE sync_lease_id = 'run-b'").run();
}

test("로컬 batch 직전에 멈춘 실행 A는 lease를 이어받은 실행 B가 반영한 더 새 원격 값을 덮지 않고 멈춘다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  await harness.sync();
  const [remoteLesson] = [...harness.remote.events.values()];
  const staleTime = at("2026-11-04T10:00:00Z");
  const newestTime = at("2026-11-06T15:00:00Z");
  const newestFingerprint = await localFingerprint({ kind: "LESSON", id: "lesson-1", start: newestTime });
  harness.remote.remoteEdit(remoteLesson.remoteId, { start: staleTime, end: new Date(staleTime.getTime() + 3_600_000) });

  // A가 원격 v2를 pull해 로컬 값을 읽은 뒤 batch 직전에 멈춘 사이: 시계 +61초, B가 lease를 잡고 원격 v3를 반영해 cursor까지 저장.
  harness.beforeNextAtomicWrite(() => {
    harness.clock.now = new Date(BASE_NOW.getTime() + 61_000);
    takeOverLease(harness);
    harness.remote.remoteEdit(remoteLesson.remoteId, { start: newestTime, end: new Date(newestTime.getTime() + 3_600_000) });
    const newest = harness.remote.events.get(remoteLesson.remoteId)!;
    harness.sqlite.prepare("UPDATE lessons SET scheduled_at = ? WHERE id = 'lesson-1'").run(seconds(newestTime));
    harness.sqlite
      .prepare("UPDATE calendar_sync_links SET etag = ?, local_fingerprint = ? WHERE local_id = 'lesson-1'")
      .run(newest.etag, newestFingerprint);
    harness.sqlite.prepare("UPDATE calendar_mappings SET cursor = ? WHERE id = ?").run(harness.remote.currentCursor(), MAPPING);
  });

  harness.remote.calls = [];
  const stale = await harness.sync();
  assert.ok(stale.status === "synced" && stale.partial, "소유권을 잃은 실행은 partial로 멈춘다");
  assert.equal(stale.localChanged, false);
  assert.equal(harness.rows<{ scheduled_at: number }>("SELECT scheduled_at FROM lessons")[0].scheduled_at, seconds(newestTime), "B가 반영한 최신 값이 남는다");
  assert.equal(links(harness)[0].local_fingerprint, newestFingerprint, "A가 link를 이전 값으로 되돌리지 않는다");
  assert.deepEqual(harness.remote.calls, ["pull"], "A는 다시 읽거나 원격에 쓰지 않고 멈춘다");
  assert.equal(harness.rows<{ cursor: string }>("SELECT cursor FROM calendar_mappings")[0].cursor, harness.remote.currentCursor(), "A가 cursor를 덮지 않는다");
  finishRunB(harness);

  harness.clock.now = new Date(BASE_NOW.getTime() + 200_000);
  const next = await harness.sync();
  assert.equal(next.status, "synced");
  assert.equal(harness.rows<{ scheduled_at: number }>("SELECT scheduled_at FROM lessons")[0].scheduled_at, seconds(newestTime), "다음 증분 동기화도 최신 값을 유지한다");
  assert.equal(harness.remote.events.get(remoteLesson.remoteId)!.start.getTime(), newestTime.getTime());
});

test("lease를 잃은 실행 A의 원격 삭제 반영은 그 사이 웹 수정을 지우지 않고, 다음 동기화가 웹 값을 원격에 다시 만든다", async (context) => {
  const harness = setup(context);
  insertEvent(harness, "event-1", { title: "연습", start: at("2026-11-05T11:00:00Z"), end: at("2026-11-05T12:00:00Z") });
  await harness.sync();
  harness.remote.remoteDelete(links(harness)[0].remote_id!);
  harness.beforeNextAtomicWrite(() => {
    harness.clock.now = new Date(BASE_NOW.getTime() + 61_000);
    takeOverLease(harness);
    harness.sqlite.prepare("UPDATE calendar_events SET title = '웹에서 고침' WHERE id = 'event-1'").run();
  }, 1);

  const stale = await harness.sync();
  assert.ok(stale.status === "synced" && stale.partial);
  assert.deepEqual(harness.rows<{ title: string }>("SELECT title FROM calendar_events"), [{ title: "웹에서 고침" }], "웹 수정이 남는다");
  assert.equal(links(harness).length, 1, "A는 link를 지우지 않는다");
  finishRunB(harness);

  harness.clock.now = new Date(BASE_NOW.getTime() + 200_000);
  await harness.sync();
  const recreated = [...harness.remote.events.values()].filter((event) => event.portalRef === "event:event-1");
  assert.equal(recreated.length, 1);
  assert.equal(recreated[0].title, "웹에서 고침");
  assert.deepEqual(harness.rows<{ title: string }>("SELECT title FROM calendar_events"), [{ title: "웹에서 고침" }]);
});

test("원격 응답 뒤 link 저장도 lease 소유권으로 막혀 이어받은 실행의 link를 덮지 않는다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  await harness.sync();
  harness.sqlite.prepare("UPDATE lessons SET scheduled_at = ? WHERE id = 'lesson-1'").run(seconds(at("2026-11-07T09:00:00Z")));
  const before = links(harness)[0];
  // push의 원격 update가 끝난 뒤 link 저장 batch 직전에 lease를 잃는다.
  harness.beforeNextAtomicWrite(() => {
    harness.clock.now = new Date(BASE_NOW.getTime() + 61_000);
    takeOverLease(harness);
  });

  const stale = await harness.sync({ mode: "push" });
  assert.ok(stale.status === "synced" && stale.partial);
  assert.equal(harness.remote.writeCount(), 2, "원격 update는 lease 갱신 뒤 한 번 보냈다");
  assert.deepEqual(links(harness)[0], before, "lease를 잃은 뒤에는 link를 쓰지 않는다");
});

// ── 교차 검토(Sol 5) 필수 지적 회귀 테스트 ──

/** pull만 바꾼 가짜 client(나머지는 harness.remote로 보낸다). */
function withPull(harness: Harness, pull: CalendarProviderClient["pull"]): CalendarProviderClient {
  const remote = harness.remote;
  return {
    kind: "GOOGLE",
    listCalendars: () => remote.listCalendars(),
    pull,
    create: (...args) => remote.create(...args),
    update: (...args) => remote.update(...args),
    remove: (...args) => remote.remove(...args),
    findByPortalRef: (...args) => remote.findByPortalRef(...args),
    get: (...args) => remote.get(...args),
  };
}

type MappingState = { last_error: string | null; last_synced_at: number | null; updated_at: number; cursor: string | null };

function mappingState(harness: Harness): MappingState {
  return harness.rows<MappingState>("SELECT last_error, last_synced_at, updated_at, cursor FROM calendar_mappings")[0];
}

test("lease를 잃은 실행 A의 늦은 인증 실패는 연결을 NEEDS_REAUTH로 바꾸지 않고 이어받은 실행 B의 상태를 덮지 않는다", async (context) => {
  const harness = setup(context);
  insertLesson(harness, "lesson-1", at("2026-11-03T09:00:00Z"));
  let releasePull!: () => void;
  const pullGate = new Promise<void>((resolve) => {
    releasePull = resolve;
  });
  const stalled = withPull(harness, async () => {
    await pullGate;
    throw new CalendarAuthError("revoked", { status: 401 });
  });
  const first = harness.sync({ client: stalled });
  await waitFor(() => harness.rows<{ id: string | null }>("SELECT sync_lease_id AS id FROM calendar_mappings")[0].id !== null, "첫 실행 lease");

  harness.clock.now = new Date(BASE_NOW.getTime() + 61_000);
  const second = await harness.sync();
  assert.equal(second.status, "synced", "만료된 lease는 B가 이어받아 성공한다");
  const afterB = mappingState(harness);
  assert.equal(afterB.last_error, null);

  releasePull();
  await first;
  const connection = harness.rows<{ status: string; last_error: string | null }>("SELECT status, last_error FROM calendar_connections")[0];
  assert.deepEqual(connection, { status: "ACTIVE", last_error: null }, "lease를 잃은 실행은 연결을 비활성화하지 않는다");
  assert.deepEqual(mappingState(harness), afterB, "B의 매핑 상태를 덮지 않는다");

  harness.clock.now = new Date(BASE_NOW.getTime() + 200_000);
  assert.equal((await harness.sync()).status, "synced", "다음 실행도 inactive로 건너뛰지 않는다");
});

test("인증 실패 중 연결 자격 증명이 바뀌었으면(재연결·다른 갱신) 연결을 NEEDS_REAUTH로 바꾸지 않는다", async (context) => {
  const harness = setup(context);
  const reconnecting = withPull(harness, async () => {
    harness.sqlite.prepare("UPDATE calendar_connections SET encrypted_credentials = 'reconnected' WHERE id = ?").run(CONNECTION);
    throw new CalendarAuthError("revoked", { status: 401 });
  });
  const result = await harness.sync({ client: reconnecting });
  assert.ok(result.status === "failed" && result.authFailed);
  assert.equal(harness.rows<{ status: string }>("SELECT status FROM calendar_connections")[0].status, "ACTIVE");
  assert.equal(mappingState(harness).last_error, CALENDAR_SYNC_MESSAGES.auth, "lease 소유 중이면 매핑 오류는 남긴다");
});

test("실행의 pull 이후 원격에 생긴 변경은 같은 실행이 lease를 풀기 전 꼬리 pull로 반영하고 cursor를 옮긴다", async (context) => {
  const harness = setup(context);
  await harness.sync();
  const start = at("2026-11-08T10:00:00Z");
  let pulls = 0;
  const racing = withPull(harness, async (...args) => {
    pulls += 1;
    const result = await harness.remote.pull(...args);
    // 첫 pull의 snapshot 뒤에 원격 일정이 생기고 알림이 온다(알림 동기화는 lease에 막힌다).
    if (pulls === 1) harness.remote.remoteAdd({ title: "실행 중 추가", start, end: new Date(start.getTime() + 3_600_000) });
    return result;
  });
  const result = await harness.sync({ client: racing });
  assert.equal(result.status, "synced");
  assert.equal(pulls, 2, "push 뒤 꼬리 pull을 한 번 한다");
  assert.deepEqual(harness.rows<{ title: string }>("SELECT title FROM calendar_events"), [{ title: "실행 중 추가" }]);
  assert.equal(mappingState(harness).cursor, harness.remote.currentCursor(), "cursor가 꼬리 pull 뒤로 옮겨진다");

  // push 모드는 pull하지 않는다(꼬리 pull도 없다).
  harness.remote.calls = [];
  await harness.sync({ mode: "push" });
  assert.ok(!harness.remote.calls.includes("pull"));
});
