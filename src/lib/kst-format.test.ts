import assert from "node:assert/strict";
import test from "node:test";
import { formatKst, formatKstDot, formatKstMonthDay, formatKstMonthDayTime, formatKstShortDate, formatRecordTime } from "./kst-format";

test("UTC로 실행되는 서버에서도 KST 날짜와 시각으로 표시한다", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const lateEveningUtc = new Date("2026-10-08T15:30:00.000Z");
    assert.equal(formatKst(lateEveningUtc, { year: "numeric", month: "numeric", day: "numeric" }), "2026. 10. 9.");
    assert.match(formatKst(lateEveningUtc), /2026\. 10\. 9\. 오전 12:30/u);
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("값이 없거나 잘못되면 fallback을 표시한다", () => {
  assert.equal(formatKst(null, undefined, "날짜 정보 없음"), "날짜 정보 없음");
  assert.equal(formatKst("not-a-date", undefined, "작성일 미정"), "작성일 미정");
  assert.equal(formatKst(undefined), "");
});

test("짧은 날짜는 KST 기준 다른 해의 기록에만 연도를 붙인다", () => {
  const reference = new Date("2026-10-09T00:00:00.000Z");
  assert.equal(formatKstShortDate(new Date("2026-03-02T03:00:00.000Z"), "", reference), "3월 2일");
  assert.equal(formatKstShortDate(new Date("2025-12-31T16:00:00.000Z"), "", reference), "1월 1일");
  assert.equal(formatKstShortDate(new Date("2025-12-31T14:00:00.000Z"), "", reference), "2025년 12월 31일");
  assert.equal(formatKstShortDate(null, "날짜 정보 없음", reference), "날짜 정보 없음");
});

test("목록 점 날짜·이력 시각은 KST로 표시하고 다른 해에는 연도를 붙인다", () => {
  // 2026-10-26 18:40 KST
  const now = Date.UTC(2026, 9, 26, 9, 40);
  assert.equal(formatKstDot(new Date(now), { weekday: true, time: true, referenceTime: new Date(now) }), "10.26 (월) 18:40");
  assert.equal(formatKstDot(Date.UTC(2025, 0, 2, 0, 5), { referenceTime: new Date(now) }), "2025.01.02");
  assert.equal(formatKstMonthDay(now), "10.26");
  assert.equal(formatKstMonthDay(null, "날짜 미정"), "날짜 미정");
  assert.equal(formatKstMonthDayTime(now), "10.26 18:40");
  assert.equal(formatRecordTime(new Date(now), now), "10.26 18:40");
  assert.equal(formatRecordTime(Date.UTC(2025, 0, 2, 0, 5), now), "2025.01.02 09:05");
  assert.equal(formatRecordTime(null, now), "시각 없음");
});
