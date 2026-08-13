import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminStudentDetailHref, resolveStudentDetailTab } from "./student-space-routes";

test("학생 상세 탭은 canonical allowlist로 닫힌다", () => {
  assert.equal(resolveStudentDetailTab("qna"), "qna");
  assert.equal(resolveStudentDetailTab("unknown"), "overview");
  assert.equal(buildAdminStudentDetailHref("student/1", "notes"), "/dashboard/admin/students/student%2F1?tab=notes");
});
