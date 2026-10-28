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
