import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import {
  clearCollabLocalDataExceptOwner,
  clearCollabLocalDataForOwner,
  collabConfirmedDbName,
  collabDbIndexStorageKey,
  collabDocDbName,
  collabGenerationStorageKey,
  collabRecoveryStorageKey,
  deleteIndexedDb,
  inspectCollabLocalDataForOwner,
  isCollabOwnerLocked,
  listCollabDbNames,
  lockCollabOwner,
  parseCollabDbName,
  rememberCollabDbName,
  subscribeCollabOwnerClear,
  subscribeCollabOwnerLock,
  unlockCollabOwner,
} from "./local-store";
import { broadcastFormDraftContinuityClear } from "@/lib/form-draft/page-session";

type FakeDeleteBehavior = "success" | "blocked" | "blocked-then-success" | "error" | "silent";

/** deleteDatabase 결과를 이름별로 정할 수 있는 최소 IndexedDB. */
class FakeIndexedDb {
  readonly names = new Set<string>();
  readonly behaviors = new Map<string, FakeDeleteBehavior>();
  readonly deleteCalls: string[] = [];
  databases?: () => Promise<Array<{ name?: string }>>;

  constructor(options: { withDatabases?: boolean } = {}) {
    if (options.withDatabases !== false) {
      this.databases = async () => [...this.names].map((name) => ({ name }));
    }
  }

  deleteDatabase(name: string): IDBOpenDBRequest {
    this.deleteCalls.push(name);
    const request = {} as {
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
      onblocked: (() => void) | null;
    };
    request.onsuccess = null;
    request.onerror = null;
    request.onblocked = null;
    const behavior = this.behaviors.get(name) ?? "success";
    setTimeout(() => {
      if (behavior === "success") {
        this.names.delete(name);
        request.onsuccess?.();
      } else if (behavior === "error") {
        request.onerror?.();
      } else if (behavior === "blocked") {
        request.onblocked?.();
      } else if (behavior === "blocked-then-success") {
        request.onblocked?.();
        setTimeout(() => {
          this.names.delete(name);
          request.onsuccess?.();
        }, 5);
      }
    }, 0);
    return request as unknown as IDBOpenDBRequest;
  }
}

function installCollabBrowser(
  context: TestContext,
  idb: FakeIndexedDb | null,
): { browserWindow: Window; storage: Storage } {
  const browserWindow = new Window({ url: "https://portal.test/" });
  const storage = browserWindow.localStorage as unknown as Storage;
  const values: Record<string, unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    CustomEvent: browserWindow.CustomEvent,
    indexedDB: idb ?? undefined,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [binding, value] of Object.entries(values)) {
    previous.set(binding, Object.getOwnPropertyDescriptor(globalThis, binding));
    Object.defineProperty(globalThis, binding, { configurable: true, writable: true, value });
  }
  context.after(() => {
    browserWindow.close();
    for (const [binding, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, binding, descriptor);
      else Reflect.deleteProperty(globalThis, binding);
    }
  });
  return { browserWindow, storage };
}

test("이름 builder와 해석은 owner·roomKey·구버전을 구분하고 다른 DB를 무시한다", () => {
  assert.equal(collabDocDbName("u1", "note:abc", 2), "portal-collab:u1:note:abc:2");
  assert.equal(collabConfirmedDbName("u1", "draft:post:u1:scope", 0), "portal-collab-confirmed:u1:draft:post:u1:scope:0");
  assert.equal(collabGenerationStorageKey("u1", "note:abc"), "portal-collab-gen:u1:note:abc");
  assert.equal(collabRecoveryStorageKey("u1", "note:abc", 5), "portal-collab-recovered:u1:note:abc:5");
  assert.deepEqual(parseCollabDbName("portal-collab:u1:note:abc:2"), { scope: "owner", owner: "u1", roomKey: "note:abc" });
  assert.deepEqual(parseCollabDbName("portal-collab:u1:draft:post:u1:scope:0"), { scope: "owner", owner: "u1", roomKey: "draft:post:u1:scope" });
  assert.deepEqual(parseCollabDbName("portal-collab:note:abc:3"), { scope: "legacy", roomKey: "note:abc" });
  assert.deepEqual(parseCollabDbName("portal-collab:draft:post:u1:scope:3"), { scope: "legacy", roomKey: "draft:post:u1:scope" });
  assert.equal(parseCollabDbName("portal-collab:u1:note:abc:x"), null);
  assert.equal(parseCollabDbName("other-db"), null);
  assert.equal(parseCollabDbName("portal-collab-confirmed:note:abc:1"), null);
  assert.throws(() => collabDocDbName("a:b", "note:abc", 0), /INVALID_COLLAB_OWNER/u);
});

