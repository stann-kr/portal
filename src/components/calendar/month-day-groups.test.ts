import assert from "node:assert/strict";
import test from "node:test";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { groupItemsBySpannedDay } from "./MobileMonthView";

const base = {
  space: { studentId: "s1", label: "김학생" },
  source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포탈" },
} as unknown as Pick<UnifiedItem, "space" | "source">;

test("좁은 화면 월 보기는 여러 날 일정을 기간의 날마다 놓고 종일 종료일은 포함하지 않는다", () => {
  const allDay: UnifiedItem = {
    ...base,
    id: "e1",
    type: "EVENT",
    title: "워크숍",
    date: new Date("2026-10-25T15:00:00.000Z"),
    endDate: new Date("2026-10-28T15:00:00.000Z"),
    metadata: { allDay: true, allDayStartDate: "2026-10-26", allDayEndDate: "2026-10-29" },
  };
  const overnight: UnifiedItem = {
    ...base,
    id: "e2",
    type: "EVENT",
    title: "밤샘 공연",
    date: new Date("2026-10-30T13:00:00.000Z"),
    endDate: new Date("2026-10-30T17:00:00.000Z"),
    metadata: {},
  };
  const groups = groupItemsBySpannedDay([allDay, overnight]);
  assert.deepEqual(groups.get("2026-10-26")?.map((item) => item.id), ["e1"]);
  assert.deepEqual(groups.get("2026-10-27")?.map((item) => item.id), ["e1"]);
  assert.deepEqual(groups.get("2026-10-28")?.map((item) => item.id), ["e1"]);
  assert.equal(groups.get("2026-10-29"), undefined);
  // KST 22:00~다음 날 02:00 일정은 두 날에 모두 보인다.
  assert.deepEqual(groups.get("2026-10-30")?.map((item) => item.id), ["e2"]);
  assert.deepEqual(groups.get("2026-10-31")?.map((item) => item.id), ["e2"]);
});
