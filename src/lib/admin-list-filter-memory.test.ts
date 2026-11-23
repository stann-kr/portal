import assert from "node:assert/strict";
import test from "node:test";
import { resolveRememberedStudent, serializeAdminListFilterCookie } from "./admin-list-filter-memory";

test("주소에 학생 값이 없을 때만 기억한 학생으로 열고, 주소 값(빈 값 포함)이 있으면 그것을 따른다", () => {
  assert.equal(resolveRememberedStudent(undefined, "qa-s1"), "qa-s1");
  assert.equal(resolveRememberedStudent(null, "qa-s1"), "qa-s1");
  assert.equal(resolveRememberedStudent("qa-s2", "qa-s1"), "qa-s2");
  assert.equal(resolveRememberedStudent("", "qa-s1"), null);
  assert.equal(resolveRememberedStudent(undefined, ""), null);
  assert.equal(resolveRememberedStudent(undefined, "bad id;"), null);
});

test("cookie는 학생 id만 담고 이상한 값은 빈 값(전체 학생)으로 쓴다", () => {
  assert.equal(serializeAdminListFilterCookie("notes", "qa-s1", true), "portal-admin-notes-student=qa-s1; Path=/; Max-Age=15552000; SameSite=Lax; Secure");
  assert.match(serializeAdminListFilterCookie("assignments", "a=b", false), /^portal-admin-assignments-student=; Path=\//u);
});