test("deleteIndexedDb는 success·blocked·error·무응답을 timeout 안에서 구분한다", { concurrency: false }, async (context) => {
  const idb = new FakeIndexedDb();
  installCollabBrowser(context, idb);
  idb.behaviors.set("blocked", "blocked");
  idb.behaviors.set("late", "blocked-then-success");
  idb.behaviors.set("error", "error");
  idb.behaviors.set("silent", "silent");
  assert.equal(await deleteIndexedDb("ok", 50), "deleted");
  assert.equal(await deleteIndexedDb("blocked", 20), "blocked");
  assert.equal(await deleteIndexedDb("late", 200), "deleted");
  assert.equal(await deleteIndexedDb("error", 50), "error");
  assert.equal(await deleteIndexedDb("silent", 20), "error");
});

test("IndexedDB가 없으면 지울 DB가 없는 것으로 보고 deleted를 돌려준다", { concurrency: false }, async (context) => {
  installCollabBrowser(context, null);
  assert.equal(await deleteIndexedDb("anything", 10), "deleted");
});

test("databases()가 없으면 owner 색인으로 DB 이름을 찾는다", { concurrency: false }, async (context) => {
  const idb = new FakeIndexedDb({ withDatabases: false });
  installCollabBrowser(context, idb);
  const a = collabDocDbName("ua", "note:n1", 0);
  const b = collabConfirmedDbName("ub", "guide:g1", 1);
  assert.equal(rememberCollabDbName("ua", a), true);
  assert.equal(rememberCollabDbName("ua", a), true);
  assert.equal(rememberCollabDbName("ub", b), true);
  assert.deepEqual(await listCollabDbNames(), [b, a].sort());

  const result = await clearCollabLocalDataForOwner("ua", { deleteTimeoutMs: 50 });
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(idb.deleteCalls, [a]);
  assert.deepEqual(await listCollabDbNames(), [b]);
  assert.equal(window.localStorage.getItem(collabDbIndexStorageKey("ua")), null);
});

test("owner 정리는 그 owner와 구버전만 지우고 다른 owner를 보존한다", { concurrency: false }, async (context) => {
  const idb = new FakeIndexedDb();
  const { storage } = installCollabBrowser(context, idb);
  const mine = [collabDocDbName("ua", "note:n1", 0), collabConfirmedDbName("ua", "note:n1", 0)];
  const other = collabDocDbName("ub", "note:n1", 0);
  const legacy = "portal-collab:note:n1:4";
  for (const name of [...mine, other, legacy, "unrelated-db"]) idb.names.add(name);
  storage.setItem(collabGenerationStorageKey("ua", "note:n1"), "0");
  storage.setItem(collabGenerationStorageKey("ub", "note:n1"), "0");
  storage.setItem(collabRecoveryStorageKey("ua", "note:n1", 1), JSON.stringify({ userId: "ua" }));
  storage.setItem(collabRecoveryStorageKey("ub", "note:n1", 1), JSON.stringify({ userId: "ub" }));
  storage.setItem("portal-collab-epoch:note:n1", "4");
  storage.setItem("portal-collab-recovered:note:n1:7", JSON.stringify({ userId: "ua" }));
  storage.setItem("portal-collab-recovered:note:n1:8", JSON.stringify({ userId: "ub" }));
  storage.setItem("portal-collab-recovered:note:n1:9", "{broken");

  assert.ok((await inspectCollabLocalDataForOwner("ua")).length > 0);
  const result = await clearCollabLocalDataForOwner("ua", { deleteTimeoutMs: 50 });

  assert.deepEqual(result.remaining, []);
  assert.deepEqual(result.deletedDbNames, [...mine, legacy].sort());
  assert.deepEqual([...idb.names].sort(), [other, "unrelated-db"].sort());
  assert.equal(storage.getItem(collabGenerationStorageKey("ua", "note:n1")), null);
  assert.equal(storage.getItem(collabRecoveryStorageKey("ua", "note:n1", 1)), null);
  assert.equal(storage.getItem("portal-collab-epoch:note:n1"), null);
  assert.equal(storage.getItem("portal-collab-recovered:note:n1:7"), null);
  assert.equal(storage.getItem("portal-collab-recovered:note:n1:9"), null);
  assert.notEqual(storage.getItem("portal-collab-recovered:note:n1:8"), null);
  assert.notEqual(storage.getItem(collabGenerationStorageKey("ub", "note:n1")), null);
  assert.notEqual(storage.getItem(collabRecoveryStorageKey("ub", "note:n1", 1)), null);
  assert.deepEqual(await inspectCollabLocalDataForOwner("ua"), []);
  assert.equal(isCollabOwnerLocked("ua"), true);
  assert.equal(isCollabOwnerLocked("ub"), false);
  assert.equal(rememberCollabDbName("ua", mine[0]), false);
});

