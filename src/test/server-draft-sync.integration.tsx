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
  serializeFormDraft,
} from "@/lib/form-draft";
import { enqueueDocumentServerDraftDiscard } from "@/lib/document-server-draft-queue";
import { createAccountLogoutLockStorageKey } from "@/lib/account-logout-lock";

// 서버 초안 쓰기 경로는 실시간 공동 편집 전환(aa0cd61) 뒤 호출하는 화면이 없어 지웠다.
// 남은 것은 로그아웃 때 이 기기의 옛 폐기 대기열을 보내고 로컬 초안을 정리하는 경로다.

type DraftData = {
  title: string;
  contentHtml: string;
};

type DiscardInput = {
  sourceKey: string;
  operationId: string;
  expectedDraftVersion: number;
  targetPayloadHashes?: readonly string[];
  supersededOperationIds?: readonly string[];
};

let remoteDraft: DocumentServerDraftSnapshot | null = null;
let discardCalls: DiscardInput[] = [];

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
    baseResourceVersion: null,
    writerDeviceId,
    updatedAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1_000,
  };
}

async function mockDiscard(input: DiscardInput) {
  discardCalls.push(input);
  if ((remoteDraft?.draftVersion ?? 0) !== input.expectedDraftVersion ||
    (remoteDraft && input.targetPayloadHashes && !input.targetPayloadHashes.includes(remoteDraft.payloadHash))) {
    return { ok: false, reason: "VERSION_CONFLICT", current: remoteDraft };
  }
  remoteDraft = null;
  return {
    ok: true,
    replayed: false,
    operationResultVersion: input.expectedDraftVersion,
    current: null,
  };
}

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

let LogoutTextButton: typeof import("@/components/auth/LogoutTextButton").LogoutTextButton;

before(async () => {
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

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  assert.fail(message);
}

/** 이 기기의 localStorage를 seed한 브라우저 창을 띄운다. */
function createBrowser(context: TestContext, seed?: (storage: Storage) => void) {
  const browserWindow = new Window({ url: "https://portal.test/dashboard" });
  seed?.(browserWindow.localStorage as unknown as Storage);
  setOnline(browserWindow, true);
  const restoreGlobals = installBrowserGlobals(browserWindow);
  context.after(() => {
    browserWindow.close();
    restoreGlobals();
  });
  return browserWindow;
}

/** 브라우저 정리(전역 해제)보다 먼저 내려야 하므로 테스트 안에서 unmount한다. */
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
  discardCalls = [];
  logoutCalls = [];
  logoutProbeKeys = null;
  logoutFailures = 0;
  logoutRedirects = false;
  logoutHold = null;
  lockAtDiscard = [];
  logoutLockProbeKey = null;
}

