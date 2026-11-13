/**
 * 휴지통에 있는 게시물·질문을 화면으로 내보낼 때 지운 사람 id는 떼고, "보는 사람이 되살릴 수 없는지"만 붙인다.
 * 서버 복원 규칙(post-atomic·qna-atomic의 RESTORE_TRASH)과 같다: 관리자는 모두 되살리고,
 * 그 밖의 사람은 자기가 휴지통으로 보낸 것만 되살린다(관리자가 지운 글은 관리자만).
 */
export function withRestoreLock<T extends { deletedAt: Date | null; deletedById: string | null }>(
  row: T,
  viewer: { id: string | null | undefined; isAdmin: boolean },
): Omit<T, "deletedById"> & { restoreLocked: boolean } {
  const { deletedById, ...rest } = row;
  return {
    ...rest,
    restoreLocked: Boolean(row.deletedAt) && !viewer.isAdmin && deletedById !== viewer.id,
  };
}

/** 학생 휴지통에서 관리자가 지운 글에 붙이는 표시와 안내(캔버스 ReviewDecisionsUi ③). */
export const ADMIN_TRASHED_BADGE = "Stann이 지움";
export function adminTrashedState(deadline: string): string {
  return `Stann이 지운 글은 Stann만 되살릴 수 있습니다. ${deadline}까지 보관됩니다.`;
}
export const ADMIN_TRASHED_DETAIL_NOTE = "Stann이 휴지통으로 보낸 글이라 Stann만 되살릴 수 있습니다.";
