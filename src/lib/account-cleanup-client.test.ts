import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import {
  ACCOUNT_CLEANUP_REGISTER_ENDPOINT,
  clearDeletedAccountLocalState,
  createEphemeralAccountCleanupTokenDigest,
  ensureAccountCleanupToken,
  registerAccountCleanupToken,
  requestAccountCleanupStatus,
  sweepAccountCleanupStatuses,
} from "./account-cleanup-client";
import {
  ACCOUNT_CLEANUP_TOKEN_DIGEST_PATTERN,
  createAccountCleanupTokenStorageKey,
  digestAccountCleanupToken,
  ensureStoredAccountCleanupToken,
} from "./account-cleanup-token";
import {
  createDocumentDraftKey,
  createDocumentServerDraftQueueKey,
  createFormDraftClearMarkerKey,
  createFormDraftRecoveryKey,
  persistFormDraftRawSnapshot,
  writeFormDraftClearMarker,
} from "./form-draft";
import {
  createDocumentServerDraftDeviceStorageKey,
  enqueueDocumentServerDraftDiscard,
  getOrCreateDocumentServerDraftDeviceId,
} from "./document-server-draft-queue";
import { createAccountTerminalLockStorageKey } from "./account-terminal-lock";
import { createAccountCalendarTabStorageKey, createAccountNotesViewStorageKey } from "./local-owner-keys";
import {
  listOwnerlessLegacyDocumentDrafts,
  removeOwnerlessLegacyDocumentDrafts,
  snapshotOwnerlessLegacyDocumentDrafts,
} from "./local-document-drafts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class RemovalDeniedStorage extends MemoryStorage {
  constructor(private readonly deniedKey: string) {
    super();
  }

  override removeItem(key: string): void {
    if (key === this.deniedKey) throw new Error("remove denied");
    super.removeItem(key);
  }
}

class AccessDeniedStorage extends MemoryStorage {
  accesses = 0;

  override getItem(): string | null {
    this.accesses += 1;
    throw new Error("storage denied");
  }

  override setItem(): void {
    this.accesses += 1;
    throw new Error("storage denied");
  }
}

class TerminalLockRaceStorage extends MemoryStorage {
  private interleaveKey: string | null = null;
  private interleave: (() => void) | null = null;
  private cleanupCompleted = false;
  private lateTokenKey: string | null = null;
  private deniedLateTokenRemovals = 0;
  lateTokenWrites = 0;

  armReadInterleave(storageKey: string, interleave: () => void): void {
    this.interleaveKey = storageKey;
    this.interleave = interleave;
  }

  markCleanupCompleted(tokenKey: string): void {
    this.cleanupCompleted = true;
    this.lateTokenKey = tokenKey;
  }

  denyNextLateTokenRemoval(): void {
    this.deniedLateTokenRemovals += 1;
  }

  override getItem(key: string): string | null {
    const captured = super.getItem(key);
    if (key === this.interleaveKey && this.interleave) {
      const interleave = this.interleave;
      this.interleaveKey = null;
      this.interleave = null;
      interleave();
    }
    return captured;
  }

  override setItem(key: string, value: string): void {
    if (this.cleanupCompleted && key === this.lateTokenKey) {
      this.lateTokenWrites += 1;
    }
    super.setItem(key, value);
  }

  override removeItem(key: string): void {
    if (
      this.cleanupCompleted &&
      key === this.lateTokenKey &&
      this.deniedLateTokenRemovals > 0
    ) {
      this.deniedLateTokenRemovals -= 1;
      throw new Error("late token remove denied");
    }
    super.removeItem(key);
  }
}

function installBrowserStorage(
  context: TestContext,
  storage: Storage = new MemoryStorage(),
): { browserWindow: Window; storage: Storage } {
  const browserWindow = new Window({ url: "https://portal.test/login" });
  Object.defineProperty(browserWindow, "localStorage", {
    configurable: true,
    value: storage,
  });
  const bindings = ["window", "document", "CustomEvent"] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const values: Record<(typeof bindings)[number], unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    CustomEvent: browserWindow.CustomEvent,
  };
  for (const binding of bindings) {
    previous.set(binding, Object.getOwnPropertyDescriptor(globalThis, binding));
    Object.defineProperty(globalThis, binding, {
      configurable: true,
      writable: true,
      value: values[binding],
    });
  }
  context.after(() => {
    browserWindow.close();
    for (const binding of [...bindings].reverse()) {
      const descriptor = previous.get(binding);
      if (descriptor) Object.defineProperty(globalThis, binding, descriptor);
      else Reflect.deleteProperty(globalThis, binding);
    }
  });
  return { browserWindow, storage };
}

