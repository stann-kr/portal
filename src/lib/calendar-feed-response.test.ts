import assert from "node:assert/strict";
import test from "node:test";
import { buildLessonCalendarIcs } from "./calendar-feed-response";

const student = { displayName: "학생", email: "student@example.com" };

test("레슨 구독 피드는 레슨마다 고정 UID와 UTC 시작 시각을 기록한다", () => {
  const first = buildLessonCalendarIcs(student, [
    { id: "lesson-1", scheduledAt: new Date("2026-10-09T10:30:00.000Z") },
    { id: "lesson-2", scheduledAt: new Date("2026-10-16T10:30:00.000Z") },
  ]);
  const second = buildLessonCalendarIcs(student, [
    { id: "lesson-1", scheduledAt: new Date("2026-10-09T10:30:00.000Z") },
  ]);
  assert.equal(first.error, null);
  const value = first.value ?? "";
  assert.equal(value.match(/BEGIN:VEVENT/gu)?.length, 2);
  assert.match(value, /UID:lesson-1@lessons\.stannlumo/u);
  assert.match(value, /UID:lesson-2@lessons\.stannlumo/u);
  assert.match(value, /DTSTART:20261009T103000Z/u);
  assert.match(second.value ?? "", /UID:lesson-1@lessons\.stannlumo/u);
});

test("예정 레슨이 없으면 가짜 일정 없이 빈 캘린더를 반환한다", () => {
  const empty = buildLessonCalendarIcs(student, []);
  assert.equal(empty.error, null);
  assert.match(empty.value ?? "", /BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/u);
  assert.doesNotMatch(empty.value ?? "", /BEGIN:VEVENT/u);
});
