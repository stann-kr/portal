import assert from "node:assert/strict";
import test from "node:test";
import { IDENTITY, MAX_SCALE, clampTransform, naturalScale, wrapIndex, zoomAround } from "./image-viewer-geometry";

test("확대한 점은 제자리에 머문다", () => {
  const zoomed = zoomAround(IDENTITY, 2, { x: 100, y: -40 });
  assert.deepEqual(zoomed, { scale: 2, x: -100, y: 40 });
});

test("이동은 넘친 만큼만, 확대율은 1~최대로 제한한다", () => {
  const fit = { width: 400, height: 300 };
  const stage = { width: 600, height: 400 };
  assert.deepEqual(clampTransform({ scale: 2, x: 500, y: -500 }, fit, stage), { scale: 2, x: 100, y: -100 });
  assert.deepEqual(clampTransform({ scale: 0.5, x: 30, y: 30 }, fit, stage), { scale: 1, x: 0, y: 0 });
  assert.equal(clampTransform({ scale: 10, x: 0, y: 0 }, fit, stage).scale, MAX_SCALE);
});

test("원래 크기 배율과 이미지 번호 순환", () => {
  assert.equal(naturalScale({ width: 1600, height: 900 }, { width: 800, height: 450 }), 2);
  assert.equal(naturalScale({ width: 300, height: 200 }, { width: 300, height: 200 }), 1);
  assert.equal(naturalScale({ width: 0, height: 0 }, { width: 0, height: 0 }), 1);
  assert.equal(wrapIndex(-1, 3), 2);
  assert.equal(wrapIndex(3, 3), 0);
});
