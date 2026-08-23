import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const ACCOUNT_TERMINAL_LOCK_STORAGE_KEY_PREFIX =
  "portal:account-terminal-lock:v1:";
export const ACCOUNT_TERMINAL_LOCK_EVENT = "portal:account-terminal-lock";

const ACCOUNT_TERMINAL_LOCK_VALUE = '{"version":1}';
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type AccountTerminalLockStorage = Pick<
  Storage,
  "getItem" | "setItem"
>;

export type AccountTerminalLockDescriptor = {
  ownerDigest: string;
  storageKey: string;
};

export type AccountTerminalLockEventDetail = {
  ownerDigest: string;
};

export class AccountOwnerTerminallyLockedError extends Error {
  constructor() {
    super("Account owner is terminally locked on this device");
    this.name = "ACCOUNT_OWNER_TERMINALLY_LOCKED";
  }
}

export function digestAccountTerminalLockOwnerId(ownerId: string): string {
  if (!ownerId) throw new TypeError("계정 terminal lock에는 owner가 필요합니다.");
  return bytesToHex(sha256(utf8ToBytes(ownerId)));
}

export function createAccountTerminalLockStorageKey(ownerId: string): string {
  return `${ACCOUNT_TERMINAL_LOCK_STORAGE_KEY_PREFIX}${digestAccountTerminalLockOwnerId(ownerId)}`;
}

export function readAccountTerminalLockStorageOwnerDigest(
  storageKey: string,
): string | null {
  if (!storageKey.startsWith(ACCOUNT_TERMINAL_LOCK_STORAGE_KEY_PREFIX)) {
    return null;
  }
  const ownerDigest = storageKey.slice(
    ACCOUNT_TERMINAL_LOCK_STORAGE_KEY_PREFIX.length,
  );
  return SHA256_HEX_PATTERN.test(ownerDigest) &&
      `${ACCOUNT_TERMINAL_LOCK_STORAGE_KEY_PREFIX}${ownerDigest}` === storageKey
    ? ownerDigest
    : null;
}

export function isAccountOwnerTerminallyLocked(
  storage: Pick<AccountTerminalLockStorage, "getItem">,
  ownerId: string,
): boolean {
  return storage.getItem(createAccountTerminalLockStorageKey(ownerId)) ===
    ACCOUNT_TERMINAL_LOCK_VALUE;
}

export function assertAccountOwnerMayPersist(
  storage: Pick<AccountTerminalLockStorage, "getItem">,
  ownerId: string,
): void {
  if (isAccountOwnerTerminallyLocked(storage, ownerId)) {
    throw new AccountOwnerTerminallyLockedError();
  }
}

function announceAccountTerminalLock(ownerDigest: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent<AccountTerminalLockEventDetail>(
        ACCOUNT_TERMINAL_LOCK_EVENT,
        { detail: { ownerDigest } },
      ),
    );
  } catch {
    // durable localStorage lock이 source of truth이므로 same-window 알림은 hint다.
  }
}

/**
 * 삭제가 확인된 owner의 모든 후속 local write를 막는 영구 lock을 기록한다.
 * storage key/value에는 raw owner ID를 남기지 않는다.
 */
export function ensureAccountTerminalDeletionLock(
  storage: AccountTerminalLockStorage,
  ownerId: string,
): AccountTerminalLockDescriptor {
  const ownerDigest = digestAccountTerminalLockOwnerId(ownerId);
  const storageKey = `${ACCOUNT_TERMINAL_LOCK_STORAGE_KEY_PREFIX}${ownerDigest}`;
  if (storage.getItem(storageKey) !== ACCOUNT_TERMINAL_LOCK_VALUE) {
    storage.setItem(storageKey, ACCOUNT_TERMINAL_LOCK_VALUE);
  }
  if (storage.getItem(storageKey) !== ACCOUNT_TERMINAL_LOCK_VALUE) {
    throw new Error("계정 terminal lock을 기기에 보존하지 못했습니다.");
  }
  announceAccountTerminalLock(ownerDigest);
  return { ownerDigest, storageKey };
}

export function isAccountTerminalLockEventForOwner(
  event: Event,
  ownerId: string,
): boolean {
  const detail = (event as CustomEvent<AccountTerminalLockEventDetail>).detail;
  return detail?.ownerDigest === digestAccountTerminalLockOwnerId(ownerId);
}
