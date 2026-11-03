import assert from "node:assert/strict";
import test from "node:test";
import type { DrizzleDb } from "@/db/client";
import { createSqliteTestDb, insertConnection, insertMapping, insertProfile } from "@/lib/calendar-sync/sqlite-test-db";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { queryConnectedLessonsForStudent, queryConnectedNextEvents } from "./connected-next-lesson";
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

test("공개 iCal을 읽지 못한 학생은 건너뛰고 나머지는 그대로 센다", async (context) => {
  const db = createSqliteTestDb(context);
  insertProfile(db, "subscribed", "student");
  db.run("INSERT INTO external_calendar_subscriptions (id, student_id, provider, label, encrypted_url, url_iv) VALUES ('sub-1', 'subscribed', 'GOOGLE', 'Google', 'x', 'y')");
  const result = await queryConnectedNextEvents(db.ctx.db as unknown as DrizzleDb, NOW, async () => {
    throw new Error("network");
  });
  assert.equal(result.size, 0);
});

test("다음 레슨은 포털 레슨과 연결된 일정 중 이른 쪽이다", () => {
  const base = { email: "", displayName: null, createdAt: null, currentModule: null, pendingFeedbackCount: 0 };
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
