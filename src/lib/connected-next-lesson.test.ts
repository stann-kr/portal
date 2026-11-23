import assert from "node:assert/strict";
import test from "node:test";
import type { DrizzleDb } from "@/db/client";
import { createSqliteTestDb, insertConnection, insertMapping, insertProfile } from "@/lib/calendar-sync/sqlite-test-db";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import {
  queryConnectedLessonsForStudent,
  queryConnectedNextEvents,
  querySubscribedLessonsForStudent,
  querySubscribedNextEvents,
} from "./connected-next-lesson";
import { withConnectedNextLessons, type StudentRosterStat } from "./student-roster";

const NOW = new Date("2026-11-03T03:00:00.000Z");
const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1_000);

const WEEKLY_SERIES = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//KO",
  "BEGIN:VEVENT",
  "UID:weekly-lesson@example.com",
  "DTSTAMP:20260901T000000Z",
  "DTSTART:20260902T100000Z",
  "DTEND:20260902T110000Z",
  "RRULE:FREQ=WEEKLY",
  "SUMMARY:정기 수업",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("연결된 캘린더의 가장 가까운 앞으로의 일정을 학생별로 찾는다(동기화 일정·반복 사본·공개 iCal)", async (context) => {
  const db = createSqliteTestDb(context);
  insertProfile(db, "admin-1", "admin");
  for (const id of ["synced", "series", "subscribed", "plain"]) insertProfile(db, id, "student");
  insertConnection(db, "conn-1", "GOOGLE");
  insertMapping(db, "map-synced", "conn-1", "synced", "cal-synced");
  insertMapping(db, "map-series", "conn-1", "series", "cal-series");

  // 동기화로 가져온 일정: 지난 일정·지운 link·연결 안 된 일정은 세지 않는다.
  const insertEvent = (id: string, userId: string, iso: string) =>
    db.run("INSERT INTO calendar_events (id, user_id, title, start_time) VALUES (?, ?, '일정', ?)", id, userId, epoch(iso));
  const link = (id: string, mapping: string, localId: string, fingerprint = "fp") =>
    db.run("INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, local_fingerprint) VALUES (?, ?, 'EVENT', ?, ?)", id, mapping, localId, fingerprint);
  insertEvent("past", "synced", "2026-11-01T10:00:00Z");
  insertEvent("deleted", "synced", "2026-11-03T05:00:00Z");
  insertEvent("next", "synced", "2026-11-05T10:00:00Z");
  insertEvent("later", "synced", "2026-11-12T10:00:00Z");
  insertEvent("unlinked", "plain", "2026-11-04T10:00:00Z");
  link("l-past", "map-synced", "past");
  link("l-deleted", "map-synced", "deleted", "DELETED");
  link("l-next", "map-synced", "next");
  link("l-later", "map-synced", "later");

  db.run("INSERT INTO calendar_remote_series (mapping_id, remote_id, series_key, ics_text) VALUES ('map-series', 'r-1', 'weekly-lesson@example.com', ?)", WEEKLY_SERIES);
  db.run("INSERT INTO external_calendar_subscriptions (id, student_id, provider, label, encrypted_url, url_iv) VALUES ('sub-1', 'subscribed', 'GOOGLE', 'Google', 'x', 'y')");

  const requested: string[] = [];
  const fetchSubscribed = async (studentId: string) => {
    requested.push(studentId);
    return [
      { date: new Date("2026-11-02T10:00:00Z") },
      { date: new Date("2026-11-06T09:00:00Z") },
    ] as unknown as UnifiedItem[];
  };

  const result = await queryConnectedNextEvents(db.ctx.db as unknown as DrizzleDb, NOW, fetchSubscribed);
  assert.deepEqual(requested, ["subscribed"]);
  assert.equal(result.get("synced")?.toISOString(), "2026-11-05T10:00:00.000Z");
  assert.equal(result.get("series")?.toISOString(), "2026-11-04T10:00:00.000Z");
  assert.equal(result.get("subscribed")?.toISOString(), "2026-11-06T09:00:00.000Z");
  assert.equal(result.has("plain"), false);
});

