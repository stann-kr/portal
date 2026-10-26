import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCalendarMoveToItem,
  buildCalendarMoveRequest,
  getCalendarItemEditing,
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
    source: { kind: "PORTAL", entity, label: "포털" },
    ...overrides,
  };
}

const student: CalendarEditContext = {
  actorId: "student-1",
  role: "student",
  canManageEvents: true,
  canManageLessons: false,
};
const admin: CalendarEditContext = {
  actorId: "admin-1",
  role: "admin",
  canManageEvents: false,
  canManageLessons: true,
};

test("학생은 본인 일정과 본인이 쓴 노트만 옮기고 레슨은 옮기지 못한다", () => {
  assert.deepEqual(getCalendarItemEditing(item("CALENDAR_EVENT"), student), {
    kind: "event",
    movable: true,
    resizable: true,
  });
  assert.equal(getCalendarItemEditing(item("LESSON"), student).movable, false);
  assert.equal(
    getCalendarItemEditing(item("PRIVATE_NOTE", { metadata: { authorId: "student-1" } }), student).kind,
    "note",
  );
  assert.equal(
    getCalendarItemEditing(item("PRIVATE_NOTE", { metadata: { authorId: "admin-1" } }), student).movable,
    false,
  );
});

test("관리자는 학생 스페이스의 레슨과 노트를 옮기고 학생 개인 일정은 옮기지 못한다", () => {
  assert.equal(getCalendarItemEditing(item("LESSON"), admin).kind, "lesson");
  assert.equal(getCalendarItemEditing(item("LESSON"), admin).resizable, false);
  assert.equal(
    getCalendarItemEditing(item("PRIVATE_NOTE", { metadata: { authorId: "student-1" } }), admin).kind,
    "note",
  );
  assert.equal(getCalendarItemEditing(item("CALENDAR_EVENT"), admin).movable, false);
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
    assert.equal(getCalendarItemEditing(candidate, { ...admin, canManageEvents: true }).movable, false);
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
    buildCalendarMoveRequest(getCalendarItemEditing(item("LESSON"), student), { start, end, allDay: false, startStr: "" }),
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
