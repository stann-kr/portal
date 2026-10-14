import assert from "node:assert/strict";
import test from "node:test";
import { buildNoteCreateHref, resolveNoteCreateDefaultDate } from "./note-create-route";

test("노트 composer URL date는 실제 존재하는 YYYY-MM-DD만 유지한다", () => {
  const now = new Date("2026-08-04T16:00:00.000Z");
  assert.equal(resolveNoteCreateDefaultDate("2026-02-28", now), "2026-02-28");
  assert.equal(resolveNoteCreateDefaultDate("2024-02-29", now), "2024-02-29");
  assert.equal(resolveNoteCreateDefaultDate("2026-02-29", now), "2026-08-05");
  assert.equal(resolveNoteCreateDefaultDate("2026-8-5", now), "2026-08-05");
});

test("캘린더 노트 링크는 선택 날짜와 안전한 returnTo만 전달한다", () => {
  assert.equal(
    buildNoteCreateHref({
      pathname: "/dashboard/admin/students/student-1/notes/new",
      defaultDate: "2026-08-05",
      returnTo: "/dashboard/admin?section=schedule&student=student-1",
      returnFallback: "/dashboard/admin",
    }),
    "/dashboard/admin/students/student-1/notes/new?date=2026-08-05&returnTo=%2Fdashboard%2Fadmin%3Fsection%3Dschedule%26student%3Dstudent-1",
  );
  assert.equal(
    buildNoteCreateHref({
      pathname: "/dashboard/student/notes/new",
      defaultDate: "not-a-date",
      returnTo: "https://outside.example",
      returnFallback: "/dashboard/student",
    }),
    "/dashboard/student/notes/new?returnTo=%2Fdashboard%2Fstudent",
  );
});
