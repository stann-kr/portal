import assert from "node:assert/strict";
import test from "node:test";
import {
  getUnifiedItemKey,
  replaceUnifiedItemsInRange,
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

test("기간 재조회는 그 기간의 포탈 항목만 응답으로 교체하고 잘린 응답은 병합만 한다", () => {
  const range = { start: new Date("2026-11-01T00:00:00.000Z"), end: new Date("2026-11-30T23:59:59.999Z") };
  const stale = event("stale", "지운 일정", "2026-11-10T00:00:00.000Z");
  const kept = event("kept", "그대로", "2026-11-11T00:00:00.000Z");
  const outside = event("outside", "기간 밖", "2026-12-05T00:00:00.000Z");
  const edge = event("edge", "끝 경계", "2026-11-30T23:59:59.999Z");
  const external: UnifiedItem = { ...event("ext", "외부", "2026-11-12T00:00:00.000Z"), source: { kind: "GOOGLE_CALENDAR", entity: "EXTERNAL_CALENDAR_EVENT", label: "외부" } };
  const moved = event("kept", "옮김", "2026-11-20T00:00:00.000Z");
  const beyond = event("beyond", "응답이 준 기간 밖 항목", "2027-01-01T00:00:00.000Z");

  const replaced = replaceUnifiedItemsInRange([stale, kept, outside, edge, external], [moved, beyond], { ...range, complete: true });
  assert.deepEqual(replaced.map((item) => `${item.id}:${item.title}`), ["beyond:응답이 준 기간 밖 항목", "outside:기간 밖", "kept:옮김", "ext:외부"]);

  const truncated = replaceUnifiedItemsInRange([stale, kept, outside], [moved], { ...range, complete: false });
  assert.deepEqual(truncated.map((item) => item.id).sort(), ["kept", "outside", "stale"], "잘린 응답이면 아무것도 지우지 않는다");
});
