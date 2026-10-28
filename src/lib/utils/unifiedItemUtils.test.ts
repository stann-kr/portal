import assert from "node:assert/strict";
import test from "node:test";
import {
  getUnifiedItemKey,
  upsertUnifiedItem,
  upsertUnifiedItems,
  type UnifiedItem,
} from "./unifiedItemUtils";

function event(id: string, title: string, date: string): UnifiedItem {
  return {
    id,
    type: "EVENT",
    title,
    date: new Date(date),
    metadata: {},
    space: { studentId: "student-1", label: "학생" },
    source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포탈" },
  };
}

test("생성 성공 항목은 같은 source key로 정확히 한 번만 합쳐진다", () => {
  const original = event("event-1", "이전 제목", "2026-08-13T00:00:00.000Z");
  const updated = event("event-1", "새 제목", "2026-08-13T01:00:00.000Z");
  const once = upsertUnifiedItem([original], updated);
  const twice = upsertUnifiedItem(once, updated);
  assert.equal(twice.length, 1);
  assert.equal(twice[0]?.title, "새 제목");
  assert.equal(getUnifiedItemKey(twice[0]!), "PORTAL:CALENDAR_EVENT:event-1");
});

test("외부 source 묶음은 기존 내부 일정과 exact-once로 병합된다", () => {
  const internal = event("internal", "내부", "2026-08-13T00:00:00.000Z");
  const external: UnifiedItem = {
    ...event("external", "외부", "2026-08-13T01:00:00.000Z"),
    source: {
      kind: "GOOGLE_CALENDAR",
      entity: "EXTERNAL_CALENDAR_EVENT",
      label: "Google Calendar",
    },
  };
  const updated = { ...external, title: "변경된 외부 일정" };

  const once = upsertUnifiedItems([internal], [external]);
  const twice = upsertUnifiedItems(once, [updated]);

  assert.deepEqual(twice.map((entry) => entry.id), ["external", "internal"]);
  assert.equal(twice[0]?.title, "변경된 외부 일정");
});
