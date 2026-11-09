/**
 * @file src/lib/actions/all-notes.ts
 * @description 관리자 "전체 노트" 목록(Admin 전용). 대상 학생은 클라이언트 값이 아니라 활성 학생 profile로 서버에서 확정한다.
 */
"use server";

import { createDb } from "@/db/client";
import { listActiveStudentProfiles, type ActiveProfile } from "@/lib/active-profile";
import { requireAdmin } from "@/lib/auth-guard";
import { normalizeDocumentSearchQuery } from "@/lib/document-search";
import { decodeAllNotesCursor, queryAllStudentNotesPage, type AllNoteRow } from "@/lib/all-notes-query";

export type AllStudentNotes = {
  /** 필터 선택지: 활성 학생 전체. */
  students: ActiveProfile[];
  /** 활성 학생 중 고른 학생(없거나 모르는 id면 null = 전체). */
  selectedStudentId: string | null;
  /** 이 페이지 노트(최근 수정순). 본문 전체는 싣지 않고 짧은 미리보기만 담는다. */
  notes: AllNoteRow[];
  /** 읽은 커서가 올바르면 true(깨진 값은 첫 페이지로 돌아간다). */
  continued: boolean;
  nextCursor: string | null;
};

/**
 * 모든 활성 학생(또는 그중 한 명)의 휴지통 밖 노트를 최근 수정순으로 한 페이지씩 반환한다.
 * `query`는 제목·본문 검색어, `cursor`는 앞 페이지가 준 `nextCursor`다.
 */
export async function getAllStudentNotes(
  input: { studentId?: string | null; query?: string; cursor?: string | null } = {},
): Promise<AllStudentNotes> {
  await requireAdmin();
  const db = createDb();
  const students = await listActiveStudentProfiles(db);
  const selected = input.studentId ? students.find((student) => student.id === input.studentId) ?? null : null;
  const cursor = decodeAllNotesCursor(input.cursor);
  if (students.length === 0) {
    return { students, selectedStudentId: null, notes: [], continued: false, nextCursor: null };
  }
  const { notes, nextCursor } = await queryAllStudentNotesPage(db, {
    studentId: selected?.id ?? null,
    query: normalizeDocumentSearchQuery(input.query),
    cursor,
  });
  return { students, selectedStudentId: selected?.id ?? null, notes, continued: cursor !== null, nextCursor };
}
