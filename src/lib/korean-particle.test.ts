import assert from "node:assert/strict";
import test from "node:test";
import { withObjectParticle } from "./korean-particle";

test("이름 뒤 목적격 조사는 받침에 따라 을/를, 한글로 끝나지 않으면 을(를)", () => {
  assert.equal(withObjectParticle("정학생"), "정학생을");
  assert.equal(withObjectParticle("김민지"), "김민지를");
  assert.equal(withObjectParticle("student@example.com"), "student@example.com을(를)");
  assert.equal(withObjectParticle(""), "");
});
