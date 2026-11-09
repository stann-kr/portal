import assert from "node:assert/strict";
import test from "node:test";
import { ALL_STUDENTS_SCOPE, resolveAdminScheduleStudent } from "./admin-schedule-scope";

test("관리자 일정 학생 선택은 있는 학생 딥링크를 지키고 그 밖에는 전체 학생으로 연다", () => {
  const ids = ["student-1", "student-2"];
  assert.equal(resolveAdminScheduleStudent("student-2", ids), "student-2");
  assert.equal(resolveAdminScheduleStudent(ALL_STUDENTS_SCOPE, ids), ALL_STUDENTS_SCOPE);
  assert.equal(resolveAdminScheduleStudent(null, ids), ALL_STUDENTS_SCOPE, "기본은 전체 학생");
  assert.equal(resolveAdminScheduleStudent("removed-student", ids), ALL_STUDENTS_SCOPE, "지워진 학생 딥링크는 전체 학생으로");
  assert.equal(resolveAdminScheduleStudent("all", []), "", "학생이 없으면 빈 선택");
});
