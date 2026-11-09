/**
 * @file src/lib/actions/all-notes.ts
 * @description 관리자 "전체 노트" 목록(Admin 전용). 대상 학생은 클라이언트 값이 아니라 활성 학생 profile로 서버에서 확정한다.
 */
"use server";

import { createDb } from "@/db/client";
import { listActiveStudentProfiles, type ActiveProfile } from "@/lib/active-profile";
import { requireAdmin } from "@/lib/auth-guard";
import { queryAllStudentNotes, type AllNoteRow } from "@/lib/all-notes-query";

export type AllStudentNotes = {
  /** 필터 선택지: 활성 학생 전체. */
  students: ActiveProfile[];
  /** 활성 학생 중 고른 학생(없거나 모르는 id면 null = 전체). */
  selectedStudentId: string | null;
  notes: AllNoteRow[];
  truncated: boolean;
};

/**
 * 모든 활성 학생(또는 그중 한 명)의 휴지통 밖 노트를 최근 수정순으로 반환한다.
 * `fullBody`는 서버 검색(`?q=`)이 본문까지 찾을 때만 켠다.
 */
export async function getAllStudentNotes(input: { studentId?: string | null; fullBody?: boolean } = {}): Promise<AllStudentNotes> {
  await requireAdmin();
  const db = createDb();
  const students = await listActiveStudentProfiles(db);
  const selected = input.studentId ? students.find((student) => student.id === input.studentId) ?? null : null;
  const targetIds = selected ? [selected.id] : students.map((student) => student.id);
  if (targetIds.length === 0) return { students, selectedStudentId: null, notes: [], truncated: false };
  const { notes, truncated } = await queryAllStudentNotes(db, targetIds, { fullBody: input.fullBody === true });
  return { students, selectedStudentId: selected?.id ?? null, notes, truncated };
}
