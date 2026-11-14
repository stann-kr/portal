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
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import {
  requireAuth,
  requireAdmin,
  assertOwnerOrAdmin,
  requireStudentTarget,
} from "@/lib/auth-guard";
import { settledSubmissionError, validateFreeSubmissionPayload } from "@/lib/assignment-submission";
import { assignmentAwaitingReview } from "@/lib/assignment-review-query";
import { pushMessages } from "@/lib/push/messages";
import { notifyPush } from "@/lib/push/notify";
import { fromStoredAssignmentFormat } from "@/lib/assignment-recurrence";
import { CREATION_OPERATION_FIELD, deriveCreationResourceId, resolveCreationOperationId } from "@/lib/creation-operation";

async function countFeedbacks(db: ReturnType<typeof createDb>, assignmentId: string): Promise<number> {
  const [row] = await db.select({ value: count(feedbacks.id) }).from(feedbacks).where(eq(feedbacks.assignmentId, assignmentId));
  return Number(row?.value ?? 0);
}

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
 * @param formData - { mediaUrl?, text?, operationId (UUID v4) }
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

  // 응답을 못 받고 같은 내용을 다시 보내도 제출이 한 건만 남도록, 폼이 보낸 작업 ID에서 제출 id를 정한다.
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) return { error: "작성 정보를 확인하지 못했습니다. 입력 내용을 보관한 뒤 새로고침해 주세요." };
  const id = deriveCreationResourceId(operationId, JSON.stringify(["free-submission", session.user.id]));

  const db = createDb();
  const inserted = await db.insert(assignments).values({
    id,
    studentId: session.user.id!,
    mediaUrl: payload.mediaUrl,
    textHtml: payload.textHtml,
  }).onConflictDoNothing({ target: assignments.id }).returning({ id: assignments.id });
  if (inserted.length === 0) {
    const [existing] = await db.select().from(assignments).where(eq(assignments.id, id)).limit(1);
    if (
      !existing ||
      existing.studentId !== session.user.id ||
      existing.taskId !== null ||
      existing.mediaUrl !== payload.mediaUrl ||
      existing.textHtml !== payload.textHtml
    ) {
      return { error: "이 제출은 고치기 전 내용으로 이미 저장되었거나 상태가 바뀌었습니다. 목록을 확인해 주세요." };
    }
  } else {
    await notifyPush(
      { kind: "role", role: "admin" },
      pushMessages.assignmentSubmitted({ assignmentId: id, studentName: session.user.name ?? null, title: null }),
      { excludeProfileId: session.user.id },
    );
  }

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
      assignmentAwaitingReview(db),
    ))
    .returning({ id: assignments.id });

  if (updated.length === 0) {
    const [remaining] = await db
      .select({ id: assignments.id, reviewedAt: assignments.reviewedAt })
      .from(assignments)
      .where(ownFreeSubmission)
      .limit(1);
    return {
      error: remaining
        ? settledSubmissionError("고칠", { feedbackCount: await countFeedbacks(db, assignmentId), reviewedAt: remaining.reviewedAt })
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
      assignmentAwaitingReview(db),
    ))
    .returning({ id: assignments.id });

  if (deleted.length === 0) {
    const [remaining] = await db
      .select({ id: assignments.id, reviewedAt: assignments.reviewedAt })
      .from(assignments)
      .where(ownAssignment)
      .limit(1);
    return {
      success: false,
      error: remaining
        ? settledSubmissionError("삭제할", { feedbackCount: await countFeedbacks(db, assignmentId), reviewedAt: remaining.reviewedAt })
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
      reviewedAt: assignments.reviewedAt,
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
      reviewedAt: assignments.reviewedAt,
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
        analysisForm: assignmentTasks.analysisForm,
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

  const task = row.task?.id && row.task.submissionFormat
    ? {
        id: row.task.id,
        title: row.task.title!,
        descriptionHtml: row.task.descriptionHtml!,
        submissionFormat: fromStoredAssignmentFormat({ submissionFormat: row.task.submissionFormat, analysisForm: Boolean(row.task.analysisForm) }),
        dueAt: row.task.dueAt,
      }
    : null;
  return { ...row.assignment, task };
}

/**
 * Admin Dashboard: 검토 대기(피드백 없고 확인함도 아닌) 제출 수 (Pending Feedbacks 통계).
 */
export async function getPendingFeedbackCount(): Promise<number> {
  await requireAdmin();
  const db = createDb();

  const rows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(assignmentAwaitingReview(db));
  return rows.length;
}

/**
 * Admin 업무함: 검토 대기(피드백 없고 확인함도 아닌) 제출(링크·글 모두)을 오래된 제출 순으로 조회합니다.
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
    .where(assignmentAwaitingReview(db))
    .orderBy(asc(assignments.submittedAt));
}
