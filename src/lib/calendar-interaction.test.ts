import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCalendarMoveToItem,
  buildCalendarMoveRequest,
  calendarWallStringToKst,
  createLatestMoveTracker,
  fromCalendarWallTime,
  isCalendarMoveReflected,
  resolveSavedMove,
  toCalendarWallTime,
  getCalendarItemEditing,
  getCalendarItemLockReason,
  getNoteCalendarDateKey,
  type CalendarEditContext,
} from "./calendar-interaction";
import type { UnifiedItem, UnifiedItemSourceEntity } from "./utils/unifiedItemUtils";

function item(entity: UnifiedItemSourceEntity, overrides: Partial<UnifiedItem> = {}): UnifiedItem {
  return {
    id: `${entity}-1`,
    type: entity === "PRIVATE_NOTE" ? "NOTE" : "EVENT",
    title: "항목",
    date: new Date("2026-10-27T01:00:00.000Z"),
    endDate: null,
    metadata: {},
    space: { studentId: "student-1", label: "학생" },
    source: { kind: "PORTAL", entity, label: "포탈" },
    ...overrides,
  };
}

const student: CalendarEditContext = { actorId: "student-1", role: "student" };
const otherStudent: CalendarEditContext = { actorId: "student-2", role: "student" };
const admin: CalendarEditContext = { actorId: "admin-1", role: "admin" };

test("학생은 자기 스페이스의 일정·레슨과 본인이 쓴 노트를 옮기고 다른 학생 것은 옮기지 못한다", () => {
  assert.deepEqual(getCalendarItemEditing(item("CALENDAR_EVENT"), student), {
    kind: "event",
    movable: true,
    resizable: true,
  });
  assert.equal(getCalendarItemEditing(item("LESSON"), student).kind, "lesson");
  assert.equal(getCalendarItemEditing(item("LESSON"), student).resizable, false);
  assert.equal(
    getCalendarItemEditing(item("PRIVATE_NOTE", { metadata: { authorId: "student-1" } }), student).kind,
    "note",
  );
  assert.equal(
    getCalendarItemEditing(item("PRIVATE_NOTE", { metadata: { authorId: "admin-1" } }), student).movable,
    false,
  );
  assert.equal(getCalendarItemEditing(item("CALENDAR_EVENT"), otherStudent).movable, false);
  assert.equal(getCalendarItemEditing(item("LESSON"), otherStudent).movable, false);
  assert.equal(
    getCalendarItemEditing(item("PRIVATE_NOTE", { metadata: { authorId: "student-2" } }), otherStudent).movable,
    false,
    "작성자여도 다른 학생 스페이스의 노트는 옮기지 못한다",
  );
});

test("관리자는 학생 스페이스의 일정·레슨·노트를 모두 옮긴다", () => {
  assert.equal(getCalendarItemEditing(item("LESSON"), admin).kind, "lesson");
  assert.equal(getCalendarItemEditing(item("CALENDAR_EVENT"), admin).kind, "event");
  assert.equal(getCalendarItemEditing(item("CALENDAR_EVENT"), admin).resizable, true);
  assert.equal(
    getCalendarItemEditing(item("PRIVATE_NOTE", { metadata: { authorId: "student-1" } }), admin).kind,
    "note",
  );
});

test("끌 수 없는 항목은 이유를 알려 주고 옮길 수 있는 항목은 이유가 없다", () => {
  assert.equal(getCalendarItemLockReason(item("CALENDAR_EVENT"), student), null);
  assert.match(getCalendarItemLockReason(item("PRIVATE_NOTE", { metadata: { authorId: "admin-1" } }), student) ?? "", /작성자나 관리자/u);
  assert.match(getCalendarItemLockReason(item("QNA_THREAD"), admin) ?? "", /올린 날짜/u);
  assert.match(getCalendarItemLockReason(item("ASSIGNMENT"), admin) ?? "", /제출한 날짜/u);
  assert.match(getCalendarItemLockReason(item("DIGGING_TRACK"), student) ?? "", /추가한 날짜/u);
  assert.match(getCalendarItemLockReason(item("EXTERNAL_CALENDAR_EVENT", {
    source: { kind: "ICLOUD_CALENDAR", entity: "EXTERNAL_CALENDAR_EVENT", label: "iCloud" },
  }), admin) ?? "", /외부 캘린더/u);
});

