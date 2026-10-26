import assert from "node:assert/strict";
import test from "node:test";
import {
  createDaySelection,
  describeRelativeDay,
  findClosestDayKey,
  isUnifiedItemAllDay,
  resolveUnifiedItemSort,
  sortDayAgenda,
  sortUnifiedItems,
} from "./unified-item-views";
import type { UnifiedItem, UnifiedItemType } from "./utils/unifiedItemUtils";

function item(id: string, type: UnifiedItemType, iso: string, title = id): UnifiedItem {
  return {
    id,
    type,
    title,
    date: new Date(iso),
    metadata: {},
    space: { studentId: "s", label: "학생" },
    source: { kind: "PORTAL", entity: type === "NOTE" ? "PRIVATE_NOTE" : "CALENDAR_EVENT", label: "포털" },
  };
}

test("오늘·내일·어제만 말로 붙이고 월말을 넘어도 하루 차이를 센다", () => {
  assert.equal(describeRelativeDay("2026-10-31", "2026-10-31"), "오늘");
  assert.equal(describeRelativeDay("2026-11-01", "2026-10-31"), "내일");
  assert.equal(describeRelativeDay("2026-10-30", "2026-10-31"), "어제");
  assert.equal(describeRelativeDay("2026-11-02", "2026-10-31"), null);
});

test("오늘 묶음이 없으면 가장 가까운 날을, 같은 거리면 앞으로 올 날을 고른다", () => {
  assert.equal(findClosestDayKey(["2026-10-25", "2026-10-31", "2026-11-03"], "2026-10-31"), "2026-10-31");
  assert.equal(findClosestDayKey(["2026-10-29", "2026-11-02"], "2026-10-31"), "2026-11-02");
  assert.equal(findClosestDayKey(["2026-10-21", "2026-11-12"], "2026-10-31"), "2026-10-21");
  assert.equal(findClosestDayKey([], "2026-10-31"), null);
});

test("노트와 종일 일정만 종일로 보고 하루 선택은 다음 날을 끝으로 둔다", () => {
  assert.equal(isUnifiedItemAllDay(item("n", "NOTE", "2026-10-31T00:00:00Z")), true);
  assert.equal(isUnifiedItemAllDay(item("e", "EVENT", "2026-10-31T00:00:00Z")), false);
  assert.equal(isUnifiedItemAllDay({ ...item("x", "EVENT", "2026-10-31T00:00:00Z"), metadata: { allDay: true } }), true);
  assert.deepEqual(createDaySelection("2026-12-31"), { startStr: "2026-12-31", endStr: "2027-01-01", allDay: true });
});

test("정렬은 선택 기준 뒤에 최신순, 원래 순서로 동률을 고정한다", () => {
  const items = [
    item("old-note", "NOTE", "2026-10-01T00:00:00Z", "나 노트"),
    item("new-event", "EVENT", "2026-10-03T00:00:00Z", "가 일정"),
    item("mid-event", "EVENT", "2026-10-02T00:00:00Z", "다 일정"),
  ];
  assert.deepEqual(sortUnifiedItems(items, "date-desc").map((entry) => entry.id), ["new-event", "mid-event", "old-note"]);
  assert.deepEqual(sortUnifiedItems(items, "date-asc").map((entry) => entry.id), ["old-note", "mid-event", "new-event"]);
  assert.deepEqual(sortUnifiedItems(items, "title").map((entry) => entry.id), ["new-event", "old-note", "mid-event"]);
  assert.deepEqual(sortUnifiedItems(items, "type").map((entry) => entry.id), ["new-event", "mid-event", "old-note"]);
  assert.equal(resolveUnifiedItemSort("constructor"), "date-desc");
  assert.equal(resolveUnifiedItemSort("title"), "title");
});

test("하루 일정은 종일 항목을 먼저, 나머지는 이른 시각부터 놓는다", () => {
  const day = [
    item("late", "EVENT", "2026-10-28T10:00:00Z"),
    item("note", "NOTE", "2026-10-28T00:00:00Z"),
    item("early", "EVENT", "2026-10-28T03:00:00Z"),
  ];
  assert.deepEqual(sortDayAgenda(day).map((entry) => entry.id), ["note", "early", "late"]);
});
