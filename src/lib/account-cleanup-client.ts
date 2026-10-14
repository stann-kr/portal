"use client";

import {
  ACCOUNT_CLEANUP_TOKEN_DIGEST_PATTERN,
  createAccountCleanupToken,
  digestAccountCleanupToken,
  ensureStoredAccountCleanupToken,
  listStoredAccountCleanupTokens,
  readStoredAccountCleanupToken,
  removeStoredAccountCleanupTokenIfUnchanged,
  type StoredAccountCleanupToken,
} from "@/lib/account-cleanup-token";
import {
  AccountOwnerTerminallyLockedError,
  ensureAccountTerminalDeletionLock,
  isAccountOwnerTerminallyLocked,
} from "@/lib/account-terminal-lock";
import {
  clearLocalDocumentDraftsForDeletedOwner,
  inspectBrowserLocalDocumentDraftsForOwner,
  type BrowserLocalDocumentDraftCleanupResult,
  type BrowserLocalDocumentDraftOwnerInspectionResult,
} from "@/lib/local-draft-continuity-client";

export const ACCOUNT_CLEANUP_REGISTER_ENDPOINT = "/api/account-cleanup/register";
export const ACCOUNT_CLEANUP_STATUS_ENDPOINT = "/api/account-cleanup/status";
export const ACCOUNT_CLEANUP_REQUEST_TIMEOUT_MS = 10_000;

export type AccountCleanupTokenDescriptor = {
  ownerId: string;
  tokenDigest: string;
};

export type AccountCleanupTokenReadResult =
  | { ok: true; token: AccountCleanupTokenDescriptor | null }
  | { ok: false; reason: "STORAGE_UNAVAILABLE" | "STORAGE_READ_FAILED" };

export type AccountCleanupTokenEnsureResult =
  | { ok: true; token: AccountCleanupTokenDescriptor }
  | {
      ok: false;
      reason:
        | "STORAGE_UNAVAILABLE"
        | "STORAGE_WRITE_FAILED"
        | "SECURE_RANDOM_UNAVAILABLE"
        | "OWNER_TERMINALLY_LOCKED";
    };

export type AccountCleanupRegisterRequest = { tokenDigest: string };
export type AccountCleanupRegisterResponse = { ok: true };
export type AccountCleanupStatusRequest = { tokenDigest: string };
export type AccountCleanupStatusResponse = {
  ok: true;
  status: "DELETED" | "NO_ACTION";
};

export type AccountCleanupRegistrationResult =
  | { ok: true; tokenDigest: string }
  | {
      ok: false;
      reason: "TOKEN_UNAVAILABLE" | "REQUEST_FAILED" | "INVALID_RESPONSE";
      tokenDigest?: string;
    };

export type AccountCleanupStatusRequestResult =
  | { ok: true; status: AccountCleanupStatusResponse["status"] }
  | { ok: false; reason: "REQUEST_FAILED" | "INVALID_RESPONSE" };

export type DeletedAccountLocalCleanupResult = {
  ownerId: string;
  success: boolean;
  tokenRemoved: boolean;
  reason:
    | "CLEARED"
    | "STORAGE_UNAVAILABLE"
    | "TOKEN_MISSING_OR_CHANGED"
    | "DRAFT_CLEANUP_FAILED"
    | "DRAFT_VERIFICATION_FAILED"
    | "TERMINAL_LOCK_FAILED"
    | "TOKEN_REMOVE_FAILED";
  draftCleanup: BrowserLocalDocumentDraftCleanupResult | null;
  verification: BrowserLocalDocumentDraftOwnerInspectionResult | null;
};

export type AuthenticatedDeletedAccountLocalCleanupResult = {
  ownerId: string;
  success: boolean;
  reason:
    | "CLEARED"
    | "STORAGE_UNAVAILABLE"
    | "DRAFT_CLEANUP_FAILED"
    | "DRAFT_VERIFICATION_FAILED"
    | "TERMINAL_LOCK_FAILED";
  draftCleanup: BrowserLocalDocumentDraftCleanupResult | null;
  verification: BrowserLocalDocumentDraftOwnerInspectionResult | null;
};

