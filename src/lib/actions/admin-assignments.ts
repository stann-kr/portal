"use server";

/**
 * 관리자 전체 과제 화면(캔버스 AdminAssignments): 수강 중인 학생 전체(또는 고른 한 명)의
 * 피드백 대기 제출 · 아직 안 낸 과제 · 최근 확인한 제출을 한 번에 읽는다.
 * 쓰기는 하지 않는다. 피드백·확인은 지금 과제 상세가, 과제 내기는 학생 상세 과제 탭 폼이 맡는다.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { createDbContext, type DbContext, type DrizzleDb } from "@/db/client";
import { assignments, assignmentTasks } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-guard";
import { listActiveStudentProfiles } from "@/lib/active-profile";
import { assignmentAwaitingReview } from "@/lib/assignment-review-query";
import { ensureRecurringAssignmentTasks } from "@/lib/assignment-task-generation";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";

/** 최근 확인한 제출을 보이는 기간과 최대 줄 수. */
const ADMIN_RECENT_REVIEWED_DAYS = 30;
const RECENT_REVIEWED_LIMIT = 30;
/** 아직 안 낸 과제의 최대 줄 수(학생 수가 적어 넘을 일이 드물다). */
const OPEN_TASK_LIMIT = 200;

export type AdminAssignmentStudent = { id: string; label: string };

export type AdminPendingSubmission = {
  id: string;
  studentId: string;
  title: string;
  submittedAt: Date | null;
};

export type AdminOpenTask = {
  id: string;
  studentId: string;
  title: string;
  dueAt: Date | null;
  createdAt: Date;
};

export type AdminReviewedSubmission = AdminPendingSubmission;

export type AdminAssignmentsOverview = {
  students: AdminAssignmentStudent[];
  /** 필터로 고른 학생. 수강 중인 학생이 아니면 null(전체 학생)이다. */
  selectedStudentId: string | null;
  pending: AdminPendingSubmission[];
  open: AdminOpenTask[];
  reviewed: AdminReviewedSubmission[];
};

function readDb(context: DbContext): DrizzleDb {
  return context.db as unknown as DrizzleDb;
}

const FREE_SUBMISSION_TITLE = "자유 제출";

export async function getAdminAssignmentsOverview(
  input: { studentId?: string | null } = {},
  now: Date = new Date(),
): Promise<AdminAssignmentsOverview> {
  await requireAdmin();
  const context = createDbContext();
  const db = readDb(context);
  const profiles = await listActiveStudentProfiles(db);
  const students = profiles
    .map((profile) => ({ id: profile.id, label: getUnifiedItemSpaceLabel(profile) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  const selectedStudentId = input.studentId && students.some((student) => student.id === input.studentId)
    ? input.studentId
    : null;
  const ids = selectedStudentId ? [selectedStudentId] : students.map((student) => student.id);
  if (ids.length === 0) return { students, selectedStudentId, pending: [], open: [], reviewed: [] };

  // 학생 과제 화면과 같이, 진행 중인 정기 과제의 아직 없는 회차를 먼저 만든다(학생이 과제 화면을 열기 전에도 보이게).
  for (const id of ids) await ensureRecurringAssignmentTasks(context, id, now);

  // 학생 id 목록을 bind한다. 수강 중 학생은 D1 bind 제한(100)보다 훨씬 적지만, 넘치면 앞 90명만 읽어 오류 대신 일부를 보인다.
  const owners = ids.slice(0, 90);
  const recentFrom = new Date(now.getTime() - ADMIN_RECENT_REVIEWED_DAYS * 24 * 60 * 60 * 1000);
  const submissionColumns = {
    id: assignments.id,
    studentId: assignments.studentId,
    title: sql<string | null>`${assignmentTasks.title}`,
    submittedAt: assignments.submittedAt,
  };

  const [pendingRows, openRows, reviewedRows] = await Promise.all([
    db
      .select(submissionColumns)
      .from(assignments)
      .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
      .where(and(inArray(assignments.studentId, owners), isNotNull(assignments.submittedAt), assignmentAwaitingReview(db)))
      .orderBy(asc(assignments.submittedAt)),
    db
      .select({
        id: assignmentTasks.id,
        studentId: assignmentTasks.studentId,
        title: assignmentTasks.title,
        dueAt: assignmentTasks.dueAt,
        createdAt: assignmentTasks.createdAt,
      })
      .from(assignmentTasks)
      .where(and(
        inArray(assignmentTasks.studentId, owners),
        notExists(db.select({ id: assignments.id }).from(assignments).where(eq(assignments.taskId, assignmentTasks.id))),
      ))
      // 마감이 있는 과제를 마감이 가까운(지난) 순으로 먼저, 마감 없는 과제는 낸 순서로 뒤에 둔다.
      .orderBy(sql`${assignmentTasks.dueAt} IS NULL`, asc(assignmentTasks.dueAt), asc(assignmentTasks.createdAt))
      .limit(OPEN_TASK_LIMIT),
    db
      .select(submissionColumns)
      .from(assignments)
      .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
      .where(and(
        inArray(assignments.studentId, owners),
        isNotNull(assignments.submittedAt),
        gte(assignments.submittedAt, recentFrom),
        sql`NOT (${assignmentAwaitingReview(db)})`,
      ))
      .orderBy(desc(assignments.submittedAt))
      .limit(RECENT_REVIEWED_LIMIT),
  ]);

  const toSubmission = (row: (typeof pendingRows)[number]): AdminPendingSubmission => ({
    id: row.id,
    studentId: row.studentId,
    title: row.title ?? FREE_SUBMISSION_TITLE,
    submittedAt: row.submittedAt,
  });
  return {
    students,
    selectedStudentId,
    pending: pendingRows.map(toSubmission),
    open: openRows,
    reviewed: reviewedRows.map(toSubmission),
  };
}
