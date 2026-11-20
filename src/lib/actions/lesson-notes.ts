/**
 * @file src/lib/actions/lesson-notes.ts
 * @description Stann 레슨 행의 "수업 노트" 링크에 쓰는 날짜별 노트 id 조회(Admin 전용).
 */
"use server";

import { createDb, createDbContext } from "@/db/client";
import { requireAdmin, requireStudentTarget } from "@/lib/auth-guard";
import { queryGroupLessonNoteIds, queryLessonNoteIds } from "@/lib/lesson-note-query";
import { readStudentLessonGroupId } from "@/lib/lesson-groups";

/**
 * 학생 한 명의 레슨 목록 노트 id(학생 상세). 개인 노트는 "학생:KST 날짜", 그 학생이 지금 속한 그룹의 그룹 노트는
 * "group:그룹:KST 날짜" 열쇠다(그룹레슨 줄은 그룹 노트만 본다, 캔버스 UxReview1120Policies ⑪). 그룹은 서버가 학생에게서 정한다.
 */
export async function getLessonNoteIdsForStudent(studentId: string): Promise<Record<string, string>> {
  const student = await requireStudentTarget(studentId);
  const db = createDb();
  const groupId = await readStudentLessonGroupId(createDbContext(), student.id);
  const [personal, grouped] = await Promise.all([
    queryLessonNoteIds(db, [student.id]),
    groupId ? queryGroupLessonNoteIds(db, { groupId }) : Promise.resolve({}),
  ]);
  return { ...personal, ...grouped };
}

/** 여러 학생의 기간 안 "학생:KST 날짜" → 노트 id(업무함 다가오는 레슨). */
export async function getLessonNoteIdsInRange(
  studentIds: string[],
  range: { from: Date; to: Date },
): Promise<Record<string, string>> {
  await requireAdmin();
  return queryLessonNoteIds(createDb(), studentIds, range);
}

/** 기간 안 "group:그룹:KST 날짜" → 그룹 노트 id(업무함 그룹레슨 줄, 결정 ux1120-group-lesson-tools). */
export async function getGroupLessonNoteIdsInRange(range: { from: Date; to: Date }): Promise<Record<string, string>> {
  await requireAdmin();
  return queryGroupLessonNoteIds(createDb(), { range });
}