test("동기화 일정도 90일보다 먼 것은 다음 레슨으로 보지 않는다", async (context) => {
  const db = createSqliteTestDb(context);
  insertProfile(db, "admin-1", "admin");
  for (const id of ["far", "edge"]) insertProfile(db, id, "student");
  insertConnection(db, "conn-1", "GOOGLE");
  insertMapping(db, "map-far", "conn-1", "far", "cal-far");
  insertMapping(db, "map-edge", "conn-1", "edge", "cal-edge");
  const insertLinkedEvent = (id: string, userId: string, mapping: string, iso: string) => {
    db.run("INSERT INTO calendar_events (id, user_id, title, start_time) VALUES (?, ?, '일정', ?)", id, userId, epoch(iso));
    db.run("INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, local_fingerprint) VALUES (?, ?, 'EVENT', ?, 'fp')", `l-${id}`, mapping, id);
  };
  // NOW(2026-11-03T03:00Z)에서 90일 뒤는 2027-02-01T03:00Z다.
  insertLinkedEvent("far-200", "far", "map-far", "2027-05-22T10:00:00Z");
  insertLinkedEvent("edge-in", "edge", "map-edge", "2027-02-01T02:00:00Z");
  insertLinkedEvent("edge-out", "edge", "map-edge", "2027-02-01T04:00:00Z");

  const result = await queryConnectedNextEvents(db.ctx.db as unknown as DrizzleDb, NOW, async () => []);
  assert.equal(result.has("far"), false, "반복 사본·iCal 구독과 같은 90일 창을 쓴다");
  assert.equal(result.get("edge")?.toISOString(), "2027-02-01T02:00:00.000Z");
});

test("공개 iCal을 읽지 못한 학생은 건너뛰고 나머지는 그대로 센다", async (context) => {
  const db = createSqliteTestDb(context);
  insertProfile(db, "subscribed", "student");
  db.run("INSERT INTO external_calendar_subscriptions (id, student_id, provider, label, encrypted_url, url_iv) VALUES ('sub-1', 'subscribed', 'GOOGLE', 'Google', 'x', 'y')");
  const result = await queryConnectedNextEvents(db.ctx.db as unknown as DrizzleDb, NOW, async () => {
    throw new Error("network");
  });
  assert.equal(result.size, 0);
});

test("다음 레슨은 포탈 레슨과 연결된 일정 중 이른 쪽이다", () => {
  const base = { email: "", displayName: null, createdAt: null, currentModule: null, pendingFeedbackCount: 0, openQnaCount: 0 };
  const stats: StudentRosterStat[] = [
    { ...base, id: "none", nextLessonDate: null },
    { ...base, id: "portal-earlier", nextLessonDate: new Date("2026-11-04T00:00:00Z") },
    { ...base, id: "external-earlier", nextLessonDate: new Date("2026-11-20T00:00:00Z") },
    { ...base, id: "untouched", nextLessonDate: null },
  ];
  const connected = new Map([
    ["none", new Date("2026-11-07T00:00:00Z")],
    ["portal-earlier", new Date("2026-11-08T00:00:00Z")],
    ["external-earlier", new Date("2026-11-09T00:00:00Z")],
  ]);
  const merged = withConnectedNextLessons(stats, connected);
  assert.deepEqual(merged.map((row) => row.nextLessonDate?.toISOString() ?? null), [
    "2026-11-07T00:00:00.000Z",
    "2026-11-04T00:00:00.000Z",
    "2026-11-09T00:00:00.000Z",
    null,
  ]);
  assert.equal(merged[3], stats[3]);
});

