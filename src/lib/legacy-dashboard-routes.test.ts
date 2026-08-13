import assert from "node:assert/strict";
import test from "node:test";
import { getLegacyCalendarRedirect, STUDENT_LEGACY_REDIRECTS } from "./legacy-dashboard-routes";

test("legacy dashboard route는 정확한 canonical section과 view를 보존한다", () => {
  assert.equal(getLegacyCalendarRedirect("student"), "/dashboard/student?section=workspace&view=calendar");
  assert.equal(getLegacyCalendarRedirect("admin"), "/dashboard/admin?section=schedule&view=calendar");
  assert.match(STUDENT_LEGACY_REDIRECTS.curriculum, /view=curriculum/u);
  assert.match(STUDENT_LEGACY_REDIRECTS.assignments, /view=assignments/u);
  assert.match(STUDENT_LEGACY_REDIRECTS.digging, /view=all&type=DIGGING/u);
});
