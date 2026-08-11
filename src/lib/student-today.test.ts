import assert from "node:assert/strict";
import test from "node:test";
import {
  getStudentTodaySummary,
  type StudentTodaySummary,
} from "./student-today";
import type { UnifiedItem } from "./utils/unifiedItemUtils";

function item(
  id: string,
  type: UnifiedItem["type"],
  date: string,
  options: {
    subType?: string;
    feedbackCount?: number;
  } = {},
): UnifiedItem {
  return {
    id,
    type,
    subType: options.subType,
    title: id,
    date: new Date(date),
    metadata:
      options.feedbackCount === undefined
        ? {}
        : { feedbackCount: options.feedbackCount },
    space: { studentId: "student-1", label: "학생" },
    source: {
      kind: "PORTAL",
      entity: type === "EVENT" ? "CALENDAR_EVENT" : type === "NOTE" ? "PRIVATE_NOTE" : type === "DIGGING" ? "DIGGING_TRACK" : type === "QNA" ? "QNA_THREAD" : "ASSIGNMENT",
      label: "포털",
    },
  };
}

const NOW = new Date("2026-08-05T00:00:00.000Z");

function summary(items: UnifiedItem[]): StudentTodaySummary {
  return getStudentTodaySummary(items, NOW);
}

test("지난 일정을 제외하고 가장 가까운 레슨을 다음 cue로 선택한다", () => {
  const result = summary([
    item("past", "EVENT", "2026-08-04T23:59:00.000Z", { subType: "LESSON" }),
    item("practice", "EVENT", "2026-08-05T01:00:00.000Z", { subType: "PRACTICE" }),
    item("lesson", "EVENT", "2026-08-05T02:00:00.000Z", { subType: "LESSON" }),
  ]);

  assert.equal(result.nextCue?.id, "lesson");
});

test("lessons 테이블에서 정규화된 레슨도 다음 cue로 선택한다", () => {
  const lesson = item("lesson-row", "EVENT", "2026-08-05T01:00:00.000Z", { subType: "LESSON" });
  lesson.source.entity = "LESSON";

  const result = summary([
    item("practice", "EVENT", "2026-08-05T00:30:00.000Z", { subType: "PRACTICE" }),
    lesson,
  ]);

  assert.equal(result.nextCue?.id, "lesson-row");
  assert.equal(result.nextCue?.source.entity, "LESSON");
});

test("예정된 레슨이 없으면 가장 가까운 일정을 사용한다", () => {
  const result = summary([
    item("later", "EVENT", "2026-08-06T00:00:00.000Z", { subType: "GIG" }),
    item("next", "EVENT", "2026-08-05T04:00:00.000Z", { subType: "PRACTICE" }),
  ]);

  assert.equal(result.nextCue?.id, "next");
});

test("과제를 피드백 있음과 가장 최근 피드백 대기로 구분한다", () => {
  const result = summary([
    item("ready-old", "ASSIGNMENT", "2026-08-01T00:00:00.000Z", { feedbackCount: 2 }),
    item("waiting-old", "ASSIGNMENT", "2026-08-02T00:00:00.000Z", { feedbackCount: 0 }),
    item("waiting-new", "ASSIGNMENT", "2026-08-04T00:00:00.000Z"),
    item("ready-new", "ASSIGNMENT", "2026-08-03T00:00:00.000Z", { feedbackCount: 1 }),
  ]);

  assert.deepEqual(result.feedbackItems.map((entry) => entry.id), [
    "ready-new",
    "ready-old",
  ]);
  assert.equal(result.waitingAssignment?.id, "waiting-new");
});

test("Q&A를 답변 완료와 답변 대기로 분리하고 종료 항목을 제외한다", () => {
  const result = summary([
    item("open", "QNA", "2026-08-04T00:00:00.000Z", { subType: "OPEN" }),
    item("answered", "QNA", "2026-08-03T00:00:00.000Z", { subType: "ANSWERED" }),
    item("closed", "QNA", "2026-08-05T00:00:00.000Z", { subType: "CLOSED" }),
  ]);

  assert.deepEqual(result.answeredQnaItems.map((entry) => entry.id), ["answered"]);
  assert.deepEqual(result.openQnaItems.map((entry) => entry.id), ["open"]);
});
