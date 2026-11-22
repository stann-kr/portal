export const ACCOUNT_CALENDAR_TAB_STORAGE_KEY_PREFIX = "portal:calendarTab:";

export function createAccountCalendarTabStorageKey(ownerId: string): string {
  if (!ownerId) throw new TypeError("캘린더 탭 저장소에는 owner가 필요합니다.");
  return `${ACCOUNT_CALENDAR_TAB_STORAGE_KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

export function readAccountCalendarTabStorageOwnerId(
  storageKey: string,
): string | null {
  if (!storageKey.startsWith(ACCOUNT_CALENDAR_TAB_STORAGE_KEY_PREFIX)) {
    return null;
  }
  try {
    const ownerId = decodeURIComponent(
      storageKey.slice(ACCOUNT_CALENDAR_TAB_STORAGE_KEY_PREFIX.length),
    );
    return ownerId && createAccountCalendarTabStorageKey(ownerId) === storageKey
      ? ownerId
      : null;
  } catch {
    return null;
  }
}

export const ACCOUNT_NOTES_VIEW_STORAGE_KEY_PREFIX = "portal:notesView:";

/** 노트 목록 보기(표·목록) 선택은 브라우저를 쓰는 계정마다 따로 기억한다. */
export function createAccountNotesViewStorageKey(ownerId: string): string {
  if (!ownerId) throw new TypeError("노트 보기 저장소에는 owner가 필요합니다.");
  return `${ACCOUNT_NOTES_VIEW_STORAGE_KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

export function readAccountNotesViewStorageOwnerId(storageKey: string): string | null {
  if (!storageKey.startsWith(ACCOUNT_NOTES_VIEW_STORAGE_KEY_PREFIX)) return null;
  try {
    const ownerId = decodeURIComponent(storageKey.slice(ACCOUNT_NOTES_VIEW_STORAGE_KEY_PREFIX.length));
    return ownerId && createAccountNotesViewStorageKey(ownerId) === storageKey ? ownerId : null;
  } catch {
    return null;
  }
}

export const ACCOUNT_ASSIGNMENT_DRAFT_SYNC_STORAGE_KEY_PREFIX = "portal:assignmentDraftSync:";

/**
 * 과제 글 계정 임시 저장(0035)의 이 기기 동기화 표시(마지막으로 계정에 올린 글의 signature·version과 고르지 않은 쪽 보관본).
 * 계정마다 따로 두고 로그아웃·계정 삭제 때 다른 계정 저장소와 함께 지운다.
 */
export function createAccountAssignmentDraftSyncStorageKey(ownerId: string, draftKey: string): string {
  if (!ownerId || !draftKey) throw new TypeError("과제 글 동기화 저장소에는 owner와 key가 필요합니다.");
  return `${ACCOUNT_ASSIGNMENT_DRAFT_SYNC_STORAGE_KEY_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(draftKey)}`;
}

export function readAccountAssignmentDraftSyncStorageOwnerId(storageKey: string): string | null {
  if (!storageKey.startsWith(ACCOUNT_ASSIGNMENT_DRAFT_SYNC_STORAGE_KEY_PREFIX)) return null;
  const rest = storageKey.slice(ACCOUNT_ASSIGNMENT_DRAFT_SYNC_STORAGE_KEY_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  try {
    const ownerId = decodeURIComponent(rest.slice(0, separator));
    const draftKey = decodeURIComponent(rest.slice(separator + 1));
    return ownerId && draftKey && createAccountAssignmentDraftSyncStorageKey(ownerId, draftKey) === storageKey ? ownerId : null;
  } catch {
    return null;
  }
}
