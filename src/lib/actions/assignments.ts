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
import { asc, desc, eq, notExists } from "drizzle-orm";
import {
  requireAuth,
  requireAdmin,
  assertOwnerOrAdmin,
  requireStudentTarget,
} from "@/lib/auth-guard";

/** 지원하는 미디어 플랫폼 URL 패턴 */
const MEDIA_URL_PATTERNS = [
  /^https?:\/\/(www\.)?youtube\.com\/watch/,
  /^https?:\/\/youtu\.be\//,
  /^https?:\/\/(www\.)?soundcloud\.com\//,
];

function isValidMediaUrl(url: string): boolean {
  return MEDIA_URL_PATTERNS.some((p) => p.test(url));
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

  const mediaUrl = (formData.get("mediaUrl") as string)?.trim();

  if (!mediaUrl) return { error: "미디어 URL을 입력해주세요." };
  if (!isValidMediaUrl(mediaUrl)) {
    return { error: "YouTube 또는 SoundCloud URL만 지원합니다." };
  }

  const db = createDb();
  const id = crypto.randomUUID();

  await db.insert(assignments).values({
    id,
    studentId: session.user.id!,
    mediaUrl,
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
