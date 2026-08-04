import assert from "node:assert/strict";
import test from "node:test";
import { toKstDateInputValue } from "./date-input";

test("KST 자정 이후에는 UTC 전날이 아니라 KST 당일을 반환한다", () => {
  assert.equal(toKstDateInputValue(new Date("2026-08-04T16:00:00.000Z")), "2026-08-05");
});

test("KST 자정 직전은 KST 전날로 반환한다", () => {
  assert.equal(toKstDateInputValue(new Date("2026-08-04T14:59:59.000Z")), "2026-08-04");
});
