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
  serializeFormDraft,
} from "@/lib/form-draft";
import {
  enqueueDocumentServerDraftDiscard,
  enqueueDocumentServerDraftUpsert,
  getOrCreateDocumentServerDraftDeviceId,
  parseQueuedDocumentServerDraft,
} from "@/lib/document-server-draft-queue";
import {
  createAccountTerminalLockStorageKey,
  ensureAccountTerminalDeletionLock,
} from "@/lib/account-terminal-lock";
import { clearLocalDocumentDraftsForDeletedOwner } from "@/lib/local-draft-continuity-client";
import {
  acquireAccountLogoutLock,
  createAccountLogoutLockStorageKey,
  releaseAccountLogoutLock,
} from "@/lib/account-logout-lock";

type DraftData = {
  title: string;
  contentHtml: string;
  baseRevision?: number;
  /** 노트 form처럼 입력마다 바뀌는 휘발 값(서버 payload·비교 hash에서 제외하는 대상). */
  operationId?: string;
};

type SaveInput = {
  sourceKey: string;
  operationId: string;
  expectedDraftVersion: number;
  expectedPayloadHash?: string;
  payloadJson: string;
  baseResourceVersion: number | null;
  writerDeviceId: string;
};

type DiscardInput = {
  sourceKey: string;
  operationId: string;
  expectedDraftVersion: number;
  targetPayloadHashes?: readonly string[];
  supersededOperationIds?: readonly string[];
};

let remoteDraft: DocumentServerDraftSnapshot | null = null;
let saveMode: "success" | "network-error" | "conflict" | "operation-conflict" = "success";
// 서버 fence 모사: 폐기가 superseded로 선점한 UPSERT operation ID와, 현재 서버본을 만든 UPSERT operation ID.
let fencedOperationIds = new Set<string>();
let remoteProducerOperationId: string | null = null;
let saveCalls: SaveInput[] = [];
let discardCalls: DiscardInput[] = [];
let readCalls = 0;
let readFails = false;
let beforeSaveCommit: (() => Promise<void>) | null = null;
let afterDiscardCommit: (() => Promise<void>) | null = null;

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

async function mockDiscard(input: DiscardInput) {
  discardCalls.push(input);
  // 실제 서버처럼 superseded receipt 선점은 CAS 판정과 무관하게 먼저 남는다.
  for (const operationId of input.supersededOperationIds ?? []) fencedOperationIds.add(operationId);
  // 서버 fence(b)와 같이, superseded 요청이 만든 서버본은 그 본문 hash가 폐기 대상에 있을 때만 version과 무관하게 지운다.
  const producedBySuperseded = remoteDraft !== null && remoteProducerOperationId !== null &&
    (input.supersededOperationIds ?? []).includes(remoteProducerOperationId) &&
    (input.targetPayloadHashes?.includes(remoteDraft.payloadHash) ?? false);
  if (!producedBySuperseded && ((remoteDraft?.draftVersion ?? 0) !== input.expectedDraftVersion ||
    (remoteDraft && input.targetPayloadHashes && !input.targetPayloadHashes.includes(remoteDraft.payloadHash)))) {
    return { ok: false, reason: "VERSION_CONFLICT", current: remoteDraft };
  }
  remoteDraft = null;
  remoteProducerOperationId = null;
  await afterDiscardCommit?.();
  return {
    ok: true,
    replayed: false,
    operationResultVersion: input.expectedDraftVersion,
    current: null,
  };
}

mock.module("@/lib/actions/documentDrafts", {
  namedExports: {
    readDocumentServerDraft: async () => {
      readCalls += 1;
      if (readFails) throw new Error("network unavailable");
      return { ok: true, draft: remoteDraft };
    },
    saveDocumentServerDraft: async (input: SaveInput) => {
      saveCalls.push(input);
      if (saveMode === "network-error") throw new Error("network unavailable");
      await beforeSaveCommit?.();
      if (saveMode === "operation-conflict" || fencedOperationIds.has(input.operationId)) {
        return { ok: false, reason: "OPERATION_PAYLOAD_CONFLICT", current: remoteDraft };
      }
      if (saveMode === "conflict" || (remoteDraft?.draftVersion ?? 0) !== input.expectedDraftVersion ||
        (remoteDraft && remoteDraft.payloadHash !== input.expectedPayloadHash)) {
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
      remoteProducerOperationId = input.operationId;
      return {
        ok: true,
        replayed: false,
        operationResultVersion: remoteDraft.draftVersion,
        current: remoteDraft,
      };
    },
    discardDocumentServerDraft: (input: DiscardInput) => mockDiscard(input),
  },
});

// 로그아웃 action이 불릴 때 이 기기의 초안·대기열이 이미 지워졌는지 기록한다.
let logoutCalls: { queueRaw: string | null; localDraft: string | null }[] = [];
let logoutProbeKeys: { queueKey: string; sourceKey: string } | null = null;
// 다음 로그아웃 action을 실패시킬 횟수(연결 끊김·서버 오류).
let logoutFailures = 0;
// 실제 Next.js처럼 직접 부른 action의 redirect를 redirect 오류(reject)로 돌려줄지.
let logoutRedirects = false;
// 로그아웃 응답을 이 promise가 풀릴 때까지 붙잡는다(느린 로그아웃).
let logoutHold: Promise<void> | null = null;
// 폐기 요청이 나갈 때 로그아웃 잠금이 이미 기록돼 있었는지.
let lockAtDiscard: (string | null)[] = [];
let logoutLockProbeKey: string | null = null;

mock.module("@/lib/actions/session", {
  namedExports: {
    logoutCurrentUser: async () => {
      const storage = globalThis.window.localStorage;
      logoutCalls.push({
        queueRaw: logoutProbeKeys ? storage.getItem(logoutProbeKeys.queueKey) : null,
        localDraft: logoutProbeKeys ? storage.getItem(logoutProbeKeys.sourceKey) : null,
      });
      if (logoutHold) await logoutHold;
      if (logoutFailures > 0) {
        logoutFailures -= 1;
        throw new Error("Failed to fetch");
      }
      if (logoutRedirects) {
        throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/login;307;", handled: true });
      }
    },
  },
});

let useSyncedFormDraft: typeof import("@/lib/hooks/useSyncedFormDraft").useSyncedFormDraft;
type ServerSyncOptions = import("@/lib/hooks/useDocumentServerDraftSync").DocumentServerDraftSyncOptions<DraftData>;
let DraftStatus: typeof import("@/components/editor/DraftStatus").DraftStatus;
let LogoutTextButton: typeof import("@/components/auth/LogoutTextButton").LogoutTextButton;

before(async () => {
  ({ useSyncedFormDraft } = await import("@/lib/hooks/useSyncedFormDraft"));
  ({ DraftStatus } = await import("@/components/editor/DraftStatus"));
  ({ LogoutTextButton } = await import("@/components/auth/LogoutTextButton"));
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
  "FormData",
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
    FormData: browserWindow.FormData,
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

function setVisibility(browserWindow: Window, visibilityState: "hidden" | "visible"): void {
  Object.defineProperty(browserWindow.document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  assert.fail(message);
}

async function createHarness(
  context: TestContext,
  sourceKey: string,
  seed?: (storage: Storage) => void,
  options: { server?: ServerSyncOptions } = {},
) {
  const browserWindow = new Window({ url: "https://portal.test/dashboard" });
  seed?.(browserWindow.localStorage as unknown as Storage);
  setOnline(browserWindow, true);
  const restoreGlobals = installBrowserGlobals(browserWindow);
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  let root = createRoot(container as unknown as Element);
  let mounted = false;
  let result: HookResult | null = null;
  const restored: DraftData[] = [];
  // 선택창이 "한 번도" 뜨지 않았는지는 최종 상태가 아니라 상태 이력으로 확인한다(remount 뒤에도 이어 쌓는다).
  const statusHistory: string[] = [];

  function Probe() {
    const hook = useSyncedFormDraft<DraftData>(sourceKey, (draft) => {
      restored.push(draft);
    }, { debounceMs: 60_000, server: options.server });
    result = hook;
    if (statusHistory.at(-1) !== hook.serverSync.status) statusHistory.push(hook.serverSync.status);
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

  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => root.unmount());
  };
  const mount = async () => {
    if (mounted) return;
    root = createRoot(container as unknown as Element);
    mounted = true;
    result = null;
    await act(async () => root.render(<Probe />));
    await waitFor(() => result?.serverSync.status !== "loading", "초기 서버 초안 확인이 끝나야 합니다.");
  };

  context.after(async () => {
    await unmount();
    browserWindow.close();
    restoreGlobals();
  });
  await mount();

  return {
    browserWindow,
    container,
    restored,
    statusHistory,
    getResult: () => {
      if (!result) throw new Error("server draft hook이 준비되지 않았습니다.");
      return result;
    },
    /** 편집기가 내려가는 상황(route 이동·key 전환)을 모사한다. localStorage·기기 ID는 그대로 남는다. */
    unmount,
    /** 같은 창·localStorage에서 새 hook 인스턴스를 올린다(다음 `new:` 작성 화면 진입 모사). */
    remount: async () => {
      await unmount();
      await mount();
    },
  };
}

/** harness 정리(전역 해제)보다 먼저 내려야 하므로 테스트 안에서 unmount한다. */
async function renderLogoutButton(browserWindow: Window, ownerId: string) {
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  // 로그아웃 전 폐기는 server action이 아니라 fetch(`/api/document-drafts/discard`)로 간다.
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (logoutLockProbeKey) lockAtDiscard.push(globalThis.window.localStorage.getItem(logoutLockProbeKey));
    return Response.json(await mockDiscard(JSON.parse(String(init?.body))));
  }) as typeof fetch;
  await act(async () => root.render(<LogoutTextButton ownerId={ownerId} label="로그아웃" />));
  const button = container.querySelector("button");
  assert.ok(button, "로그아웃 버튼이 있어야 합니다.");
  return {
    button,
    unmount: async () => {
      await act(async () => root.unmount());
      globalThis.fetch = previousFetch;
    },
  };
}

function resetServerMock(): void {
  remoteDraft = null;
  saveMode = "success";
  fencedOperationIds = new Set();
  remoteProducerOperationId = null;
  saveCalls = [];
  discardCalls = [];
  readCalls = 0;
  readFails = false;
  beforeSaveCommit = null;
  afterDiscardCommit = null;
  logoutCalls = [];
  logoutProbeKeys = null;
  logoutFailures = 0;
  logoutRedirects = false;
  logoutHold = null;
  lockAtDiscard = [];
  logoutLockProbeKey = null;
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

test("제출 직후 로그아웃하면 폐기 대기열을 먼저 보내 계정 작성본을 지운 뒤 로컬 초안을 정리한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-flush";
  const sourceKey = createDocumentDraftKey("note", ownerId, "submitted-then-logout");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const submitted = { title: "등록한 글", contentHtml: "<p>본문</p>" };
  remoteDraft = createSnapshot(sourceKey, submitted, 1);
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().serverSync.useRemoteDraft());
  // 등록 직후 화면이 바뀌어 편집기가 폐기 요청을 보내지 못한 상태.
  setOnline(harness.browserWindow, false);
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: submitted }));
  assert.equal(parseQueuedDocumentServerDraft(harness.browserWindow.localStorage.getItem(queueKey) ?? "")?.operationType, "DISCARD");
  assert.equal(discardCalls.length, 0);
  setOnline(harness.browserWindow, true);

  logoutProbeKeys = { queueKey, sourceKey };
  logoutLockProbeKey = createAccountLogoutLockStorageKey(ownerId);
  const logout = await renderLogoutButton(harness.browserWindow, ownerId);
  try {
    await act(async () => logout.button.click());
    assert.equal(logout.button.disabled, true);
    assert.equal(logout.button.getAttribute("aria-busy"), "true");
    await waitFor(() => logoutCalls.length === 1, "폐기 요청 뒤 로그아웃 action이 한 번 실행되어야 합니다.");
  } finally {
    await logout.unmount();
  }

  assert.equal(discardCalls.length, 1);
  assert.equal(discardCalls[0]?.expectedDraftVersion, 1);
  // 폐기 요청이 나가기 전에 다른 탭이 볼 로그아웃 잠금이 이미 기록돼 있어야 한다.
  assert.equal(lockAtDiscard.length, 1);
  assert.notEqual(lockAtDiscard[0], null);
  assert.equal(logoutLockProbeKey.includes(ownerId), false);
  assert.equal(remoteDraft, null);
  assert.deepEqual(logoutCalls, [{ queueRaw: null, localDraft: null }]);
});

