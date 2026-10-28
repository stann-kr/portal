import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysToDayKey,
  describeAgendaKind,
  getStudentRecentNotes,
  getStudentTodayAgenda,
  getStudentTodaySummary,
  getStudentTodoEntries,
  getStudentUpcomingSchedule,
  kstDayKeyToDate,
  toKstDayKey,
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

// ─── 홈(오늘) 파생 데이터 ─────────────────────────────
// 기준 시각: 2026-08-05 09:00 KST (= 00:00Z). KST 오늘은 2026-08-05.

function withMetadata(entry: UnifiedItem, metadata: Record<string, unknown>, endDate?: string): UnifiedItem {
  return { ...entry, metadata: { ...entry.metadata, ...metadata }, endDate: endDate ? new Date(endDate) : entry.endDate };
}

test("KST 날짜 키는 UTC 날짜가 아니라 서울 달력 날짜를 따른다", () => {
  assert.equal(toKstDayKey(new Date("2026-08-04T15:00:00.000Z")), "2026-08-05");
  assert.equal(toKstDayKey(new Date("2026-08-04T14:59:59.000Z")), "2026-08-04");
  assert.equal(addDaysToDayKey("2026-08-31", 1), "2026-09-01");
  assert.equal(kstDayKeyToDate("2026-08-05").toISOString(), "2026-08-04T15:00:00.000Z");
});

test("오늘 일정은 종일 → 이어지는 일정 → 시간순 → 오늘 노트 순서이고 다른 날짜는 제외한다", () => {
  const external = withMetadata(
    item("all-day", "EVENT", "2026-08-04T15:00:00.000Z", { subType: "LESSON" }),
    { allDay: true, allDayStartDate: "2026-08-05", allDayEndDate: "2026-08-06" },
  );
  const continued = withMetadata(
    item("overnight", "EVENT", "2026-08-04T13:00:00.000Z", { subType: "GIG" }),
    {},
    "2026-08-05T01:00:00.000Z",
  );
  const result = getStudentTodayAgenda([
    item("note-today", "NOTE", "2026-08-04T15:00:00.000Z"),
    item("evening", "EVENT", "2026-08-05T10:00:00.000Z", { subType: "PRACTICE" }),
    item("earlier-today", "EVENT", "2026-08-04T16:00:00.000Z", { subType: "LESSON" }),
    item("tomorrow", "EVENT", "2026-08-05T15:00:00.000Z", { subType: "LESSON" }),
    item("yesterday", "EVENT", "2026-08-04T14:00:00.000Z", { subType: "LESSON" }),
    item("note-yesterday", "NOTE", "2026-08-04T14:00:00.000Z"),
    item("qna", "QNA", "2026-08-05T00:00:00.000Z", { subType: "OPEN" }),
    continued,
    external,
  ], NOW);

  assert.deepEqual(result.map((entry) => [entry.item.id, entry.kind, entry.continued]), [
    ["all-day", "allDay", false],
    ["overnight", "timed", true],
    ["earlier-today", "timed", false],
    ["evening", "timed", false],
    ["note-today", "note", false],
  ]);
});

test("여러 날에 걸친 종일 일정은 종료일(배타)을 넘지 않는다", () => {
  const multi = withMetadata(
    item("camp", "EVENT", "2026-08-02T15:00:00.000Z", { subType: "LESSON" }),
    { allDay: true, allDayStartDate: "2026-08-03", allDayEndDate: "2026-08-05" },
  );
  assert.deepEqual(getStudentTodayAgenda([multi], NOW), []);
  assert.equal(getStudentTodayAgenda([multi], new Date("2026-08-04T03:00:00.000Z"))[0]?.continued, true);
});

test("다가오는 일정은 내일부터 7일을 날짜별로 묶고 전체 행 수를 제한한다", () => {
  const result = getStudentUpcomingSchedule([
    item("today", "EVENT", "2026-08-05T10:00:00.000Z", { subType: "LESSON" }),
    item("d1-late", "EVENT", "2026-08-06T10:00:00.000Z", { subType: "PRACTICE" }),
    item("d1-early", "EVENT", "2026-08-05T23:00:00.000Z", { subType: "LESSON" }),
    item("d3", "EVENT", "2026-08-08T01:00:00.000Z", { subType: "GIG" }),
    item("d7", "EVENT", "2026-08-12T05:00:00.000Z", { subType: "LESSON" }),
    item("d8", "EVENT", "2026-08-12T15:00:00.000Z", { subType: "LESSON" }),
    item("note", "NOTE", "2026-08-06T00:00:00.000Z"),
  ], NOW, { limit: 3 });

  assert.equal(result.totalCount, 4);
  assert.equal(result.shownCount, 3);
  assert.deepEqual(
    result.groups.map((group) => [group.dayKey, group.offset, group.entries.map((entry) => entry.item.id)]),
    [
      ["2026-08-06", 1, ["d1-early", "d1-late"]],
      ["2026-08-08", 3, ["d3"]],
    ],
  );
});

