import assert from "node:assert/strict";
import test from "node:test";
import { buildQnaFilterHref, buildQnaListHref, resolveQnaFilter } from "./qna-routes";

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

test("Q&A 상태 필터 URL은 상세 복귀와 관리자 학생 탭·상위 문맥을 보존한다", () => {
  const parent = "/dashboard/student?section=today";
  const filtered = new URL(buildQnaListHref(parent, "ANSWERED"), "https://portal.test");
  assert.equal(filtered.searchParams.get("returnTo"), parent);
  assert.equal(resolveQnaFilter(filtered.searchParams.get("qnaStatus")), "ANSWERED");
  const admin = new URL(buildQnaFilterHref("/dashboard/admin/students/student-1?tab=qna#records", "CLOSED"), "https://portal.test");
  assert.equal(admin.pathname, "/dashboard/admin/students/student-1");
  assert.equal(admin.searchParams.get("tab"), "qna");
  assert.equal(admin.hash, "#records");
  const reset = new URL(buildQnaFilterHref(`${admin.pathname}${admin.search}${admin.hash}`, "ALL"), "https://portal.test");
  assert.equal(reset.searchParams.has("qnaStatus"), false);
  assert.equal(reset.searchParams.get("tab"), "qna");
  assert.equal(resolveQnaFilter(["OPEN", "CLOSED"]), "ALL");
  assert.equal(resolveQnaFilter("invalid"), "ALL");
});