test("로그아웃하면 폐기 대기열을 먼저 보내 계정 작성본을 지운 뒤 로컬 초안을 정리한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-flush";
  const sourceKey = createDocumentDraftKey("note", ownerId, "submitted-then-logout");
  const queueKey = createDocumentServerDraftQueueKey(sourceKey);
  const submitted = { title: "등록한 글", contentHtml: "<p>본문</p>" };
  remoteDraft = createSnapshot(sourceKey, submitted, 1);
  // 등록 직후 화면이 바뀌어 보내지 못한 폐기 요청이 이 기기의 대기열에 남은 상태.
  const browserWindow = createBrowser(context, (storage) => {
    enqueueDocumentServerDraftDiscard(storage, { sourceKey, expectedDraftVersion: 1 });
  });
  assert.notEqual(browserWindow.localStorage.getItem(queueKey), null);

  logoutProbeKeys = { queueKey, sourceKey };
  logoutLockProbeKey = createAccountLogoutLockStorageKey(ownerId);
  const logout = await renderLogoutButton(browserWindow, ownerId);
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

test("로그아웃 action이 실패하면 잠금을 풀고 오류를 보이며 다시 누를 수 있다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-retry";
  const sourceKey = createDocumentDraftKey("note", ownerId, "logout-retry");
  const lockKey = createAccountLogoutLockStorageKey(ownerId);
  // 아직 등록하지 않은 이 기기의 초안. 로그아웃이 실패하면 남아 있어야 한다.
  const browserWindow = createBrowser(context, (storage) => {
    storage.setItem(sourceKey, serializeFormDraft({ title: "쓰던 노트", contentHtml: "<p>지우면 안 된다</p>" }));
  });
  logoutFailures = 1;

  const logout = await renderLogoutButton(browserWindow, ownerId);
  try {
    await act(async () => logout.button.click());
    await waitFor(() => logoutCalls.length === 1, "첫 로그아웃 action이 실행되어야 합니다.");
    await waitFor(() => !logout.button.disabled, "실패하면 로그아웃 버튼을 다시 누를 수 있어야 합니다.");
    assert.equal(logout.button.getAttribute("aria-busy"), null);
    const form = logout.button.closest("form");
    const alert = form?.querySelector("[role='alert']");
    assert.match(alert?.textContent ?? "", /로그아웃하지 못했습니다/u);
    assert.equal(browserWindow.localStorage.getItem(lockKey), null, "실패하면 로그아웃 잠금을 풀어야 합니다.");
    // 로그아웃이 확인되지 않았으므로 이 기기의 초안과 열린 편집기를 그대로 둔다.
    assert.notEqual(browserWindow.localStorage.getItem(sourceKey), null, "실패하면 로컬 초안을 지우지 않아야 합니다.");

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
  const browserWindow = createBrowser(context, (storage) => {
    storage.setItem(sourceKey, serializeFormDraft({ title: "쓰던 노트", contentHtml: "<p>x</p>" }));
    enqueueDocumentServerDraftDiscard(storage, { sourceKey, expectedDraftVersion: 1 });
  });
  setOnline(browserWindow, false);

  const logout = await renderLogoutButton(browserWindow, ownerId);
  try {
    await act(async () => logout.button.click());
    await waitFor(() => logoutCalls.length === 1, "오프라인이어도 로그아웃 action이 실행되어야 합니다.");
    // 보내지 못한 폐기 대기열과 로컬 초안도 로그아웃이 확인된 뒤 이 기기에서 지운다.
    await waitFor(
      () => browserWindow.localStorage.getItem(queueKey) === null &&
        browserWindow.localStorage.getItem(sourceKey) === null,
      "로그아웃 뒤 이 기기의 폐기 대기열과 초안을 지워야 합니다.",
    );
  } finally {
    await logout.unmount();
  }

  assert.equal(discardCalls.length, 0);
});

test("로그아웃 action의 redirect 응답은 실패가 아니므로 잠금과 진행 표시를 유지한다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-redirect";
  const sourceKey = createDocumentDraftKey("note", ownerId, "logout-redirect");
  const lockKey = createAccountLogoutLockStorageKey(ownerId);
  // 로그아웃이 확인되면(redirect 신호) 이 기기의 초안을 지워야 한다(공유 기기 보호).
  const browserWindow = createBrowser(context, (storage) => {
    storage.setItem(sourceKey, serializeFormDraft({ title: "남기면 안 되는 초안", contentHtml: "<p>x</p>" }));
  });
  logoutRedirects = true;

  const logout = await renderLogoutButton(browserWindow, ownerId);
  try {
    await act(async () => logout.button.click());
    await waitFor(() => logoutCalls.length === 1, "로그아웃 action이 실행되어야 합니다.");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    assert.equal(logout.button.disabled, true, "이동하는 동안 버튼은 계속 기다림 상태여야 합니다.");
    assert.equal(logout.button.closest("form")?.querySelector("[role='alert']") ?? null, null);
    assert.notEqual(browserWindow.localStorage.getItem(lockKey), null, "이동 중에는 잠금을 풀지 않아야 합니다.");
    assert.equal(browserWindow.localStorage.getItem(sourceKey), null, "로그아웃이 확인되면 이 기기의 초안을 지워야 합니다.");
  } finally {
    await logout.unmount();
  }
});

test("로그아웃 응답이 늦어지면 잠금을 만료 전에 다시 기록해 다른 탭 저장을 계속 막는다", { concurrency: false }, async (context) => {
  resetServerMock();
  const ownerId = "student-logout-slow";
  const lockKey = createAccountLogoutLockStorageKey(ownerId);
  const browserWindow = createBrowser(context);
  const hold = Promise.withResolvers<void>();
  logoutHold = hold.promise;
  logoutRedirects = true;

  const logout = await renderLogoutButton(browserWindow, ownerId);
  try {
    await act(async () => logout.button.click());
    await waitFor(() => logoutCalls.length === 1, "로그아웃 action이 실행되어야 합니다.");
    const expiresAt = () => JSON.parse(browserWindow.localStorage.getItem(lockKey) ?? "null")?.expiresAt as number | undefined;
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
