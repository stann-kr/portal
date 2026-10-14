import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  AccountOwnerTerminallyLockedError,
  isAccountOwnerTerminallyLocked,
} from "@/lib/account-terminal-lock";
import type { FormDraftStorage } from "@/lib/form-draft";

export const ACCOUNT_CLEANUP_TOKEN_STORAGE_KEY_PREFIX =
  "portal:account-cleanup-token:";
export const ACCOUNT_CLEANUP_TOKEN_BYTES = 32;
export const ACCOUNT_CLEANUP_TOKEN_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

const ACCOUNT_CLEANUP_TOKEN_PATTERN = /^[0-9a-f]{64}$/u;

export type StoredAccountCleanupToken = {
  ownerId: string;
  storageKey: string;
  /** localStorage CAS와 익명 상태 조회 준비에만 사용하고 서버로 전송하지 않는다. */
  rawToken: string;
  tokenDigest: string;
};

export type AccountCleanupSecureRandom = Pick<Crypto, "getRandomValues">;

export function createAccountCleanupTokenStorageKey(ownerId: string): string {
  if (!ownerId) throw new TypeError("기기 정리 token에는 owner가 필요합니다.");
  return `${ACCOUNT_CLEANUP_TOKEN_STORAGE_KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

export function readAccountCleanupTokenStorageOwnerId(
  storageKey: string,
): string | null {
  if (!storageKey.startsWith(ACCOUNT_CLEANUP_TOKEN_STORAGE_KEY_PREFIX)) {
    return null;
  }
  try {
    const ownerId = decodeURIComponent(
      storageKey.slice(ACCOUNT_CLEANUP_TOKEN_STORAGE_KEY_PREFIX.length),
    );
    return ownerId && createAccountCleanupTokenStorageKey(ownerId) === storageKey
      ? ownerId
      : null;
  } catch {
    return null;
  }
}

export function digestAccountCleanupToken(rawToken: string): string {
  if (!ACCOUNT_CLEANUP_TOKEN_PATTERN.test(rawToken)) {
    throw new TypeError("유효한 기기 정리 token이 필요합니다.");
  }
  return bytesToHex(sha256(utf8ToBytes(rawToken)));
}

export function createAccountCleanupToken(
  secureRandom: AccountCleanupSecureRandom = globalThis.crypto,
): string {
  if (!secureRandom || typeof secureRandom.getRandomValues !== "function") {
    throw new Error("안전한 기기 정리 token을 만들 수 없습니다.");
  }
  const tokenBytes = new Uint8Array(ACCOUNT_CLEANUP_TOKEN_BYTES);
  secureRandom.getRandomValues(tokenBytes);
  return bytesToHex(tokenBytes);
}

export function readStoredAccountCleanupToken(
  storage: Pick<FormDraftStorage, "getItem">,
  ownerId: string,
): StoredAccountCleanupToken | null {
  const storageKey = createAccountCleanupTokenStorageKey(ownerId);
  const rawToken = storage.getItem(storageKey);
  if (!rawToken || !ACCOUNT_CLEANUP_TOKEN_PATTERN.test(rawToken)) return null;
  return {
    ownerId,
    storageKey,
    rawToken,
    tokenDigest: digestAccountCleanupToken(rawToken),
  };
}

export function ensureStoredAccountCleanupToken(
  storage: Pick<FormDraftStorage, "getItem" | "setItem" | "removeItem">,
  ownerId: string,
  secureRandom: AccountCleanupSecureRandom = globalThis.crypto,
): StoredAccountCleanupToken {
  if (isAccountOwnerTerminallyLocked(storage, ownerId)) {
    throw new AccountOwnerTerminallyLockedError();
  }

  const current = readStoredAccountCleanupToken(storage, ownerId);
  if (current) {
    if (isAccountOwnerTerminallyLocked(storage, ownerId)) {
      discardStoredAccountCleanupTokenIfUnchanged(storage, current);
      throw new AccountOwnerTerminallyLockedError();
    }
    return current;
  }

  const storageKey = createAccountCleanupTokenStorageKey(ownerId);
  const rawToken = createAccountCleanupToken(secureRandom);
  storage.setItem(storageKey, rawToken);
  if (storage.getItem(storageKey) !== rawToken) {
    throw new Error("기기 정리 token을 브라우저 저장소에 보존하지 못했습니다.");
  }
  const created = {
    ownerId,
    storageKey,
    rawToken,
    tokenDigest: digestAccountCleanupToken(rawToken),
  };
  if (isAccountOwnerTerminallyLocked(storage, ownerId)) {
    discardStoredAccountCleanupTokenIfUnchanged(storage, created);
    throw new AccountOwnerTerminallyLockedError();
  }
  return created;
}

export function listStoredAccountCleanupTokens(
  storage: FormDraftStorage,
): StoredAccountCleanupToken[] {
  const tokens: StoredAccountCleanupToken[] = [];
  const seenOwners = new Set<string>();
  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index);
    if (!storageKey) continue;
    const ownerId = readAccountCleanupTokenStorageOwnerId(storageKey);
    if (!ownerId || seenOwners.has(ownerId)) continue;
    seenOwners.add(ownerId);
    const token = readStoredAccountCleanupToken(storage, ownerId);
    if (token) tokens.push(token);
  }
  return tokens.sort((left, right) => left.ownerId.localeCompare(right.ownerId));
}

export function removeStoredAccountCleanupTokenIfUnchanged(
  storage: Pick<FormDraftStorage, "getItem" | "removeItem" | "setItem">,
  token: StoredAccountCleanupToken,
): boolean {
  try {
    if (storage.getItem(token.storageKey) !== token.rawToken) return false;
    storage.removeItem(token.storageKey);
    if (storage.getItem(token.storageKey) === null) return true;
  } catch {
    // 제거 또는 제거 확인이 실패하면 아래에서 같은 원문을 best-effort 복원한다.
  }
  try {
    if (storage.getItem(token.storageKey) === null) {
      storage.setItem(token.storageKey, token.rawToken);
    }
  } catch {
    // 저장소 자체가 차단되면 caller가 실패로 보고 다음 focus/online에서 재시도한다.
  }
  return false;
}

/** terminal lock 뒤에는 실패 시 원문을 복원하지 않고 같은 snapshot만 폐기한다. */
export function discardStoredAccountCleanupTokenIfUnchanged(
  storage: Pick<FormDraftStorage, "getItem" | "removeItem">,
  token: StoredAccountCleanupToken,
): boolean {
  try {
    const current = storage.getItem(token.storageKey);
    if (current === null) return true;
    if (current !== token.rawToken) return false;
    storage.removeItem(token.storageKey);
    return storage.getItem(token.storageKey) === null;
  } catch {
    return false;
  }
}
