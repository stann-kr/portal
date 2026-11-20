import type { StudentRosterStat } from "@/lib/actions/students";
import { LESSON_GROUP_MIN_MEMBERS, type LessonGroupSummary } from "@/lib/lesson-group-rules";

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

/**
 * 업무함 "다가오는 레슨" 한 줄. 그룹 멤버 모두의 다음 레슨이 같은 시각이면 그룹레슨 한 줄로 합친다
 * (일정의 그룹레슨 블록과 같은 규칙, 캔버스 UxReview1120Admin ②).
 */
export type UpcomingLessonRow =
  | { kind: "student"; id: string; at: Date; student: StudentRosterStat }
  | { kind: "group"; id: string; at: Date; group: { id: string; name: string }; members: StudentRosterStat[] };

export type AdminWorkQueue = {
  openThreads: AdminQueueThread[];
  pendingAssignments: PendingFeedbackAssignment[];
  /** 가까운 순서의 전체 줄. 업무함이 처음 5줄을 보여 주고 나머지는 펼쳐 본다. */
  upcomingLessons: UpcomingLessonRow[];
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

/** 업무함 "미답변 Q&A" 순서(오래 기다린 질문 먼저). getAdminWorkQueue와 같은 기준. */
export function sortOpenThreads<T extends AdminQueueThread>(threads: readonly T[]): T[] {
  return [...threads].sort((a, b) => threadTime(a) - threadTime(b));
}

function mergeUpcomingGroupLessons(
  students: readonly StudentRosterStat[],
  groups: readonly LessonGroupSummary[],
): UpcomingLessonRow[] {
  const byId = new Map(students.map((student) => [student.id, student]));
  const merged = new Map<string, UpcomingLessonRow>();
  for (const group of groups) {
    if (group.memberIds.length < LESSON_GROUP_MIN_MEMBERS) continue;
    const members = group.memberIds.map((id) => byId.get(id));
    if (members.some((member) => !member || merged.has(member.id))) continue;
    const at = members[0]!.nextLessonDate!;
    if (!members.every((member) => member!.nextLessonDate!.getTime() === at.getTime())) continue;
    const row: UpcomingLessonRow = {
      kind: "group",
      id: `group:${group.id}`,
      at,
      group: { id: group.id, name: group.name },
      members: members as StudentRosterStat[],
    };
    for (const member of row.members) merged.set(member.id, row);
  }
  const rows: UpcomingLessonRow[] = [];
  const seen = new Set<UpcomingLessonRow>();
  for (const student of students) {
    const row = merged.get(student.id) ?? { kind: "student" as const, id: student.id, at: student.nextLessonDate!, student };
    if (seen.has(row)) continue;
    seen.add(row);
    rows.push(row);
  }
  return rows;
}

export function getAdminWorkQueue(
  students: StudentRosterStat[],
  threads: AdminQueueThread[],
  pendingAssignments: PendingFeedbackAssignment[],
  referenceTime: Date,
  lessonGroups: readonly LessonGroupSummary[] = [],
): AdminWorkQueue {
  const weekEnd = new Date(referenceTime.getTime() + 7 * 24 * 60 * 60 * 1000);
  const openThreads = sortOpenThreads(threads.filter((thread) => thread.status === "OPEN"));
  const sortedPendingAssignments = sortPendingAssignments(pendingAssignments);
  const upcomingStudents = students
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
  const upcomingLessons = mergeUpcomingGroupLessons(upcomingStudents, lessonGroups);

  return {
    openThreads: openThreads.slice(0, 5),
    // 업무함이 처음 5건을 보여 주고 나머지는 펼쳐 볼 수 있도록 전체 정렬 결과를 반환한다.
    pendingAssignments: sortedPendingAssignments,
    upcomingLessons,
    metrics: {
      openThreadCount: openThreads.length,
      pendingFeedbackCount: sortedPendingAssignments.length,
      upcomingLessonCount: upcomingLessons.length,
      studentCount: students.length,
    },
  };
}

/** 관리자 업무함 주소. 업무함에서 연 화면의 돌아가기 대상이다. */
export const ADMIN_WORK_QUEUE_PATH = "/dashboard/admin?section=work";

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

/** 업무함에서 연 Q&A 주소. `from=work`가 있으면 답한 뒤 다음 미답변 질문으로 이어 준다(캔버스 UxReview1120Admin ①). */
export function buildQnaQueueHref(threadId: string, returnTo: string): string {
  return `/dashboard/qna/${encodeURIComponent(threadId)}?from=work&returnTo=${encodeURIComponent(returnTo)}`;
}

/** 지금 연 질문을 뺀 남은 미답변 질문 수와 업무함 순서의 다음 질문. 남은 것이 없으면 next는 null이다. */
export function getNextOpenThread<T extends AdminQueueThread>(
  open: readonly T[],
  currentId: string,
): { remaining: number; next: T | null } {
  const rest = sortOpenThreads(open.filter((thread) => thread.id !== currentId && thread.status === "OPEN"));
  return { remaining: rest.length, next: rest[0] ?? null };
}
