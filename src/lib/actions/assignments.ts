/**
 * @file src/lib/actions/assignments.ts
 * @description 과제 제출 관련 서버 액션.
 * Student: 과제 제출(YouTube/SoundCloud URL), 본인 과제 조회.
 * Admin: 전체 학생 과제 조회, 미피드백 과제 수 조회.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { assignments, feedbacks, profiles } from "@/db/schema";
import { asc, count, desc, eq, notExists } from "drizzle-orm";
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
    .select()
    .from(assignments)
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
      submittedAt: assignments.submittedAt,
      feedbackCount: count(feedbacks.id),
    })
    .from(assignments)
    .leftJoin(feedbacks, eq(feedbacks.assignmentId, assignments.id))
    .where(eq(assignments.studentId, studentId))
    .groupBy(assignments.id)
    .orderBy(desc(assignments.submittedAt));
  return rows.map((row) => ({ ...row, feedbackCount: Number(row.feedbackCount) }));
}

/**
 * 과제 단건 조회 (ID로).
 */
export async function getAssignmentById(assignmentId: string) {
  const session = await requireAuth();
  const db = createDb();
  const rows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  const assignment = rows[0] ?? null;
  if (!assignment) return null;

  assertOwnerOrAdmin(session, assignment.studentId);

  return assignment;
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
 * Admin 업무함: 피드백이 아직 없는 과제를 오래된 제출 순으로 조회합니다.
 */
export async function getPendingFeedbackAssignments() {
  await requireAdmin();
  const db = createDb();

  return db
    .select({
      id: assignments.id,
      mediaUrl: assignments.mediaUrl,
      submittedAt: assignments.submittedAt,
      studentId: assignments.studentId,
      studentName: profiles.displayName,
      studentEmail: profiles.email,
    })
    .from(assignments)
    .innerJoin(profiles, eq(assignments.studentId, profiles.id))
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
