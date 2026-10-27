import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveAssignmentTaskId,
  describeRecurrenceSchedule,
  enumerateOccurrenceDates,
  kstDueAt,
  kstTodayKey,
  planRecurrenceOccurrences,
  validateRecurrenceSchedule,
  weekdayListFromMask,
  weekdayMaskFromList,
  type AssignmentRecurrenceSchedule,
} from "./assignment-recurrence";

const MON = 1;
const WED = 3;
const FRI = 5;

function schedule(overrides: Partial<AssignmentRecurrenceSchedule> = {}): AssignmentRecurrenceSchedule {
  return {
    // 2026-10-28은 수요일이다.
    startDate: "2026-10-28",
    intervalWeeks: 1,
    weekdays: weekdayMaskFromList([MON, FRI]),
    dueTime: "21:00",
    endDate: null,
    maxOccurrences: null,
    ...overrides,
  };
}

test("시작일이 든 주부터 선택 요일만 고르고 시작일 앞 요일은 건너뛴다", () => {
  assert.deepEqual(enumerateOccurrenceDates(schedule(), "2026-11-09"), [
    "2026-10-30",
    "2026-11-02",
    "2026-11-06",
    "2026-11-09",
  ]);
});

test("격주는 시작일이 든 주(일요일 시작)를 0주차로 센다", () => {
  const dates = enumerateOccurrenceDates(schedule({ intervalWeeks: 2, weekdays: weekdayMaskFromList([0, WED]) }), "2026-11-30");
  // 0주차(10.25~10.31): 일요일 10.25는 시작일 앞이라 빠지고 수 10.28. 2주차: 11.08, 11.11. 4주차: 11.22, 11.25.
  assert.deepEqual(dates, ["2026-10-28", "2026-11-08", "2026-11-11", "2026-11-22", "2026-11-25"]);
});

test("종료일은 포함하고 횟수는 첫 실제 회차부터 센다", () => {
  assert.deepEqual(enumerateOccurrenceDates(schedule({ endDate: "2026-11-06" }), "2027-01-01"), [
    "2026-10-30",
    "2026-11-02",
    "2026-11-06",
  ]);
  assert.deepEqual(enumerateOccurrenceDates(schedule({ maxOccurrences: 2 }), "2027-01-01"), ["2026-10-30", "2026-11-02"]);
  assert.deepEqual(enumerateOccurrenceDates(schedule({ maxOccurrences: 2 }), "2027-01-01", 5), ["2026-10-30", "2026-11-02"]);
});

test("마감 시각은 회차 날짜의 KST 시각이다", () => {
  assert.equal(kstDueAt("2026-10-30", "21:00").toISOString(), "2026-10-30T12:00:00.000Z");
  assert.equal(kstDueAt("2026-10-30", "08:30").toISOString(), "2026-10-29T23:30:00.000Z");
  assert.equal(kstTodayKey(new Date("2026-10-29T15:00:00.000Z")), "2026-10-30");
  assert.equal(kstTodayKey(new Date("2026-10-29T14:59:59.000Z")), "2026-10-29");
});

test("생성 계획은 오늘(KST)까지의 회차와 다음 회차 하나만 고른다", () => {
  // KST 2026-11-02(월) 09:00. 오늘 회차는 아직 마감 전이어도 포함, 다음 회차는 11.06 하나.
  const now = new Date("2026-11-02T00:00:00.000Z");
  const planned = planRecurrenceOccurrences(schedule(), { now });
  assert.deepEqual(planned.map((item) => item.occurrenceDate), ["2026-10-30", "2026-11-02", "2026-11-06"]);
  assert.equal(planned[1]!.dueAt.toISOString(), "2026-11-02T12:00:00.000Z");
  // 시작일 전이면 첫 회차 하나만.
  assert.deepEqual(
    planRecurrenceOccurrences(schedule(), { now: new Date("2026-10-01T00:00:00.000Z") }).map((item) => item.occurrenceDate),
    ["2026-10-30"],
  );
  // 끝난 규칙은 다음 회차가 없다.
  assert.deepEqual(
    planRecurrenceOccurrences(schedule({ maxOccurrences: 1 }), { now }).map((item) => item.occurrenceDate),
    ["2026-10-30"],
  );
});

test("floor 전에 마감된 회차는 만들지 않고, 오래된 시작일은 최근 cap개만 남긴다", () => {
  const now = new Date("2026-11-02T00:00:00.000Z");
  const floor = new Date("2026-10-31T00:00:00.000Z");
  assert.deepEqual(
    planRecurrenceOccurrences(schedule(), { now, floor }).map((item) => item.occurrenceDate),
    ["2026-11-02", "2026-11-06"],
  );
  const daily = schedule({ startDate: "2020-01-01", weekdays: 127 });
  const planned = planRecurrenceOccurrences(daily, { now, cap: 60 });
  assert.equal(planned.length, 60);
  assert.equal(planned.at(-1)!.occurrenceDate, "2026-11-03");
  assert.equal(planned[0]!.occurrenceDate, "2026-09-05");
});

test("회차 id는 규칙·날짜에서 결정적으로 만들어지고 서로 다르다", () => {
  const a = deriveAssignmentTaskId("rule-1", "2026-10-30");
  assert.equal(a, deriveAssignmentTaskId("rule-1", "2026-10-30"));
  assert.notEqual(a, deriveAssignmentTaskId("rule-1", "2026-11-02"));
  assert.notEqual(a, deriveAssignmentTaskId("rule-2", "2026-10-30"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.throws(() => deriveAssignmentTaskId("rule-1", "2026-02-30"));
});

test("규칙 검증은 DB CHECK 범위를 따르고 요약은 월요일부터 읽힌다", () => {
  assert.equal(validateRecurrenceSchedule({ ...schedule(), weekdays: 0 }).ok, false);
  assert.equal(validateRecurrenceSchedule({ ...schedule(), intervalWeeks: 13 }).ok, false);
  assert.equal(validateRecurrenceSchedule({ ...schedule(), dueTime: "24:00" }).ok, false);
  assert.equal(validateRecurrenceSchedule({ ...schedule(), endDate: "2026-10-27" }).ok, false);
  assert.equal(validateRecurrenceSchedule({ ...schedule(), maxOccurrences: 521 }).ok, false);
  assert.equal(validateRecurrenceSchedule({ ...schedule(), startDate: "2026-02-30" }).ok, false);
  assert.equal(validateRecurrenceSchedule({ ...schedule(), endDate: "" }).ok, true);
  assert.deepEqual(weekdayListFromMask(weekdayMaskFromList([0, 6, 3])), [0, 3, 6]);
  assert.equal(
    describeRecurrenceSchedule(schedule({ weekdays: weekdayMaskFromList([0, MON]), maxOccurrences: 12 })),
    "매주 월·일 21:00 마감 · 10월 28일부터 · 12회",
  );
  assert.equal(
    describeRecurrenceSchedule(schedule({ intervalWeeks: 2, endDate: "2026-12-31" })),
    "2주마다 월·금 21:00 마감 · 10월 28일부터 · 12월 31일까지",
  );
});
