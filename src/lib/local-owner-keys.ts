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
