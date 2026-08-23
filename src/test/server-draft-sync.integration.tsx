import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  canonicalizeDocumentServerDraftPayload,
  serializeDocumentServerDraftPayload,
  type DocumentServerDraftSnapshot,
} from "@/lib/document-server-draft-contract";
import {
  createDocumentDraftKey,
  createDocumentServerDraftQueueKey,
  parseFormDraft,
} from "@/lib/form-draft";
import { parseQueuedDocumentServerDraft } from "@/lib/document-server-draft-queue";
import {
  createAccountTerminalLockStorageKey,
  ensureAccountTerminalDeletionLock,
} from "@/lib/account-terminal-lock";
import { clearLocalDocumentDraftsForDeletedOwner } from "@/lib/local-draft-continuity-client";

type DraftData = {
  title: string;
  contentHtml: string;
  baseRevision?: number;
};

type SaveInput = {
  sourceKey: string;
  operationId: string;
  expectedDraftVersion: number;
  payloadJson: string;
  baseResourceVersion: number | null;
  writerDeviceId: string;
};

type DiscardInput = {
  sourceKey: string;
  operationId: string;
  expectedDraftVersion: number;
};

let remoteDraft: DocumentServerDraftSnapshot | null = null;
let saveMode: "success" | "network-error" | "conflict" = "success";
let saveCalls: SaveInput[] = [];
let discardCalls: DiscardInput[] = [];
let readCalls = 0;

function createSnapshot(
  sourceKey: string,
  data: DraftData,
  draftVersion: number,
  writerDeviceId = "7971deed-89f6-48a4-8bbd-5f0ec63488e0",
): DocumentServerDraftSnapshot {
  const payloadJson = serializeDocumentServerDraftPayload(data);
  const payload = canonicalizeDocumentServerDraftPayload(payloadJson);
  if (!payload) throw new Error("server draft fixture payload가 유효해야 합니다.");
  const identity = sourceKey.split(":");
  return {
    sourceKey,
    kind: "note",
    contextId: decodeURIComponent(identity.at(-1) ?? "new"),
    payloadJson,
    payloadHash: payload.payloadHash,
    draftVersion,
    baseResourceVersion: data.baseRevision ?? null,
    writerDeviceId,
    updatedAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1_000,
  };
}

mock.module("@/lib/actions/documentDrafts", {
  namedExports: {
    readDocumentServerDraft: async () => {
      readCalls += 1;
      return { ok: true, draft: remoteDraft };
    },
    saveDocumentServerDraft: async (input: SaveInput) => {
      saveCalls.push(input);
      if (saveMode === "network-error") throw new Error("network unavailable");
      if (saveMode === "conflict") {
        return { ok: false, reason: "VERSION_CONFLICT", current: remoteDraft };
      }
      const data = canonicalizeDocumentServerDraftPayload(input.payloadJson)?.data as
        | DraftData
        | undefined;
      if (!data) throw new Error("server draft save payload가 유효해야 합니다.");
      remoteDraft = createSnapshot(
        input.sourceKey,
        data,
        input.expectedDraftVersion + 1,
        input.writerDeviceId,
      );
      return {
        ok: true,
        replayed: false,
        operationResultVersion: remoteDraft.draftVersion,
        current: remoteDraft,
      };
    },
    discardDocumentServerDraft: async (input: DiscardInput) => {
      discardCalls.push(input);
      remoteDraft = null;
      return {
        ok: true,
        replayed: false,
        operationResultVersion: input.expectedDraftVersion,
        current: null,
      };
    },
  },
});

let useSyncedFormDraft: typeof import("@/lib/hooks/useSyncedFormDraft").useSyncedFormDraft;
let DraftStatus: typeof import("@/components/editor/DraftStatus").DraftStatus;

before(async () => {
  ({ useSyncedFormDraft } = await import("@/lib/hooks/useSyncedFormDraft"));
  ({ DraftStatus } = await import("@/components/editor/DraftStatus"));
});

after(() => mock.restoreAll());

