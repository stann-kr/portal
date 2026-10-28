/**
 * @file src/lib/actions/assignments.ts
 * @description 과제 제출 관련 서버 액션.
 * Student: 자유 제출(YouTube/SoundCloud 링크·글·둘 다), 피드백 전 본인 자유 제출 수정, 본인 제출 조회·삭제.
 * Admin: 전체 학생 제출 조회, 미피드백 제출 수 조회.
 * 관리자가 낸 과제와 과제별 제출은 assignmentTasks.ts가 맡는다. 이 파일의 조회는 두 제출을 함께 돌려주고
 * 과제 제출이면 과제 제목(taskTitle)을 붙인다. 글만 있는 제출은 mediaUrl이 null이다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { assignments, assignmentTasks, feedbacks, profiles } from "@/db/schema";
import { and, asc, count, desc, eq, isNull, notExists, sql } from "drizzle-orm";
import {
  requireAuth,
  requireAdmin,
  assertOwnerOrAdmin,
  requireStudentTarget,
} from "@/lib/auth-guard";
import { validateFreeSubmissionPayload } from "@/lib/assignment-submission";

// ───────────────────────────────────────────────
// 학생: 과제 제출
// ───────────────────────────────────────────────

export type SubmitAssignmentState = {
  error?: string;
  success?: boolean;
  id?: string;
};

/**
 * 자유 제출 (Student 전용). 관리자 과제 없이 링크·글 중 하나 이상을 낸다.
 * @param _prev - useActionState 이전 상태
 * @param formData - { mediaUrl?, text? }
 */
export async function submitAssignment(
  _prev: SubmitAssignmentState,
  formData: FormData,
): Promise<SubmitAssignmentState> {
  const session = await requireAuth();
  if (session.user.role !== "student")
    return { error: "학생만 과제를 제출할 수 있습니다." };

  const payload = validateFreeSubmissionPayload({
    mediaUrl: formData.get("mediaUrl"),
    text: formData.get("text"),
  });
  if (!payload.ok) return { error: payload.error };

  const db = createDb();
  const id = crypto.randomUUID();

  await db.insert(assignments).values({
    id,
    studentId: session.user.id!,
    mediaUrl: payload.mediaUrl,
    textHtml: payload.textHtml,
  });

  revalidatePath("/dashboard/student/assignments");
  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/admin");
  return { success: true, id };
}

/**
 * 학생 본인의 자유 제출(task_id IS NULL)을 피드백이 달리기 전에만 고친다.
 * 소유·자유 제출·피드백 없음 확인과 수정을 한 UPDATE 문으로 처리해 그 사이 등록된 피드백이 있으면 고치지 않는다.
 * 관리자 과제에 대한 제출은 assignmentTasks.ts의 updateMyTaskSubmission이 맡는다.
 */
export async function updateMyFreeSubmission(
  assignmentId: string,
  _prev: SubmitAssignmentState,
  formData: FormData,
): Promise<SubmitAssignmentState> {
  const session = await requireAuth();
  if (session.user.role !== "student") return { error: "제출한 학생만 고칠 수 있습니다." };
  const studentId = session.user.id;

  const payload = validateFreeSubmissionPayload({
    mediaUrl: formData.get("mediaUrl"),
    text: formData.get("text"),
  });
  if (!payload.ok) return { error: payload.error };

  const ownFreeSubmission = and(
    eq(assignments.id, assignmentId),
    eq(assignments.studentId, studentId),
    isNull(assignments.taskId),
  );
  const db = createDb();
  const updated = await db
    .update(assignments)
    .set({ mediaUrl: payload.mediaUrl, textHtml: payload.textHtml, updatedAt: new Date() })
    .where(and(
      ownFreeSubmission,
      notExists(
        db
          .select({ id: feedbacks.id })
          .from(feedbacks)
          .where(eq(feedbacks.assignmentId, assignments.id)),
      ),
    ))
    .returning({ id: assignments.id });

  if (updated.length === 0) {
    const [remaining] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(ownFreeSubmission)
      .limit(1);
    return {
      error: remaining
        ? "피드백이 등록된 제출은 고칠 수 없습니다. 필요하면 Stann에게 문의해 주세요."
        : "고칠 제출을 찾을 수 없습니다. 목록을 새로고침해 주세요.",
    };
  }

  revalidatePath("/dashboard/student/assignments");
  revalidatePath(`/dashboard/student/assignments/${assignmentId}`);
  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/admin");
  revalidatePath(`/dashboard/admin/students/${studentId}`);
  return { success: true, id: assignmentId };
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
        ? "피드백이 등록된 제출은 삭제할 수 없습니다. 필요하면 Stann에게 문의해 주세요."
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