export type AccountCleanupStatusSweepResult = {
  checkedOwners: string[];
  noActionOwners: string[];
  cleanedOwners: string[];
  failedOwners: string[];
  storageUnavailable: boolean;
  shouldSignOut: boolean;
};

type AccountCleanupFetch = typeof fetch;

type AccountCleanupRequestOptions = {
  fetcher?: AccountCleanupFetch;
  timeoutMs?: number;
};

function readBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function toDescriptor(
  token: StoredAccountCleanupToken,
): AccountCleanupTokenDescriptor {
  return { ownerId: token.ownerId, tokenDigest: token.tokenDigest };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRegisterResponse(value: unknown): value is AccountCleanupRegisterResponse {
  return isRecord(value) && value.ok === true;
}

function isStatusResponse(value: unknown): value is AccountCleanupStatusResponse {
  return isRecord(value) &&
    value.ok === true &&
    (value.status === "DELETED" || value.status === "NO_ACTION");
}

async function postAccountCleanupRequest(
  endpoint: string,
  tokenDigest: string,
  options: AccountCleanupRequestOptions,
): Promise<Response> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("fetch unavailable");
  }
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? ACCOUNT_CLEANUP_REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(endpoint, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tokenDigest }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function readAccountCleanupToken(
  ownerId: string,
): AccountCleanupTokenReadResult {
  const storage = readBrowserStorage();
  if (!storage) return { ok: false, reason: "STORAGE_UNAVAILABLE" };
  try {
    const token = readStoredAccountCleanupToken(storage, ownerId);
    return { ok: true, token: token ? toDescriptor(token) : null };
  } catch {
    return { ok: false, reason: "STORAGE_READ_FAILED" };
  }
}

/** 원문은 localStorage에만 보존하고 호출자에는 server action용 digest만 노출한다. */
export function ensureAccountCleanupToken(
  ownerId: string,
): AccountCleanupTokenEnsureResult {
  const storage = readBrowserStorage();
  if (!storage) return { ok: false, reason: "STORAGE_UNAVAILABLE" };
  try {
    return {
      ok: true,
      token: toDescriptor(ensureStoredAccountCleanupToken(storage, ownerId)),
    };
  } catch (error) {
    const reason = error instanceof AccountOwnerTerminallyLockedError
      ? "OWNER_TERMINALLY_LOCKED"
      : error instanceof Error &&
          error.message.includes("안전한 기기 정리 token")
        ? "SECURE_RANDOM_UNAVAILABLE"
        : "STORAGE_WRITE_FAILED";
    return { ok: false, reason };
  }
}

export function isBrowserAccountOwnerTerminallyLocked(ownerId: string): boolean {
  const storage = readBrowserStorage();
  if (!storage) return false;
  try {
    return isAccountOwnerTerminallyLocked(storage, ownerId);
  } catch {
    return false;
  }
}

/** 인증된 현재 계정에 digest만 등록한다. 원문 token은 요청 body에 포함하지 않는다. */
export async function registerAccountCleanupToken(
  ownerId: string,
  options: AccountCleanupRequestOptions = {},
): Promise<AccountCleanupRegistrationResult> {
  const ensured = ensureAccountCleanupToken(ownerId);
  if (!ensured.ok) return { ok: false, reason: "TOKEN_UNAVAILABLE" };
  return registerAccountCleanupTokenDigest(ensured.token.tokenDigest, options);
}

async function registerAccountCleanupTokenDigest(
  tokenDigest: string,
  options: AccountCleanupRequestOptions,
): Promise<AccountCleanupRegistrationResult> {
  try {
    const response = await postAccountCleanupRequest(
      ACCOUNT_CLEANUP_REGISTER_ENDPOINT,
      tokenDigest,
      options,
    );
    if (!response.ok) {
      return { ok: false, reason: "REQUEST_FAILED", tokenDigest };
    }
    const value: unknown = await response.json();
    return isRegisterResponse(value)
      ? { ok: true, tokenDigest }
      : { ok: false, reason: "INVALID_RESPONSE", tokenDigest };
  } catch {
    return { ok: false, reason: "REQUEST_FAILED", tokenDigest };
  }
}

