/**
 * @file src/lib/actions/lesson-notes.ts
 * @description Stann 레슨 행의 "수업 노트" 링크에 쓰는 날짜별 노트 id 조회(Admin 전용).
 */
"use server";

import { createDb } from "@/db/client";
import { requireAdmin, requireStudentTarget } from "@/lib/auth-guard";
import { queryLessonNoteIds } from "@/lib/lesson-note-query";

/** 학생 한 명의 "학생:KST 날짜" → 노트 id(학생 상세 레슨 목록). */
export async function getLessonNoteIdsForStudent(studentId: string): Promise<Record<string, string>> {
  const student = await requireStudentTarget(studentId);
  return queryLessonNoteIds(createDb(), [student.id]);
}

/** 여러 학생의 기간 안 "학생:KST 날짜" → 노트 id(업무함 다가오는 레슨). */
export async function getLessonNoteIdsInRange(
  studentIds: string[],
  range: { from: Date; to: Date },
): Promise<Record<string, string>> {
  await requireAdmin();
  return queryLessonNoteIds(createDb(), studentIds, range);
}
