import assert from "node:assert/strict";
import test from "node:test";
import { missingWhenAccessDenied } from "./access-denied-as-missing";

test("권한 거부는 없는 문서(null)로 바꾸고, 값과 다른 오류는 그대로 둔다", async () => {
  assert.equal(await missingWhenAccessDenied(Promise.resolve("문서")), "문서");
  assert.equal(await missingWhenAccessDenied(Promise.resolve(null)), null);
  assert.equal(await missingWhenAccessDenied(Promise.reject(new Error("Unauthorized"))), null);
  assert.equal(await missingWhenAccessDenied(Promise.reject(new Error("Student not found"))), null);
  await assert.rejects(missingWhenAccessDenied(Promise.reject(new Error("D1_ERROR: no such table"))), /D1_ERROR/u);
  await assert.rejects(missingWhenAccessDenied(Promise.reject("Unauthorized")), (error) => error === "Unauthorized");
});
