import assert from "node:assert/strict";
import test from "node:test";
import { getLegacyCalendarRedirect, getLegacyCurriculumRedirect, STUDENT_LEGACY_REDIRECTS } from "./legacy-dashboard-routes";

test("legacy dashboard route는 정확한 canonical section과 view를 보존한다", () => {
  assert.equal(getLegacyCalendarRedirect("student"), "/dashboard/student?section=workspace&view=calendar");
  assert.equal(getLegacyCalendarRedirect("admin"), "/dashboard/admin?section=schedule&view=calendar");
  assert.match(STUDENT_LEGACY_REDIRECTS.curriculum, /view=curriculum/u);
  assert.match(STUDENT_LEGACY_REDIRECTS.assignments, /view=assignments/u);
});

test("커리큘럼을 숨기면 예전 커리큘럼 주소는 학생 캘린더로 간다", () => {
  assert.equal(getLegacyCurriculumRedirect(false), "/dashboard/student?section=workspace&view=calendar");
  assert.equal(getLegacyCurriculumRedirect(true), STUDENT_LEGACY_REDIRECTS.curriculum);
  assert.equal(getLegacyCurriculumRedirect(), "/dashboard/student?section=workspace&view=calendar");
});
