import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccountCleanupBootstrap } from "./AccountCleanupBootstrap";
import { LocalDraftAccountBoundary } from "./LocalDraftAccountBoundary";
import { OwnerlessLegacyDraftCleanup } from "./OwnerlessLegacyDraftCleanup";
import {
  ACCOUNT_CLEANUP_REGISTER_ENDPOINT,
  ACCOUNT_CLEANUP_STATUS_ENDPOINT,
} from "../../lib/account-cleanup-client";
import {
  createAccountCleanupTokenStorageKey,
  ensureStoredAccountCleanupToken,
} from "../../lib/account-cleanup-token";
import { createDocumentDraftKey } from "../../lib/form-draft";

const GLOBAL_BINDINGS = [
  "window",
  "document",
  "navigator",
  "CustomEvent",
  "Event",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLParagraphElement",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
  "React",
] as const;

type GlobalBinding = (typeof GLOBAL_BINDINGS)[number];

type DomHarness = {
  browserWindow: Window;
  container: HTMLElement;
  root: Root;
};

function installDomHarness(context: TestContext): DomHarness {
  const browserWindow = new Window({ url: "https://portal.test/login" });
  const previous = new Map<GlobalBinding, PropertyDescriptor | undefined>();
  const bindings: Record<GlobalBinding, unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    CustomEvent: browserWindow.CustomEvent,
    Event: browserWindow.Event,
    Node: browserWindow.Node,
    HTMLElement: browserWindow.HTMLElement,
    HTMLButtonElement: browserWindow.HTMLButtonElement,
    HTMLParagraphElement: browserWindow.HTMLParagraphElement,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const binding of GLOBAL_BINDINGS) {
    previous.set(binding, Object.getOwnPropertyDescriptor(globalThis, binding));
    Object.defineProperty(globalThis, binding, {
      configurable: true,
      writable: true,
      value: bindings[binding],
    });
  }

  const browserContainer = browserWindow.document.createElement("div");
  browserWindow.document.body.append(browserContainer);
  const container = browserContainer as unknown as HTMLElement;
  const root = createRoot(container);
  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    for (const binding of [...GLOBAL_BINDINGS].reverse()) {
      const descriptor = previous.get(binding);
      if (descriptor) Object.defineProperty(globalThis, binding, descriptor);
      else Reflect.deleteProperty(globalThis, binding);
    }
  });
  return { browserWindow, container, root };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.ok(button, `버튼을 찾을 수 없습니다: ${label}`);
  return button;
}

async function click(browserWindow: Window, element: HTMLButtonElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new browserWindow.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }) as unknown as Event);
  });
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) return;
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
  assert.fail(message);
}

