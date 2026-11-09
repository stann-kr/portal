import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { assignments, curriculums, lessons, profiles, qnaThreads } from "@/db/schema";
import { assignmentAwaitingReview } from "./assignment-review-query";
import { formatModuleProgressLabel } from "./student-progress";

export type StudentRosterStat = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: Date | null;
  currentModule: string | null;
  nextLessonDate: Date | null;
  pendingFeedbackCount: number;
  /** 답변을 기다리는(OPEN, 휴지통 아님) 질문 수. */
  openQnaCount: number;
};

type CurriculumAggregate = {
  studentId: string;
  moduleCount: number;
  nextIncompleteDescriptor: string | null;
};

const MODULE_DESCRIPTOR_SEPARATOR = "\u001f";

function currentModuleFromAggregate(row: CurriculumAggregate | undefined): string {
  if (!row || Number(row.moduleCount) === 0) return "진도 미지정";
  if (!row.nextIncompleteDescriptor) return "모든 과정 완료";
  const separatorIndex = row.nextIncompleteDescriptor.indexOf(MODULE_DESCRIPTOR_SEPARATOR);
  if (separatorIndex < 1) return "진도 미지정";
  const weekNum = Number.parseInt(row.nextIncompleteDescriptor.slice(0, separatorIndex), 10);
  const title = row.nextIncompleteDescriptor.slice(separatorIndex + 1);
  return Number.isSafeInteger(weekNum) && title
    ? formatModuleProgressLabel(weekNum, title)
    : "진도 미지정";
}

function epochSecondsToDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1_000);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * 학생 수와 무관하게 5개 조회로 roster 요약을 만든다.
 * 각 도메인은 DB group aggregate로 한 번만 스캔하고 JS에서는 Map lookup만 수행한다.
 */
export async function queryStudentRosterStats(
  db: DrizzleDb,
  referenceTime: Date = new Date(),
): Promise<StudentRosterStat[]> {
  const [studentRows, curriculumRows, lessonRows, pendingFeedbackRows, openQnaRows] = await Promise.all([
    db
      .select({
        id: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .where(eq(profiles.role, "student"))
      .orderBy(desc(profiles.createdAt)),
    db
      .select({
        studentId: curriculums.studentId,
        moduleCount: sql<number>`count(*)`,
        nextIncompleteDescriptor: sql<string | null>`min(CASE WHEN ${curriculums.isCompleted} = 0 THEN printf('%010d', ${curriculums.weekNum}) || char(31) || ${curriculums.title} END)`,
      })
      .from(curriculums)
      .groupBy(curriculums.studentId),
    db
      .select({
        studentId: lessons.studentId,
        nextLessonEpoch: sql<number | null>`min(${lessons.scheduledAt})`,
      })
      .from(lessons)
      .where(gte(lessons.scheduledAt, referenceTime))
      .groupBy(lessons.studentId),
    db
      .select({
        studentId: assignments.studentId,
        pendingFeedbackCount: sql<number>`count(*)`,
      })
      .from(assignments)
      .where(assignmentAwaitingReview(db))
      .groupBy(assignments.studentId),
    db
      .select({
        studentId: qnaThreads.studentId,
        openQnaCount: sql<number>`count(*)`,
      })
      .from(qnaThreads)
      .where(and(eq(qnaThreads.status, "OPEN"), isNull(qnaThreads.deletedAt)))
      .groupBy(qnaThreads.studentId),
  ]);

  const curriculumByStudent = new Map(
    curriculumRows.map((row) => [row.studentId, row as CurriculumAggregate]),
  );
  const lessonByStudent = new Map(
    lessonRows.map((row) => [row.studentId, epochSecondsToDate(row.nextLessonEpoch)]),
  );
  const pendingByStudent = new Map(
    pendingFeedbackRows.map((row) => [row.studentId, Number(row.pendingFeedbackCount)]),
  );

  const openQnaByStudent = new Map(
    openQnaRows.map((row) => [row.studentId, Number(row.openQnaCount)]),
  );

  return studentRows.map((student) => ({
    ...student,
    currentModule: currentModuleFromAggregate(curriculumByStudent.get(student.id)),
    nextLessonDate: lessonByStudent.get(student.id) ?? null,
    pendingFeedbackCount: pendingByStudent.get(student.id) ?? 0,
    openQnaCount: openQnaByStudent.get(student.id) ?? 0,
  }));
}

export type StudentWorkCounts = {
  /** 검토 대기(피드백 없고 확인함 아님) 제출 수 */
  pendingFeedbackCount: number;
  /** 답변을 기다리는 질문 수 */
  openQnaCount: number;
};

/** 학생 한 명의 처리할 일 수(학생 상세 탭 숫자). roster와 같은 조건으로 센다. */
export async function queryStudentWorkCounts(db: DrizzleDb, studentId: string): Promise<StudentWorkCounts> {
  const [[pending], [openQna]] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)` })
      .from(assignments)
      .where(and(eq(assignments.studentId, studentId), assignmentAwaitingReview(db))),
    db
      .select({ value: sql<number>`count(*)` })
      .from(qnaThreads)
      .where(and(eq(qnaThreads.studentId, studentId), eq(qnaThreads.status, "OPEN"), isNull(qnaThreads.deletedAt))),
  ]);
  return { pendingFeedbackCount: Number(pending?.value ?? 0), openQnaCount: Number(openQna?.value ?? 0) };
}

/** 포탈 레슨과 연결된 바깥 캘린더 일정 중 더 이른 쪽을 다음 레슨으로 삼는다. */
export function withConnectedNextLessons(
  stats: StudentRosterStat[],
  connected: ReadonlyMap<string, Date>,
): StudentRosterStat[] {
  return stats.map((student) => {
    const external = connected.get(student.id);
    if (!external) return student;
    const next = student.nextLessonDate && student.nextLessonDate.getTime() <= external.getTime()
      ? student.nextLessonDate
      : external;
    return next === student.nextLessonDate ? student : { ...student, nextLessonDate: next };
  });
}

/**
 * Stann 사이드바 업무함 숫자: 검토 대기 제출 + 답변을 기다리는 질문(모든 학생).
 * 학생 상세 탭·roster와 같은 조건(assignmentAwaitingReview, OPEN이고 지우지 않은 질문)으로 센다.
 */
export async function queryAdminWorkCount(db: DrizzleDb): Promise<number> {
  const [[pending], [openQna]] = await Promise.all([
    db.select({ value: sql<number>`count(*)` }).from(assignments).where(assignmentAwaitingReview(db)),
    db
      .select({ value: sql<number>`count(*)` })
      .from(qnaThreads)
      .where(and(eq(qnaThreads.status, "OPEN"), isNull(qnaThreads.deletedAt))),
  ]);
  return Number(pending?.value ?? 0) + Number(openQna?.value ?? 0);
}