test("로그아웃 잠금 동안 같은 계정의 다른 탭은 서버 초안을 저장하지 않고, 잠금이 풀리면 이어서 보낸다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-peer";
  const sourceKey = createDocumentDraftKey("note", ownerId, "peer-tab");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const lockKey = createAccountLogoutLockStorageKey(ownerId);
  const harness = await createHarness(context, sourceKey);
  const storage = harness.browserWindow.localStorage as unknown as Storage;

  setOnline(harness.browserWindow, false);
  await act(async () => harness.getResult().save({ title: "다른 탭 작성본", contentHtml: "<p>peer</p>" }));
  const queuedRaw = storage.getItem(queueKey);
  assert.equal(parseQueuedDocumentServerDraft(queuedRaw ?? "")?.operationType, "UPSERT");

  // 다른 탭이 로그아웃을 시작했다: 잠금 기록 → 이 탭은 storage 이벤트로 받는다.
  const handle = acquireAccountLogoutLock(storage, ownerId);
  assert.ok(handle);
  await act(async () => {
    harness.browserWindow.dispatchEvent(new harness.browserWindow.StorageEvent("storage", {
      key: lockKey,
      newValue: handle.raw,
      storageArea: harness.browserWindow.localStorage,
    }));
  });
  setOnline(harness.browserWindow, true);
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await act(async () => harness.getResult().serverSync.keepLocalDraft());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 40)));

  assert.equal(saveCalls.length, 0, "잠금 동안에는 UPSERT를 보내지 않아야 합니다.");
  assert.notEqual(storage.getItem(queueKey), null, "보내지 않은 저장 요청은 대기열에 남아야 합니다.");
  assert.notEqual(harness.getResult().serverSync.localPreview, null, "로컬 초안은 그대로 남아야 합니다.");
  assert.equal(harness.getResult().serverSync.status, "queued");

  // 로그아웃이 실패해 잠금이 풀리면 이어서 저장한다.
  releaseAccountLogoutLock(storage, ownerId, handle);
  assert.equal(storage.getItem(lockKey), null);
  await act(async () => {
    harness.browserWindow.dispatchEvent(new harness.browserWindow.StorageEvent("storage", {
      key: lockKey,
      storageArea: harness.browserWindow.localStorage,
    }));
  });
  await waitFor(() => saveCalls.length === 1, "잠금이 풀리면 대기열의 저장을 보내야 합니다.");
  await waitFor(() => harness.getResult().serverSync.status === "synced", "잠금이 풀린 뒤 동기화되어야 합니다.");
});

test("로그아웃 action이 실패하면 잠금을 풀고 오류를 보이며 다시 누를 수 있다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-retry";
  const sourceKey = createDocumentDraftKey("note", ownerId, "logout-retry");
  const lockKey = createAccountLogoutLockStorageKey(ownerId);
  // 아직 등록하지 않은 이 기기의 초안. 로그아웃이 실패하면 남아 있어야 한다.
  const harness = await createHarness(context, sourceKey, (storage) => {
    storage.setItem(sourceKey, serializeFormDraft({ title: "쓰던 노트", contentHtml: "<p>지우면 안 된다</p>" }));
  });
  logoutFailures = 1;

  const logout = await renderLogoutButton(harness.browserWindow, ownerId);
  try {
    await act(async () => logout.button.click());
    await waitFor(() => logoutCalls.length === 1, "첫 로그아웃 action이 실행되어야 합니다.");
    await waitFor(() => !logout.button.disabled, "실패하면 로그아웃 버튼을 다시 누를 수 있어야 합니다.");
    assert.equal(logout.button.getAttribute("aria-busy"), null);
    const form = logout.button.closest("form");
    const alert = form?.querySelector("[role='alert']");
    assert.match(alert?.textContent ?? "", /로그아웃하지 못했습니다/u);
    assert.equal(harness.browserWindow.localStorage.getItem(lockKey), null, "실패하면 로그아웃 잠금을 풀어야 합니다.");
    // 로그아웃이 확인되지 않았으므로 이 기기의 초안과 열린 편집기를 그대로 둔다.
    assert.notEqual(harness.browserWindow.localStorage.getItem(sourceKey), null, "실패하면 로컬 초안을 지우지 않아야 합니다.");

    await act(async () => logout.button.click());
    await waitFor(() => logoutCalls.length === 2, "다시 누르면 로그아웃 action을 다시 보내야 합니다.");
    await waitFor(() => form?.querySelector("[role='alert']") === null, "다시 시도하면 이전 오류를 지워야 합니다.");
    assert.equal(logout.button.disabled, true);
  } finally {
    await logout.unmount();
  }
});