test("ownerless legacy UI는 2단계 확인·취소 focus·allowlist 삭제·live status를 지킨다", { concurrency: false }, async (context) => {
  const { browserWindow, container, root } = installDomHarness(context);
  const storage = browserWindow.localStorage;
  const allowedKeys = [
    "draft:qna:thread",
    "draft:qna:reply:thread-1",
    "draft:note:slide:student-1",
    "draft:note:full:student-1",
  ];
  const preservedKeys = [
    "draft:qna:thread:lookalike",
    createDocumentDraftKey("note", "student-current", "new"),
    "studentPortal:section",
  ];
  for (const key of [...allowedKeys, ...preservedKeys]) storage.setItem(key, "value");
  let clearCount = 0;
  const originalClear = storage.clear.bind(storage);
  storage.clear = () => {
    clearCount += 1;
    originalClear();
  };

  await act(async () => {
    root.render(React.createElement(OwnerlessLegacyDraftCleanup));
  });
  const trigger = findButton(container, "이 기기의 이전 포털 초안 모두 지우기");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.ok(trigger.className.includes("motion-reduce:transition-none"));

  await click(browserWindow, trigger);
  const confirm = findButton(container, "이전 초안 모두 삭제 확인");
  assert.equal(browserWindow.document.activeElement, confirm);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  for (const key of allowedKeys) assert.equal(storage.getItem(key), "value");

  await click(browserWindow, findButton(container, "취소"));
  assert.equal(browserWindow.document.activeElement, trigger);
  for (const key of allowedKeys) assert.equal(storage.getItem(key), "value");

  await click(browserWindow, trigger);
  storage.setItem(allowedKeys[0]!, "changed-by-peer");
  await click(browserWindow, findButton(container, "이전 초안 모두 삭제 확인"));
  const changedStatus = container.querySelector("#ownerless-draft-cleanup-status");
  assert.match(changedStatus?.textContent ?? "", /다시 확인/u);
  assert.equal(storage.getItem(allowedKeys[0]!), "changed-by-peer");
  for (const key of allowedKeys.slice(1)) {
    assert.equal(storage.getItem(key), "value");
  }

  await click(browserWindow, findButton(container, "이전 초안 모두 삭제 확인"));
  const status = container.querySelector("#ownerless-draft-cleanup-status");
  assert.ok(status);
  assert.match(status.textContent ?? "", /이전 포털 초안 4개를 지웠습니다/u);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(browserWindow.document.activeElement, status);
  assert.equal(clearCount, 0);
  for (const key of allowedKeys) assert.equal(storage.getItem(key), null);
  for (const key of preservedKeys) assert.equal(storage.getItem(key), "value");
});

