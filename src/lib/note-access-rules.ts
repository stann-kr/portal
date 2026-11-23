/**
 * 노트(private_notes) 접근 규칙의 단일 판단(순수 함수, DB·서버 의존 없음).
 *
 * - 개인 노트(groupId null): 읽기·쓰기(편집·자동 저장·날짜·이미지·이력 되돌리기)는 그 학생 본인·관리자다. 관리자(Stann)가
 *   만든 그 학생의 개인 노트도 학생이 함께 쓴다(2026-11-23 사용자 결정, 그룹 노트 멤버와 같은 대우).
 *   휴지통 이동·휴지통 복원은 `canManageNoteLifecycle`로 따로 판단한다(작성자 본인·관리자만). 영구 삭제는 관리자만.
 * - 그룹 노트(groupId 있음): 읽기·쓰기 모두 관리자 또는 지금 그 그룹 멤버(2026-11-15/16 사용자 결정).
 *   student_id·author_id(만든 사람)로 정하지 않는다. 그룹을 떠난 학생은 접근을 잃는다.
 *
 * - 학생 편집 막기(studentReadOnly, 0036, 2026-11-23 사용자 결정): 관리자가 켜면 작성자가 아닌 학생(개인 노트의 그 학생,
 *   그룹 노트의 멤버)은 읽기만 하고 휴지통 이동·복원도 못 한다. 작성자 본인은 그대로 쓴다(학생이 만든 노트에는 켜지 않는다).
 *
 * server action·원자 쓰기·공동 편집 토큰·매체 읽기가 모두 이 함수로 판단한다. 원자 쓰기는 같은 규칙을
 * `noteWriteAccessSql`(private-note-atomic)로 같은 batch 안에서 다시 확인한다.
 */
export type NoteAccessActor = { id: string; isAdmin: boolean };

export type NoteAccessSubject = {
  studentId: string;
  authorId: string;
  groupId: string | null;
  /** 관리자가 학생 편집을 막았는지. 작성자 본인과 관리자에게는 영향이 없다. */
  studentReadOnly: boolean;
};

/** 학생 편집 막기가 이 사람에게 적용되는지(관리자·작성자 본인은 아니다). */
function blockedByReadOnly(actor: NoteAccessActor, note: NoteAccessSubject): boolean {
  return note.studentReadOnly && !actor.isAdmin && actor.id !== note.authorId;
}

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
  if (note.groupId) return isCurrentGroupMember ? (blockedByReadOnly(actor, note) ? "read" : "write") : null;
  if (actor.id !== note.studentId) return null;
  // 2026-11-23 사용자 결정: 작성자가 Stann이어도 노트 주인 학생은 쓴다(이전에는 "read"). 관리자가 막으면 읽기만.
  return blockedByReadOnly(actor, note) ? "read" : "write";
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
  if (blockedByReadOnly(actor, note)) return false;
  if (note.groupId) return isCurrentGroupMember;
  return actor.id === note.studentId && actor.id === note.authorId;
}

/**
 * 관리자가 이 노트의 학생 편집을 막을 수 있는지: 관리자가 만든 노트(개인·그룹)만. 학생이 만든 노트는 그 학생 것이라
 * 막으면 주인이 자기 노트를 못 고치게 되므로 두지 않는다(서버 action도 같은 규칙으로 거절한다).
 */
export function canToggleStudentReadOnly(actor: NoteAccessActor, note: NoteAccessSubject & { authorIsAdmin: boolean }): boolean {
  return actor.isAdmin && note.authorIsAdmin;
}

/** 멤버십 조회가 필요한 경우인지(관리자·개인 노트는 조회하지 않는다). */
export function noteAccessNeedsMembership(actor: NoteAccessActor, note: Pick<NoteAccessSubject, "groupId">): note is { groupId: string } {
  return !actor.isAdmin && Boolean(note.groupId);
}
