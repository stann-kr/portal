import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNotesLessonsTimelineHref,
  getCalendarTabs,
  matchesCalendarPreset,
  resolveCalendarTab,
} from "./calendar-section-contract";
import type { UnifiedItem } from "./utils/unifiedItemUtils";

function item(type: UnifiedItem["type"], subType?: string): UnifiedItem {
  return {
    id: `${type}-${subType ?? "none"}`,
    type,
    subType,
    title: "항목",
    date: new Date("2026-08-13T00:00:00.000Z"),
    metadata: {},
    space: { studentId: "student-1", label: "학생" },
    source: { kind: "PORTAL", entity: type === "NOTE" ? "PRIVATE_NOTE" : "CALENDAR_EVENT", label: "포털" },
  };
}

test("관리자 일정은 학생 전용 커리큘럼과 과제 탭을 제공하지 않는다", () => {
  assert.deepEqual(getCalendarTabs("admin").map((tab) => tab.value), ["calendar", "daily", "all"]);
  assert.deepEqual(getCalendarTabs("student").map((tab) => tab.value), [
    "calendar", "daily", "all", "curriculum", "assignments",
  ]);
  assert.equal(resolveCalendarTab("curriculum", "admin"), "calendar");
});

test("노트와 레슨 preset은 다른 일정 유형을 섞지 않는다", () => {
  assert.equal(matchesCalendarPreset(item("NOTE"), "notes-lessons"), true);
  assert.equal(matchesCalendarPreset(item("EVENT", "LESSON"), "notes-lessons"), true);
  assert.equal(matchesCalendarPreset(item("EVENT", "PRACTICE"), "notes-lessons"), false);
});

test("노트 시간축 링크는 역할별 canonical workspace를 가리킨다", () => {
  assert.equal(
    buildNotesLessonsTimelineHref({ role: "student" }),
    "/dashboard/student?section=workspace&view=calendar&preset=notes-lessons",
  );
  assert.equal(
    buildNotesLessonsTimelineHref({ role: "admin", studentId: "student-1" }),
    "/dashboard/admin?section=schedule&view=calendar&preset=notes-lessons&student=student-1",
  );
});
