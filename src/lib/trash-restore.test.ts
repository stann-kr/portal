import assert from "node:assert/strict";
import test from "node:test";
import { withRestoreLock } from "./trash-restore";

const trashedAt = new Date("2026-11-12T00:30:00Z");

test("휴지통 복원 잠금은 서버 복원 규칙과 같고 지운 사람 id를 내보내지 않는다", () => {
  const student = { id: "student-1", isAdmin: false };
  const byAdmin = withRestoreLock({ id: "p1", deletedAt: trashedAt, deletedById: "admin-1" }, student);
  assert.deepEqual(byAdmin, { id: "p1", deletedAt: trashedAt, restoreLocked: true });
  assert.equal("deletedById" in byAdmin, false);

  assert.equal(withRestoreLock({ deletedAt: trashedAt, deletedById: "student-1" }, student).restoreLocked, false, "자기가 지운 글은 되살린다.");
  assert.equal(withRestoreLock({ deletedAt: trashedAt, deletedById: null }, student).restoreLocked, true, "지운 사람을 모르면 학생은 되살리지 못한다(서버도 거부).");
  assert.equal(withRestoreLock({ deletedAt: trashedAt, deletedById: "admin-1" }, { id: "admin-2", isAdmin: true }).restoreLocked, false, "관리자는 모두 되살린다.");
  assert.equal(withRestoreLock({ deletedAt: null, deletedById: null }, student).restoreLocked, false, "휴지통에 없으면 잠금이 아니다.");
});
