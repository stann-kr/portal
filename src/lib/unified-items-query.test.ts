import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_STUDENTS_ITEMS_LIMIT,
  getAllStudentsItemsWindow,
  isWindowCovered,
  resolveAllStudentsItemsQuery,
  resolveUnifiedItemsQuery,
  selectUnifiedItemsWithinQuery,
  UNIFIED_ITEMS_DEFAULT_LIMIT,
  UNIFIED_ITEMS_MAX_LIMIT,
} from "./unified-items-query";
import type { UnifiedItem, UnifiedItemType } from "./utils/unifiedItemUtils";

function item(id: string, type: UnifiedItemType, date: string): UnifiedItem {
  return {
    id,
    type,
    title: id,
    date: new Date(date),
    metadata: {},
    space: { studentId: "student-1", label: "학생" },
    source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포탈" },
  };
}

test("기본 일정 조회는 2년 window와 bounded 결과 budget을 만든다", () => {
  const query = resolveUnifiedItemsQuery(undefined, new Date("2026-08-13T12:34:56.000Z"));
  assert.equal(query.start.toISOString(), "2025-08-13T00:00:00.000Z");
  assert.equal(query.end.toISOString(), "2027-08-13T23:59:59.999Z");
  assert.equal(query.limit, UNIFIED_ITEMS_DEFAULT_LIMIT);
  assert.ok(query.perSourceLimit < query.limit);
});

test("명시 기간·type·limit을 검증하고 date-only end를 날짜 끝으로 해석한다", () => {
  const query = resolveUnifiedItemsQuery({
    start: "2026-08-01",
    end: "2026-08-31",
    types: ["NOTE", "NOTE", "QNA"],
    limit: 20,
  });
  assert.equal(query.start.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(query.end.toISOString(), "2026-08-31T23:59:59.999Z");
  assert.deepEqual(query.types, ["NOTE", "QNA"]);
  assert.equal(query.limit, 20);
});

test("잘못된 기간, 과대 기간과 결과 budget은 fail closed 한다", () => {
  assert.throws(() => resolveUnifiedItemsQuery({ start: "2026-01-01" }));
  assert.throws(() => resolveUnifiedItemsQuery({ start: "2026-02-01", end: "2026-01-01" }));
  assert.throws(() => resolveUnifiedItemsQuery({ start: "2020-01-01", end: "2026-01-01" }));
  assert.throws(() => resolveUnifiedItemsQuery({ limit: UNIFIED_ITEMS_MAX_LIMIT + 1 }));
  assert.throws(() => resolveUnifiedItemsQuery({
    types: ["UNKNOWN" as UnifiedItemType],
  }));
});

test("최종 결과도 기간·type·개수 계약을 다시 적용한다", () => {
  const query = resolveUnifiedItemsQuery({
    start: "2026-08-01",
    end: "2026-08-31",
    types: ["EVENT"],
    limit: 1,
  });
  const selected = selectUnifiedItemsWithinQuery([
    item("old", "EVENT", "2026-07-31T23:59:59.000Z"),
    item("note", "NOTE", "2026-08-20T00:00:00.000Z"),
    item("first", "EVENT", "2026-08-10T00:00:00.000Z"),
    item("latest", "EVENT", "2026-08-11T00:00:00.000Z"),
  ], query);
  assert.deepEqual(selected.map((entry) => entry.id), ["latest"]);
});

test("전체 학생 일정은 보이는 달 앞뒤(KST 앞 달 1일 ~ 두 달 뒤 말일)만 읽고 기간을 124일로 묶는다", () => {
  // 2026-11-30 23:30 KST(= 14:30Z)는 KST로 11월이다.
  const window = getAllStudentsItemsWindow(new Date("2026-11-30T14:30:00.000Z"));
  assert.equal(window.start.toISOString(), "2026-09-30T15:00:00.000Z", "10월 1일 00:00 KST");
  assert.equal(window.end.toISOString(), "2027-01-31T14:59:59.999Z", "1월 31일 23:59:59.999 KST");
  // UTC로는 11월 30일이지만 KST로 12월 1일이면 12월 기준이다.
  assert.equal(getAllStudentsItemsWindow(new Date("2026-11-30T15:30:00.000Z")).start.toISOString(), "2026-10-31T15:00:00.000Z");
  assert.ok(isWindowCovered([window], new Date("2026-11-01T00:00:00.000Z"), new Date("2026-12-15T00:00:00.000Z")));
  assert.ok(!isWindowCovered([window], new Date("2027-01-25T00:00:00.000Z"), new Date("2027-02-07T00:00:00.000Z")));

  const query = resolveAllStudentsItemsQuery(undefined, new Date("2026-11-09T00:00:00.000Z"));
  assert.equal(query.start.toISOString(), "2026-09-30T15:00:00.000Z");
  assert.equal(query.limit, ALL_STUDENTS_ITEMS_LIMIT);
  assert.deepEqual([...query.types].sort(), ["ASSIGNMENT", "DIGGING", "EVENT", "NOTE", "QNA"]);
  assert.throws(() => resolveAllStudentsItemsQuery({ start: "2026-01-01", end: "2026-12-31" }), RangeError);
  assert.throws(() => resolveAllStudentsItemsQuery({ start: "2026-01-01" }), TypeError);
});
