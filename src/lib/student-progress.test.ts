import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentModuleLabel } from "./student-progress";

test("모듈 0개와 하나 이상 모두 완료를 다른 상태로 표시한다", () => {
  assert.equal(getCurrentModuleLabel([]), "진도 미지정");
  assert.equal(getCurrentModuleLabel([
    { weekNum: 1, title: "기초", isCompleted: true },
  ]), "모든 과정 완료");
  assert.equal(getCurrentModuleLabel([
    { weekNum: 2, title: "믹싱", isCompleted: false },
    { weekNum: 1, title: "기초", isCompleted: false },
  ]), "WEEK 01 · 기초");
});
