/**
 * 레슨 행 수업 노트 링크용 조회. 노트 날짜는 noteDate, 없으면 createdAt(노트 목록과 같은 규칙)이다.
 */
import { and, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { privateNotes } from "@/db/schema";
import { lessonNoteKey } from "@/lib/lesson-note-links";

/** D1 statement당 bind 100개 제한 안에서 학생 id를 받는다. */
export const LESSON_NOTE_STUDENT_LIMIT = 80;

/**
 * 학생들의 노트를 "학생:KST 날짜" → 노트 id로 묶는다. 같은 날 노트가 여럿이면 가장 최근에 고친 노트.
 * range가 있으면 그 기간(앞뒤 하루 여유)의 노트만 읽는다.
 */
export async function queryLessonNoteIds(
  db: DrizzleDb,
  studentIds: readonly string[],
  range?: { from: Date; to: Date },
): Promise<Record<string, string>> {
  const ids = [...new Set(studentIds)].slice(0, LESSON_NOTE_STUDENT_LIMIT);
  if (ids.length === 0) return {};
  const margin = 24 * 60 * 60 * 1000;
  const from = range ? new Date(range.from.getTime() - margin) : null;
  const to = range ? new Date(range.to.getTime() + margin) : null;
  const rows = await db
    .select({
      id: privateNotes.id,
      studentId: privateNotes.studentId,
      noteDate: privateNotes.noteDate,
      createdAt: privateNotes.createdAt,
      updatedAt: privateNotes.updatedAt,
    })
    .from(privateNotes)
    .where(and(
      inArray(privateNotes.studentId, ids),
      isNull(privateNotes.deletedAt),
      from && to
        ? or(
            and(gte(privateNotes.noteDate, from), lte(privateNotes.noteDate, to)),
            and(isNull(privateNotes.noteDate), gte(privateNotes.createdAt, from), lte(privateNotes.createdAt, to)),
          )
        : undefined,
    ));
  const picked = new Map<string, { id: string; updated: number }>();
  for (const row of rows) {
    const date = row.noteDate ?? row.createdAt;
    if (!date) continue;
    const key = lessonNoteKey(row.studentId, date);
    const updated = row.updatedAt?.getTime() ?? 0;
    const current = picked.get(key);
    if (!current || updated > current.updated) picked.set(key, { id: row.id, updated });
  }
  return Object.fromEntries([...picked].map(([key, value]) => [key, value.id]));
}

