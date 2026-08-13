import assert from "node:assert/strict";
import test from "node:test";
import { getUnifiedItemKey, upsertUnifiedItem, type UnifiedItem } from "./unifiedItemUtils";

function event(id: string, title: string, date: string): UnifiedItem {
  return {
    id,
    type: "EVENT",
    title,
    date: new Date(date),
    metadata: {},
    space: { studentId: "student-1", label: "학생" },
    source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포털" },
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
