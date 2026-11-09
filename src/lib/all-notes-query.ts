/**
 * 관리자 "전체 노트" 목록(개선 2차 시안 3번) 조회. 대상 학생 id는 호출자가 서버에서 확정해 넘긴다.
 * 학생 id는 statement당 STUDENT_ID_CHUNK개씩 bind하고(D1 bind 100개 제한), 묶음마다 최근 수정순 상한을 건다.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { privateNotes, profiles } from "@/db/schema";
import { STUDENT_ID_CHUNK, UNIFIED_NOTE_PREVIEW_SOURCE_CHARS } from "@/lib/unified-items-store";

/** 한 화면에 싣는 노트 상한(최근 수정순). 넘으면 truncated로 알린다. */
export const ALL_NOTES_LIMIT = 1_000;

/** 실제 데이터로 가를 수 있는 노트 종류: 작성자가 Stann(관리자)인지 학생 본인인지. */
export type AllNoteKind = "STANN" | "STUDENT";

export const ALL_NOTE_KIND_LABELS: Record<AllNoteKind, string> = {
  STANN: "Stann 노트",
  STUDENT: "학생 노트",
};

export type AllNoteRow = {
  id: string;
  title: string;
  /** 검색이 없으면 본문 앞부분(미리보기용), 검색이 있으면 전체 본문. */
  contentHtml: string;
  studentId: string;
  authorId: string;
  authorName: string | null;
  kind: AllNoteKind;
  noteDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AllNotesResult = { notes: AllNoteRow[]; truncated: boolean };

export async function queryAllStudentNotes(
  db: DrizzleDb,
  studentIds: readonly string[],
  options: { fullBody: boolean; limit?: number },
): Promise<AllNotesResult> {
  const limit = options.limit ?? ALL_NOTES_LIMIT;
  const ids = [...new Set(studentIds)];
  const merged: AllNoteRow[] = [];
  let truncated = false;
  for (let index = 0; index < ids.length; index += STUDENT_ID_CHUNK) {
    const chunk = ids.slice(index, index + STUDENT_ID_CHUNK);
    const rows = await db
      .select({
        id: privateNotes.id,
        title: privateNotes.title,
        contentHtml: options.fullBody
          ? privateNotes.contentHtml
          : sql<string>`substr(${privateNotes.contentHtml}, 1, ${UNIFIED_NOTE_PREVIEW_SOURCE_CHARS})`,
        studentId: privateNotes.studentId,
        authorId: privateNotes.authorId,
        authorName: profiles.displayName,
        authorRole: profiles.role,
        noteDate: privateNotes.noteDate,
        createdAt: privateNotes.createdAt,
        updatedAt: privateNotes.updatedAt,
      })
      .from(privateNotes)
      .leftJoin(profiles, eq(profiles.id, privateNotes.authorId))
      .where(and(
        chunk.length === 1 ? eq(privateNotes.studentId, chunk[0]!) : inArray(privateNotes.studentId, chunk),
        isNull(privateNotes.deletedAt),
      ))
      .orderBy(desc(privateNotes.updatedAt), desc(privateNotes.id))
      .limit(limit + 1);
    if (rows.length > limit) truncated = true;
    for (const { authorRole, ...row } of rows.slice(0, limit)) {
      // 작성자가 학생 본인이면 학생 노트, 관리자(또는 지워진 작성자)는 Stann 노트로 본다.
      merged.push({ ...row, kind: authorRole === "student" && row.authorId === row.studentId ? "STUDENT" : "STANN" });
    }
  }
  merged.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || (left.id < right.id ? 1 : -1));
  if (merged.length > limit) truncated = true;
  return { notes: merged.slice(0, limit), truncated };
}
