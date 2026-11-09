/**
 * 레슨 행의 "수업 노트" 링크(UsabilityBundle ⑤). 그 날짜(KST) 노트가 있으면 노트를 열고,
 * 없으면 날짜가 채워진 새 노트 화면으로 간다. 클라이언트에서도 쓰는 순수 함수만 둔다(조회는 lesson-note-query.ts).
 */
import { toKstDateInputValue } from "@/lib/date-input";

export function lessonNoteKey(studentId: string, date: Date): string {
  return `${studentId}:${toKstDateInputValue(date)}`;
}

/** 레슨 행의 수업 노트 링크. 노트가 있으면 열고, 없으면 그 날짜로 새 노트. */
export function buildLessonNoteLink({
  studentId,
  lessonAt,
  noteIds,
  returnTo,
}: {
  studentId: string;
  lessonAt: Date;
  noteIds: Readonly<Record<string, string>>;
  returnTo: string;
}): { href: string; existing: boolean } {
  const noteId = noteIds[lessonNoteKey(studentId, lessonAt)];
  const back = encodeURIComponent(returnTo);
  if (noteId) return { href: `/dashboard/notes/${encodeURIComponent(noteId)}?returnTo=${back}`, existing: true };
  return {
    href: `/dashboard/admin/students/${encodeURIComponent(studentId)}/notes/new?date=${toKstDateInputValue(lessonAt)}&returnTo=${back}`,
    existing: false,
  };
}

/** 레슨 행의 수업 노트 링크 모양(UsabilityBundle ⑤). 학생 상세 레슨 목록과 업무함 다가오는 레슨이 함께 쓴다. */
export const LESSON_NOTE_LINK_CLASS =
  "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:h-7";
