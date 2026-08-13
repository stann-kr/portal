import assert from "node:assert/strict";
import test from "node:test";
import { buildQnaListHref } from "./qna-routes";

test("Q&A 목록 returnTo는 내부 경로만 보존한다", () => {
  assert.equal(
    buildQnaListHref("/dashboard/student?section=today"),
    "/dashboard/qna?returnTo=%2Fdashboard%2Fstudent%3Fsection%3Dtoday",
  );
  assert.equal(
    buildQnaListHref("https://outside.example"),
    "/dashboard/qna?returnTo=%2Fdashboard%2Fstudent%3Fsection%3Dtoday",
  );
});
