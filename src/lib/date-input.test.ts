import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarSelectionToKstDateKey,
  calendarSelectionToKstDateTimeInput,
  nextFullHour,
  parseKstDateTimeInput,
  toKstDateInputValue,
  toKstDateTimeInputValue,
} from "./date-input";

test("KST 자정 이후에는 UTC 전날이 아니라 KST 당일을 반환한다", () => {
  assert.equal(toKstDateInputValue(new Date("2026-08-04T16:00:00.000Z")), "2026-08-05");
});

test("KST 자정 직전은 KST 전날로 반환한다", () => {
  assert.equal(toKstDateInputValue(new Date("2026-08-04T14:59:59.000Z")), "2026-08-04");
});

test("datetime-local은 실행 환경이 아니라 KST wall time으로 해석한다", () => {
  const parsed = parseKstDateTimeInput("2026-08-13T00:30");
  assert.equal(parsed?.toISOString(), "2026-08-12T15:30:00.000Z");
  assert.equal(toKstDateTimeInputValue(parsed!), "2026-08-13T00:30");
  assert.equal(parseKstDateTimeInput("2026-02-29T09:00"), null);
});

test("캘린더 날짜와 시간 선택을 KST 입력값으로 정규화한다", () => {
  assert.equal(calendarSelectionToKstDateKey("2026-08-13"), "2026-08-13");
  assert.equal(calendarSelectionToKstDateTimeInput("2026-08-13"), "2026-08-13T09:00");
  assert.equal(
    calendarSelectionToKstDateKey("2026-08-13T00:30:00+09:00"),
    "2026-08-13",
  );
  assert.equal(
    calendarSelectionToKstDateTimeInput("2026-08-13T00:30:00+09:00"),
    "2026-08-13T00:30",
  );
});

test("레슨·일정 기본 시작 시각은 지금 이후 첫 정시이고 정각이면 다음 정시다", () => {
  assert.equal(toKstDateTimeInputValue(nextFullHour(Date.parse("2026-10-27T01:28:17.000Z"))), "2026-10-27T11:00");
  assert.equal(toKstDateTimeInputValue(nextFullHour(Date.parse("2026-10-27T02:00:00.000Z"))), "2026-10-27T12:00");
  assert.equal(toKstDateTimeInputValue(nextFullHour(Date.parse("2026-10-27T14:59:59.999Z"))), "2026-10-28T00:00");
});
