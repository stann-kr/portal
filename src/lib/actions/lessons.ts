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
import { parseKstDateTimeInput } from "@/lib/date-input";

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

export type ScheduledLesson = { id: string; scheduledAt: string };

export type CreateLessonState = { error?: string; success?: boolean; lesson?: ScheduledLesson };

function parseLessonScheduleInput(formData: FormData): { ok: true; value: Date } | { ok: false; error: string } {
  const scheduledAtStr = formData.get("scheduledAt");
  if (typeof scheduledAtStr !== "string" || !scheduledAtStr) {
    return { ok: false, error: "날짜와 시간을 입력해주세요." };
  }
  const scheduledAt = parseKstDateTimeInput(scheduledAtStr) ?? new Date(scheduledAtStr);
  if (isNaN(scheduledAt.getTime())) return { ok: false, error: "유효하지 않은 날짜입니다." };
  return { ok: true, value: scheduledAt };
}

function revalidateLessonPaths(studentId: string): void {
  revalidatePath(`/dashboard/admin/students/${studentId}`);
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/student");
}

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

  const parsed = parseLessonScheduleInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  const db = createDb();
  const id = crypto.randomUUID();
  await db.insert(lessons).values({
    id,
    studentId,
    scheduledAt: parsed.value,
  });

  revalidateLessonPaths(studentId);
  return { success: true, lesson: { id, scheduledAt: parsed.value.toISOString() } };
}

/**
 * 레슨 시간 변경 (Admin 전용). 대상 학생의 레슨만 바꾸고 결과를 상태로 돌려준다.
 */
export async function rescheduleLesson(
  lessonId: string,
  studentId: string,
  _prev: CreateLessonState,
  formData: FormData,
): Promise<CreateLessonState> {
  await requireStudentTarget(studentId);

  const parsed = parseLessonScheduleInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  const db = createDb();
  const updated = await db
    .update(lessons)
    .set({ scheduledAt: parsed.value })
    .where(and(eq(lessons.id, lessonId), eq(lessons.studentId, studentId)))
    .returning({ id: lessons.id });
  if (updated.length === 0) return { error: "레슨을 찾을 수 없습니다. 목록을 새로고침해 주세요." };

  revalidateLessonPaths(studentId);
  return { success: true, lesson: { id: lessonId, scheduledAt: parsed.value.toISOString() } };
}

/**
 * 캘린더에서 끌어 옮긴 레슨 시간을 저장한다 (Admin 전용). 실패는 상태로 돌려 화면이 원위치하게 한다.
 */
export async function moveLesson(
  lessonId: string,
  studentId: string,
  scheduledAt: string,
): Promise<CreateLessonState> {
  const formData = new FormData();
  formData.set("scheduledAt", scheduledAt);
  return rescheduleLesson(lessonId, studentId, {}, formData);
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
  revalidateLessonPaths(studentId);
}