test("외부 캘린더·디깅·Q&A·과제는 누구도 끌 수 없다", () => {
  const external = item("EXTERNAL_CALENDAR_EVENT", {
    source: { kind: "GOOGLE_CALENDAR", entity: "EXTERNAL_CALENDAR_EVENT", label: "Google" },
  });
  for (const candidate of [
    external,
    item("DIGGING_TRACK"),
    item("QNA_THREAD"),
    item("ASSIGNMENT"),
  ]) {
    assert.equal(getCalendarItemEditing(candidate, student).movable, false);
    assert.equal(getCalendarItemEditing(candidate, admin).movable, false);
  }
});

test("노트 날짜는 지정 날짜 그대로, 없으면 작성 시각의 KST 날짜로 놓는다", () => {
  assert.equal(
    getNoteCalendarDateKey(item("PRIVATE_NOTE", { metadata: { noteDate: new Date("2026-10-30T00:00:00.000Z") } })),
    "2026-10-30",
  );
  assert.equal(
    getNoteCalendarDateKey(item("PRIVATE_NOTE", { metadata: { noteDate: "2026-10-30T00:00:00.000Z" } })),
    "2026-10-30",
  );
  // UTC 10월 27일 16시는 KST 10월 28일 새벽이다.
  assert.equal(
    getNoteCalendarDateKey(item("PRIVATE_NOTE", { date: new Date("2026-10-27T16:00:00.000Z"), metadata: { noteDate: null } })),
    "2026-10-28",
  );
});

test("이동 요청은 항목이 표현할 수 있는 칸에서만 만든다", () => {
  const start = new Date("2026-10-28T05:00:00.000Z");
  const end = new Date("2026-10-28T06:30:00.000Z");
  const note = getCalendarItemEditing(item("PRIVATE_NOTE", { metadata: { authorId: "student-1" } }), student);
  assert.deepEqual(
    buildCalendarMoveRequest(note, { start, end: null, allDay: true, startStr: "2026-10-29" }),
    { kind: "note", noteDate: "2026-10-29" },
  );
  assert.equal(buildCalendarMoveRequest(note, { start, end: null, allDay: false, startStr: start.toISOString() }), null);

  const event = getCalendarItemEditing(item("CALENDAR_EVENT"), student);
  assert.deepEqual(
    buildCalendarMoveRequest(event, { start, end, allDay: false, startStr: start.toISOString() }),
    { kind: "event", startTime: start.toISOString(), endTime: end.toISOString() },
  );
  assert.equal(buildCalendarMoveRequest(event, { start, end, allDay: true, startStr: "2026-10-28" }), null);
  assert.equal(buildCalendarMoveRequest(event, { start: end, end: start, allDay: false, startStr: "" }), null);

  const lesson = getCalendarItemEditing(item("LESSON"), admin);
  assert.deepEqual(
    buildCalendarMoveRequest(lesson, { start, end, allDay: false, startStr: start.toISOString() }),
    { kind: "lesson", scheduledAt: start.toISOString() },
  );
  assert.equal(
    buildCalendarMoveRequest(getCalendarItemEditing(item("LESSON"), otherStudent), { start, end, allDay: false, startStr: "" }),
    null,
  );
});

test("먼저 보여 줄 항목은 새 날짜만 바꾸고 나머지는 그대로 둔다", () => {
  const original = item("PRIVATE_NOTE", { metadata: { authorId: "student-1", preview: "본문", noteDate: null } });
  const moved = applyCalendarMoveToItem(original, { kind: "note", noteDate: "2026-11-02" });
  assert.equal(moved.date.toISOString(), "2026-11-02T00:00:00.000Z");
  assert.equal(getNoteCalendarDateKey(moved), "2026-11-02");
  assert.equal(moved.metadata.preview, "본문");
  assert.equal(original.metadata.noteDate, null);

  const event = applyCalendarMoveToItem(item("CALENDAR_EVENT"), {
    kind: "event",
    startTime: "2026-10-28T05:00:00.000Z",
    endTime: null,
  });
  assert.equal(event.date.toISOString(), "2026-10-28T05:00:00.000Z");
  assert.equal(event.endDate, null);
});

