import { digestAccountTerminalLockOwnerId } from "@/lib/account-terminal-lock";

/**
 * 로그아웃 중 잠금. 로그아웃하는 탭이 서버 초안 폐기를 보내기 전에 기록해, 같은 계정의 다른 탭(과 같은 탭의
 * 편집기)이 폐기 직후 서버 초안을 다시 저장(UPSERT)하지 않게 한다. 계정 삭제의 terminal lock과 달리
 * 되돌릴 수 있다: 로그아웃이 실패하면 풀고, 탭이 닫혀 풀지 못해도 짧은 만료 뒤 저절로 풀린다.
 * 다른 탭은 storage 이벤트로, 같은 탭은 CustomEvent로 바로 알게 되고, 저장 직전에는 저장소 값을 다시 읽는다.
 */
export const ACCOUNT_LOGOUT_LOCK_STORAGE_KEY_PREFIX = "portal:account-logout-lock:v1:";
export const ACCOUNT_LOGOUT_LOCK_EVENT = "portal:account-logout-lock";
/** 폐기 대기 상한(3초)과 로그아웃 요청 시간을 덮는 만료. 넘기면 다른 탭이 다시 저장한다. */
export const ACCOUNT_LOGOUT_LOCK_TTL_MS = 15_000;

type LogoutLockStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AccountLogoutLockEventDetail = {
  ownerDigest: string;
  locked: boolean;
};

export type AccountLogoutLockHandle = {
  storageKey: string;
  raw: string;
};

export function createAccountLogoutLockStorageKey(ownerId: string): string {
  return `${ACCOUNT_LOGOUT_LOCK_STORAGE_KEY_PREFIX}${digestAccountTerminalLockOwnerId(ownerId)}`;
}

function readExpiresAt(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { version, expiresAt } = value as { version?: unknown; expiresAt?: unknown };
    return version === 1 && typeof expiresAt === "number" && Number.isFinite(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

/** 만료 전 잠금이 있으면 true. 읽을 수 없는 값은 잠금으로 보지 않는다(저장을 영구히 막지 않게). */
export function isAccountOwnerLogoutLocked(
  storage: Pick<Storage, "getItem">,
  ownerId: string,
  now: number = Date.now(),
): boolean {
  if (!ownerId) return false;
  const expiresAt = readExpiresAt(storage.getItem(createAccountLogoutLockStorageKey(ownerId)));
  return expiresAt !== null && expiresAt > now;
}

function announce(ownerId: string, locked: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent<AccountLogoutLockEventDetail>(ACCOUNT_LOGOUT_LOCK_EVENT, {
        detail: { ownerDigest: digestAccountTerminalLockOwnerId(ownerId), locked },
      }),
    );
  } catch {
    // 저장소 값이 원본이므로 같은 탭 알림 실패는 저장 직전 확인으로 수렴한다.
  }
}

/**
 * 잠금을 기록하고 같은 탭에 알린다. 다른 탭은 이 기록의 storage 이벤트를 받는다.
 * 저장소를 쓸 수 없으면 null을 돌려준다(로그아웃은 계속한다).
 */
export function acquireAccountLogoutLock(
  storage: LogoutLockStorage,
  ownerId: string,
  { now = Date.now(), ttlMs = ACCOUNT_LOGOUT_LOCK_TTL_MS }: { now?: number; ttlMs?: number } = {},
): AccountLogoutLockHandle | null {
  const storageKey = createAccountLogoutLockStorageKey(ownerId);
  const raw = JSON.stringify({ version: 1, expiresAt: now + ttlMs });
  let handle: AccountLogoutLockHandle | null = null;
  try {
    storage.setItem(storageKey, raw);
    if (storage.getItem(storageKey) === raw) handle = { storageKey, raw };
  } catch {
    handle = null;
  }
  announce(ownerId, true);
  return handle;
}

/** 로그아웃이 실패했을 때 내가 건 잠금만 푼다(그사이 다른 탭이 새로 건 잠금은 남긴다). */
export function releaseAccountLogoutLock(
  storage: LogoutLockStorage,
  ownerId: string,
  handle: AccountLogoutLockHandle | null,
): void {
  if (handle) {
    try {
      if (storage.getItem(handle.storageKey) === handle.raw) storage.removeItem(handle.storageKey);
    } catch {
      // 지우지 못한 잠금은 만료로 풀린다.
    }
  }
  announce(ownerId, false);
}

export function isAccountLogoutLockEventForOwner(event: Event, ownerId: string): boolean {
  if (!ownerId) return false;
  const detail = (event as CustomEvent<AccountLogoutLockEventDetail>).detail;
  return detail?.ownerDigest === digestAccountTerminalLockOwnerId(ownerId);
}
