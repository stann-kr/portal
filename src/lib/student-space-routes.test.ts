import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdminStudentDetailHref,
  buildStudentDiggingBoardHref,
  resolveStudentDetailTab,
  STUDENT_DIGGING_TIMELINE_HREF,
} from "./student-space-routes";

test("학생 상세 탭은 canonical allowlist로 닫힌다", () => {
  assert.equal(resolveStudentDetailTab("qna"), "qna");
  assert.equal(resolveStudentDetailTab("unknown"), "overview");
  assert.equal(buildAdminStudentDetailHref("student/1", "notes"), "/dashboard/admin/students/student%2F1?tab=notes");
});

test("학생 디깅 보드는 호출 문맥을 보존하고 기본 복귀는 워크스페이스 디깅 필터다", () => {
  assert.match(STUDENT_DIGGING_TIMELINE_HREF, /section=workspace&view=all&type=DIGGING/u);
  assert.equal(
    buildStudentDiggingBoardHref("/dashboard/student?section=workspace&view=calendar"),
    "/dashboard/student/digging?returnTo=%2Fdashboard%2Fstudent%3Fsection%3Dworkspace%26view%3Dcalendar",
  );
});