/** 저장소가 차단된 삭제 요청용 원문은 즉시 버리고 digest만 메모리에 유지한다. */
export function createEphemeralAccountCleanupTokenDigest():
  AccountCleanupRegistrationResult {
  let tokenDigest: string;
  try {
    tokenDigest = digestAccountCleanupToken(createAccountCleanupToken());
  } catch {
    return { ok: false, reason: "TOKEN_UNAVAILABLE" };
  }
  return { ok: true, tokenDigest };
}

/** 익명 endpoint에는 digest만 보내고 ACTIVE/unknown을 구분하지 않는 NO_ACTION만 받는다. */
export async function requestAccountCleanupStatus(
  tokenDigest: string,
  options: AccountCleanupRequestOptions = {},
): Promise<AccountCleanupStatusRequestResult> {
  if (!ACCOUNT_CLEANUP_TOKEN_DIGEST_PATTERN.test(tokenDigest)) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  try {
    const response = await postAccountCleanupRequest(
      ACCOUNT_CLEANUP_STATUS_ENDPOINT,
      tokenDigest,
      options,
    );
    if (!response.ok) return { ok: false, reason: "REQUEST_FAILED" };
    const value: unknown = await response.json();
    return isStatusResponse(value)
      ? { ok: true, status: value.status }
      : { ok: false, reason: "INVALID_RESPONSE" };
  } catch {
    return { ok: false, reason: "REQUEST_FAILED" };
  }
}

/** 인증된 삭제 성공 직후 token 유무와 무관하게 owner lock→삭제→재검증한다. */
export function clearAuthenticatedDeletedAccountLocalState(
  ownerId: string,
): AuthenticatedDeletedAccountLocalCleanupResult {
  const storage = readBrowserStorage();
  if (!storage) {
    return {
      ownerId,
      success: false,
      reason: "STORAGE_UNAVAILABLE",
      draftCleanup: null,
      verification: null,
    };
  }

  try {
    ensureAccountTerminalDeletionLock(storage, ownerId);
  } catch {
    return {
      ownerId,
      success: false,
      reason: "TERMINAL_LOCK_FAILED",
      draftCleanup: null,
      verification: null,
    };
  }

  const draftCleanup = clearLocalDocumentDraftsForDeletedOwner(ownerId);
  if (
    draftCleanup.storageUnavailable ||
    draftCleanup.enumerationFailed ||
    draftCleanup.failedKeys.length > 0
  ) {
    return {
      ownerId,
      success: false,
      reason: "DRAFT_CLEANUP_FAILED",
      draftCleanup,
      verification: null,
    };
  }

  const verification = inspectBrowserLocalDocumentDraftsForOwner(ownerId);
  if (
    verification.storageUnavailable ||
    verification.enumerationFailed ||
    verification.storageKeys.length > 0
  ) {
    return {
      ownerId,
      success: false,
      reason: "DRAFT_VERIFICATION_FAILED",
      draftCleanup,
      verification,
    };
  }

  try {
    if (!isAccountOwnerTerminallyLocked(storage, ownerId)) {
      return {
        ownerId,
        success: false,
        reason: "TERMINAL_LOCK_FAILED",
        draftCleanup,
        verification,
      };
    }
  } catch {
    return {
      ownerId,
      success: false,
      reason: "TERMINAL_LOCK_FAILED",
      draftCleanup,
      verification,
    };
  }

  return {
    ownerId,
    success: true,
    reason: "CLEARED",
    draftCleanup,
    verification,
  };
}

