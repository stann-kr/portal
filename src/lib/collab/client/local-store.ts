"use client";

import { digestAccountTerminalLockOwnerId } from "@/lib/account-terminal-lock";
import { parseCollabDocKey } from "@/lib/collab/doc-key";
import {
  FORM_DRAFT_BROADCAST_CHANNEL,
  FORM_DRAFT_CHANGE_EVENT,
  type FormDraftChangeDetail,
} from "@/lib/form-draft/page-session";

/**
 * 공동 편집 기기 보관(IndexedDB·localStorage) 이름 규칙과 계정 경계 정리.
 *
 * - IndexedDB 문서: `portal-collab:<owner>:<roomKey>:<generation>`
 * - IndexedDB 확인본: `portal-collab-confirmed:<owner>:<roomKey>:<generation>`
 * - generation: `portal-collab-gen:<owner>:<roomKey>`
 * - 복구본: `portal-collab-recovered:<owner>:<roomKey>:<ms>`(JSON에 userId)
 * - 이름 색인: `portal-collab-dbs:v1:<owner>` = 이 owner로 연 DB 이름 JSON 배열
 * - 잠금: `portal-collab-locked:v1:<sha256(owner)>`
 *
 * 구버전(개발 중에만 존재): IDB `portal-collab:<roomKey>:<epoch>`, `portal-collab-epoch:<roomKey>`,
 * `portal-collab-recovered:<roomKey>:<ms>`(JSON userId). owner를 모르므로 어느 정리에서나 지우되,
 * 구버전 복구본은 JSON userId가 다른(보존 대상) 계정이면 남긴다.
 */

export const COLLAB_DOC_DB_PREFIX = "portal-collab:";
export const COLLAB_CONFIRMED_DB_PREFIX = "portal-collab-confirmed:";
export const COLLAB_GENERATION_PREFIX = "portal-collab-gen:";
export const COLLAB_RECOVERED_PREFIX = "portal-collab-recovered:";
export const COLLAB_DB_INDEX_PREFIX = "portal-collab-dbs:v1:";
export const COLLAB_OWNER_LOCK_PREFIX = "portal-collab-locked:v1:";
export const COLLAB_LEGACY_EPOCH_PREFIX = "portal-collab-epoch:";
/** 같은 window에 잠금·해제를 알린다(detail: {@link CollabOwnerLockEventDetail}). */
export const COLLAB_OWNER_LOCK_EVENT = "portal:collab-owner-lock";
export const COLLAB_DELETE_TIMEOUT_MS = 3_000;

const OWNER_SEGMENT = /^[^:]+$/u;
const INTEGER_SEGMENT = /^\d+$/u;
const LOCK_VALUE = '{"version":1}';

export type CollabOwnerLockEventDetail = { ownerDigest: string; locked: boolean };

export type CollabDeleteOutcome = "deleted" | "blocked" | "error";

export type CollabLocalCleanupResult = {
  /** 지우지 못한(또는 확인하지 못한) DB 이름과 localStorage key. 비어 있어야 성공이다. */
  remaining: string[];
  deletedDbNames: string[];
  storageUnavailable: boolean;
};

export type CollabLocalClearOptions = {
  deleteTimeoutMs?: number;
};

type CollabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

type IndexedDbLike = {
  deleteDatabase(name: string): IDBOpenDBRequest;
  databases?: () => Promise<Array<{ name?: string }>>;
};

function assertOwner(owner: string): void {
  if (!owner || !OWNER_SEGMENT.test(owner)) throw new TypeError("INVALID_COLLAB_OWNER");
}

function readStorage(): CollabStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readIndexedDb(): IndexedDbLike | null {
  try {
    const value = (globalThis as { indexedDB?: IndexedDbLike }).indexedDB;
    return value && typeof value.deleteDatabase === "function" ? value : null;
  } catch {
    return null;
  }
}

// --- 이름 builder ---

export function collabDocDbName(owner: string, roomKey: string, generation: number): string {
  assertOwner(owner);
  return `${COLLAB_DOC_DB_PREFIX}${owner}:${roomKey}:${generation}`;
}