test("최근 노트는 지난 노트를 최신순으로 먼저, 앞으로의 노트는 뒤에 두고 미리보기를 정리한다", () => {
  const withPreview = withMetadata(item("recent", "NOTE", "2026-08-04T00:00:00.000Z"), { preview: "  믹스 연습  " });
  const result = getStudentRecentNotes([
    item("old", "NOTE", "2026-07-01T00:00:00.000Z"),
    item("future-far", "NOTE", "2026-09-01T00:00:00.000Z"),
    item("future-near", "NOTE", "2026-08-10T00:00:00.000Z"),
    item("today", "NOTE", "2026-08-05T00:00:00.000Z"),
    item("event", "EVENT", "2026-08-05T00:00:00.000Z", { subType: "LESSON" }),
    withPreview,
  ], NOW, 4);

  assert.deepEqual(result.map((entry) => entry.item.id), ["today", "recent", "old", "future-near"]);
  assert.equal(result[1]?.preview, "믹스 연습");
  assert.equal(result[0]?.preview, "");
});

test("할 일은 피드백 도착 → 답변 완료 → 피드백 대기 → 답변 대기 순서로 최대 5개다", () => {
  const result = getStudentTodoEntries(summary([
    item("ready", "ASSIGNMENT", "2026-08-01T00:00:00.000Z", { feedbackCount: 1 }),
    item("waiting", "ASSIGNMENT", "2026-08-02T00:00:00.000Z", { feedbackCount: 0 }),
    item("open-1", "QNA", "2026-08-04T00:00:00.000Z", { subType: "OPEN" }),
    item("open-2", "QNA", "2026-08-03T00:00:00.000Z", { subType: "OPEN" }),
    item("open-3", "QNA", "2026-08-02T00:00:00.000Z", { subType: "OPEN" }),
    item("answered", "QNA", "2026-08-03T00:00:00.000Z", { subType: "ANSWERED" }),
  ]));

  assert.deepEqual(result.map((entry) => [entry.item.id, entry.status]), [
    ["ready", "feedbackReady"],
    ["answered", "qnaAnswered"],
    ["waiting", "feedbackWaiting"],
    ["open-1", "qnaOpen"],
    ["open-2", "qnaOpen"],
  ]);
});

test("일정 유형 이름은 외부 캘린더 출처를 레슨으로 오인하지 않는다", () => {
  const external = item("ext", "EVENT", "2026-08-05T00:00:00.000Z", { subType: "LESSON" });
  external.source = { kind: "GOOGLE_CALENDAR", entity: "EXTERNAL_CALENDAR_EVENT", label: "Google 캘린더" };
  assert.equal(describeAgendaKind(external), "Google 캘린더");
  assert.equal(describeAgendaKind(item("gig", "EVENT", "2026-08-05T00:00:00.000Z", { subType: "GIG" })), "공연");
  assert.equal(describeAgendaKind(item("n", "NOTE", "2026-08-05T00:00:00.000Z")), "노트");
});

test("미제출 과제는 피드백 대기로 섞이지 않고 마감 지남 → 다가오는 순으로 할 일 앞에 온다", () => {
  const task = (id: string, dueAt: string | null) => {
    const entry = item(id, "ASSIGNMENT", dueAt ?? "2026-08-01T00:00:00.000Z", { subType: "TASK" });
    entry.metadata = { taskId: id, dueAt };
    entry.source = { kind: "PORTAL", entity: "ASSIGNMENT_TASK", label: "포털" };
    return entry;
  };
  const result = summary([
    task("overdue", "2026-08-04T12:00:00.000Z"),
    task("soon", "2026-08-06T12:00:00.000Z"),
    task("far", "2026-08-20T12:00:00.000Z"),
    task("no-due", null),
    item("waiting", "ASSIGNMENT", "2026-08-02T00:00:00.000Z", { feedbackCount: 0 }),
  ]);
  assert.equal(result.waitingAssignment?.id, "waiting");
  assert.deepEqual(result.overdueTasks.map((entry) => entry.id), ["overdue"]);
  assert.deepEqual(result.upcomingTasks.map((entry) => entry.id), ["soon", "no-due"]);
  assert.deepEqual(getStudentTodoEntries(result).map((entry) => [entry.item.id, entry.status]), [
    ["overdue", "taskOverdue"],
    ["soon", "taskDue"],
    ["no-due", "taskDue"],
    ["waiting", "feedbackWaiting"],
  ]);
});
