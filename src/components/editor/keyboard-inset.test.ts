import assert from "node:assert/strict";
import test from "node:test";
import { keyboardInsetPx } from "./keyboard-inset";

test("키보드 높이: 보이는 영역 아래로 가려진 높이, 주소 막대 정도의 작은 차이는 0", () => {
  assert.equal(keyboardInsetPx(844, { height: 844, offsetTop: 0 }), 0);
  assert.equal(keyboardInsetPx(844, { height: 790, offsetTop: 0 }), 0, "주소 막대 접힘(54px)은 키보드가 아니다");
  assert.equal(keyboardInsetPx(844, { height: 508, offsetTop: 0 }), 336);
  assert.equal(keyboardInsetPx(844, { height: 508, offsetTop: 120 }), 216, "화면이 위로 밀린 만큼 뺀다");
});