test("로그아웃 전 폐기 요청이 실패해도 로컬 초안을 정리하고 로그아웃한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-offline";
  const sourceKey = createDocumentDraftKey("note", ownerId, "offline-logout");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const harness = await createHarness(context, sourceKey, (storage) => {
    enqueueDocumentServerDraftDiscard(storage, { sourceKey, expectedDraftVersion: 1 });
  });
  setOnline(harness.browserWindow, false);

  logoutProbeKeys = { queueKey, sourceKey };
  const logout = await renderLogoutButton(harness.browserWindow, ownerId);
  try {
    await act(async () => logout.button.click());
    await waitFor(() => logoutCalls.length === 1, "오프라인이어도 로그아웃 action이 실행되어야 합니다.");
  } finally {
    await logout.unmount();
  }

  assert.equal(discardCalls.length, 0);
  assert.deepEqual(logoutCalls, [{ queueRaw: null, localDraft: null }]);
});

test("제출된 A 초안 정리는 CAS 충돌 뒤 다른 기기의 미전송 B를 삭제하지 않는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "submitted-race");
  const submitted = { title: "제출한 A", contentHtml: "<p>A</p>" };
  const otherDraft = { title: "아직 미전송 B", contentHtml: "<p>B</p>" };
  remoteDraft = createSnapshot(sourceKey, submitted, 1);
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().serverSync.useRemoteDraft());
  remoteDraft = createSnapshot(sourceKey, otherDraft, 2);
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: submitted }));
  await waitFor(() => harness.getResult().serverSync.status === "remote-available", "다른 기기의 초안을 다시 선택할 수 있어야 합니다.");
  assert.equal(remoteDraft?.payloadHash, createSnapshot(sourceKey, otherDraft, 2).payloadHash);
  assert.equal(discardCalls.length, 1, "거절된 삭제를 다른 payload의 새 version으로 재시도하지 않는다");
  assert.equal(harness.browserWindow.localStorage.getItem(createDocumentServerDraftQueueKey(sourceKey)), null);
});

test("제출 정리는 같은 기기 ID를 쓰는 다른 탭의 후속 작업(v2·다른 hash)을 폐기하지 않는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "submitted-same-device-tab");
  const submitted = { title: "탭 A 제출", contentHtml: "<p>A</p>" };
  const tabB = { title: "탭 B 새 본문", contentHtml: "<p>B</p>" };
  remoteDraft = createSnapshot(sourceKey, submitted, 1);
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().serverSync.useRemoteDraft());
  // 같은 브라우저의 탭 B는 기기 ID를 공유한다. 탭 A의 정리가 기다리는 동안 탭 B가 다른 본문을 v2로 저장했다.
  const ownDeviceId = getOrCreateDocumentServerDraftDeviceId(harness.browserWindow.localStorage as unknown as Storage, "student-1");
  remoteDraft = createSnapshot(sourceKey, tabB, 2, ownDeviceId);
  const tabBHash = remoteDraft.payloadHash;
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: submitted }));
  await waitFor(() => harness.getResult().serverSync.status === "remote-available", "탭 B의 작성본을 다시 선택할 수 있어야 합니다.");
  assert.equal(remoteDraft?.payloadHash, tabBHash, "기기 ID가 같다는 이유로 v2·다른 본문을 지우지 않는다");
  assert.equal(remoteDraft?.writerDeviceId, ownDeviceId);
  assert.equal(discardCalls.length, 1, "충돌 뒤 탭 B의 hash로 다시 겨냥하지 않는다");
  assert.deepEqual(discardCalls[0]?.targetPayloadHashes, [createSnapshot(sourceKey, submitted, 1).payloadHash]);
  assert.equal(harness.browserWindow.localStorage.getItem(createDocumentServerDraftQueueKey(sourceKey)), null);
});

test("이미 확인한 다른 서버본은 로컬 문서 제출 성공으로 삭제하지 않는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "known-peer");
  const submitted = { title: "이 기기 A", contentHtml: "<p>A</p>" };
  remoteDraft = createSnapshot(sourceKey, { title: "서버 B", contentHtml: "<p>B</p>" }, 4);
  const remoteHash = remoteDraft.payloadHash;
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().save(submitted));
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: submitted }));
  assert.equal(remoteDraft?.payloadHash, remoteHash);
  assert.equal(discardCalls.length, 0);
  assert.equal(harness.getResult().serverSync.status, "remote-available");
});

test("오프라인 제출 정리는 같은 version으로 재생성된 다른 본문을 보존한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "offline-cleanup");
  const submitted = { title: "제출 A", contentHtml: "<p>A</p>" };
  remoteDraft = createSnapshot(sourceKey, submitted, 1);
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().serverSync.useRemoteDraft());
  setOnline(harness.browserWindow, false);
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: submitted }));
  const queued = parseQueuedDocumentServerDraft(harness.browserWindow.localStorage.getItem(createDocumentServerDraftQueueKey(sourceKey)) ?? "");
  assert.equal(queued?.operationType, "DISCARD");
  if (queued?.operationType === "DISCARD") assert.deepEqual(queued.targetPayloadHashes, [remoteDraft.payloadHash]);
  remoteDraft = createSnapshot(sourceKey, { title: "재생성 B", contentHtml: "<p>B</p>" }, 1);
  const peerHash = remoteDraft.payloadHash;
  setOnline(harness.browserWindow, true);
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => harness.getResult().serverSync.status === "remote-available", "서버에 새 작성본을 보존해야 합니다.");
  assert.equal(remoteDraft?.payloadHash, peerHash);
  assert.equal(discardCalls.length, 1);
});

test("오래된 UPSERT는 동일 version 재생성 본문을 덮지 않고 새 기준을 명시적으로 선택한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "upsert-aba");
  remoteDraft = createSnapshot(sourceKey, { title: "기준 A", contentHtml: "<p>A</p>" }, 1);
  const oldHash = remoteDraft.payloadHash;
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().serverSync.useRemoteDraft());
  setOnline(harness.browserWindow, false);
  await act(async () => harness.getResult().save({ title: "내 변경 C", contentHtml: "<p>C</p>" }));
  remoteDraft = createSnapshot(sourceKey, { title: "재생성 B", contentHtml: "<p>B</p>" }, 1);
  const peerHash = remoteDraft.payloadHash;
  setOnline(harness.browserWindow, true);
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => harness.getResult().serverSync.status === "conflict", "본문 기준 충돌을 보여야 합니다.");
  assert.equal(saveCalls[0]?.expectedPayloadHash, oldHash);
  assert.equal(remoteDraft?.payloadHash, peerHash);
  await act(async () => harness.getResult().serverSync.keepLocalDraft());
  await waitFor(() => harness.getResult().serverSync.status === "synced", "명시적 새 기준 선택 뒤 저장할 수 있어야 합니다.");
  assert.equal(saveCalls[1]?.expectedPayloadHash, peerHash);
  assert.match(remoteDraft?.payloadJson ?? "", /내 변경 C/);
});

test("기준 본문 hash 없는 기존 수정 queue는 원문을 보존하고 사용자 선택 전 재전송하지 않는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "legacy-upsert");
  const local = { title: "기존 queue C", contentHtml: "<p>C</p>" };
  remoteDraft = createSnapshot(sourceKey, { title: "현재 B", contentHtml: "<p>B</p>" }, 1);
  const peerHash = remoteDraft.payloadHash;
  let originalRaw = "";
  const harness = await createHarness(context, sourceKey, (storage) => {
    storage.setItem(sourceKey, serializeFormDraft(local));
    originalRaw = enqueueDocumentServerDraftUpsert(storage, {
      sourceKey, data: local, expectedDraftVersion: 1, baseResourceVersion: null,
      writerDeviceId: "7971deed-89f6-48a4-8bbd-5f0ec63488e0",
    }).raw;
  });
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  assert.equal(harness.getResult().serverSync.status, "conflict");
  assert.equal(saveCalls.length, 0);
  assert.equal(harness.browserWindow.localStorage.getItem(createDocumentServerDraftQueueKey(sourceKey)), originalRaw);
  await act(async () => harness.getResult().serverSync.keepLocalDraft());
  await waitFor(() => harness.getResult().serverSync.status === "synced", "기존 본문을 명시적으로 이어서 저장할 수 있어야 합니다.");
  assert.equal(saveCalls[0]?.expectedPayloadHash, peerHash);
  assert.match(remoteDraft?.payloadJson ?? "", /기존 queue C/);
});

