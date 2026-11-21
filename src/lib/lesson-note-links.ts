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

/** 그룹 노트 id 표의 열쇠("group:그룹:KST 날짜"). 학생 열쇠와 겹치지 않는다. */
export function groupLessonNoteKey(groupId: string, date: Date): string {
  return `group:${groupId}:${toKstDateInputValue(date)}`;
}

/**
 * 그룹레슨 줄의 수업 노트 링크(결정 ux1120-group-lesson-tools). 그 날 그룹 노트가 있으면 열고,
 * 없으면 첫 멤버의 새 노트 화면을 저장 위치 "그룹 노트"로 연다(그 학생의 지금 그룹에 저장된다).
 */
export function buildGroupLessonNoteLink({
  groupId,
  memberId,
  lessonAt,
  noteIds,
  returnTo,
}: {
  groupId: string;
  memberId: string;
  lessonAt: Date;
  noteIds: Readonly<Record<string, string>>;
  returnTo: string;
}): { href: string; existing: boolean } {
  const noteId = noteIds[groupLessonNoteKey(groupId, lessonAt)];
  const back = encodeURIComponent(returnTo);
  if (noteId) return { href: `/dashboard/notes/${encodeURIComponent(noteId)}?returnTo=${back}`, existing: true };
  return {
    href: `/dashboard/admin/students/${encodeURIComponent(memberId)}/notes/new?date=${toKstDateInputValue(lessonAt)}&space=group&returnTo=${back}`,
    existing: false,
  };
}

/** 레슨 행의 수업 노트 링크 모양(UsabilityBundle ⑤). 학생 상세 레슨 목록과 업무함 다가오는 레슨이 함께 쓴다. */
export const LESSON_NOTE_LINK_CLASS =
  "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:h-7";
