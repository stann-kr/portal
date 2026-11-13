import assert from "node:assert/strict";
import test from "node:test";
import { createOncePerOwner } from "./once-per-owner";

test("계정마다 한 번만 실행하고, 계정이 바뀌면 다시 실행한다", () => {
  const firstFor = createOncePerOwner();
  assert.equal(firstFor("student-1"), true);
  assert.equal(firstFor("student-1"), false, "계정 메뉴가 두 곳에 있어도 한 번만");
  assert.equal(firstFor("student-2"), true, "앱 안에서 계정을 바꾸면 새 계정 기준으로 다시 맞춘다");
  assert.equal(firstFor("student-2"), false);
  assert.equal(firstFor("student-1"), true, "원래 계정으로 돌아와도 다시 맞춘다");
});