const GLOBAL_BINDINGS = [
  "window",
  "document",
  "navigator",
  "CustomEvent",
  "StorageEvent",
  "Event",
  "Node",
  "HTMLElement",
  "MutationObserver",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
  "React",
] as const;

type GlobalBinding = (typeof GLOBAL_BINDINGS)[number];
type HookResult = ReturnType<typeof useSyncedFormDraft<DraftData>>;

function installBrowserGlobals(browserWindow: Window): () => void {
  const previous = new Map<GlobalBinding, PropertyDescriptor | undefined>();
  const bindings: Record<GlobalBinding, unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    CustomEvent: browserWindow.CustomEvent,
    StorageEvent: browserWindow.StorageEvent,
    Event: browserWindow.Event,
    Node: browserWindow.Node,
    HTMLElement: browserWindow.HTMLElement,
    MutationObserver: browserWindow.MutationObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const name of GLOBAL_BINDINGS) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: bindings[name],
    });
  }
  return () => {
    for (const name of [...GLOBAL_BINDINGS].reverse()) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

function setOnline(browserWindow: Window, online: boolean): void {
  Object.defineProperty(browserWindow.navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  assert.fail(message);
}

async function createHarness(context: TestContext, sourceKey: string) {
  const browserWindow = new Window({ url: "https://portal.test/dashboard" });
  setOnline(browserWindow, true);
  const restoreGlobals = installBrowserGlobals(browserWindow);
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  let result: HookResult | null = null;
  const restored: DraftData[] = [];

  function Probe() {
    const hook = useSyncedFormDraft<DraftData>(sourceKey, (draft) => {
      restored.push(draft);
    }, { debounceMs: 60_000 });
    result = hook;
    return (
      <DraftStatus
        status={hook.status}
        canSubmit={hook.canSubmit}
        savedAt={hook.savedAt}
        restored={hook.restored}
        serverSync={hook.serverSync}
      />
    );
  }

  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    restoreGlobals();
  });
  await act(async () => root.render(<Probe />));
  await waitFor(() => result?.serverSync.status !== "loading", "초기 서버 초안 확인이 끝나야 합니다.");

  return {
    browserWindow,
    container,
    restored,
    getResult: () => {
      if (!result) throw new Error("server draft hook이 준비되지 않았습니다.");
      return result;
    },
  };
}

function resetServerMock(): void {
  remoteDraft = null;
  saveMode = "success";
  saveCalls = [];
  discardCalls = [];
  readCalls = 0;
}

test("terminal owner lock은 late peer draft write와 server action을 막고 hook refs를 비운다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-terminal-peer";
  const sourceKey = createDocumentDraftKey("note", ownerId, "terminal-note");
  const harness = await createHarness(context, sourceKey);
  setOnline(harness.browserWindow, false);

  await act(async () => {
    harness.getResult().save({
      title: "삭제 전 작성본",
      contentHtml: "<p>terminal</p>",
    });
  });
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  assert.notEqual(harness.browserWindow.localStorage.getItem(queueKey), null);
  assert.notEqual(harness.getResult().serverSync.localPreview, null);

  await act(async () => {
    ensureAccountTerminalDeletionLock(
      harness.browserWindow.localStorage,
      ownerId,
    );
    clearLocalDocumentDraftsForDeletedOwner(ownerId);
  });

  assert.equal(harness.getResult().canSubmit, false);
  assert.equal(harness.getResult().serverSync.localPreview, null);
  assert.equal(harness.getResult().serverSync.remoteDraft, null);
  assert.equal(harness.browserWindow.localStorage.getItem(sourceKey), null);
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);
  const lockKey = createAccountTerminalLockStorageKey(ownerId);
  assert.equal(lockKey.includes(ownerId), false);
  assert.notEqual(harness.browserWindow.localStorage.getItem(lockKey), null);

  const readCallsBeforeLateActions = readCalls;
  await act(async () => {
    harness.getResult().save({
      title: "늦은 peer write",
      contentHtml: "<p>blocked</p>",
    });
    harness.getResult().serverSync.keepLocalDraft();
    harness.getResult().serverSync.discardRemoteDraft();
    await harness.getResult().serverSync.refresh();
  });

  assert.equal(harness.browserWindow.localStorage.getItem(sourceKey), null);
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);
  assert.equal(saveCalls.length, 0);
  assert.equal(discardCalls.length, 0);
  assert.equal(readCalls, readCallsBeforeLateActions);
});

