/** 제자리 rebase 전후에 Y.Doc으로 보내는 알림 이름. 편집기가 이 기기 커서·스크롤을 기억했다가 되살린다. */
export const COLLAB_REBASE_EVENT = "portal-collab-rebase";

/** 화면 아래 떠 있는 공동 편집 안내가 가리는 높이(px). 안내가 body data 속성에 쓰고 편집기 자동 스크롤이 읽는다. */
export const COLLAB_NOTICE_INSET_ATTRIBUTE = "collabNoticeInset";

export function readCollabNoticeInset(): number {
  if (typeof document === "undefined") return 0;
  const value = Number(document.body?.dataset[COLLAB_NOTICE_INSET_ATTRIBUTE] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
