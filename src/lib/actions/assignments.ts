/**
 * @file src/lib/actions/assignments.ts
 * @description 과제 제출 관련 서버 액션.
 * Student: 자유 제출(YouTube/SoundCloud URL), 본인 제출 조회·삭제.
 * Admin: 전체 학생 제출 조회, 미피드백 제출 수 조회.
 * 관리자가 낸 과제와 과제별 제출은 assignmentTasks.ts가 맡는다. 이 파일의 조회는 두 제출을 함께 돌려주고
 * 과제 제출이면 과제 제목(taskTitle)을 붙인다. 글만 있는 제출은 mediaUrl이 null이다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { assignments, assignmentTasks, feedbacks, profiles } from "@/db/schema";
import { and, asc, count, desc, eq, notExists, sql } from "drizzle-orm";
import {
  requireAuth,
  requireAdmin,
  assertOwnerOrAdmin,
  requireStudentTarget,
} from "@/lib/auth-guard";
import { normalizeAssignmentMediaUrl } from "@/lib/assignment-media-url";

// ───────────────────────────────────────────────
// 학생: 과제 제출
// ───────────────────────────────────────────────

export type SubmitAssignmentState = {
  error?: string;
  success?: boolean;
  id?: string;
};

/**
 * 과제 제출 (Student 전용).
 * @param _prev - useActionState 이전 상태
 * @param formData - { mediaUrl, title }
 */
export async function submitAssignment(
  _prev: SubmitAssignmentState,
  formData: FormData,
): Promise<SubmitAssignmentState> {
  const session = await requireAuth();
  if (session.user.role !== "student")
    return { error: "학생만 과제를 제출할 수 있습니다." };

  const media = normalizeAssignmentMediaUrl(formData.get("mediaUrl"));
  if (!media.ok) return { error: media.error };

  const db = createDb();
  const id = crypto.randomUUID();

  await db.insert(assignments).values({
    id,
    studentId: session.user.id!,
    mediaUrl: media.url,
  });

  revalidatePath("/dashboard/student/assignments");
  revalidatePath("/dashboard/student");
  return { success: true, id };
}

export type DeleteAssignmentResult = { success: true } | { success: false; error: string };

/**
 * 학생 본인의 잘못된 제출을 피드백이 달리기 전에만 삭제한다.
 * 피드백 존재 확인과 삭제를 한 DELETE 문으로 처리해 그 사이 등록된 피드백을 지우지 않는다.
 * 관리자는 학생 제출을 대신 삭제하지 않는다.
 */
export async function deleteMyAssignment(assignmentId: string): Promise<DeleteAssignmentResult> {
  const session = await requireAuth();
  if (session.user.role !== "student") {
    return { success: false, error: "제출한 학생만 삭제할 수 있습니다." };
  }
  const ownAssignment = and(
    eq(assignments.id, assignmentId),
    eq(assignments.studentId, session.user.id),
  );

  const db = createDb();
  const deleted = await db
    .delete(assignments)
    .where(and(
      ownAssignment,
      notExists(
        db
          .select({ id: feedbacks.id })
          .from(feedbacks)
          .where(eq(feedbacks.assignmentId, assignments.id)),
      ),
    ))
    .returning({ id: assignments.id });

  if (deleted.length === 0) {
    const [remaining] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(ownAssignment)
      .limit(1);
    return {
      success: false,
      error: remaining
        ? "피드백이 등록된 제출은 삭제할 수 없습니다. 필요하면 강사에게 문의해 주세요."
        : "이미 삭제됐거나 찾을 수 없는 제출입니다. 목록을 새로고침해 주세요.",
    };
  }

  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/admin");
  return { success: true };
}

// ───────────────────────────────────────────────
// 조회
// ───────────────────────────────────────────────

/**
 * 학생 본인 과제 목록 조회 (최신순).
 */