test("기존 queue와 다른 로컬 복원본의 편집·자동 정리는 선택 전 원 queue를 보존한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "legacy-distinct-local");
  const queued = { title: "queue에만 남은 C", contentHtml: "<p>고유 원문 C</p>" };
  const local = { title: "로컬 복원 D", contentHtml: "<p>D</p>" };
  remoteDraft = createSnapshot(sourceKey, { title: "서버 B", contentHtml: "<p>B</p>" }, 1);
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  let originalRaw = "";
  const harness = await createHarness(context, sourceKey, (storage) => {
    storage.setItem(sourceKey, serializeFormDraft(local));
    originalRaw = enqueueDocumentServerDraftUpsert(storage, {
      sourceKey, data: queued, expectedDraftVersion: 1, baseResourceVersion: null,
      writerDeviceId: "7971deed-89f6-48a4-8bbd-5f0ec63488e0",
    }).raw;
  });
  assert.deepEqual(harness.restored.at(-1), local);
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), originalRaw);

  remoteDraft = createSnapshot(sourceKey, local, 2);
  await act(async () => {
    await harness.getResult().serverSync.refresh();
    harness.getResult().save(local);
    harness.getResult().clear({ reason: "empty" });
  });
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), originalRaw);
  assert.equal(harness.getResult().serverSync.status, "conflict");
  assert.equal(saveCalls.length, 0);
  assert.equal(discardCalls.length, 0);

  const chooseRemote = [...harness.container.querySelectorAll("button")].find((button) => button.textContent?.includes("계정 작성본 사용"));
  assert.ok(chooseRemote);
  chooseRemote.focus();
  await act(async () => chooseRemote.click());
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);
  assert.deepEqual(harness.restored.at(-1), local);
  assert.equal(harness.getResult().serverSync.status, "synced");
  assert.equal(harness.browserWindow.document.activeElement?.getAttribute("aria-label"), "계정 초안 동기화 상태");
});

test("서버에 같은 본문이 있어도 기존 queue는 명시적 선택 전 조회·제출 정리로 제거하지 않는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "legacy-converged");
  const data = { title: "보존할 C", contentHtml: "<p>C</p>" };
  remoteDraft = createSnapshot(sourceKey, data, 2);
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  let originalRaw = "";
  const harness = await createHarness(context, sourceKey, (storage) => {
    storage.setItem(sourceKey, serializeFormDraft(data));
    originalRaw = enqueueDocumentServerDraftUpsert(storage, {
      sourceKey, data, expectedDraftVersion: 1, baseResourceVersion: null,
      writerDeviceId: "7971deed-89f6-48a4-8bbd-5f0ec63488e0",
    }).raw;
  });
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), originalRaw);
  await act(async () => {
    harness.getResult().save(data);
    harness.getResult().clear({ reason: "submitted", submittedData: data });
    await harness.getResult().serverSync.refresh();
  });
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), originalRaw);
  assert.equal(harness.getResult().serverSync.status, "conflict");
  assert.equal(saveCalls.length, 0);
  assert.equal(discardCalls.length, 0);
  assert.match(remoteDraft?.payloadJson ?? "", /보존할 C/);
});

test("보관된 queue만 남아도 원문을 보고 폼으로 복원한 뒤 명시적으로 계정에 저장할 수 있다", { concurrency: false }, async (context) => {
  for (const clearedLocal of [false, true]) {
    await context.test(clearedLocal ? "다른 로컬 본문 정리 후" : "계정 조회 실패와 오프라인 복원", async (subcontext) => {
      resetServerMock();
      readFails = !clearedLocal;
      const sourceKey = createDocumentDraftKey("note", "student-1", `legacy-recovery-${clearedLocal}`);
      const data = { title: "유일하게 보관된 C", contentHtml: "<p>복원할 본문 C</p>" };
      const local = { title: "현재 입력 D", contentHtml: "<p>D</p>" };
      const queueKey = createDocumentServerDraftQueueKey(sourceKey);
      let originalRaw = "";
      const harness = await createHarness(subcontext, sourceKey, (storage) => {
        if (clearedLocal) storage.setItem(sourceKey, serializeFormDraft(local));
        originalRaw = enqueueDocumentServerDraftUpsert(storage, {
          sourceKey, data, expectedDraftVersion: 1, baseResourceVersion: null,
          writerDeviceId: "7971deed-89f6-48a4-8bbd-5f0ec63488e0",
        }).raw;
      });
      assert.match(harness.container.textContent ?? "", /유일하게 보관된 C/);
      if (clearedLocal) {
        assert.deepEqual(harness.restored.at(-1), local, "보관된 C가 현재 D를 자동 교체하지 않는다");
        await act(async () => harness.getResult().clear({ reason: "empty" }));
      } else {
        setOnline(harness.browserWindow, false);
        await act(async () => harness.getResult().serverSync.refresh());
      }
      const restore = [...harness.container.querySelectorAll("button")].find((button) => button.textContent?.includes("보관된 작성본 복원"));
      assert.ok(restore && !restore.disabled, "사용자가 선택할 수 있는 복원 버튼이 있어야 한다");
      await act(async () => restore.click());
      assert.deepEqual(harness.restored.at(-1), data);
      assert.equal(harness.browserWindow.document.activeElement?.getAttribute("aria-label"), "계정 초안 동기화 상태");
      assert.deepEqual(parseFormDraft<DraftData>(harness.browserWindow.localStorage.getItem(sourceKey) ?? "")?.data, data);
      assert.equal(harness.browserWindow.localStorage.getItem(queueKey), originalRaw, "폼 복원만으로 원 queue를 재작성하지 않는다");
      assert.equal(saveCalls.length, 0);
      assert.equal(discardCalls.length, 0);

      readFails = false;
      setOnline(harness.browserWindow, true);
      await act(async () => harness.getResult().serverSync.refresh());
      const keepLocal = [...harness.container.querySelectorAll("button")].find((button) => button.textContent?.includes("내 초안으로 계속"));
      assert.ok(keepLocal);
      keepLocal.focus();
      await act(async () => keepLocal.click());
      await waitFor(() => harness.getResult().serverSync.status === "synced", "선택한 보관본을 계정에 저장할 수 있어야 한다");
      assert.equal(harness.browserWindow.document.activeElement?.getAttribute("aria-label"), "계정 초안 동기화 상태");
      assert.match(remoteDraft?.payloadJson ?? "", /복원할 본문 C/);
      assert.equal(saveCalls[0]?.expectedDraftVersion, 0);
      assert.notEqual(saveCalls[0]?.operationId, parseQueuedDocumentServerDraft(originalRaw)?.operationId);
      assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);
    });
  }
});

test("보관본 미리보기 뒤 queue가 바뀌면 새 원문을 자동 복원하지 않고 다시 보여 준다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "legacy-recovery-stale");
  remoteDraft = createSnapshot(sourceKey, { title: "현재 계정 B", contentHtml: "<p>B</p>" }, 4);
  const baseHash = remoteDraft.payloadHash;
  const seed = (storage: Storage, title: string) => enqueueDocumentServerDraftUpsert(storage, {
    sourceKey, data: { title, contentHtml: `<p>${title}</p>` }, expectedDraftVersion: 1,
    baseResourceVersion: null, writerDeviceId: "7971deed-89f6-48a4-8bbd-5f0ec63488e0",
  });
  const harness = await createHarness(context, sourceKey, (storage) => { seed(storage, "선택 전 C"); });
  const restore = [...harness.container.querySelectorAll("button")].find((button) => button.textContent?.includes("보관된 작성본 복원"));
  assert.ok(restore);
  const newer = seed(harness.browserWindow.localStorage, "새 보관본 F");
  await act(async () => restore.click());
  assert.equal(harness.restored.length, 0);
  assert.equal(harness.browserWindow.localStorage.getItem(sourceKey), null);
  assert.equal(harness.browserWindow.localStorage.getItem(createDocumentServerDraftQueueKey(sourceKey)), newer.raw);
  assert.match(harness.container.textContent ?? "", /새 보관본 F/);
  assert.equal(saveCalls.length, 0);
  await act(async () => restore.click());
  assert.equal(harness.restored.at(-1)?.title, "새 보관본 F");
  assert.equal(remoteDraft?.payloadHash, baseHash, "입력란 복원은 계정 작성본을 덮지 않는다");
  assert.equal(saveCalls.length, 0);
  await act(async () => harness.getResult().serverSync.keepLocalDraft());
  await waitFor(() => harness.getResult().serverSync.status === "synced", "새로 확인한 작성본을 선택해 저장한다");
  assert.equal(saveCalls[0]?.expectedDraftVersion, 4);
  assert.equal(saveCalls[0]?.expectedPayloadHash, baseHash);
  assert.match(remoteDraft?.payloadJson ?? "", /새 보관본 F/);
});

