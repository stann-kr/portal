import assert from "node:assert/strict";
import test from "node:test";
import { getQuickCreateDefaults } from "./calendar-quick-create";

test("하루 칸 클릭은 그날 노트를 먼저 고르고 일정 시간은 오전 9시로 채운다", () => {
  assert.deepEqual(
    getQuickCreateDefaults({ startStr: "2026-10-27", endStr: "2026-10-28", allDay: true }, ["note", "event"]),
    { kind: "note", dateKey: "2026-10-27", start: "2026-10-27T09:00", end: "2026-10-27T10:00", spanLabel: null },
  );
  assert.equal(
    getQuickCreateDefaults({ startStr: "2026-10-27", endStr: "2026-10-28", allDay: true }, ["event", "lesson"]).kind,
    "event",
  );
});

test("여러 날을 끌어 고르면 첫날부터 마지막 날까지의 일정으로 채운다", () => {
  assert.deepEqual(
    getQuickCreateDefaults({ startStr: "2026-10-27", endStr: "2026-10-30", allDay: true }, ["note", "event"]),
    { kind: "note", dateKey: "2026-10-27", start: "2026-10-27T09:00", end: "2026-10-29T18:00", spanLabel: "3일" },
  );
});

test("시간 칸 선택은 일정(관리자는 레슨)을 먼저 고르고 KST 시각을 그대로 쓴다", () => {
  const selection = {
    startStr: "2026-10-27T14:00:00+09:00",
    endStr: "2026-10-27T15:30:00+09:00",
    allDay: false,
  };
  assert.deepEqual(getQuickCreateDefaults(selection, ["note", "event"]), {
    kind: "event",
    dateKey: "2026-10-27",
    start: "2026-10-27T14:00",
    end: "2026-10-27T15:30",
    spanLabel: "14:00–15:30",
  });
  assert.equal(getQuickCreateDefaults(selection, ["note", "lesson"]).kind, "lesson");
  assert.equal(getQuickCreateDefaults(selection, ["note"]).kind, "note");
});
