/**
 * 노트(private_notes) 접근 규칙의 단일 판단(순수 함수, DB·서버 의존 없음).
 *
 * - 개인 노트(groupId null): 읽기는 그 학생 본인·관리자, 쓰기(편집·휴지통·복원·되돌리기)는 작성자 본인·관리자.
 * - 그룹 노트(groupId 있음): 읽기·쓰기 모두 관리자 또는 지금 그 그룹 멤버(2026-11-15/16 사용자 결정).
 *   student_id·author_id(만든 사람)로 정하지 않는다. 그룹을 떠난 학생은 접근을 잃는다.
 *
 * server action·원자 쓰기·공동 편집 토큰·매체 읽기가 모두 이 함수로 판단한다. 원자 쓰기는 같은 규칙을
 * `noteWriteAccessSql`(private-note-atomic)로 같은 batch 안에서 다시 확인한다.
 */
export type NoteAccessActor = { id: string; isAdmin: boolean };

export type NoteAccessSubject = {
  studentId: string;
  authorId: string;
  groupId: string | null;
};

export type NoteAccessMode = "write" | "read";

/**
 * @param isCurrentGroupMember 그룹 노트일 때 actor가 지금 `groupId` 멤버인지. 개인 노트·관리자는 보지 않는다.
 * @returns "write" | "read" | null(접근 없음)
 */
export function resolveNoteAccess(
  actor: NoteAccessActor,
  note: NoteAccessSubject,
  isCurrentGroupMember: boolean,
): NoteAccessMode | null {
  if (actor.isAdmin) return "write";
  if (note.groupId) return isCurrentGroupMember ? "write" : null;
  if (actor.id !== note.studentId) return null;
  return actor.id === note.authorId ? "write" : "read";
}

/** 멤버십 조회가 필요한 경우인지(관리자·개인 노트는 조회하지 않는다). */
export function noteAccessNeedsMembership(actor: NoteAccessActor, note: Pick<NoteAccessSubject, "groupId">): note is { groupId: string } {
  return !actor.isAdmin && Boolean(note.groupId);
}