export function collabConfirmedDbName(owner: string, roomKey: string, generation: number): string {
  assertOwner(owner);
  return `${COLLAB_CONFIRMED_DB_PREFIX}${owner}:${roomKey}:${generation}`;
}

export function collabGenerationStorageKey(owner: string, roomKey: string): string {
  assertOwner(owner);
  return `${COLLAB_GENERATION_PREFIX}${owner}:${roomKey}`;
}

/** 복구본 key 접두사. 실제 key는 `${prefix}${roomKey}:${ms}`. */
export function collabRecoveryStoragePrefix(owner: string): string {
  assertOwner(owner);
  return `${COLLAB_RECOVERED_PREFIX}${owner}:`;
}

export function collabRecoveryStorageKey(owner: string, roomKey: string, ms: number): string {
  return `${collabRecoveryStoragePrefix(owner)}${roomKey}:${ms}`;
}

export function collabDbIndexStorageKey(owner: string): string {
  assertOwner(owner);
  return `${COLLAB_DB_INDEX_PREFIX}${owner}`;
}

function collabOwnerLockStorageKey(owner: string): string {
  return `${COLLAB_OWNER_LOCK_PREFIX}${digestAccountTerminalLockOwnerId(owner)}`;
}

// --- 이름 해석 ---

type ParsedCollabName =
  | { scope: "owner"; owner: string; roomKey: string }
  | { scope: "legacy"; roomKey: string };

/** `<rest>`가 `<roomKey>:<int>`(구버전) 또는 `<owner>:<roomKey>:<int>`(현재)인지 판정한다. */
function parseOwnedSuffix(rest: string, requireInteger: boolean): ParsedCollabName | null {
  const lastColon = rest.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const tail = rest.slice(lastColon + 1);
  if (requireInteger && !INTEGER_SEGMENT.test(tail)) return null;
  const head = rest.slice(0, lastColon);
  if (parseCollabDocKey(head)) return { scope: "legacy", roomKey: head };
  const firstColon = head.indexOf(":");
  if (firstColon <= 0) return null;
  const owner = head.slice(0, firstColon);
  const roomKey = head.slice(firstColon + 1);
  if (!parseCollabDocKey(roomKey)) return null;
  return { scope: "owner", owner, roomKey };
}

/** 공동 편집 IndexedDB 이름이면 owner(구버전이면 legacy)를 돌려준다. 다른 DB는 null. */
export function parseCollabDbName(name: string): ParsedCollabName | null {
  if (name.startsWith(COLLAB_CONFIRMED_DB_PREFIX)) {
    const parsed = parseOwnedSuffix(name.slice(COLLAB_CONFIRMED_DB_PREFIX.length), true);
    // 확인본은 owner 도입 뒤에만 생겼다.
    return parsed?.scope === "owner" ? parsed : null;
  }
  if (name.startsWith(COLLAB_DOC_DB_PREFIX)) {
    return parseOwnedSuffix(name.slice(COLLAB_DOC_DB_PREFIX.length), true);
  }
  return null;
}

type ParsedStorageKey =
  | { kind: "generation"; owner: string }
  | { kind: "recovered"; owner: string }
  | { kind: "legacy-recovered"; userId: string | null }
  | { kind: "legacy-epoch" }
  | { kind: "index"; owner: string }
  | { kind: "lock" };

function readLegacyRecoveryUserId(storage: CollabStorage, key: string): string | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (value && typeof value === "object" && typeof (value as { userId?: unknown }).userId === "string") {
      return (value as { userId: string }).userId || null;
    }
  } catch {
    // 해석하지 못한 구버전 복구본은 owner를 모르는 것으로 본다.
  }
  return null;
}