export async function getMyAssignments() {
  const session = await requireAuth();
  const db = createDb();
  return db
    .select({
      id: assignments.id,
      taskId: assignments.taskId,
      mediaUrl: assignments.mediaUrl,
      textHtml: assignments.textHtml,
      submittedAt: assignments.submittedAt,
      taskTitle: assignmentTasks.title,
    })
    .from(assignments)
    .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
    .where(eq(assignments.studentId, session.user.id!))
    .orderBy(desc(assignments.submittedAt));
}

/**
 * 특정 학생의 과제 목록 조회 (Admin용).
 */
export async function getAssignmentsByStudent(studentId: string) {
  await requireStudentTarget(studentId);
  const db = createDb();
  return db
    .select()
    .from(assignments)
    .where(eq(assignments.studentId, studentId))
    .orderBy(desc(assignments.submittedAt));
}

/**
 * 관리자 학생 상세의 과제 목록: 제출 최신순과 과제별 피드백 수.
 */
export async function getAssignmentSummariesByStudent(studentId: string) {
  await requireStudentTarget(studentId);
  const db = createDb();
  const rows = await db
    .select({
      id: assignments.id,
      mediaUrl: assignments.mediaUrl,
      hasText: sql<number>`${assignments.textHtml} IS NOT NULL AND length(${assignments.textHtml}) > 0`,
      taskTitle: assignmentTasks.title,
      submittedAt: assignments.submittedAt,
      feedbackCount: count(feedbacks.id),
    })
    .from(assignments)
    .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
    .leftJoin(feedbacks, eq(feedbacks.assignmentId, assignments.id))
    .where(eq(assignments.studentId, studentId))
    .groupBy(assignments.id)
    .orderBy(desc(assignments.submittedAt));
  return rows.map((row) => ({ ...row, hasText: Boolean(row.hasText), feedbackCount: Number(row.feedbackCount) }));
}

/**
 * 과제 단건 조회 (ID로).
 */
export async function getAssignmentById(assignmentId: string) {
  const session = await requireAuth();
  const db = createDb();
  const rows = await db
    .select({
      assignment: assignments,
      task: {
        id: assignmentTasks.id,
        title: assignmentTasks.title,
        descriptionHtml: assignmentTasks.descriptionHtml,
        submissionFormat: assignmentTasks.submissionFormat,
        dueAt: assignmentTasks.dueAt,
      },
    })
    .from(assignments)
    .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  const row = rows[0] ?? null;
  if (!row) return null;

  assertOwnerOrAdmin(session, row.assignment.studentId);

  return { ...row.assignment, task: row.task?.id ? row.task : null };
}

/**
 * Admin Dashboard: 피드백 없는 과제 수 (Pending Feedbacks 통계).
 */
export async function getPendingFeedbackCount(): Promise<number> {
  await requireAdmin();
  const db = createDb();

  const rows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      notExists(
        db
          .select()
          .from(feedbacks)
          .where(eq(feedbacks.assignmentId, assignments.id)),
      ),
    );
  return rows.length;
}

/**
 * Admin 업무함: 피드백이 아직 없는 제출(링크·글 모두)을 오래된 제출 순으로 조회합니다.
 */
export async function getPendingFeedbackAssignments() {
  await requireAdmin();
  const db = createDb();

  return db
    .select({
      id: assignments.id,
      mediaUrl: assignments.mediaUrl,
      taskTitle: assignmentTasks.title,
      submittedAt: assignments.submittedAt,
      studentId: assignments.studentId,
      studentName: profiles.displayName,
      studentEmail: profiles.email,
    })
    .from(assignments)
    .innerJoin(profiles, eq(assignments.studentId, profiles.id))
    .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
    .where(
      notExists(
        db
          .select({ id: feedbacks.id })
          .from(feedbacks)
          .where(eq(feedbacks.assignmentId, assignments.id)),
      ),
    )
    .orderBy(asc(assignments.submittedAt));
}
