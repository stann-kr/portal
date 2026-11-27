/**
 * 노트 열람 기록(0044 `note_views`). 학생이 노트 문서를 열 때 마지막 시각을 남기고, 관리자만 본다
 * (2026-11-27 사용자 요청 "일반 노트도 최근 열람 시간이 나왔으면 좋겠어 나만 볼 수 있게"). 관리자가 연 것은 남기지 않는다.
 */
"use server";

import { sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { requireAdmin, requireAuth } from "@/lib/auth-guard";

/** 이보다 빨리 다시 열면(새로고침·뒤로가기) 시각을 바꾸지 않는다. */
const NOTE_VIEW_REFRESH_SECONDS = 60;

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

/**
 * 관리자 전용: 노트마다 학생별 마지막 열람(최근 순). 기록이 없는 노트는 빠진다.
 * 지금 볼 수 있는 학생만 센다: 개인 노트는 그 학생, 그룹 노트는 지금 멤버(그룹에서 빠진 학생의 예전 기록은 숨긴다).
 */
export async function getNoteViews(noteIds: readonly string[]): Promise<Record<string, NoteViewEntry[]>> {
  await requireAdmin();
  const ids = [...new Set(noteIds.filter((id) => typeof id === "string" && id))];
  const result: Record<string, NoteViewEntry[]> = {};
  if (ids.length === 0) return result;
  const rows = await createDb().all<{ noteId: string; studentId: string; lastViewedAt: number }>(sql`
    SELECT view.note_id AS noteId, view.student_id AS studentId, view.last_viewed_at AS lastViewedAt
    FROM note_views AS view
    JOIN private_notes AS note ON note.id = view.note_id
    WHERE view.note_id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
      AND (
        (note.group_id IS NULL AND view.student_id = note.student_id)
        OR (note.group_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM lesson_group_members AS member
          WHERE member.group_id = note.group_id AND member.student_id = view.student_id
        ))
      )
    ORDER BY view.last_viewed_at DESC, view.student_id
  `);
  for (const row of rows) {
    (result[row.noteId] ??= []).push({ studentId: row.studentId, lastViewedAt: new Date(row.lastViewedAt * 1000) });
  }
  return result;
}