test("학생 상세용 연결된 일정은 그 학생 것만 가까운 순서로 출처와 함께 모은다", async (context) => {
  const db = createSqliteTestDb(context);
  insertProfile(db, "admin-1", "admin");
  insertProfile(db, "student", "student");
  insertProfile(db, "other", "student");
  insertConnection(db, "conn-1", "ICLOUD");
  insertMapping(db, "map-1", "conn-1", "student", "cal-1");
  insertMapping(db, "map-2", "conn-1", "other", "cal-2");
  db.run("INSERT INTO calendar_events (id, user_id, title, start_time) VALUES ('e-1', 'student', '보충 수업', ?)", epoch("2026-11-10T10:00:00Z"));
  db.run("INSERT INTO calendar_events (id, user_id, title, start_time) VALUES ('e-2', 'other', '남의 일정', ?)", epoch("2026-11-04T10:00:00Z"));
  db.run("INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, local_fingerprint) VALUES ('l-1', 'map-1', 'EVENT', 'e-1', 'fp')");
  db.run("INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, local_fingerprint) VALUES ('l-2', 'map-2', 'EVENT', 'e-2', 'fp')");
  db.run("INSERT INTO calendar_remote_series (mapping_id, remote_id, series_key, ics_text) VALUES ('map-1', 'r-1', 'weekly-lesson@example.com', ?)", WEEKLY_SERIES);

  let fetched = false;
  const lessons = await queryConnectedLessonsForStudent(db.ctx.db as unknown as DrizzleDb, "student", NOW, async () => {
    fetched = true;
    return [];
  });
  assert.equal(fetched, false, "공개 iCal을 연결하지 않은 학생은 읽지 않는다");
  assert.deepEqual(lessons.slice(0, 3).map((lesson) => [lesson.scheduledAt.toISOString(), lesson.title, lesson.sourceLabel]), [
    ["2026-11-04T10:00:00.000Z", "정기 수업", "iCloud Calendar"],
    ["2026-11-10T10:00:00.000Z", "보충 수업", "iCloud Calendar"],
    ["2026-11-11T10:00:00.000Z", "정기 수업", "iCloud Calendar"],
  ]);
  assert.ok(lessons.every((lesson) => lesson.title !== "남의 일정"));
  assert.ok(lessons.every((lesson) => lesson.scheduledAt.getTime() < NOW.getTime() + 90 * 86_400_000));
});

test("첫 화면용 조회(fetch 없음)는 공개 iCal을 읽지 않고, 공개 iCal 다음 레슨·일정은 따로 받는다", async (context) => {
  const db = createSqliteTestDb(context);
  insertProfile(db, "admin-1", "admin");
  insertProfile(db, "subscribed", "student");
  insertProfile(db, "other", "student");
  db.run("INSERT INTO external_calendar_subscriptions (id, student_id, provider, label, encrypted_url, url_iv) VALUES ('sub-1', 'subscribed', 'GOOGLE', 'Google', 'x', 'y')");
  const drizzle = db.ctx.db as unknown as DrizzleDb;

  // 관리자 홈 첫 화면·학생 상세 첫 화면은 바깥 요청 없이 DB 일정만 쓴다.
  assert.equal((await queryConnectedNextEvents(drizzle, NOW, null)).has("subscribed"), false);
  assert.deepEqual(await queryConnectedLessonsForStudent(drizzle, "subscribed", NOW, null), []);

  const requested: string[] = [];
  const item = (id: string, iso: string) => ({
    id, title: `수업 ${id}`, date: new Date(iso), source: { kind: "EXTERNAL", label: "Google Calendar" },
  });
  const fetchSubscribed = async (studentId: string) => {
    requested.push(studentId);
    return [
      item("past", "2026-11-02T10:00:00Z"),
      item("b", "2026-11-08T10:00:00Z"),
      item("a", "2026-11-06T09:00:00Z"),
      item("a", "2026-11-06T09:00:00Z"),
      item("far", "2027-03-01T10:00:00Z"),
    ] as unknown as UnifiedItem[];
  };
  const next = await querySubscribedNextEvents(drizzle, NOW, fetchSubscribed);
  assert.deepEqual(requested, ["subscribed"], "구독한 학생만 읽는다");
  assert.equal(next.get("subscribed")?.toISOString(), "2026-11-06T09:00:00.000Z");
  assert.equal(next.has("other"), false);

  const lessons = await querySubscribedLessonsForStudent(drizzle, "subscribed", NOW, fetchSubscribed);
  assert.deepEqual(lessons.map((lesson) => [lesson.id, lesson.scheduledAt.toISOString(), lesson.sourceLabel]), [
    ["EXTERNAL:a", "2026-11-06T09:00:00.000Z", "Google Calendar"],
    ["EXTERNAL:b", "2026-11-08T10:00:00.000Z", "Google Calendar"],
  ], "지난 일정·90일 밖·겹친 일정은 빼고 가까운 순서로 둔다");

  requested.length = 0;
  assert.deepEqual(await querySubscribedLessonsForStudent(drizzle, "other", NOW, fetchSubscribed), []);
  assert.deepEqual(requested, [], "구독이 없는 학생은 바깥 요청을 하지 않는다");
  assert.deepEqual(
    await querySubscribedLessonsForStudent(drizzle, "subscribed", NOW, async () => { throw new Error("offline"); }),
    [],
    "바깥 요청이 실패하면 빈 목록으로 둔다",
  );
});