test("기기 정리 token 원문은 owner별 localStorage에만 두고 register에는 digest만 보낸다", { concurrency: false }, async (context) => {
  const { storage } = installBrowserStorage(context);
  const ownerId = "student-register";
  const ensured = ensureAccountCleanupToken(ownerId);
  assert.equal(ensured.ok, true);
  if (!ensured.ok) return;

  const rawToken = storage.getItem(createAccountCleanupTokenStorageKey(ownerId));
  assert.match(rawToken ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(ensured.token.tokenDigest, digestAccountCleanupToken(rawToken!));

  let observedInit: RequestInit | undefined;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, ACCOUNT_CLEANUP_REGISTER_ENDPOINT);
    observedInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const registered = await registerAccountCleanupToken(ownerId, { fetcher });

  assert.deepEqual(registered, {
    ok: true,
    tokenDigest: ensured.token.tokenDigest,
  });
  assert.equal(observedInit?.cache, "no-store");
  assert.equal(observedInit?.credentials, "same-origin");
  const body = JSON.parse(String(observedInit?.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["tokenDigest"]);
  assert.equal(body.tokenDigest, ensured.token.tokenDigest);
  assert.equal(String(observedInit?.body).includes(rawToken!), false);
  assert.equal(storage.getItem(createAccountCleanupTokenStorageKey(ownerId)), rawToken);
});

test("terminal lock과 token 신규 write가 교차해도 post-write 검증이 raw owner key를 CAS 제거한다", { concurrency: false }, (context) => {
  const ownerId = "student-token-write-race";
  const tokenKey = createAccountCleanupTokenStorageKey(ownerId);
  const lockKey = createAccountTerminalLockStorageKey(ownerId);
  const storage = new TerminalLockRaceStorage();
  const initialToken = ensureStoredAccountCleanupToken(storage, ownerId);
  installBrowserStorage(context, storage);
  let cleanupSucceeded = false;

  storage.armReadInterleave(lockKey, () => {
    cleanupSucceeded = clearDeletedAccountLocalState(
      ownerId,
      initialToken.tokenDigest,
    ).success;
    storage.markCleanupCompleted(tokenKey);
  });
  const ensured = ensureAccountCleanupToken(ownerId);

  assert.equal(cleanupSucceeded, true);
  assert.equal(storage.lateTokenWrites, 1);
  assert.deepEqual(ensured, {
    ok: false,
    reason: "OWNER_TERMINALLY_LOCKED",
  });
  assert.equal(storage.getItem(tokenKey), null);
  assert.notEqual(storage.getItem(lockKey), null);
  assert.equal(lockKey.includes(ownerId), false);
});

test("기존 token read 뒤 terminal cleanup이 교차하면 post-read 검증이 stale descriptor 반환을 막는다", { concurrency: false }, (context) => {
  const ownerId = "student-token-read-race";
  const tokenKey = createAccountCleanupTokenStorageKey(ownerId);
  const storage = new TerminalLockRaceStorage();
  const initialToken = ensureStoredAccountCleanupToken(storage, ownerId);
  installBrowserStorage(context, storage);
  let cleanupSucceeded = false;

  storage.armReadInterleave(tokenKey, () => {
    cleanupSucceeded = clearDeletedAccountLocalState(
      ownerId,
      initialToken.tokenDigest,
    ).success;
    storage.markCleanupCompleted(tokenKey);
  });
  const ensured = ensureAccountCleanupToken(ownerId);

  assert.equal(cleanupSucceeded, true);
  assert.equal(storage.lateTokenWrites, 0);
  assert.deepEqual(ensured, {
    ok: false,
    reason: "OWNER_TERMINALLY_LOCKED",
  });
  assert.equal(storage.getItem(tokenKey), null);
});

test("익명 sweep은 post-write discard 실패 token을 status 조회 없이 정리하고 다른 owner를 보존한다", { concurrency: false }, async (context) => {
  const ownerId = "student-anonymous-terminal-retry";
  const retainedOwner = "student-anonymous-retained";
  const tokenKey = createAccountCleanupTokenStorageKey(ownerId);
  const lockKey = createAccountTerminalLockStorageKey(ownerId);
  const retainedSource = createDocumentDraftKey("note", retainedOwner, "retained");
  const storage = new TerminalLockRaceStorage();
  const initialToken = ensureStoredAccountCleanupToken(storage, ownerId);
  const retainedToken = ensureStoredAccountCleanupToken(storage, retainedOwner);
  storage.setItem(retainedSource, "other-owner-draft");
  installBrowserStorage(context, storage);
  let cleanupSucceeded = false;

  storage.denyNextLateTokenRemoval();
  storage.armReadInterleave(lockKey, () => {
    cleanupSucceeded = clearDeletedAccountLocalState(
      ownerId,
      initialToken.tokenDigest,
    ).success;
    storage.markCleanupCompleted(tokenKey);
  });
  const ensured = ensureAccountCleanupToken(ownerId);
  const requestedDigests: string[] = [];
  const result = await sweepAccountCleanupStatuses({
    fetcher: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tokenDigest: string };
      requestedDigests.push(body.tokenDigest);
      return new Response(JSON.stringify({ ok: true, status: "NO_ACTION" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });

  assert.equal(cleanupSucceeded, true);
  assert.deepEqual(ensured, {
    ok: false,
    reason: "OWNER_TERMINALLY_LOCKED",
  });
  assert.equal(storage.lateTokenWrites, 1);
  assert.deepEqual(requestedDigests, [retainedToken.tokenDigest]);
  assert.deepEqual(result.cleanedOwners, [ownerId]);
  assert.deepEqual(result.noActionOwners, [retainedOwner]);
  assert.equal(result.shouldSignOut, false);
  assert.equal(storage.getItem(tokenKey), null);
  assert.equal(storage.getItem(retainedToken.storageKey), retainedToken.rawToken);
  assert.equal(storage.getItem(retainedSource), "other-owner-draft");
});

test("현재 owner sweep은 post-write discard 실패 token을 직접 재정리한 뒤에만 sign-out한다", { concurrency: false }, async (context) => {
  const ownerId = "student-current-terminal-retry";
  const tokenKey = createAccountCleanupTokenStorageKey(ownerId);
  const lockKey = createAccountTerminalLockStorageKey(ownerId);
  const storage = new TerminalLockRaceStorage();
  const initialToken = ensureStoredAccountCleanupToken(storage, ownerId);
  installBrowserStorage(context, storage);
  let cleanupSucceeded = false;
  let statusRequests = 0;

  storage.denyNextLateTokenRemoval();
  storage.armReadInterleave(lockKey, () => {
    cleanupSucceeded = clearDeletedAccountLocalState(
      ownerId,
      initialToken.tokenDigest,
    ).success;
    storage.markCleanupCompleted(tokenKey);
  });
  const ensured = ensureAccountCleanupToken(ownerId);
  assert.notEqual(storage.getItem(tokenKey), null);

  const result = await sweepAccountCleanupStatuses({
    ownerId,
    fetcher: (async () => {
      statusRequests += 1;
      return new Response(JSON.stringify({ ok: true, status: "NO_ACTION" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });

  assert.equal(cleanupSucceeded, true);
  assert.deepEqual(ensured, {
    ok: false,
    reason: "OWNER_TERMINALLY_LOCKED",
  });
  assert.equal(statusRequests, 0);
  assert.deepEqual(result.cleanedOwners, [ownerId]);
  assert.deepEqual(result.failedOwners, []);
  assert.equal(result.shouldSignOut, true);
  assert.equal(storage.getItem(tokenKey), null);
});

test("localStorage가 차단되어도 ephemeral 원문은 저장·전송하지 않고 digest만 만든다", { concurrency: false }, (context) => {
  const storage = new AccessDeniedStorage();
  installBrowserStorage(context, storage);
  const registered = createEphemeralAccountCleanupTokenDigest();

  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  assert.match(registered.tokenDigest, ACCOUNT_CLEANUP_TOKEN_DIGEST_PATTERN);
  assert.equal(storage.accesses, 0);
});

test("익명 status는 DELETED/NO_ACTION만 받아들이고 ACTIVE 표현과 오류 응답은 재시도로 남긴다", async () => {
  const rawToken = "ab".repeat(32);
  const digest = digestAccountCleanupToken(rawToken);
  const activeFetcher = (async () => new Response(
    JSON.stringify({ ok: true, status: "ACTIVE" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )) as typeof fetch;
  const errorFetcher = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;

  assert.deepEqual(
    await requestAccountCleanupStatus(digest, { fetcher: activeFetcher }),
    { ok: false, reason: "INVALID_RESPONSE" },
  );
  assert.deepEqual(
    await requestAccountCleanupStatus(digest, { fetcher: errorFetcher }),
    { ok: false, reason: "REQUEST_FAILED" },
  );
});

test("DELETED sweep는 확인된 owner의 모든 표현과 token만 지우고 다른 owner를 보존한다", { concurrency: false }, async (context) => {
  const { storage } = installBrowserStorage(context);
  const deletedOwner = "student-deleted";
  const retainedOwner = "student-retained";
  const deletedSource = createDocumentDraftKey("note", deletedOwner, "note-1");
  const retainedSource = createDocumentDraftKey("note", retainedOwner, "note-2");
  const deletedKeys = [
    deletedSource,
    createFormDraftRecoveryKey(deletedSource, "future-writer"),
    createFormDraftClearMarkerKey(deletedSource),
    createDocumentServerDraftQueueKey(deletedSource),
    createDocumentServerDraftDeviceStorageKey(deletedOwner),
    createAccountCalendarTabStorageKey(deletedOwner),
    createAccountNotesViewStorageKey(deletedOwner),
  ];
  for (const key of deletedKeys) storage.setItem(key, "future-or-legacy-value");
  storage.setItem(retainedSource, "other-owner-value");
  storage.setItem(createDocumentServerDraftDeviceStorageKey(retainedOwner), "other-device");
  storage.setItem(createAccountCalendarTabStorageKey(retainedOwner), "calendar");
  storage.setItem(createAccountNotesViewStorageKey(retainedOwner), "list");
  const deletedToken = ensureStoredAccountCleanupToken(storage, deletedOwner);
  const retainedToken = ensureStoredAccountCleanupToken(storage, retainedOwner);
  const requestedDigests: string[] = [];
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { tokenDigest: string };
    requestedDigests.push(request.tokenDigest);
    const status = request.tokenDigest === deletedToken.tokenDigest
      ? "DELETED"
      : "NO_ACTION";
    return new Response(JSON.stringify({ ok: true, status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await sweepAccountCleanupStatuses({ fetcher });

  assert.deepEqual(result.cleanedOwners, [deletedOwner]);
  assert.deepEqual(result.noActionOwners, [retainedOwner]);
  assert.equal(result.shouldSignOut, false);
  assert.deepEqual(requestedDigests.sort(), [
    deletedToken.tokenDigest,
    retainedToken.tokenDigest,
  ].sort());
  for (const key of deletedKeys) assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem(deletedToken.storageKey), null);
  const terminalLockKey = createAccountTerminalLockStorageKey(deletedOwner);
  assert.equal(terminalLockKey.includes(deletedOwner), false);
  assert.notEqual(storage.getItem(terminalLockKey), null);
  assert.equal(storage.getItem(retainedSource), "other-owner-value");
  assert.equal(storage.getItem(retainedToken.storageKey), retainedToken.rawToken);
  assert.equal(
    storage.getItem(createDocumentServerDraftDeviceStorageKey(retainedOwner)),
    "other-device",
  );
  assert.equal(
    storage.getItem(createAccountCalendarTabStorageKey(retainedOwner)),
    "calendar",
  );
  assert.equal(storage.getItem(createAccountNotesViewStorageKey(retainedOwner)), "list");

  assert.throws(
    () => persistFormDraftRawSnapshot(storage, {
      sourceKey: deletedSource,
      recoveryKey: createFormDraftRecoveryKey(deletedSource, "late-peer"),
      raw: "late-peer-draft",
      expectedRaw: null,
    }),
    /terminally locked/u,
  );
  assert.throws(
    () => writeFormDraftClearMarker(storage, deletedSource, "late-signature"),
    /terminally locked/u,
  );
  assert.throws(
    () => enqueueDocumentServerDraftDiscard(storage, {
      sourceKey: deletedSource,
      expectedDraftVersion: 0,
    }),
    /terminally locked/u,
  );
  assert.throws(
    () => getOrCreateDocumentServerDraftDeviceId(storage, deletedOwner),
    /terminally locked/u,
  );
  assert.equal(storage.getItem(deletedSource), null);
  assert.equal(storage.getItem(createDocumentServerDraftQueueKey(deletedSource)), null);
});

test("owner durable 삭제가 하나라도 실패하면 cleanup token을 유지하고 lock만으로 완료 처리하지 않는다", { concurrency: false }, async (context) => {
  const ownerId = "student-retry";
  const sourceKey = createDocumentDraftKey("qna-thread", ownerId);
  const storage = new RemovalDeniedStorage(sourceKey);
  installBrowserStorage(context, storage);
  storage.setItem(sourceKey, "future-value");
  const token = ensureStoredAccountCleanupToken(storage, ownerId);

  const result = clearDeletedAccountLocalState(ownerId, token.tokenDigest);

  assert.equal(result.success, false);
  assert.equal(result.reason, "DRAFT_CLEANUP_FAILED");
  assert.equal(storage.getItem(sourceKey), "future-value");
  assert.equal(storage.getItem(token.storageKey), token.rawToken);

  const retried = await sweepAccountCleanupStatuses({
    ownerId,
    fetcher: (async () => new Response(
      JSON.stringify({ ok: true, status: "DELETED" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch,
  });
  assert.deepEqual(retried.failedOwners, [ownerId]);
  assert.equal(retried.shouldSignOut, false);
  assert.equal(storage.getItem(token.storageKey), token.rawToken);
});

test("draft 재열거가 성공해도 token CAS 제거가 실패하면 원문 token을 유지한다", { concurrency: false }, (context) => {
  const ownerId = "student-token-retry";
  const tokenKey = createAccountCleanupTokenStorageKey(ownerId);
  const storage = new RemovalDeniedStorage(tokenKey);
  installBrowserStorage(context, storage);
  const sourceKey = createDocumentDraftKey("community-post", ownerId);
  storage.setItem(sourceKey, "draft-value");
  const token = ensureStoredAccountCleanupToken(storage, ownerId);

  const result = clearDeletedAccountLocalState(ownerId, token.tokenDigest);

  assert.equal(result.success, false);
  assert.equal(result.reason, "TOKEN_REMOVE_FAILED");
  assert.equal(storage.getItem(sourceKey), null);
  assert.equal(storage.getItem(token.storageKey), token.rawToken);
});

test("ownerless legacy 명시 삭제는 역사적 exact/prefix allowlist만 제거한다", () => {
  const storage = new MemoryStorage();
  const allowed = [
    "draft:qna:thread",
    "draft:qna:reply:thread-1",
    "draft:note:slide:student-1",
    "draft:note:full:student-1",
  ];
  const preserved = [
    "draft:qna:thread:lookalike",
    "draft:qna:reply:",
    "draft:note:full",
    createDocumentDraftKey("note", "student-1", "new"),
    "studentPortal:section",
  ];
  for (const key of [...allowed, ...preserved]) storage.setItem(key, "value");

  assert.deepEqual(listOwnerlessLegacyDocumentDrafts(storage), {
    storageKeys: [...allowed].sort(),
    enumerationFailed: false,
  });
  const snapshot = snapshotOwnerlessLegacyDocumentDrafts(storage);
  assert.equal(snapshot.enumerationFailed, false);
  const removed = removeOwnerlessLegacyDocumentDrafts(storage, snapshot.snapshots);

  assert.deepEqual(removed.removedKeys, [...allowed].sort());
  for (const key of allowed) assert.equal(storage.getItem(key), null);
  for (const key of preserved) assert.equal(storage.getItem(key), "value");
});

test("ownerless legacy 확인 snapshot이 바뀌면 새 값과 key를 삭제하지 않는다", () => {
  const storage = new MemoryStorage();
  storage.setItem("draft:qna:thread", "first");
  const expected = snapshotOwnerlessLegacyDocumentDrafts(storage);
  assert.equal(expected.enumerationFailed, false);

  storage.setItem("draft:qna:thread", "changed");
  storage.setItem("draft:qna:reply:new", "new-peer-draft");
  const removed = removeOwnerlessLegacyDocumentDrafts(
    storage,
    expected.snapshots,
  );

  assert.equal(removed.snapshotChanged, true);
  assert.deepEqual(removed.removedKeys, []);
  assert.equal(storage.getItem("draft:qna:thread"), "changed");
  assert.equal(storage.getItem("draft:qna:reply:new"), "new-peer-draft");
  assert.deepEqual(
    removed.currentSnapshots.map(({ storageKey }) => storageKey),
    ["draft:qna:reply:new", "draft:qna:thread"],
  );
});