test("캘린더 칸 위치는 기기 시간대와 무관하게 KST 벽시계로 오가고 선택 문자열은 KST offset을 붙인다", () => {
  const instant = new Date("2026-10-27T05:00:00.000Z"); // KST 14:00
  assert.equal(toCalendarWallTime(instant), "2026-10-27T14:00:00");
  // UTC 모드 캘린더는 "14:00" 칸을 UTC 14:00 Date로 돌려준다.
  assert.equal(fromCalendarWallTime(new Date("2026-10-27T14:00:00Z")).toISOString(), instant.toISOString());
  assert.equal(toCalendarWallTime(new Date("2026-10-27T16:30:00.000Z")), "2026-10-28T01:30:00", "KST 자정을 넘으면 다음 날 칸");
  assert.equal(calendarWallStringToKst("2026-10-27T14:00:00Z"), "2026-10-27T14:00:00+09:00");
  assert.equal(calendarWallStringToKst("2026-10-27"), "2026-10-27");
});

test("저장이 끝난 이동은 그 사이 바뀐 최신 항목에 날짜만 합치고 빠진 항목은 되살리지 않는다", () => {
  const original = item("CALENDAR_EVENT", { title: "옛 제목" });
  const renamed = { ...original, title: "새 제목", metadata: { description: "메모" } };
  const request = { kind: "event", startTime: "2026-10-29T03:00:00.000Z", endTime: null } as const;
  const key = "PORTAL:CALENDAR_EVENT:CALENDAR_EVENT-1";
  const saved = resolveSavedMove([renamed], key, request);
  assert.equal(saved?.title, "새 제목");
  assert.equal(saved?.metadata.description, "메모");
  assert.equal(saved?.date.toISOString(), "2026-10-29T03:00:00.000Z");
  assert.equal(resolveSavedMove([], key, request), null);
});

test("다시 받은 항목이 이동한 자리에 있는지 종류별로 판정한다", () => {
  const event = item("CALENDAR_EVENT", { date: new Date("2026-10-29T03:00:00.000Z"), endDate: new Date("2026-10-29T04:00:00.000Z") });
  assert.equal(isCalendarMoveReflected(event, { kind: "event", startTime: "2026-10-29T03:00:00.000Z", endTime: "2026-10-29T04:00:00.000Z" }), true);
  assert.equal(isCalendarMoveReflected(event, { kind: "event", startTime: "2026-10-29T03:00:00.000Z", endTime: null }), false);
  assert.equal(isCalendarMoveReflected(item("LESSON"), { kind: "lesson", scheduledAt: "2026-10-27T01:00:00.000Z" }), true);
  const note = item("PRIVATE_NOTE", { metadata: { noteDate: new Date("2026-10-30T00:00:00.000Z") } });
  assert.equal(isCalendarMoveReflected(note, { kind: "note", noteDate: "2026-10-30" }), true);
  assert.equal(isCalendarMoveReflected(note, { kind: "note", noteDate: "2026-10-31" }), false);
});

test("겹친 이동은 마지막 요청만 결과를 반영하고 늦게 온 이전 응답은 무시한다", () => {
  const tracker = createLatestMoveTracker();
  const first = tracker.start("item");
  const second = tracker.start("item");
  const other = tracker.start("other");
  assert.equal(tracker.isLatest("item", first), false);
  assert.equal(tracker.isLatest("item", second), true);
  assert.equal(tracker.isLatest("other", other), true);
  tracker.finish("item", first);
  assert.equal(tracker.isLatest("item", second), true, "이전 요청의 마무리가 최신 요청을 지우지 않는다");
  tracker.finish("item", second);
  assert.equal(tracker.isLatest("item", second), false);
});
