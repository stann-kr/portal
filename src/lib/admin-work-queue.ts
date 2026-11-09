import type { StudentRosterStat } from "@/lib/actions/students";

export type AdminQueueThread = {
  id: string;
  title: string;
  status: string;
  createdAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
  studentId: string | null | undefined;
  studentName: string | null | undefined;
  studentEmail: string | null | undefined;
};

export type PendingFeedbackAssignment = {
  id: string;
  /** 글만 제출하면 null이다. 업무함은 글 제출도 피드백 대기로 함께 센다. */
  mediaUrl: string | null;
  /** 관리자가 낸 과제에 대한 제출이면 과제 제목 */
  taskTitle?: string | null;
  submittedAt: Date | null;
  studentId: string;
  studentName: string | null;
  studentEmail: string;
};

export type AdminWorkQueue = {
  openThreads: AdminQueueThread[];
  pendingAssignments: PendingFeedbackAssignment[];
  upcomingLessons: StudentRosterStat[];
  metrics: {
    openThreadCount: number;
    pendingFeedbackCount: number;
    upcomingLessonCount: number;
    studentCount: number;
  };
};

function threadTime(thread: AdminQueueThread) {
  return (thread.updatedAt ?? thread.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function assignmentTime(assignment: PendingFeedbackAssignment) {
  return assignment.submittedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

export function getAdminWorkQueue(
  students: StudentRosterStat[],
  threads: AdminQueueThread[],
  pendingAssignments: PendingFeedbackAssignment[],
  referenceTime: Date,
): AdminWorkQueue {
  const weekEnd = new Date(referenceTime.getTime() + 7 * 24 * 60 * 60 * 1000);
  const openThreads = threads
    .filter((thread) => thread.status === "OPEN")
    .sort((a, b) => threadTime(a) - threadTime(b));
  const sortedPendingAssignments = sortPendingAssignments(pendingAssignments);
  const upcomingLessons = students
    .filter(
      (student) =>
        student.nextLessonDate !== null &&
        student.nextLessonDate.getTime() >= referenceTime.getTime() &&
        student.nextLessonDate.getTime() <= weekEnd.getTime(),
    )
    .sort(
      (a, b) =>
        (a.nextLessonDate?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (b.nextLessonDate?.getTime() ?? Number.MAX_SAFE_INTEGER),
    );

  return {
    openThreads: openThreads.slice(0, 5),
    // 업무함이 처음 5건을 보여 주고 나머지는 펼쳐 볼 수 있도록 전체 정렬 결과를 반환한다.
    pendingAssignments: sortedPendingAssignments,
    upcomingLessons: upcomingLessons.slice(0, 5),
    metrics: {
      openThreadCount: openThreads.length,
      pendingFeedbackCount: sortedPendingAssignments.length,
      upcomingLessonCount: upcomingLessons.length,
      studentCount: students.length,
    },
  };
}

/** 업무함에서 연 과제 상세 주소. `from=work`가 있으면 처리 뒤 다음 피드백 대기로 이어 준다. */
export function buildAssignmentQueueHref(assignmentId: string, returnTo: string): string {
  return `/dashboard/student/assignments/${encodeURIComponent(assignmentId)}?from=work&returnTo=${encodeURIComponent(returnTo)}`;
}

/** 업무함 순서(오래된 제출 먼저, 제출일 없는 제출은 뒤)로 정렬한다. getAdminWorkQueue와 같은 기준. */
export function sortPendingAssignments<T extends PendingFeedbackAssignment>(assignments: readonly T[]): T[] {
  return [...assignments].sort((a, b) => assignmentTime(a) - assignmentTime(b));
}

/**
 * 지금 연 제출을 뺀 남은 피드백 대기 수와 업무함 순서의 다음 제출(AssignmentAck 보드 "다음 항목").
 * 남은 것이 없으면 next는 null이다.
 */
export function getNextPendingAssignment<T extends PendingFeedbackAssignment>(
  pending: readonly T[],
  currentId: string,
): { remaining: number; next: T | null } {
  const rest = sortPendingAssignments(pending.filter((assignment) => assignment.id !== currentId));
  return { remaining: rest.length, next: rest[0] ?? null };
}