test("익명 bootstrap은 mount·online·focus 재시도 뒤 DELETED owner만 정리하고 sign-out하지 않는다", { concurrency: false }, async (context) => {
  const { browserWindow, container, root } = installDomHarness(context);
  const storage = browserWindow.localStorage;
  const deletedOwner = "student-offline-deleted";
  const retainedOwner = "student-other";
  const deletedKey = createDocumentDraftKey("qna-thread", deletedOwner);
  const retainedKey = createDocumentDraftKey("note", retainedOwner, "note-1");
  storage.setItem(deletedKey, "deleted-owner-draft");
  storage.setItem(retainedKey, "other-owner-draft");
  const token = ensureStoredAccountCleanupToken(storage, deletedOwner);
  let requestCount = 0;
  let signOutCount = 0;
  const observedRequests: RequestInit[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, ACCOUNT_CLEANUP_STATUS_ENDPOINT);
    requestCount += 1;
    observedRequests.push(init ?? {});
    if (requestCount < 3) {
      return new Response("retry", { status: 503 });
    }
    return new Response(JSON.stringify({ ok: true, status: "DELETED" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await act(async () => {
    root.render(React.createElement(AccountCleanupBootstrap, {
      fetcher,
      onSignOut: () => {
        signOutCount += 1;
      },
    }));
  });
  await waitFor(() => requestCount === 1, "mount status 조회가 실행되지 않았습니다.");
  assert.equal(storage.getItem(token.storageKey), token.rawToken);

  await act(async () => {
    browserWindow.dispatchEvent(new browserWindow.Event("online"));
  });
  await waitFor(() => requestCount === 2, "online status 재시도가 실행되지 않았습니다.");
  assert.equal(storage.getItem(token.storageKey), token.rawToken);

  await act(async () => {
    browserWindow.dispatchEvent(new browserWindow.Event("focus"));
  });
  await waitFor(
    () => storage.getItem(token.storageKey) === null,
    "focus 성공 뒤 기기 정리가 실행되지 않았습니다.",
  );

  assert.equal(requestCount, 3);
  assert.equal(signOutCount, 0);
  assert.equal(storage.getItem(deletedKey), null);
  assert.equal(storage.getItem(token.storageKey), null);
  assert.equal(storage.getItem(retainedKey), "other-owner-draft");
  for (const request of observedRequests) {
    assert.equal(request.cache, "no-store");
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ["tokenDigest"]);
    assert.equal(body.tokenDigest, token.tokenDigest);
    assert.equal(String(request.body).includes(token.rawToken), false);
  }
  const status = container.querySelector('[role="status"]');
  assert.match(status?.textContent ?? "", /이 기기 데이터를 정리했습니다/u);
});

test("인증 bootstrap은 in-flight online retry를 보존하고 registration 실패를 재등록한다", { concurrency: false }, async (context) => {
  const { browserWindow, container, root } = installDomHarness(context);
  const ownerId = "student-register-retry";
  let resolveFirstRegister: ((response: Response) => void) | null = null;
  const firstRegister = new Promise<Response>((resolve) => {
    resolveFirstRegister = resolve;
  });
  const endpoints: string[] = [];
  let registerCount = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    const endpoint = String(input);
    endpoints.push(endpoint);
    if (endpoint === ACCOUNT_CLEANUP_REGISTER_ENDPOINT) {
      registerCount += 1;
      if (registerCount === 1) return firstRegister;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    assert.equal(endpoint, ACCOUNT_CLEANUP_STATUS_ENDPOINT);
    return new Response(JSON.stringify({ ok: true, status: "NO_ACTION" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await act(async () => {
    root.render(React.createElement(AccountCleanupBootstrap, {
      ownerId,
      fetcher,
      onSignOut: () => assert.fail("활성 계정은 sign-out하면 안 됩니다."),
    }));
  });
  await waitFor(() => endpoints.length === 1, "첫 register가 시작되지 않았습니다.");

  await act(async () => {
    browserWindow.dispatchEvent(new browserWindow.Event("online"));
    resolveFirstRegister?.(new Response("retry", { status: 503 }));
  });
  await waitFor(
    () => endpoints.length === 4,
    "in-flight 뒤 register/status 재시도가 수렴하지 않았습니다.",
  );

  assert.deepEqual(endpoints, [
    ACCOUNT_CLEANUP_REGISTER_ENDPOINT,
    ACCOUNT_CLEANUP_STATUS_ENDPOINT,
    ACCOUNT_CLEANUP_REGISTER_ENDPOINT,
    ACCOUNT_CLEANUP_STATUS_ENDPOINT,
  ]);
  assert.notEqual(
    browserWindow.localStorage.getItem(
      createAccountCleanupTokenStorageKey(ownerId),
    ),
    null,
  );
  assert.equal(container.querySelector('[role="status"]')?.textContent, "");
});

test("인증된 현재 owner가 DELETED일 때만 cleanup 뒤 sign-out한다", { concurrency: false }, async (context) => {
  const { browserWindow, root } = installDomHarness(context);
  const ownerId = "student-current-deleted";
  const sourceKey = createDocumentDraftKey("qna-thread", ownerId);
  browserWindow.localStorage.setItem(sourceKey, "current-owner-draft");
  let signOutCount = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    const endpoint = String(input);
    return new Response(JSON.stringify(
      endpoint === ACCOUNT_CLEANUP_REGISTER_ENDPOINT
        ? { ok: true }
        : { ok: true, status: "DELETED" },
    ), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await act(async () => {
    root.render(React.createElement(AccountCleanupBootstrap, {
      ownerId,
      fetcher,
      onSignOut: () => {
        signOutCount += 1;
      },
    }));
  });
  await waitFor(() => signOutCount === 1, "현재 삭제 owner sign-out이 실행되지 않았습니다.");

  assert.equal(browserWindow.localStorage.getItem(sourceKey), null);
});

test("admin boundary는 cleanup token을 만들거나 bootstrap을 실행하지 않는다", { concurrency: false }, async (context) => {
  const { browserWindow, root } = installDomHarness(context);
  const ownerId = "admin-no-cleanup-token";

  await act(async () => {
    root.render(React.createElement(LocalDraftAccountBoundary, {
      ownerId,
      role: "admin",
    }));
  });

  assert.equal(
    browserWindow.localStorage.getItem(
      createAccountCleanupTokenStorageKey(ownerId),
    ),
    null,
  );
});
