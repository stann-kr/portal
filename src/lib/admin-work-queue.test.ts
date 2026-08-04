import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminWorkQueue,
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
