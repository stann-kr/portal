import assert from "node:assert/strict";
import test from "node:test";
import { formatKst, formatKstShortDate } from "./kst-format";

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