test("오프라인 queue는 원 operation ID로 재시도하고 성공한 raw만 제거한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "offline-note");
  const harness = await createHarness(context, sourceKey);
  setOnline(harness.browserWindow, false);
  const local = { title: "오프라인 입력", contentHtml: "<p>보존</p>" };

  await act(async () => harness.getResult().save(local));
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const offlineRaw = harness.browserWindow.localStorage.getItem(queueKey);
  assert.ok(offlineRaw);
  assert.equal(parseQueuedDocumentServerDraft(offlineRaw)?.operationType, "UPSERT");
  assert.equal(harness.getResult().serverSync.status, "offline");

  saveMode = "network-error";
  setOnline(harness.browserWindow, true);
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => saveCalls.length === 1, "첫 재시도가 전송되어야 합니다.");
  await waitFor(() => harness.getResult().serverSync.status === "error", "network 오류를 표시해야 합니다.");
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), offlineRaw);

  saveMode = "success";
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => saveCalls.length === 2, "같은 queue를 다시 전송해야 합니다.");
  await waitFor(() => harness.getResult().serverSync.status === "synced", "재시도가 동기화되어야 합니다.");
  assert.equal(saveCalls[0]?.operationId, saveCalls[1]?.operationId);
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);
});

test("다른 기기 서버본과 충돌하면 자동 덮어쓰기 없이 두 선택을 제공한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "conflict-note");
  remoteDraft = createSnapshot(
    sourceKey,
    { title: "다른 기기", contentHtml: "<p>서버 원문</p>", baseRevision: 2 },
    4,
  );
  const harness = await createHarness(context, sourceKey);
  const local = { title: "이 기기", contentHtml: "<p>로컬 원문</p>", baseRevision: 2 };

  setOnline(harness.browserWindow, false);
  await act(async () => harness.getResult().save(local));
  setOnline(harness.browserWindow, true);
  saveMode = "conflict";
  remoteDraft = createSnapshot(
    sourceKey,
    { title: "서버 최신", contentHtml: "<p>새 서버 원문</p>", baseRevision: 3 },
    5,
  );
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => harness.getResult().serverSync.status === "conflict", "CAS 충돌을 표시해야 합니다.");

  assert.match(harness.container.textContent ?? "", /자동으로 합치거나 덮어쓰지 않습니다/u);
  assert.ok(
    [...harness.container.querySelectorAll("button")].some(
      (button) => button.textContent?.includes("계정 작성본 사용"),
    ),
  );
  assert.ok(
    [...harness.container.querySelectorAll("button")].some(
      (button) => button.textContent?.includes("내 초안으로 계속"),
    ),
  );

  await act(async () => harness.getResult().serverSync.useRemoteDraft());
  assert.deepEqual(harness.restored.at(-1), {
    title: "서버 최신",
    contentHtml: "<p>새 서버 원문</p>",
    baseRevision: 3,
  });
  assert.equal(harness.getResult().serverSync.status, "synced");
  assert.equal(
    parseFormDraft<DraftData>(harness.browserWindow.localStorage.getItem(sourceKey) ?? "")
      ?.data.title,
    "서버 최신",
  );
});

test("초기 서버본을 확인한 뒤 계속 입력해도 명시적 선택 전에는 덮어쓰지 않는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "remote-choice-note");
  remoteDraft = createSnapshot(
    sourceKey,
    { title: "계정 작성본", contentHtml: "<p>다른 기기 본문</p>" },
    4,
  );
  const harness = await createHarness(context, sourceKey);
  const local = { title: "계속 입력한 로컬", contentHtml: "<p>내 본문</p>" };

  assert.equal(harness.getResult().serverSync.status, "remote-available");
  await act(async () => harness.getResult().save(local));
  await act(async () =>
    harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")),
  );

  assert.equal(harness.getResult().serverSync.status, "conflict");
  assert.equal(saveCalls.length, 0);
  assert.equal(
    harness.browserWindow.localStorage.getItem(
      createDocumentServerDraftQueueKey(sourceKey),
    ),
    null,
  );

  await act(async () => harness.getResult().serverSync.keepLocalDraft());
  await waitFor(() => saveCalls.length === 1, "명시적 로컬 선택 뒤에만 저장해야 합니다.");
  await waitFor(() => harness.getResult().serverSync.status === "synced", "선택한 로컬본이 동기화되어야 합니다.");
  assert.equal(
    canonicalizeDocumentServerDraftPayload(saveCalls[0]?.payloadJson ?? "")
      ?.data.title,
    local.title,
  );
});

