/**
 * 노트 열람 기록(0044 `note_views`). 학생이 노트 문서를 열 때 마지막 시각을 남기고, 관리자만 본다
 * (2026-11-27 사용자 요청 "일반 노트도 최근 열람 시간이 나왔으면 좋겠어 나만 볼 수 있게"). 관리자가 연 것은 남기지 않는다.
 */
"use server";

import { inArray, sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { noteViews } from "@/db/schema";
import { requireAdmin, requireAuth } from "@/lib/auth-guard";

/** 이보다 빨리 다시 열면(새로고침·뒤로가기) 시각을 바꾸지 않는다. */
const NOTE_VIEW_REFRESH_SECONDS = 60;
/** 한 번에 읽는 노트 수. D1 bind 변수 한도(100) 아래로 나눠 읽는다. */
const NOTE_VIEW_READ_CHUNK = 90;

/**
 * 학생이 노트 문서를 열었을 때 부른다. 볼 수 있는 노트(휴지통이 아닌 자기 개인 노트, 지금 멤버인 그룹 노트)만 남긴다.
 * 관리자·없는 노트·남의 노트는 아무것도 남기지 않는다.
 */
export async function recordNoteView(noteId: string): Promise<void> {
  const session = await requireAuth();
  if (session.user.role !== "student") return;
  const studentId = session.user.id;
  if (typeof noteId !== "string" || !noteId || !studentId) return;
  const now = Math.floor(Date.now() / 1000);
  await createDb().run(sql`
    INSERT INTO note_views (note_id, student_id, last_viewed_at)
    SELECT note.id, ${studentId}, ${now} FROM private_notes AS note
    WHERE note.id = ${noteId} AND note.deleted_at IS NULL
      AND (
        (note.group_id IS NULL AND note.student_id = ${studentId})
        OR (note.group_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM lesson_group_members AS member
          WHERE member.group_id = note.group_id AND member.student_id = ${studentId}
        ))
      )
    ON CONFLICT (note_id, student_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at
    WHERE note_views.last_viewed_at <= excluded.last_viewed_at - ${NOTE_VIEW_REFRESH_SECONDS}
  `);
}

export type NoteViewEntry = { studentId: string; lastViewedAt: Date };

/** 관리자 전용: 노트마다 학생별 마지막 열람(최근 순). 기록이 없는 노트는 빈 목록이다. */
export async function getNoteViews(noteIds: readonly string[]): Promise<Record<string, NoteViewEntry[]>> {
  await requireAdmin();
  const ids = [...new Set(noteIds.filter((id) => typeof id === "string" && id))];
  const result: Record<string, NoteViewEntry[]> = {};
  if (ids.length === 0) return result;
  const db = createDb();
  for (let start = 0; start < ids.length; start += NOTE_VIEW_READ_CHUNK) {
    const rows = await db
      .select({ noteId: noteViews.noteId, studentId: noteViews.studentId, lastViewedAt: noteViews.lastViewedAt })
      .from(noteViews)
      .where(inArray(noteViews.noteId, ids.slice(start, start + NOTE_VIEW_READ_CHUNK)));
    for (const row of rows) (result[row.noteId] ??= []).push({ studentId: row.studentId, lastViewedAt: row.lastViewedAt });
  }
  for (const entries of Object.values(result)) entries.sort((a, b) => b.lastViewedAt.getTime() - a.lastViewedAt.getTime());
  return result;
}
