import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssignmentQueueHref,
  buildQnaQueueHref,
  getAdminWorkQueue,
  getNextOpenThread,
  getNextPendingAssignment,
  type AdminQueueThread,
  type PendingFeedbackAssignment,
} from "./admin-work-queue";
import type { StudentRosterStat } from "./actions/students";

const NOW = new Date("2026-08-05T00:00:00.000Z");

function student(id: string, nextLessonDate: string | null): StudentRosterStat {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    createdAt: NOW,
    currentModule: null,
    nextLessonDate: nextLessonDate ? new Date(nextLessonDate) : null,
    pendingFeedbackCount: 0,
    openQnaCount: 0,
  };
}

function thread(id: string, status: string, updatedAt: string): AdminQueueThread {
  return {
    id,
    title: id,
    status,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    studentId: id,
    studentName: id,
    studentEmail: `${id}@example.com`,
  };
}

function assignment(id: string, submittedAt: string): PendingFeedbackAssignment {
  return {
    id,
    mediaUrl: `https://example.com/${id}`,
    submittedAt: new Date(submittedAt),
    studentId: id,
    studentName: id,
    studentEmail: `${id}@example.com`,
  };
}

test("미답변 질문은 오래 기다린 항목부터 정렬하고 다른 상태를 제외한다", () => {
  const queue = getAdminWorkQueue(
    [],
    [
      thread("new", "OPEN", "2026-08-04T00:00:00.000Z"),
      thread("answered", "ANSWERED", "2026-08-01T00:00:00.000Z"),
      thread("old", "OPEN", "2026-08-02T00:00:00.000Z"),
    ],
    [],
    NOW,
  );

  assert.deepEqual(queue.openThreads.map((entry) => entry.id), ["old", "new"]);
  assert.equal(queue.metrics.openThreadCount, 2);
});

test("피드백 대기 과제는 오래된 제출부터 정렬한다", () => {
  const queue = getAdminWorkQueue(
    [],
    [],
    [
      assignment("new", "2026-08-04T00:00:00.000Z"),
      assignment("old", "2026-08-01T00:00:00.000Z"),
    ],
    NOW,
  );

  assert.deepEqual(queue.pendingAssignments.map((entry) => entry.id), ["old", "new"]);
  assert.equal(queue.metrics.pendingFeedbackCount, 2);

  // 업무함 미리보기(5건)를 넘는 대기 과제도 펼쳐 볼 수 있도록 모두 반환한다.
  const many = getAdminWorkQueue(
    [],
    [],
    Array.from({ length: 7 }, (_, day) => assignment(`a${day}`, `2026-08-0${day + 1}T00:00:00.000Z`)),
    NOW,
  );
  assert.equal(many.pendingAssignments.length, 7);
  assert.equal(many.pendingAssignments[0]?.id, "a0");
});

test("현재부터 7일 이내의 레슨만 가까운 순서로 포함한다", () => {
  const queue = getAdminWorkQueue(
    [
      student("past", "2026-08-04T00:00:00.000Z"),
      student("later", "2026-08-09T00:00:00.000Z"),
      student("next", "2026-08-06T00:00:00.000Z"),
      student("outside", "2026-08-13T00:00:00.000Z"),
    ],
    [],
    [],
    NOW,
  );

  assert.deepEqual(queue.upcomingLessons.map((entry) => entry.id), ["next", "later"]);
  assert.equal(queue.metrics.upcomingLessonCount, 2);
  assert.equal(queue.metrics.studentCount, 4);
});

test("다음 항목은 지금 제출을 빼고 업무함 순서(오래된 제출 먼저, 제출일 없는 제출은 뒤)로 고른다", () => {
  const row = (id: string, submittedAt: Date | null) => ({
    id, mediaUrl: null, taskTitle: id, submittedAt, studentId: "s", studentName: "학생", studentEmail: "s@example.test",
  });
  const pending = [
    row("undated", null),
    row("newer", new Date("2026-11-03T00:00:00.000Z")),
    row("current", new Date("2026-11-01T00:00:00.000Z")),
    row("older", new Date("2026-11-02T00:00:00.000Z")),
  ];
  const result = getNextPendingAssignment(pending, "current");
  assert.equal(result.remaining, 3);
  assert.equal(result.next?.id, "older");
  assert.equal(getNextPendingAssignment([row("current", null)], "current").next, null);
  assert.equal(getNextPendingAssignment([], "current").remaining, 0);
  assert.equal(buildAssignmentQueueHref("a b", "/dashboard/admin?section=work"), "/dashboard/student/assignments/a%20b?from=work&returnTo=%2Fdashboard%2Fadmin%3Fsection%3Dwork");
});

test("업무함에서 연 Q&A는 지금 질문을 뺀 답변 대기 질문을 업무함 순서(오래 기다린 질문 먼저)로 이어 준다", () => {
  const open = [
    thread("current", "OPEN", "2026-08-01T00:00:00.000Z"),
    thread("newer", "OPEN", "2026-08-04T00:00:00.000Z"),
    thread("answered", "ANSWERED", "2026-07-01T00:00:00.000Z"),
    thread("older", "OPEN", "2026-08-02T00:00:00.000Z"),
  ];
  const result = getNextOpenThread(open, "current");
  assert.equal(result.remaining, 2);
  assert.equal(result.next?.id, "older");
  assert.deepEqual(getNextOpenThread([thread("current", "OPEN", "2026-08-01T00:00:00.000Z")], "current"), { remaining: 0, next: null });
  assert.equal(buildQnaQueueHref("t 1", "/dashboard/admin?section=work"), "/dashboard/qna/t%201?from=work&returnTo=%2Fdashboard%2Fadmin%3Fsection%3Dwork");
});

test("다가오는 레슨은 그룹 멤버 모두의 다음 레슨이 같은 시각일 때만 그룹 한 줄로 합치고, 숫자는 합친 뒤 줄 수다", () => {
  const groups = [{ id: "g1", name: "화요일반", memberIds: ["a", "b"] }, { id: "g2", name: "목요일반", memberIds: ["c", "outside"] }];
  const queue = getAdminWorkQueue(
    [
      student("b", "2026-08-06T10:00:00.000Z"),
      student("a", "2026-08-06T10:00:00.000Z"),
      student("c", "2026-08-07T10:00:00.000Z"),
      student("outside", "2026-08-20T10:00:00.000Z"),
    ],
    [],
    [],
    NOW,
    groups,
  );
  assert.deepEqual(queue.upcomingLessons.map((row) => row.id), ["group:g1", "c"]);
  const [group] = queue.upcomingLessons;
  assert.equal(group?.kind === "group" ? group.members.map((member) => member.id).join(",") : null, "a,b");
  assert.equal(queue.metrics.upcomingLessonCount, 2);
});