test("명시적 계정 초안 삭제도 충돌 뒤 다른 본문까지 자동 확대하지 않는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "explicit-discard-race");
  remoteDraft = createSnapshot(sourceKey, { title: "삭제 선택 A", contentHtml: "<p>A</p>" }, 1);
  const harness = await createHarness(context, sourceKey);
  remoteDraft = createSnapshot(sourceKey, { title: "새로운 B", contentHtml: "<p>B</p>" }, 2);
  const peerHash = remoteDraft.payloadHash;
  await act(async () => harness.getResult().serverSync.discardRemoteDraft());
  await waitFor(() => harness.getResult().serverSync.status === "remote-available", "새 작성본을 다시 확인할 수 있어야 합니다.");
  assert.equal(remoteDraft?.payloadHash, peerHash);
  assert.equal(discardCalls.length, 1);
});

test("명시적 계정 초안 삭제는 공유 큐에 있는 다른 탭의 UPSERT를 이 탭의 이전 입력으로 겨냥하지 않는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "explicit-discard-other-tab");
  remoteDraft = createSnapshot(sourceKey, { title: "확인한 A", contentHtml: "<p>A</p>" }, 1);
  const seenHash = remoteDraft.payloadHash;
  const harness = await createHarness(context, sourceKey);
  // 같은 브라우저의 탭 B가 다른 본문을 v2로 저장했고 응답 대기 중이라 공유 큐에 B의 UPSERT가 남아 있다.
  const tabB = { title: "탭 B의 후속 작업", contentHtml: "<p>B</p>" };
  const tabBEntry = enqueueDocumentServerDraftUpsert(harness.browserWindow.localStorage, {
    sourceKey, data: tabB, expectedDraftVersion: 1, baseResourceVersion: null,
    writerDeviceId: "7971deed-89f6-48a4-8bbd-5f0ec63488e0",
  }).entry;
  remoteDraft = createSnapshot(sourceKey, tabB, 2);
  const tabBHash = remoteDraft.payloadHash;

  await act(async () => harness.getResult().serverSync.discardRemoteDraft());
  await waitFor(() => discardCalls.length >= 1, "폐기 요청이 전송돼야 합니다.");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  assert.deepEqual(discardCalls[0]?.targetPayloadHashes, [seenHash], "확인했던 서버본만 겨냥한다");
  assert.equal(discardCalls.some((call) => call.supersededOperationIds?.includes(tabBEntry.operationId)), false,
    "다른 탭의 operation을 fence 대상으로 보내지 않는다");
  assert.equal(discardCalls.some((call) => call.targetPayloadHashes?.includes(tabBHash)), false);
  assert.equal(remoteDraft?.payloadHash, tabBHash, "탭 B의 v2는 보존된다");
});

test("전송 중인 UPSERT 뒤 제출 정리는 같은 본문만 지우고 다른 기기 변경은 보존한다", { concurrency: false }, async (context) => {
  for (const peerChanged of [false, true]) {
    await context.test(peerChanged ? "다른 기기 변경" : "같은 제출 본문", async (subcontext) => {
      resetServerMock();
      const sourceKey = createDocumentDraftKey("note", "student-1", `inflight-${peerChanged}`);
      const data = { title: "제출 A", contentHtml: "<p>A</p>" };
      let release: () => void = () => {};
      beforeSaveCommit = () => new Promise<void>((resolve) => { release = resolve; });
      const harness = await createHarness(subcontext, sourceKey);
      await act(async () => harness.getResult().save(data));
      await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
      await waitFor(() => saveCalls.length === 1, "UPSERT 전송이 시작돼야 합니다.");
      await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: data }));
      await act(async () => harness.getResult().serverSync.refresh());
      assert.notEqual(harness.browserWindow.localStorage.getItem(createDocumentServerDraftQueueKey(sourceKey)), null, "전송 중 조회의 null로 제출 정리 의도를 지우지 않는다");
      if (peerChanged) remoteDraft = createSnapshot(sourceKey, { title: "다른 B", contentHtml: "<p>B</p>" }, 1);
      await act(async () => release());
      await waitFor(() => harness.getResult().serverSync.status === (peerChanged ? "remote-available" : "idle"), "제출 정리가 완료되거나 다른 초안을 보존해야 합니다.");
      assert.equal(remoteDraft?.payloadJson.includes("다른 B") ?? false, peerChanged);
      if (!peerChanged) assert.equal(remoteDraft, null);
      assert.equal(harness.browserWindow.localStorage.getItem(createDocumentServerDraftQueueKey(sourceKey)), null);
    });
  }
});

test("기존 서버 초안을 편집한 UPSERT가 전송 중이어도 제출한 최신 본문을 정리한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "inflight-existing-base");
  remoteDraft = createSnapshot(sourceKey, { title: "작성 중 A", contentHtml: "<p>A</p>" }, 1);
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().serverSync.useRemoteDraft());
  let release: () => void = () => {};
  beforeSaveCommit = () => new Promise<void>((resolve) => { release = resolve; });
  const submitted = { title: "완성 C", contentHtml: "<p>C</p>" };
  await act(async () => harness.getResult().save(submitted));
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => saveCalls.length === 1, "수정 UPSERT가 전송돼야 합니다.");
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: submitted }));
  await act(async () => release());
  await waitFor(() => harness.getResult().serverSync.status === "idle", "서버가 이전 본문을 기억해도 진행 중 최신 제출본의 정리는 보존돼야 합니다.");
  assert.equal(remoteDraft, null);
});

test("이전 삭제의 지연 응답은 이후 선택한 B의 정확한 삭제 queue를 소거하지 않는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "late-discard-response");
  remoteDraft = createSnapshot(sourceKey, { title: "이전 A", contentHtml: "<p>A</p>" }, 1);
  let release: () => void = () => {};
  afterDiscardCommit = () => new Promise<void>((resolve) => { release = resolve; });
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().serverSync.discardRemoteDraft());
  await waitFor(() => discardCalls.length === 1, "A 삭제의 응답만 지연시킨다");
  remoteDraft = createSnapshot(sourceKey, { title: "새 B", contentHtml: "<p>B</p>" }, 1);
  await act(async () => {
    enqueueDocumentServerDraftDiscard(harness.browserWindow.localStorage, {
      sourceKey, expectedDraftVersion: 1, targetPayloadHashes: [remoteDraft!.payloadHash],
    });
    await harness.getResult().serverSync.refresh();
  });
  afterDiscardCommit = null;
  await act(async () => release());
  await waitFor(() => discardCalls.length === 2 && harness.getResult().serverSync.status === "idle", "새 삭제는 자체 응답으로 완료돼야 합니다.");
  assert.equal(remoteDraft, null);
  assert.equal(harness.browserWindow.localStorage.getItem(createDocumentServerDraftQueueKey(sourceKey)), null);
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

test("hidden·offline에서는 poll하지 않고 visible·online 복귀 이벤트를 한 번으로 합친다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "adaptive-poll-note");
  const harness = await createHarness(context, sourceKey);
  const initialReads = readCalls;

  setVisibility(harness.browserWindow, "hidden");
  await act(async () => {
    harness.browserWindow.document.dispatchEvent(new harness.browserWindow.Event("visibilitychange"));
    harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("focus"));
    harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(readCalls, initialReads);

  setVisibility(harness.browserWindow, "visible");
  await act(async () => {
    harness.browserWindow.document.dispatchEvent(new harness.browserWindow.Event("visibilitychange"));
    harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("focus"));
  });
  await waitFor(() => readCalls === initialReads + 1, "visible 복귀 refresh는 한 번이어야 합니다.");

  setOnline(harness.browserWindow, false);
  await act(async () => {
    harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("offline"));
    harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(readCalls, initialReads + 1);

  setOnline(harness.browserWindow, true);
  await act(async () => {
    harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online"));
    harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("focus"));
  });
  await waitFor(() => readCalls === initialReads + 2, "online 복귀 refresh는 한 번이어야 합니다.");
});

test("로그아웃 action의 redirect 응답은 실패가 아니므로 잠금과 진행 표시를 유지한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-redirect";
  const sourceKey = createDocumentDraftKey("note", ownerId, "logout-redirect");
  const lockKey = createAccountLogoutLockStorageKey(ownerId);
  // 로그아웃이 확인되면(redirect 신호) 이 기기의 초안을 지워야 한다(공유 기기 보호).
  const harness = await createHarness(context, sourceKey, (storage) => {
    storage.setItem(sourceKey, serializeFormDraft({ title: "남기면 안 되는 초안", contentHtml: "<p>x</p>" }));
  });
  logoutRedirects = true;

  const logout = await renderLogoutButton(harness.browserWindow, ownerId);
  try {
    await act(async () => logout.button.click());
    await waitFor(() => logoutCalls.length === 1, "로그아웃 action이 실행되어야 합니다.");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    assert.equal(logout.button.disabled, true, "이동하는 동안 버튼은 계속 기다림 상태여야 합니다.");
    assert.equal(logout.button.closest("form")?.querySelector("[role='alert']") ?? null, null);
    assert.notEqual(harness.browserWindow.localStorage.getItem(lockKey), null, "이동 중에는 잠금을 풀지 않아야 합니다.");
    assert.equal(harness.browserWindow.localStorage.getItem(sourceKey), null, "로그아웃이 확인되면 이 기기의 초안을 지워야 합니다.");
  } finally {
    await logout.unmount();
  }
});

