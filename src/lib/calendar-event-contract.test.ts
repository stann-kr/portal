import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH,
  CALENDAR_EVENT_MAX_DURATION_MS,
  CALENDAR_EVENT_TITLE_MAX_LENGTH,
  parseCalendarEventCreateInput,
  parseCalendarEventUpdateInput,
  type CalendarEventValues,
} from "./calendar-event-contract";

const current: CalendarEventValues = {
  title: "연습",
  eventType: "PRACTICE",
  startTime: new Date("2026-08-13T01:00:00.000Z"),
  endTime: new Date("2026-08-13T02:00:00.000Z"),
  description: null,
};

test("일정 생성 입력을 trim하고 허용된 값으로 정규화한다", () => {
  const result = parseCalendarEventCreateInput({
    title: "  믹싱 연습  ",
    eventType: "PRACTICE",
    startTime: "2026-08-13T10:00:00+09:00",
    endTime: "2026-08-13T11:00:00+09:00",
    description: "  전환 연습  ",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.title, "믹싱 연습");
  assert.equal(result.value.description, "전환 연습");
  assert.equal(result.value.startTime.toISOString(), "2026-08-13T01:00:00.000Z");
});

test("일정의 type, 길이, 시각 순서와 문자열 상한을 거부한다", () => {
  const cases = [
    { ...current, eventType: "ADMIN" },
    { ...current, title: "x".repeat(CALENDAR_EVENT_TITLE_MAX_LENGTH + 1) },
    { ...current, description: "x".repeat(CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH + 1) },
    { ...current, endTime: current.startTime },
    {
      ...current,
      endTime: new Date(current.startTime.getTime() + CALENDAR_EVENT_MAX_DURATION_MS + 1),
    },
  ];
  for (const input of cases) {
    assert.equal(parseCalendarEventCreateInput(input).ok, false);
  }
});

test("일정 patch는 알려진 필드만 허용하고 기존 값과 합친 시간 범위를 검증한다", () => {
  assert.equal(
    parseCalendarEventUpdateInput({ userId: "admin-1" }, current).ok,
    false,
  );
  assert.equal(
    parseCalendarEventUpdateInput(
      { startTime: new Date("2026-08-13T03:00:00.000Z") },
      current,
    ).ok,
    false,
  );
  const valid = parseCalendarEventUpdateInput(
    { startTime: new Date("2026-08-13T00:30:00.000Z"), description: " 이동 " },
    current,
  );
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.value.description, "이동");
});