function parseCollabStorageKey(storage: CollabStorage, key: string): ParsedStorageKey | null {
  if (key.startsWith(COLLAB_OWNER_LOCK_PREFIX)) return { kind: "lock" };
  if (key.startsWith(COLLAB_DB_INDEX_PREFIX)) {
    const owner = key.slice(COLLAB_DB_INDEX_PREFIX.length);
    return OWNER_SEGMENT.test(owner) ? { kind: "index", owner } : null;
  }
  if (key.startsWith(COLLAB_LEGACY_EPOCH_PREFIX)) return { kind: "legacy-epoch" };
  if (key.startsWith(COLLAB_GENERATION_PREFIX)) {
    const rest = key.slice(COLLAB_GENERATION_PREFIX.length);
    const colon = rest.indexOf(":");
    if (colon <= 0 || !parseCollabDocKey(rest.slice(colon + 1))) return null;
    return { kind: "generation", owner: rest.slice(0, colon) };
  }
  if (key.startsWith(COLLAB_RECOVERED_PREFIX)) {
    const parsed = parseOwnedSuffix(key.slice(COLLAB_RECOVERED_PREFIX.length), true);
    if (!parsed) return null;
    return parsed.scope === "owner"
      ? { kind: "recovered", owner: parsed.owner }
      : { kind: "legacy-recovered", userId: readLegacyRecoveryUserId(storage, key) };
  }
  return null;
}

function listStorageKeys(storage: CollabStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

type OwnerSelector = (owner: string) => boolean;

/** 정리 범위. legacy 복구본은 userId가 보존 대상이면 남긴다(모르면 지운다). */
type CleanupScope = {
  ownerMatches: OwnerSelector;
  legacyRecoveryMatches: (userId: string | null) => boolean;
};

function scopeForOwner(owner: string): CleanupScope {
  return {
    ownerMatches: (candidate) => candidate === owner,
    legacyRecoveryMatches: (userId) => userId === null || userId === owner,
  };
}

function scopeExceptOwner(owner: string): CleanupScope {
  return {
    ownerMatches: (candidate) => candidate !== owner,
    legacyRecoveryMatches: (userId) => userId !== owner,
  };
}

function dbNameInScope(name: string, scope: CleanupScope): boolean {
  const parsed = parseCollabDbName(name);
  if (!parsed) return false;
  return parsed.scope === "legacy" || scope.ownerMatches(parsed.owner);
}

/** 범위에 드는 generation·복구본·구버전 epoch key(색인·잠금 제외). */
function scopedDataStorageKeys(storage: CollabStorage, scope: CleanupScope): string[] {
  const matches: string[] = [];
  for (const key of listStorageKeys(storage)) {
    const parsed = parseCollabStorageKey(storage, key);
    if (!parsed) continue;
    if (
      (parsed.kind === "generation" || parsed.kind === "recovered") && scope.ownerMatches(parsed.owner) ||
      parsed.kind === "legacy-epoch" ||
      parsed.kind === "legacy-recovered" && scope.legacyRecoveryMatches(parsed.userId)
    ) {
      matches.push(key);
    }
  }
  return matches;
}

function readIndex(storage: CollabStorage, indexKey: string): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(indexKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function indexOwners(storage: CollabStorage): string[] {
  const owners: string[] = [];
  for (const key of listStorageKeys(storage)) {
    const parsed = parseCollabStorageKey(storage, key);
    if (parsed?.kind === "index") owners.push(parsed.owner);
  }
  return owners;
}

// --- 이름 색인 ---

/**
 * 이 owner로 연 DB 이름을 색인에 남긴다(`indexedDB.databases()`가 없는 브라우저의 정리 근거).
 * owner가 잠겨 있으면 기록하지 않고 false를 돌려준다(호출자는 DB를 열지 않아야 한다).
 */
export function rememberCollabDbName(owner: string, dbName: string): boolean {
  assertOwner(owner);
  const storage = readStorage();
  if (!storage) return false;
  try {
    if (storage.getItem(collabOwnerLockStorageKey(owner)) === LOCK_VALUE) return false;
    const indexKey = collabDbIndexStorageKey(owner);
    const names = readIndex(storage, indexKey);
    if (!names.includes(dbName)) {
      names.push(dbName);
      storage.setItem(indexKey, JSON.stringify(names));
    }
    return true;
  } catch {
    return false;
  }
}

/** 이 origin의 공동 편집 DB 이름(`databases()` 결과 ∪ 모든 owner 색인). 다른 DB는 넣지 않는다. */
export async function listCollabDbNames(): Promise<string[]> {
  const names = new Set<string>();
  const storage = readStorage();
  if (storage) {
    try {
      for (const owner of indexOwners(storage)) {
        for (const name of readIndex(storage, collabDbIndexStorageKey(owner))) {
          if (parseCollabDbName(name)) names.add(name);
        }
      }
    } catch {
      // 색인을 못 읽어도 databases() 결과로 계속한다.
    }
  }
  const idb = readIndexedDb();
  if (idb && typeof idb.databases === "function") {
    try {
      for (const info of await idb.databases()) {
        if (info.name && parseCollabDbName(info.name)) names.add(info.name);
      }
    } catch {
      // databases() 실패는 색인만으로 수렴한다.
    }
  }
  return [...names].sort();
}

// --- 삭제 ---

/**
 * `indexedDB.deleteDatabase`를 직접 기다린다. onblocked 뒤 timeout 안에 success가 오지 않으면 "blocked",
 * 응답이 아예 없으면 "error". IndexedDB가 없는 환경은 지울 DB도 없으므로 "deleted".
 */
export function deleteIndexedDb(name: string, timeoutMs: number = COLLAB_DELETE_TIMEOUT_MS): Promise<CollabDeleteOutcome> {
  const idb = readIndexedDb();
  if (!idb) return Promise.resolve("deleted");
  return new Promise((resolve) => {
    let settled = false;
    let blocked = false;
    const finish = (outcome: CollabDeleteOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish(blocked ? "blocked" : "error"), timeoutMs);
    let request: IDBOpenDBRequest;
    try {
      request = idb.deleteDatabase(name);
    } catch {
      finish("error");
      return;
    }
    request.onsuccess = () => finish("deleted");
    request.onerror = () => finish("error");
    request.onblocked = () => {
      blocked = true;
    };
  });
}

// --- owner 잠금 ---

function dispatchLockEvent(owner: string, locked: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<CollabOwnerLockEventDetail>(COLLAB_OWNER_LOCK_EVENT, {
      detail: { ownerDigest: digestAccountTerminalLockOwnerId(owner), locked },
    }));
  } catch {
    // 알림 실패는 저장된 잠금 표지로 수렴한다.
  }
}