test("로그아웃 응답이 늦어지면 잠금을 만료 전에 다시 기록해 다른 탭 저장을 계속 막는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-slow";
  const sourceKey = createDocumentDraftKey("note", ownerId, "logout-slow");
  const lockKey = createAccountLogoutLockStorageKey(ownerId);
  const harness = await createHarness(context, sourceKey);
  const hold = Promise.withResolvers<void>();
  logoutHold = hold.promise;
  logoutRedirects = true;

  const logout = await renderLogoutButton(harness.browserWindow, ownerId);
  try {
    await act(async () => logout.button.click());
    await waitFor(() => logoutCalls.length === 1, "로그아웃 action이 실행되어야 합니다.");
    const expiresAt = () => JSON.parse(harness.browserWindow.localStorage.getItem(lockKey) ?? "null")?.expiresAt as number | undefined;
    const first = expiresAt();
    assert.ok(first);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5_300)));
    const renewed = expiresAt();
    assert.ok(renewed && renewed > first, "응답을 기다리는 동안 잠금 만료가 뒤로 밀려야 합니다.");
    hold.resolve();
  } finally {
    hold.resolve();
    await logout.unmount();
  }
});

// ---- 2026-10-31 노트 편집기 안정화: 서버 초안 비교·폐기 규칙 ----

/** 새 노트 자동 생성 시퀀스: P1 UPSERT 전송 중에 P2까지 입력하고 P2로 제출 성공해 정리한다. */
async function startInflightThenSubmit(
  harness: Awaited<ReturnType<typeof createHarness>>,
  first: DraftData,
  submitted: DraftData,
) {
  await act(async () => harness.getResult().save(first));
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => saveCalls.length === 1, "P1 UPSERT 전송이 시작돼야 합니다.");
  await act(async () => harness.getResult().save(submitted));
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: submitted }));
}

test("제출 정리는 전송 중이던 이전 입력의 서버본을 본문 hash로 겨냥해 현재 version으로 다시 겨냥해 지운다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "new:student-1");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const first = { title: "첫 입력 P1", contentHtml: "<p>P1</p>" };
  const submitted = { title: "제출한 P2", contentHtml: "<p>P2</p>" };
  let release: () => void = () => {};
  beforeSaveCommit = () => new Promise<void>((resolve) => { release = resolve; });
  const harness = await createHarness(context, sourceKey);
  await startInflightThenSubmit(harness, first, submitted);
  const queued = parseQueuedDocumentServerDraft(harness.browserWindow.localStorage.getItem(queueKey) ?? "");
  assert.equal(queued?.operationType, "DISCARD");
  assert.equal(queued?.expectedDraftVersion, 0);

  if (queued?.operationType === "DISCARD") {
    assert.deepEqual(
      queued.targetPayloadHashes,
      [createSnapshot(sourceKey, submitted, 1).payloadHash, createSnapshot(sourceKey, first, 1).payloadHash].sort(),
      "전송 중이던 P1의 본문 hash를 제출 본문과 함께 대상에 넣는다",
    );
  }

  await act(async () => release());
  await waitFor(() => harness.getResult().serverSync.status === "idle", "이 기기가 쓴 P1 서버본은 제출 정리로 지워져야 합니다.");
  assert.equal(remoteDraft, null);
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);
  assert.equal(discardCalls.length, 1);
  assert.equal(discardCalls[0]?.expectedDraftVersion, 1, "UPSERT 응답의 version으로 rebase한 뒤 보내야 합니다.");
  assert.equal(harness.statusHistory.includes("remote-available"), false, "선택창이 뜨면 안 됩니다.");
  assert.equal(harness.statusHistory.includes("conflict"), false);
});

test("제출 응답을 기다리는 동안 같은 탭에서 이어 쓴 입력은 제출 정리가 폐기하지 않고 서버에 저장된다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "new:student-1");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const first = { title: "첫 입력 P1", contentHtml: "<p>P1</p>" };
  const submitted = { title: "제출한 P2", contentHtml: "<p>P2</p>" };
  const continued = { title: "제출한 P2", contentHtml: "<p>P2 이어 쓴 P3</p>" };
  let release: () => void = () => {};
  beforeSaveCommit = () => new Promise<void>((resolve) => { release = resolve; });
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().save(first));
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => saveCalls.length === 1, "P1 UPSERT 전송이 시작돼야 합니다.");
  await act(async () => harness.getResult().save(submitted));
  // 새 노트 제자리 생성: 생성 응답 전 같은 편집기에서 계속 입력한다. 정리는 그 뒤 제출 본문(P2)으로 도착한다.
  await act(async () => harness.getResult().save(continued));
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: submitted }));

  const queued = parseQueuedDocumentServerDraft(harness.browserWindow.localStorage.getItem(queueKey) ?? "");
  assert.notEqual(queued?.operationType, "DISCARD", "이어 쓴 로컬 작성본이 있으면 제출 정리는 폐기를 큐에 넣지 않는다.");
  assert.notEqual(harness.browserWindow.localStorage.getItem(sourceKey), null, "이어 쓴 로컬 작성본은 보존한다.");

  beforeSaveCommit = null;
  await act(async () => release());
  await waitFor(
    () => remoteDraft?.payloadHash === createSnapshot(sourceKey, continued, 1).payloadHash,
    "이어 쓴 P3가 서버본으로 저장돼야 합니다.",
  );
  assert.equal(discardCalls.length, 0, "제출 정리가 이어 쓴 입력을 폐기하면 안 됩니다.");
  assert.equal(harness.statusHistory.includes("remote-available"), false);
  assert.equal(harness.statusHistory.includes("conflict"), false);
});

test("전송 중 편집기가 내려가 응답이 버려져도 다음 진입의 refresh→drain이 이 기기의 서버본을 지운다",{ concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "new:student-1");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const first = { title: "첫 입력 P1", contentHtml: "<p>P1</p>" };
  const submitted = { title: "제출한 P2", contentHtml: "<p>P2</p>" };
  let release: () => void = () => {};
  beforeSaveCommit = () => new Promise<void>((resolve) => { release = resolve; });
  const harness = await createHarness(context, sourceKey);
  await startInflightThenSubmit(harness, first, submitted);

  // 새 노트 생성 직후 route·key 전환: 응답을 받을 hook이 없고 큐의 DISCARD만 남는다.
  await harness.unmount();
  await act(async () => release());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  assert.equal(remoteDraft?.draftVersion, 1, "버려진 응답과 무관하게 서버에는 P1이 남는다.");
  assert.equal(parseQueuedDocumentServerDraft(harness.browserWindow.localStorage.getItem(queueKey) ?? "")?.operationType, "DISCARD");

  await harness.remount();
  await waitFor(() => harness.getResult().serverSync.status === "idle", "다음 진입에서 이 기기의 서버본을 조용히 지워야 합니다.");
  assert.equal(remoteDraft, null);
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);
  assert.equal(discardCalls.at(-1)?.expectedDraftVersion, 1);
  assert.equal(harness.statusHistory.includes("remote-available"), false, "다음 진입에서 선택창이 뜨면 안 됩니다.");
  assert.equal(harness.statusHistory.includes("conflict"), false);
});

const VOLATILE_SERVER_OPTIONS: ServerSyncOptions = { volatileKeys: ["operationId"] };
const OTHER_DEVICE_ID = "7971deed-89f6-48a4-8bbd-5f0ec63488e0";
const opId = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;

