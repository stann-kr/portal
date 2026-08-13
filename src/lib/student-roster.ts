import { desc, eq, gte, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { assignments, curriculums, feedbacks, lessons, profiles } from "@/db/schema";

export type StudentRosterStat = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: Date | null;
  currentModule: string | null;
  nextLessonDate: Date | null;
  pendingFeedbackCount: number;
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
    ? `${weekNum}주차: ${title}`
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
 * 학생 수와 무관하게 4개 조회로 roster 요약을 만든다.
 * 각 도메인은 DB group aggregate로 한 번만 스캔하고 JS에서는 Map lookup만 수행한다.
 */
export async function queryStudentRosterStats(
  db: DrizzleDb,
  referenceTime: Date = new Date(),
): Promise<StudentRosterStat[]> {
  const [studentRows, curriculumRows, lessonRows, pendingFeedbackRows] = await Promise.all([
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
        pendingFeedbackCount: sql<number>`count(DISTINCT CASE WHEN ${feedbacks.id} IS NULL THEN ${assignments.id} END)`,
      })
      .from(assignments)
      .leftJoin(feedbacks, eq(feedbacks.assignmentId, assignments.id))
      .groupBy(assignments.studentId),
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

  return studentRows.map((student) => ({
    ...student,
    currentModule: currentModuleFromAggregate(curriculumByStudent.get(student.id)),
    nextLessonDate: lessonByStudent.get(student.id) ?? null,
    pendingFeedbackCount: pendingByStudent.get(student.id) ?? 0,
  }));
}
