import assert from "node:assert/strict";
import test from "node:test";
import { groupUnifiedItemsByKstDate } from "./unified-item-date-groups";
import type { UnifiedItem } from "./utils/unifiedItemUtils";

function note(id: string, date: string): UnifiedItem {
  return {
    id,
    type: "NOTE",
    title: id,
    date: new Date(date),
    metadata: {},
    space: { studentId: "student-1", label: "학생" },
    source: { kind: "PORTAL", entity: "PRIVATE_NOTE", label: "포털" },
  };
}

test("KST 00:30 항목은 UTC 전날이 아닌 KST 당일 그룹에 포함된다", () => {
  const groups = groupUnifiedItemsByKstDate([
    note("after-midnight", "2026-08-12T15:30:00.000Z"),
    note("before-midnight", "2026-08-12T14:30:00.000Z"),
  ]);
  assert.deepEqual([...groups.keys()], ["2026-08-13", "2026-08-12"]);
});
