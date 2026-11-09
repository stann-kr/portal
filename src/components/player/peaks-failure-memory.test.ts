import assert from "node:assert/strict";
import test from "node:test";
import { hasRecentPeaksFailure, PEAKS_FAILURE_TTL_MS, rememberPeaksFailure } from "./peaks-failure-memory";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

test("파형 실패는 매체별로 7일 동안 기억하고 지나면 지운다", () => {
  const storage = memoryStorage();
  const now = 1_800_000_000_000;
  assert.equal(hasRecentPeaksFailure("m1", now, storage), false);
  rememberPeaksFailure("m1", now, storage);
  assert.equal(hasRecentPeaksFailure("m1", now + 1000, storage), true);
  assert.equal(hasRecentPeaksFailure("m2", now + 1000, storage), false, "다른 매체는 따로");
  assert.equal(hasRecentPeaksFailure("m1", now + PEAKS_FAILURE_TTL_MS - 1, storage), true);
  assert.equal(hasRecentPeaksFailure("m1", now + PEAKS_FAILURE_TTL_MS, storage), false);
  assert.equal(storage.map.size, 0, "기한이 지난 기록은 지운다");
});

test("깨진 값·미래 시각은 기억으로 보지 않고, 저장소가 막혀도 예외를 던지지 않는다", () => {
  const storage = memoryStorage();
  storage.map.set("portal:peaks-failed:m1", "not-a-number");
  assert.equal(hasRecentPeaksFailure("m1", 1000, storage), false);
  rememberPeaksFailure("m2", 5000, storage);
  assert.equal(hasRecentPeaksFailure("m2", 1000, storage), false, "시계가 거꾸로 가면 다시 해 본다");
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.doesNotThrow(() => rememberPeaksFailure("m1", 1000, throwing));
  assert.equal(hasRecentPeaksFailure("m1", 1000, throwing), false);
  assert.equal(hasRecentPeaksFailure("m1", 1000, null), false, "브라우저 밖");
});