test("volatileKeys는 서버 payload와 비교에서 operationId를 빼 같은 내용의 다른 기기·legacy 서버본을 synced로 본다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "volatile-note");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const same = { title: "같은 내용", contentHtml: "<p>같음</p>" };
  // 배포 전 저장된 legacy 서버본: operationId가 payload에 들어 있고 다른 기기가 썼다.
  remoteDraft = createSnapshot(sourceKey, { ...same, operationId: opId("a") }, 3, OTHER_DEVICE_ID);
  const legacyHash = remoteDraft.payloadHash;
  const harness = await createHarness(context, sourceKey, undefined, { server: VOLATILE_SERVER_OPTIONS });
  assert.equal(harness.getResult().serverSync.status, "remote-available");

  // 다른 내용은 여전히 명시적 충돌이다.
  await act(async () => harness.getResult().save({ title: "다른 내용", contentHtml: "<p>다름</p>", operationId: opId("b") }));
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  assert.equal(harness.getResult().serverSync.status, "conflict");
  assert.equal(saveCalls.length, 0);

  // 같은 내용(다른 operationId)은 선택 없이 synced.
  await act(async () => harness.getResult().save({ ...same, operationId: opId("c") }));
  assert.equal(harness.getResult().serverSync.status, "synced");
  assert.equal(saveCalls.length, 0);
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);
  assert.equal(harness.getResult().serverSync.localPreview?.title, same.title);

  // 이어서 입력하면 legacy 서버본 위에 CAS 저장하되 payload에는 operationId를 싣지 않는다.
  const next = { title: "이어서 입력", contentHtml: "<p>다음</p>" };
  await act(async () => harness.getResult().save({ ...next, operationId: opId("c") }));
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => harness.getResult().serverSync.status === "synced" && saveCalls.length === 1, "legacy 서버본 위에 저장돼야 합니다.");
  assert.equal(saveCalls[0]?.expectedDraftVersion, 3);
  assert.equal(saveCalls[0]?.expectedPayloadHash, legacyHash, "CAS 기준은 서버가 저장한 hash 그대로다.");
  const sentPayload = canonicalizeDocumentServerDraftPayload(saveCalls[0]?.payloadJson ?? "");
  assert.deepEqual(sentPayload?.data, next);
  assert.equal(remoteDraft?.draftVersion, 4);

  // 다른 기기가 같은 내용을 다른 operationId로(legacy 형식) 저장해도 synced.
  remoteDraft = createSnapshot(sourceKey, { ...next, operationId: opId("d") }, 5, OTHER_DEVICE_ID);
  await act(async () => harness.getResult().serverSync.refresh());
  assert.equal(harness.getResult().serverSync.status, "synced");
  assert.equal(harness.getResult().serverSync.isDifferentDevice, true);
  assert.equal(harness.getResult().serverSync.remoteDraft?.draftVersion, 5);

  // 다른 내용이면 충돌을 유지한다.
  remoteDraft = createSnapshot(sourceKey, { title: "다른 기기 수정", contentHtml: "<p>수정</p>", operationId: opId("e") }, 6, OTHER_DEVICE_ID);
  await act(async () => harness.getResult().serverSync.refresh());
  assert.equal(harness.getResult().serverSync.status, "conflict");
  assert.equal(saveCalls.length, 1);
});

test("volatileKeys 아래 제출 정리는 operationId만 다른 legacy 서버본도 서버 hash로 겨냥해 지운다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "volatile-submit");
  const same = { title: "제출할 내용", contentHtml: "<p>제출</p>" };
  remoteDraft = createSnapshot(sourceKey, { ...same, operationId: opId("a") }, 2, OTHER_DEVICE_ID);
  const legacyHash = remoteDraft.payloadHash;
  const harness = await createHarness(context, sourceKey, undefined, { server: VOLATILE_SERVER_OPTIONS });
  await act(async () => harness.getResult().save({ ...same, operationId: opId("b") }));
  assert.equal(harness.getResult().serverSync.status, "synced");
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: { ...same, operationId: opId("f") } }));
  await waitFor(() => harness.getResult().serverSync.status === "idle", "같은 내용의 legacy 서버본은 제출 정리로 지워져야 합니다.");
  assert.equal(remoteDraft, null);
  assert.equal(discardCalls.length, 1);
  assert.ok(discardCalls[0]?.targetPayloadHashes?.includes(legacyHash));
  assert.equal(discardCalls[0]?.expectedDraftVersion, 2);
});

test("classifyRemoteDraft가 discard면 선택창 없이 서버본을 조용히 폐기하거나 로컬을 그 위에 저장한다", { concurrency: false }, async (context) => {
  await context.test("서버본이 현재 head와 같으면 조용히 폐기한다", async (subcontext) => {
    resetServerMock();
    const sourceKey = createDocumentDraftKey("note", "student-1", "classify-head");
    const head = { title: "head", contentHtml: "<p>head</p>", baseRevision: 5 };
    remoteDraft = createSnapshot(sourceKey, head, 2, OTHER_DEVICE_ID);
    const remoteHash = remoteDraft.payloadHash;
    const classified: DraftData[] = [];
    const harness = await createHarness(subcontext, sourceKey, undefined, {
      server: {
        classifyRemoteDraft: (remote) => {
          classified.push(remote);
          return remote.contentHtml === head.contentHtml ? "discard" : "keep";
        },
      },
    });
    await waitFor(() => harness.getResult().serverSync.status === "idle", "head와 같은 서버본은 조용히 지워야 합니다.");
    assert.equal(discardCalls.length, 1);
    assert.equal(discardCalls[0]?.expectedDraftVersion, 2);
    assert.deepEqual(discardCalls[0]?.targetPayloadHashes, [remoteHash]);
    assert.equal(remoteDraft, null);
    assert.equal(classified.length, 1, "같은 version·hash를 반복 판정하지 않는다");
    assert.equal(harness.statusHistory.includes("remote-available"), false, "선택창이 뜨면 안 됩니다.");
    assert.equal(harness.statusHistory.includes("conflict"), false);
  });

  await context.test("baseRevision이 head보다 오래된 서버본은 복구된 로컬 초안을 그 위에 저장한다", async (subcontext) => {
    resetServerMock();
    const sourceKey = createDocumentDraftKey("note", "student-1", "classify-stale-base");
    const stale = { title: "오래된 서버본", contentHtml: "<p>stale</p>", baseRevision: 3 };
    const local = { title: "새로고침 전 입력", contentHtml: "<p>local</p>", baseRevision: 5 };
    remoteDraft = createSnapshot(sourceKey, stale, 2, OTHER_DEVICE_ID);
    const staleHash = remoteDraft.payloadHash;
    const harness = await createHarness(subcontext, sourceKey, (storage) => {
      storage.setItem(sourceKey, serializeFormDraft(local));
    }, {
      server: { classifyRemoteDraft: (remote) => ((remote.baseRevision ?? 0) < 5 ? "discard" : "keep") },
    });
    await waitFor(() => harness.getResult().serverSync.status === "synced", "로컬 초안이 오래된 서버본 위에 저장돼야 합니다.");
    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0]?.expectedDraftVersion, 2);
    assert.equal(saveCalls[0]?.expectedPayloadHash, staleHash);
    assert.match(remoteDraft?.payloadJson ?? "", /새로고침 전 입력/u);
    assert.equal(discardCalls.length, 0);
    assert.deepEqual(harness.restored.at(-1), local);
    assert.equal(harness.statusHistory.includes("remote-available"), false);
    assert.equal(harness.statusHistory.includes("conflict"), false, "선택창이 뜨면 안 됩니다.");
  });

  await context.test("base가 head와 같고 내용이 다르면 선택창을 유지한다", async (subcontext) => {
    resetServerMock();
    const sourceKey = createDocumentDraftKey("note", "student-1", "classify-keep");
    remoteDraft = createSnapshot(sourceKey, { title: "다른 기기 수정", contentHtml: "<p>other</p>", baseRevision: 5 }, 2, OTHER_DEVICE_ID);
    const harness = await createHarness(subcontext, sourceKey, undefined, {
      server: { classifyRemoteDraft: (remote) => ((remote.baseRevision ?? 0) < 5 ? "discard" : "keep") },
    });
    assert.equal(harness.getResult().serverSync.status, "remote-available");
    await act(async () => harness.getResult().save({ title: "이 기기", contentHtml: "<p>mine</p>", baseRevision: 5 }));
    await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
    assert.equal(harness.getResult().serverSync.status, "conflict");
    assert.equal(discardCalls.length, 0);
    assert.equal(saveCalls.length, 0);
  });
});