test("삭제가 blocked면 이름을 남은 목록과 색인에 유지해 재검증이 실패한다", { concurrency: false }, async (context) => {
  const idb = new FakeIndexedDb({ withDatabases: false });
  installCollabBrowser(context, idb);
  const blocked = collabDocDbName("ua", "post:p1", 0);
  const fine = collabConfirmedDbName("ua", "post:p1", 0);
  rememberCollabDbName("ua", blocked);
  rememberCollabDbName("ua", fine);
  idb.behaviors.set(blocked, "blocked");

  const result = await clearCollabLocalDataForOwner("ua", { deleteTimeoutMs: 20 });
  assert.deepEqual(result.remaining, [blocked]);
  assert.deepEqual(result.deletedDbNames, [fine]);
  assert.deepEqual(await inspectCollabLocalDataForOwner("ua"), [blocked]);

  idb.behaviors.set(blocked, "success");
  const retried = await clearCollabLocalDataForOwner("ua", { deleteTimeoutMs: 20 });
  assert.deepEqual(retried.remaining, []);
  assert.deepEqual(await inspectCollabLocalDataForOwner("ua"), []);
});

test("계정 전환 정리는 현재 owner 외 owner를 잠그고 지우며 현재 owner를 보존한다", { concurrency: false }, async (context) => {
  const idb = new FakeIndexedDb();
  const { storage } = installCollabBrowser(context, idb);
  const current = collabDocDbName("ucur", "note:n1", 0);
  const previous = collabDocDbName("uprev", "note:n1", 0);
  idb.names.add(current);
  idb.names.add(previous);
  idb.names.add("portal-collab:guide:g1:0");
  rememberCollabDbName("ucur", current);
  rememberCollabDbName("uprev", previous);
  storage.setItem("portal-collab-recovered:note:n1:1", JSON.stringify({ userId: "ucur" }));
  storage.setItem("portal-collab-recovered:note:n1:2", JSON.stringify({ userId: "uprev" }));

  const result = await clearCollabLocalDataExceptOwner("ucur", { deleteTimeoutMs: 50 });
  assert.deepEqual(result.remaining, []);
  assert.deepEqual([...idb.names], [current]);
  assert.equal(isCollabOwnerLocked("uprev"), true);
  assert.equal(isCollabOwnerLocked("ucur"), false);
  assert.notEqual(storage.getItem(collabDbIndexStorageKey("ucur")), null);
  assert.equal(storage.getItem(collabDbIndexStorageKey("uprev")), null);
  assert.notEqual(storage.getItem("portal-collab-recovered:note:n1:1"), null);
  assert.equal(storage.getItem("portal-collab-recovered:note:n1:2"), null);
});

test("잠금은 key에 owner 원문을 넣지 않고 해제·알림을 같은 window에 전한다", { concurrency: false }, async (context) => {
  const { storage } = installCollabBrowser(context, new FakeIndexedDb());
  const events: boolean[] = [];
  const unsubscribe = subscribeCollabOwnerLock("secret-owner", (locked) => events.push(locked));
  assert.equal(lockCollabOwner("secret-owner"), true);
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? "");
  assert.equal(keys.some((key) => key.includes("secret-owner")), false);
  assert.equal(isCollabOwnerLocked("secret-owner"), true);
  unlockCollabOwner("secret-owner");
  assert.equal(isCollabOwnerLocked("secret-owner"), false);
  unsubscribe();
  assert.deepEqual(events, [true, false]);
});

test("owner clear 구독은 lock 있는 owner·except-owner 알림만 넘긴다", { concurrency: false }, async (context) => {
  installCollabBrowser(context, new FakeIndexedDb());
  const signals: unknown[] = [];
  const unsubscribe = subscribeCollabOwnerClear((signal) => signals.push(signal));
  broadcastFormDraftContinuityClear({ mode: "owner", ownerId: "ua", lock: true });
  broadcastFormDraftContinuityClear({ mode: "owner", ownerId: "ua", lock: false });
  broadcastFormDraftContinuityClear({ mode: "except-owner", ownerId: "ub", lock: true });
  unsubscribe();
  broadcastFormDraftContinuityClear({ mode: "owner", ownerId: "uc", lock: true });
  assert.deepEqual(signals, [
    { mode: "owner", ownerId: "ua" },
    { mode: "except-owner", ownerId: "ub" },
  ]);
});