/** 정리 시작 전에 설정한다. 늦게 도착한 token·open 응답이 DB를 다시 만들지 않게 한다. */
export function lockCollabOwner(owner: string): boolean {
  assertOwner(owner);
  const storage = readStorage();
  if (!storage) return false;
  try {
    const key = collabOwnerLockStorageKey(owner);
    storage.setItem(key, LOCK_VALUE);
    const locked = storage.getItem(key) === LOCK_VALUE;
    if (locked) dispatchLockEvent(owner, true);
    return locked;
  } catch {
    return false;
  }
}

/** 저장소를 못 읽으면 잠긴 것으로 본다(기기 보관을 열지 않는다). */
export function isCollabOwnerLocked(owner: string): boolean {
  assertOwner(owner);
  const storage = readStorage();
  if (!storage) return true;
  try {
    return storage.getItem(collabOwnerLockStorageKey(owner)) === LOCK_VALUE;
  } catch {
    return true;
  }
}

/** 새 로그인으로 owner가 앱 shell에 다시 올라올 때 푼다. */
export function unlockCollabOwner(owner: string): void {
  assertOwner(owner);
  const storage = readStorage();
  if (!storage) return;
  try {
    const key = collabOwnerLockStorageKey(owner);
    if (storage.getItem(key) === null) return;
    storage.removeItem(key);
    dispatchLockEvent(owner, false);
  } catch {
    // 풀지 못하면 이 기기 보관 없이 서버 연결로만 편집한다.
  }
}