test("제출 성공 clear는 대기 중 UPSERT를 DISCARD로 바꿔 서버본을 제거한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "submitted-note");
  const harness = await createHarness(context, sourceKey);
  const data = { title: "곧 제출", contentHtml: "<p>본문</p>" };
  setOnline(harness.browserWindow, false);

  await act(async () => harness.getResult().save(data));
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: data }));
  const raw = harness.browserWindow.localStorage.getItem(
    createDocumentServerDraftQueueKey(sourceKey),
  );
  assert.ok(raw);
  assert.equal(parseQueuedDocumentServerDraft(raw)?.operationType, "DISCARD");

  setOnline(harness.browserWindow, true);
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => discardCalls.length === 1, "제출 후 discard를 재시도해야 합니다.");
  assert.equal(saveCalls.length, 0);
  assert.equal(
    harness.browserWindow.localStorage.getItem(createDocumentServerDraftQueueKey(sourceKey)),
    null,
  );
});

test("계정 초안 삭제는 2단계 확인·Escape 취소·안정된 focus를 제공한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "discard-ui-note");
  remoteDraft = createSnapshot(
    sourceKey,
    { title: "삭제 전 서버본", contentHtml: "<p>서버 본문</p>" },
    2,
  );
  const harness = await createHarness(context, sourceKey);
  const findButton = (label: string) =>
    [...harness.container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes(label),
    ) as HTMLButtonElement | undefined;

  const trigger = findButton("계정 초안 삭제");
  assert.ok(trigger);
  await act(async () => trigger.click());
  const cancel = findButton("취소");
  assert.ok(cancel);
  assert.equal(harness.browserWindow.document.activeElement, cancel);

  const confirmationGroup = cancel.closest('[role="group"]');
  assert.ok(confirmationGroup);
  await act(async () => confirmationGroup.dispatchEvent(
    new harness.browserWindow.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }) as unknown as Event,
  ));
  const restoredTrigger = findButton("계정 초안 삭제");
  assert.ok(restoredTrigger);
  assert.equal(harness.browserWindow.document.activeElement, restoredTrigger);

  await act(async () => restoredTrigger.click());
  const confirm = findButton("계정 초안 삭제 확인");
  assert.ok(confirm);
  await act(async () => confirm.click());
  await waitFor(() => discardCalls.length === 1, "명시적 계정 초안 폐기가 전송되어야 합니다.");
  assert.equal(remoteDraft, null);
});

test("poll과 같은 refresh에서 다른 기기 변경을 감지해 명시적 충돌로 전환한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "multi-device-note");
  const harness = await createHarness(context, sourceKey);
  const local = { title: "내 최신", contentHtml: "<p>내 본문</p>" };
  await act(async () => harness.getResult().save(local));
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => harness.getResult().serverSync.status === "synced", "첫 저장이 완료되어야 합니다.");

  remoteDraft = createSnapshot(
    sourceKey,
    { title: "다른 기기 변경", contentHtml: "<p>원격 본문</p>" },
    (remoteDraft?.draftVersion ?? 1) + 1,
    "7971deed-89f6-48a4-8bbd-5f0ec63488e0",
  );
  await act(async () => harness.getResult().serverSync.refresh());

  assert.equal(harness.getResult().serverSync.status, "conflict");
  assert.equal(harness.getResult().serverSync.isDifferentDevice, true);
  assert.ok(readCalls >= 2);
});
