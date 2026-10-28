import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireAccountLogoutLock,
  createAccountLogoutLockStorageKey,
  isAccountOwnerLogoutLocked,
  releaseAccountLogoutLock,
} from "./account-logout-lock";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("로그아웃 잠금은 owner 원문 없이 기록되고 만료되면 풀린다", () => {
  const storage = new MemoryStorage();
  const handle = acquireAccountLogoutLock(storage, "student-1", { now: 1_000, ttlMs: 500 });
  assert.ok(handle);
  assert.equal(handle.storageKey, createAccountLogoutLockStorageKey("student-1"));
  assert.equal(handle.storageKey.includes("student-1"), false);
  assert.equal(isAccountOwnerLogoutLocked(storage, "student-1", 1_499), true);
  assert.equal(isAccountOwnerLogoutLocked(storage, "student-1", 1_500), false);
  assert.equal(isAccountOwnerLogoutLocked(storage, "student-2", 1_000), false);

  storage.setItem(handle.storageKey, "not json");
  assert.equal(isAccountOwnerLogoutLocked(storage, "student-1", 1_000), false);
});

test("실패 후 해제는 내가 건 잠금만 지운다", () => {
  const storage = new MemoryStorage();
  const mine = acquireAccountLogoutLock(storage, "student-1", { now: 1_000 });
  releaseAccountLogoutLock(storage, "student-1", mine);
  assert.equal(isAccountOwnerLogoutLocked(storage, "student-1", 1_000), false);

  const first = acquireAccountLogoutLock(storage, "student-1", { now: 1_000 });
  // 다른 탭이 그사이 새 잠금을 걸었다.
  const second = acquireAccountLogoutLock(storage, "student-1", { now: 2_000 });
  releaseAccountLogoutLock(storage, "student-1", first);
  assert.equal(storage.getItem(createAccountLogoutLockStorageKey("student-1")), second?.raw);
});

test("저장소를 쓸 수 없으면 잠금 없이 계속한다", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => undefined,
  };
  assert.equal(acquireAccountLogoutLock(storage, "student-1"), null);
  assert.doesNotThrow(() => releaseAccountLogoutLock(storage, "student-1", null));
});