/** 잠금·해제 알림(같은 window 이벤트 + 다른 탭의 storage 이벤트). 해제 뒤 다시 열 때 쓴다. */
export function subscribeCollabOwnerLock(
  owner: string,
  callback: (locked: boolean) => void,
): () => void {
  assertOwner(owner);
  if (typeof window === "undefined") return () => undefined;
  const digest = digestAccountTerminalLockOwnerId(owner);
  const storageKey = collabOwnerLockStorageKey(owner);
  const onLocal = (event: Event) => {
    const detail = (event as CustomEvent<CollabOwnerLockEventDetail>).detail;
    if (detail?.ownerDigest === digest) callback(detail.locked);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) callback(event.newValue === LOCK_VALUE);
  };
  window.addEventListener(COLLAB_OWNER_LOCK_EVENT, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(COLLAB_OWNER_LOCK_EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

export type CollabOwnerClearSignal = {
  mode: "owner" | "except-owner";
  ownerId: string;
};

/**
 * 로그아웃·계정 전환·계정 삭제의 continuity clear(lock: true) 알림을 받는다.
 * 같은 window 이벤트와 다른 탭 BroadcastChannel 둘 다 듣는다. 명시 폐기(lock: false)와 source 단위 폐기는 넘기지 않는다.
 * 받은 쪽은 `mode`·`ownerId`가 자기 owner를 가리키면(owner: 같음, except-owner: 다름) persistence를 닫고 다시 열지 않는다.
 */
export function subscribeCollabOwnerClear(callback: (signal: CollabOwnerClearSignal) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handle = (detail: FormDraftChangeDetail | null | undefined) => {
    if (!detail || detail.kind !== "continuity-clear" || detail.lock !== true || !detail.ownerId) return;
    if (detail.clearMode !== "owner" && detail.clearMode !== "except-owner") return;
    callback({ mode: detail.clearMode, ownerId: detail.ownerId });
  };
  const onLocal = (event: Event) => handle((event as CustomEvent<FormDraftChangeDetail>).detail);
  const onMessage = (event: MessageEvent<FormDraftChangeDetail>) => handle(event.data);
  window.addEventListener(FORM_DRAFT_CHANGE_EVENT, onLocal);
  let channel: BroadcastChannel | null = null;
  if (typeof window.BroadcastChannel === "function") {
    try {
      channel = new window.BroadcastChannel(FORM_DRAFT_BROADCAST_CHANNEL);
      channel.addEventListener("message", onMessage);
    } catch {
      channel = null;
    }
  }
  return () => {
    window.removeEventListener(FORM_DRAFT_CHANGE_EVENT, onLocal);
    if (channel) {
      channel.removeEventListener("message", onMessage);
      try {
        channel.close();
      } catch {
        // 이미 닫힌 채널.
      }
    }
  };
}

// --- 정리 ---

function removeStorageKeys(storage: CollabStorage, keys: readonly string[]): string[] {
  const failed: string[] = [];
  for (const key of keys) {
    try {
      storage.removeItem(key);
      if (storage.getItem(key) !== null) failed.push(key);
    } catch {
      failed.push(key);
    }
  }
  return failed;
}

/** 남은 이름만 색인에 다시 쓴다. 비면 색인 key를 지운다. 실패하면 색인 key를 남은 목록에 넣는다. */
function rewriteIndexes(
  storage: CollabStorage,
  owners: readonly string[],
  stillPresent: ReadonlySet<string>,
): string[] {
  const failed: string[] = [];
  for (const owner of owners) {
    const indexKey = collabDbIndexStorageKey(owner);
    try {
      const kept = readIndex(storage, indexKey).filter((name) => stillPresent.has(name));
      if (kept.length === 0) storage.removeItem(indexKey);
      else storage.setItem(indexKey, JSON.stringify(kept));
    } catch {
      failed.push(indexKey);
    }
  }
  return failed;
}

async function clearCollabScope(
  scope: CleanupScope,
  lockOwners: (storage: CollabStorage, dbNames: readonly string[]) => void,
  options: CollabLocalClearOptions,
): Promise<CollabLocalCleanupResult> {
  const storage = readStorage();
  if (!storage) return { remaining: [], deletedDbNames: [], storageUnavailable: true };
  const timeoutMs = options.deleteTimeoutMs ?? COLLAB_DELETE_TIMEOUT_MS;
  const remaining: string[] = [];

  // 동기 구간: generation·복구본·구버전 epoch는 첫 await 전에 지운다(이동으로 중단돼도 남지 않게).
  let dataKeys: string[] = [];
  try {
    dataKeys = scopedDataStorageKeys(storage, scope);
  } catch {
    remaining.push(COLLAB_GENERATION_PREFIX);
  }
  remaining.push(...removeStorageKeys(storage, dataKeys));

  const dbNames = (await listCollabDbNames()).filter((name) => dbNameInScope(name, scope));
  lockOwners(storage, dbNames);
  const outcomes = await Promise.all(dbNames.map(async (name) => [name, await deleteIndexedDb(name, timeoutMs)] as const));
  const deletedDbNames = outcomes.filter(([, outcome]) => outcome === "deleted").map(([name]) => name);
  const stillPresent = new Set(outcomes.filter(([, outcome]) => outcome !== "deleted").map(([name]) => name));
  remaining.push(...stillPresent);

  let owners: string[] = [];
  try {
    owners = indexOwners(storage).filter(scope.ownerMatches);
  } catch {
    remaining.push(COLLAB_DB_INDEX_PREFIX);
  }
  remaining.push(...rewriteIndexes(storage, owners, stillPresent));

  // 삭제 중 다른 탭이 새로 남긴 key도 확인한다.
  try {
    for (const key of scopedDataStorageKeys(storage, scope)) if (!remaining.includes(key)) remaining.push(key);
  } catch {
    // 위에서 이미 실패를 남겼다.
  }
  return { remaining: [...new Set(remaining)].sort(), deletedDbNames: deletedDbNames.sort(), storageUnavailable: false };
}

/**
 * 로그아웃·계정 삭제: 이 owner(와 owner 모르는 구버전)의 기기 보관을 지운다.
 * 삭제 전에 owner를 잠근다(호출자가 broadcast 전에 먼저 잠가 두는 것을 권한다. 다시 잠가도 무해하다).
 */
export function clearCollabLocalDataForOwner(
  owner: string,
  options: CollabLocalClearOptions = {},
): Promise<CollabLocalCleanupResult> {
  assertOwner(owner);
  lockCollabOwner(owner);
  return clearCollabScope(scopeForOwner(owner), () => undefined, options);
}

/** 계정 전환: 현재 owner 외 모든 owner(와 구버전)의 기기 보관을 지운다. 지우기 전에 그 owner들을 잠근다. */
export function clearCollabLocalDataExceptOwner(
  owner: string,
  options: CollabLocalClearOptions = {},
): Promise<CollabLocalCleanupResult> {
  assertOwner(owner);
  const scope = scopeExceptOwner(owner);
  return clearCollabScope(scope, (storage, dbNames) => {
    const others = new Set<string>();
    try {
      for (const name of dbNames) {
        const parsed = parseCollabDbName(name);
        if (parsed?.scope === "owner") others.add(parsed.owner);
      }
      for (const indexOwner of indexOwners(storage)) others.add(indexOwner);
    } catch {
      // 열거 실패한 owner는 잠그지 못한다(삭제 결과로 남은 이름이 보고된다).
    }
    others.delete(owner);
    for (const other of others) lockCollabOwner(other);
  }, options);
}

/** 이 owner(와 구버전)에 남은 공동 편집 DB 이름·localStorage key. 비어야 정리 완료다. */
export async function inspectCollabLocalDataForOwner(owner: string): Promise<string[]> {
  assertOwner(owner);
  const scope = scopeForOwner(owner);
  const remaining = new Set<string>();
  const storage = readStorage();
  if (storage) {
    try {
      for (const key of scopedDataStorageKeys(storage, scope)) remaining.add(key);
      for (const name of readIndex(storage, collabDbIndexStorageKey(owner))) remaining.add(name);
    } catch {
      remaining.add(COLLAB_DB_INDEX_PREFIX);
    }
  }
  for (const name of await listCollabDbNames()) if (dbNameInScope(name, scope)) remaining.add(name);
  return [...remaining].sort();
}