test("자동 보존 판정은 기억하지 않아 head가 올라가면 같은 서버본을 다시 판정해 폐기한다", { concurrency: false }, async (context) => {
  for (const trigger of ["submitted", "refresh"] as const) {
    await context.test(trigger === "submitted" ? "제출 정리 뒤" : "refresh 뒤", async (subcontext) => {
      resetServerMock();
      const sourceKey = createDocumentDraftKey("note", "student-1", `reclassify-${trigger}`);
      // 다른 기기 서버본의 base(5)가 현재 head(5)와 같아 처음에는 보존한다.
      const peer = createSnapshot(sourceKey, { title: "다른 기기 수정", contentHtml: "<p>other</p>", baseRevision: 5 }, 2, OTHER_DEVICE_ID);
      remoteDraft = peer;
      let headVersion = 5;
      let classified = 0;
      const harness = await createHarness(subcontext, sourceKey, undefined, {
        server: {
          classifyRemoteDraft: (remote) => {
            classified += 1;
            return (remote.baseRevision ?? 0) < headVersion ? "discard" : "keep";
          },
        },
      });
      assert.equal(harness.getResult().serverSync.status, "remote-available");
      assert.ok(classified >= 1);
      assert.equal(discardCalls.length, 0);

      // 사용자가 자동 저장해 head가 6이 됐다(제출 정리 → evaluateState). 같은 서버본은 이제 head보다 오래됐다.
      headVersion = 6;
      const classifiedBefore = classified;
      if (trigger === "submitted") {
        await act(async () => harness.getResult().clear({
          reason: "submitted",
          submittedData: { title: "이 기기", contentHtml: "<p>mine</p>", baseRevision: 6 },
        }));
      } else {
        await act(async () => harness.getResult().serverSync.refresh());
      }
      await waitFor(() => harness.getResult().serverSync.status === "idle", "head가 올라간 뒤 오래된 서버본은 조용히 지워야 합니다.");
      assert.ok(classified > classifiedBefore, "head 갱신 뒤 classifyRemoteDraft를 다시 불러야 합니다.");
      assert.equal(discardCalls.length, 1);
      assert.equal(discardCalls[0]?.expectedDraftVersion, 2);
      assert.deepEqual(discardCalls[0]?.targetPayloadHashes, [peer.payloadHash]);
      assert.equal(remoteDraft, null);
      assert.notEqual(harness.getResult().serverSync.status, "remote-available");
    });
  }
});

test("같은 서버본(version·hash)에 대한 선택은 기억해 늦은 관찰에서 선택창 없이 다시 적용한다", { concurrency: false }, async (context) => {
  await context.test("discard 선택", async (subcontext) => {
    resetServerMock();
    const sourceKey = createDocumentDraftKey("note", "student-1", "remember-discard");
    const stale = createSnapshot(sourceKey, { title: "지운 서버본", contentHtml: "<p>X</p>" }, 1, OTHER_DEVICE_ID);
    remoteDraft = stale;
    const harness = await createHarness(subcontext, sourceKey);
    assert.equal(harness.getResult().serverSync.status, "remote-available");
    await act(async () => harness.getResult().serverSync.discardRemoteDraft());
    await waitFor(() => harness.getResult().serverSync.status === "idle", "명시적 폐기가 끝나야 합니다.");
    // 늦은 조회가 같은 version·hash를 다시 돌려준다.
    remoteDraft = stale;
    await act(async () => harness.getResult().serverSync.refresh());
    await waitFor(() => harness.getResult().serverSync.status === "idle" && discardCalls.length === 2, "같은 결정을 다시 적용해야 합니다.");
    assert.equal(remoteDraft, null);
    assert.equal(harness.statusHistory.filter((status) => status === "remote-available").length, 1);
  });

  await context.test("keep 선택", async (subcontext) => {
    resetServerMock();
    const sourceKey = createDocumentDraftKey("note", "student-1", "remember-keep");
    const peer = createSnapshot(sourceKey, { title: "다른 기기", contentHtml: "<p>X</p>" }, 4, OTHER_DEVICE_ID);
    remoteDraft = peer;
    const harness = await createHarness(subcontext, sourceKey);
    const local = { title: "내 초안", contentHtml: "<p>P</p>" };
    await act(async () => harness.getResult().save(local));
    await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
    assert.equal(harness.getResult().serverSync.status, "conflict");
    await act(async () => harness.getResult().serverSync.keepLocalDraft());
    await waitFor(() => harness.getResult().serverSync.status === "synced", "선택한 로컬본이 저장돼야 합니다.");
    assert.equal(remoteDraft?.draftVersion, 5);
    remoteDraft = peer;
    await act(async () => harness.getResult().serverSync.refresh());
    await waitFor(() => harness.getResult().serverSync.status === "synced" && saveCalls.length === 2, "같은 결정을 다시 적용해야 합니다.");
    assert.equal(saveCalls[1]?.expectedDraftVersion, 4);
    assert.equal(saveCalls[1]?.expectedPayloadHash, peer.payloadHash);
    assert.match(remoteDraft?.payloadJson ?? "", /내 초안/u);
    assert.equal(harness.statusHistory.filter((status) => status === "conflict").length, 1);
  });
});

test("제출 정리 DISCARD는 전송 중·큐의 UPSERT를 fence 대상으로 보내 늦은 저장이 서버본을 되살리지 못하게 한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "new:student-1");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const first = { title: "첫 입력 P1", contentHtml: "<p>P1</p>" };
  const submitted = { title: "제출한 P2", contentHtml: "<p>P2</p>" };
  let release: () => void = () => {};
  beforeSaveCommit = () => new Promise<void>((resolve) => { release = resolve; });
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().save(first));
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => saveCalls.length === 1, "P1 UPSERT 전송이 시작돼야 합니다.");
  const inflightOperationId = saveCalls[0]!.operationId;
  await act(async () => harness.getResult().save(submitted));
  const queuedUpsert = parseQueuedDocumentServerDraft(harness.browserWindow.localStorage.getItem(queueKey) ?? "");
  assert.equal(queuedUpsert?.operationType, "UPSERT");
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: submitted }));
  const discard = parseQueuedDocumentServerDraft(harness.browserWindow.localStorage.getItem(queueKey) ?? "");
  assert.equal(discard?.operationType, "DISCARD");
  if (discard?.operationType !== "DISCARD") return;
  assert.deepEqual(discard.supersededOperationIds, [inflightOperationId, queuedUpsert!.operationId].sort());

  // 화면 전환으로 응답을 받을 hook이 없어진 뒤, 다음 진입이 폐기를 먼저 보낸다(서버가 fence receipt를 선점).
  await harness.remount();
  await waitFor(() => harness.getResult().serverSync.status === "idle" && discardCalls.length === 1, "폐기가 먼저 반영돼야 합니다.");
  assert.deepEqual(discardCalls[0]?.supersededOperationIds, discard.supersededOperationIds);
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);

  // 늦게 커밋을 시도한 P1 UPSERT는 fence에 걸려 서버본을 만들지 못한다.
  await act(async () => release());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  assert.equal(remoteDraft, null, "fence가 늦은 저장의 부활을 막아야 합니다.");
  await act(async () => harness.getResult().serverSync.refresh());
  assert.equal(harness.getResult().serverSync.status, "idle");
  assert.equal(harness.statusHistory.includes("remote-available"), false);
  assert.equal(harness.statusHistory.includes("conflict"), false);
});

test("큐가 이미 DISCARD로 바뀐 뒤 받은 UPSERT의 OPERATION_PAYLOAD_CONFLICT는 선택창 없이 흡수된다", { concurrency: false }, async (context) => {
  resetServerMock();
  const sourceKey = createDocumentDraftKey("note", "student-1", "absorb-fenced-upsert");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const data = { title: "제출 A", contentHtml: "<p>A</p>" };
  let release: () => void = () => {};
  beforeSaveCommit = () => new Promise<void>((resolve) => { release = resolve; });
  const harness = await createHarness(context, sourceKey);
  await act(async () => harness.getResult().save(data));
  await act(async () => harness.browserWindow.dispatchEvent(new harness.browserWindow.Event("online")));
  await waitFor(() => saveCalls.length === 1, "UPSERT 전송이 시작돼야 합니다.");
  await act(async () => harness.getResult().clear({ reason: "submitted", submittedData: data }));
  const discard = parseQueuedDocumentServerDraft(harness.browserWindow.localStorage.getItem(queueKey) ?? "");
  assert.equal(discard?.operationType, "DISCARD");
  if (discard?.operationType !== "DISCARD") return;
  // 다른 탭(또는 로그아웃 정리)이 같은 큐 항목을 먼저 보내 서버가 전송 중 UPSERT를 fence했다.
  await mockDiscard({
    sourceKey,
    operationId: discard.operationId,
    expectedDraftVersion: discard.expectedDraftVersion,
    targetPayloadHashes: discard.targetPayloadHashes,
    supersededOperationIds: discard.supersededOperationIds,
  });
  assert.equal(fencedOperationIds.has(saveCalls[0]!.operationId), true);

  await act(async () => release());
  await waitFor(() => harness.getResult().serverSync.status === "idle", "거절된 UPSERT는 선택창 없이 끝나야 합니다.");
  assert.equal(remoteDraft, null);
  assert.equal(saveCalls.length, 1);
  assert.equal(harness.browserWindow.localStorage.getItem(queueKey), null);
  assert.equal(harness.statusHistory.includes("remote-available"), false);
  assert.equal(harness.statusHistory.includes("conflict"), false);
});
