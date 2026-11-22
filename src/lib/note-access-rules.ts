/**
 * 노트(private_notes) 접근 규칙의 단일 판단(순수 함수, DB·서버 의존 없음).
 *
 * - 개인 노트(groupId null): 읽기·쓰기(편집·자동 저장·날짜·이미지·이력 되돌리기)는 그 학생 본인·관리자다. 관리자(Stann)가
 *   만든 그 학생의 개인 노트도 학생이 함께 쓴다(2026-11-23 사용자 결정, 그룹 노트 멤버와 같은 대우).
 *   휴지통 이동·휴지통 복원은 `canManageNoteLifecycle`로 따로 판단한다(작성자 본인·관리자만). 영구 삭제는 관리자만.
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
  // 2026-11-23 사용자 결정: 작성자가 Stann이어도 노트 주인 학생은 쓴다(이전에는 "read").
  return "write";
}

/**
 * 휴지통 이동·휴지통 복원을 할 수 있는지. 관리자, 그룹 노트는 지금 멤버(기존 규칙 그대로),
 * 개인 노트는 작성자 본인(그 학생 공간)만이다. 학생은 Stann이 만든 자기 노트를 고칠 수 있지만 버리지는 못한다(2026-11-23).
 * 서버 원자 쓰기는 같은 규칙을 `noteWriteAccessSql(actor, "lifecycle")`로 같은 batch 안에서 다시 확인한다.
 */
export function canManageNoteLifecycle(
  actor: NoteAccessActor,
  note: NoteAccessSubject,
  isCurrentGroupMember: boolean,
): boolean {
  if (actor.isAdmin) return true;
  if (note.groupId) return isCurrentGroupMember;
  return actor.id === note.studentId && actor.id === note.authorId;
}

/** 멤버십 조회가 필요한 경우인지(관리자·개인 노트는 조회하지 않는다). */
export function noteAccessNeedsMembership(actor: NoteAccessActor, note: Pick<NoteAccessSubject, "groupId">): note is { groupId: string } {
  return !actor.isAdmin && Boolean(note.groupId);
}
