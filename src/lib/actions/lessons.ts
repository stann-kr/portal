/**
 * @file src/lib/actions/lessons.ts
 * @description 레슨 일정 관련 서버 액션.
 * Admin: 레슨 생성/삭제.
 * Student: 본인 레슨 조회.
 * Calendar: .ics 생성용 데이터 조회.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { lessons } from "@/db/schema";
import { and, eq, gte, asc, desc } from "drizzle-orm";
import {
  requireAdmin,
  requireAuth,
  requireStudentOwnerOrAdmin,
  requireStudentTarget,
} from "@/lib/auth-guard";

// ───────────────────────────────────────────────
// 조회
// ───────────────────────────────────────────────

/**
 * 특정 학생의 모든 레슨 조회 (날짜 내림차순).
 */
export async function getLessonsByStudent(studentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  const db = createDb();
  return db
    .select()
    .from(lessons)
    .where(eq(lessons.studentId, studentId))
    .orderBy(desc(lessons.scheduledAt));
}

/**
 * 학생 본인의 다음 예정 레슨 조회 (Student Dashboard용).
 */
export async function getNextLesson(studentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  const db = createDb();
  const now = new Date();
  const rows = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.studentId, studentId), gte(lessons.scheduledAt, now)))
    .orderBy(asc(lessons.scheduledAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Admin Dashboard: 전체 예정 레슨 수 조회.
 */
export async function getUpcomingLessonCount(): Promise<number> {
  await requireAdmin();
  const db = createDb();
  const now = new Date();
  const rows = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(gte(lessons.scheduledAt, now));
  return rows.length;
}

/**
 * .ics 생성용: 특정 학생의 미래 레슨 전체 조회.
 */
export async function getLessonsForCalendar(studentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  const db = createDb();
  const now = new Date();
  return db
    .select()
    .from(lessons)
    .where(and(eq(lessons.studentId, studentId), gte(lessons.scheduledAt, now)))
    .orderBy(asc(lessons.scheduledAt));
}

// ───────────────────────────────────────────────
// Admin: 레슨 생성
// ───────────────────────────────────────────────

export type CreateLessonState = { error?: string; success?: boolean };

/**
 * 레슨 일정 생성 (Admin 전용).
 * @param studentId - 대상 학생 ID
 * @param _prev - useActionState 이전 상태
 * @param formData - { scheduledAt: ISO datetime string }
 */
export async function createLesson(
  studentId: string,
  _prev: CreateLessonState,
  formData: FormData,
): Promise<CreateLessonState> {
  await requireStudentTarget(studentId);

  const scheduledAtStr = formData.get("scheduledAt") as string;
  if (!scheduledAtStr) return { error: "날짜와 시간을 입력해주세요." };

  const scheduledAt = new Date(scheduledAtStr);
  if (isNaN(scheduledAt.getTime()))
    return { error: "유효하지 않은 날짜입니다." };

  const db = createDb();
  await db.insert(lessons).values({
    id: crypto.randomUUID(),
    studentId,
    scheduledAt,
  });

  revalidatePath(`/dashboard/admin/students/${studentId}`);
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/student");
  return { success: true };
}

// ───────────────────────────────────────────────
// Admin: 레슨 삭제
// ───────────────────────────────────────────────

/**
 * 레슨 일정 삭제 (Admin 전용).
 */
export async function deleteLesson(lessonId: string, studentId: string) {
  await requireStudentTarget(studentId);
  const db = createDb();
  await db
    .delete(lessons)
    .where(and(eq(lessons.id, lessonId), eq(lessons.studentId, studentId)));
  revalidatePath(`/dashboard/admin/students/${studentId}`);
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/student");
}