/** DELETED 확인 뒤 owner lock→durable 삭제→재열거→token CAS 순서로 수렴한다. */
export function clearDeletedAccountLocalState(
  ownerId: string,
  expectedTokenDigest: string,
): DeletedAccountLocalCleanupResult {
  const storage = readBrowserStorage();
  if (!storage) {
    return {
      ownerId,
      success: false,
      tokenRemoved: false,
      reason: "STORAGE_UNAVAILABLE",
      draftCleanup: null,
      verification: null,
    };
  }

  let token: StoredAccountCleanupToken | null;
  try {
    token = readStoredAccountCleanupToken(storage, ownerId);
  } catch {
    token = null;
  }
  if (!token || token.tokenDigest !== expectedTokenDigest) {
    return {
      ownerId,
      success: false,
      tokenRemoved: false,
      reason: "TOKEN_MISSING_OR_CHANGED",
      draftCleanup: null,
      verification: null,
    };
  }

  const ownerCleanup = clearAuthenticatedDeletedAccountLocalState(ownerId);
  if (!ownerCleanup.success) {
    return {
      ...ownerCleanup,
      tokenRemoved: false,
    };
  }

  let tokenRemoved = false;
  try {
    tokenRemoved = removeStoredAccountCleanupTokenIfUnchanged(storage, token);
  } catch {
    tokenRemoved = false;
  }
  return {
    ownerId,
    success: tokenRemoved,
    tokenRemoved,
    reason: tokenRemoved ? "CLEARED" : "TOKEN_REMOVE_FAILED",
    draftCleanup: ownerCleanup.draftCleanup,
    verification: ownerCleanup.verification,
  };
}

/** 로그인 전에는 모든 등록 token을, 로그인 후에는 현재 owner token만 익명 조회한다. */
export async function sweepAccountCleanupStatuses(
  options: AccountCleanupRequestOptions & { ownerId?: string } = {},
): Promise<AccountCleanupStatusSweepResult> {
  const result: AccountCleanupStatusSweepResult = {
    checkedOwners: [],
    noActionOwners: [],
    cleanedOwners: [],
    failedOwners: [],
    storageUnavailable: false,
    shouldSignOut: false,
  };
  const storage = readBrowserStorage();
  if (!storage) {
    result.storageUnavailable = true;
    return result;
  }

  let tokens: StoredAccountCleanupToken[];
  try {
    if (options.ownerId) {
      const token = readStoredAccountCleanupToken(storage, options.ownerId);
      if (
        isAccountOwnerTerminallyLocked(storage, options.ownerId) &&
        !token
      ) {
        result.checkedOwners.push(options.ownerId);
        result.cleanedOwners.push(options.ownerId);
        result.shouldSignOut = true;
        return result;
      }
      tokens = token ? [token] : [];
    } else {
      tokens = listStoredAccountCleanupTokens(storage);
    }
  } catch {
    result.storageUnavailable = true;
    return result;
  }

  for (const token of tokens) {
    result.checkedOwners.push(token.ownerId);
    let terminallyLocked = false;
    try {
      terminallyLocked = isAccountOwnerTerminallyLocked(
        storage,
        token.ownerId,
      );
    } catch {
      result.storageUnavailable = true;
      result.failedOwners.push(token.ownerId);
      continue;
    }
    if (terminallyLocked) {
      const cleanup = clearDeletedAccountLocalState(
        token.ownerId,
        token.tokenDigest,
      );
      if (cleanup.success) result.cleanedOwners.push(token.ownerId);
      else result.failedOwners.push(token.ownerId);
      continue;
    }

    const status = await requestAccountCleanupStatus(token.tokenDigest, options);
    if (!status.ok) {
      result.failedOwners.push(token.ownerId);
      continue;
    }
    if (status.status === "NO_ACTION") {
      result.noActionOwners.push(token.ownerId);
      continue;
    }
    const cleanup = clearDeletedAccountLocalState(
      token.ownerId,
      token.tokenDigest,
    );
    if (cleanup.success) result.cleanedOwners.push(token.ownerId);
    else result.failedOwners.push(token.ownerId);
  }

  result.shouldSignOut = Boolean(
    options.ownerId && result.cleanedOwners.includes(options.ownerId),
  );
  return result;
}
