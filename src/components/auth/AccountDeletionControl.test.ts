import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccountDeletionControlImpl } from "./AccountDeletionControl";

const DIGEST = "a".repeat(64);
const OPERATION_ID = "00000000-0000-4000-8000-000000000001";

const GLOBAL_BINDINGS = [
  "window",
  "document",
  "navigator",
  "CustomEvent",
  "Event",
  "FormData",
  "Node",
  "NodeFilter",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "MutationObserver",
  "ResizeObserver",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
  "React",
] as const;

type GlobalBinding = (typeof GLOBAL_BINDINGS)[number];
type Dependencies = ComponentProps<
  typeof AccountDeletionControlImpl
>["dependencies"];

function installDomHarness(context: TestContext): {
  browserWindow: Window;
  root: Root;
} {
  const browserWindow = new Window({ url: "https://portal.test/dashboard" });
  const previous = new Map<GlobalBinding, PropertyDescriptor | undefined>();
  const bindings: Record<GlobalBinding, unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    CustomEvent: browserWindow.CustomEvent,
    Event: browserWindow.Event,
    FormData: browserWindow.FormData,
    Node: browserWindow.Node,
    NodeFilter: browserWindow.NodeFilter,
    HTMLElement: browserWindow.HTMLElement,
    HTMLButtonElement: browserWindow.HTMLButtonElement,
    HTMLInputElement: browserWindow.HTMLInputElement,
    MutationObserver: browserWindow.MutationObserver,
    ResizeObserver: browserWindow.ResizeObserver,
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

  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  context.after(async () => {
    await act(async () => root.unmount());
    await browserWindow.happyDOM.waitUntilComplete();
    browserWindow.close();
    for (const binding of [...GLOBAL_BINDINGS].reverse()) {
      const descriptor = previous.get(binding);
      if (descriptor) Object.defineProperty(globalThis, binding, descriptor);
      else Reflect.deleteProperty(globalThis, binding);
    }
  });
  return { browserWindow, root };
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) return;
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
  assert.fail(message);
}

function findButton(document: Document, label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.getAttribute("aria-label") === label,
  );
  assert.ok(button, `버튼을 찾을 수 없습니다: ${label}`);
  return button as HTMLButtonElement;
}

function domDocument(browserWindow: Window): Document {
  return browserWindow.document as unknown as Document;
}

async function click(browserWindow: Window, button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(
      new browserWindow.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    );
  });
}

function baseDependencies(
  overrides: Partial<Dependencies> = {},
): Dependencies {
  return {
    registerPersistentToken: async () => ({ ok: true, tokenDigest: DIGEST }),
    createEphemeralToken: () => ({ ok: true, tokenDigest: DIGEST }),
    requestCleanupStatus: async () => ({ ok: true, status: "NO_ACTION" }),
    deleteAccount: async () => ({
      success: true,
      replayed: false,
      rawIdEraseAfter: "2026-01-31T00:00:00.000Z",
      storageCleanupPending: true,
    }),
    clearLocalState: (ownerId) => ({
      ownerId,
      success: true,
      tokenRemoved: true,
      reason: "CLEARED",
      draftCleanup: null,
      verification: null,
    }),
    clearAuthenticatedLocalState: (ownerId) => ({
      ownerId,
      success: true,
      reason: "CLEARED",
      draftCleanup: null,
      verification: null,
    }),
    finishSession: async () => undefined,
    createOperationId: () => OPERATION_ID,
    ...overrides,
  };
}

async function openAndFillConfirmation(
  browserWindow: Window,
): Promise<void> {
  const document = domDocument(browserWindow);
  await click(browserWindow, findButton(document, "계정 삭제"));
  await waitFor(
    () => Boolean([...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "삭제 확인 단계로 이동" &&
        !button.hasAttribute("disabled"),
    )),
    "기기 정리 token 등록 뒤 확인 버튼이 활성화되지 않았습니다.",
  );
  await click(browserWindow, findButton(document, "삭제 확인 단계로 이동"));
  await waitFor(
    () => !findButton(document, "계정 영구 삭제")
      .hasAttribute("disabled"),
    "확인 입력 뒤 삭제 버튼이 활성화되지 않았습니다.",
  );
}

test("삭제 재시도는 operation ID를 유지하고 성공 뒤 cleanup·sign-out으로 수렴한다", { concurrency: false }, async (context) => {
  const { browserWindow, root } = installDomHarness(context);
  const { AccountDeletionControlImpl } = await import("./AccountDeletionControl");
  const operationIds: string[] = [];
  const atomicRegistrationFlags: boolean[] = [];
  let calls = 0;
  let cleanupCalls = 0;
  let finishTarget = "";
  const dependencies = baseDependencies({
    deleteAccount: async (input) => {
      operationIds.push(input.operationId);
      atomicRegistrationFlags.push(input.useEphemeralCleanupDigest);
      calls += 1;
      return calls === 1
        ? {
            success: false,
            reason: "ACTIVE_MEDIA_SEAL",
            error: "업로드 처리 중",
          }
        : {
            success: true,
            replayed: false,
            rawIdEraseAfter: "2026-01-31T00:00:00.000Z",
            storageCleanupPending: true,
          };
    },
    clearLocalState: (ownerId) => {
      cleanupCalls += 1;
      return {
        ownerId,
        success: true,
        tokenRemoved: true,
        reason: "CLEARED",
        draftCleanup: null,
        verification: null,
      };
    },
    finishSession: async (target) => {
      finishTarget = target;
    },
  });
  await act(async () => {
    root.render(React.createElement(AccountDeletionControlImpl, {
      ownerId: "student-1",
      dependencies,
      initialFormValues: {
        password: "correct-password",
        confirmation: "계정 삭제",
      },
    }));
  });
  await openAndFillConfirmation(browserWindow);
  await click(browserWindow, findButton(domDocument(browserWindow), "계정 영구 삭제"));
  await waitFor(() => calls === 1, "첫 삭제 요청이 실행되지 않았습니다.");
  await click(browserWindow, findButton(domDocument(browserWindow), "계정 영구 삭제"));
  await waitFor(() => Boolean(finishTarget), "성공 뒤 로그아웃 수렴이 실행되지 않았습니다.");

  assert.deepEqual(operationIds, [OPERATION_ID, OPERATION_ID]);
  assert.deepEqual(atomicRegistrationFlags, [false, false]);
  assert.equal(cleanupCalls, 1);
  assert.equal(finishTarget, "/login?accountDeleted=1");
});

test("삭제 action 응답 유실은 익명 digest 상태가 DELETED면 즉시 정리한다", { concurrency: false }, async (context) => {
  const { browserWindow, root } = installDomHarness(context);
  const { AccountDeletionControlImpl } = await import("./AccountDeletionControl");
  let statusDigest = "";
  let finishTarget = "";
  const dependencies = baseDependencies({
    deleteAccount: async () => {
      throw new Error("response lost");
    },
    requestCleanupStatus: async (tokenDigest) => {
      statusDigest = tokenDigest;
      return { ok: true, status: "DELETED" };
    },
    finishSession: async (target) => {
      finishTarget = target;
    },
  });
  await act(async () => {
    root.render(React.createElement(AccountDeletionControlImpl, {
      ownerId: "student-1",
      dependencies,
      initialFormValues: {
        password: "correct-password",
        confirmation: "계정 삭제",
      },
    }));
  });
  await openAndFillConfirmation(browserWindow);
  await click(browserWindow, findButton(domDocument(browserWindow), "계정 영구 삭제"));
  await waitFor(() => Boolean(finishTarget), "status-confirmed 삭제가 수렴하지 않았습니다.");

  assert.equal(statusDigest, DIGEST);
  assert.equal(finishTarget, "/login?accountDeleted=1");
});

test("persistent token 등록 실패는 ephemeral digest로 삭제하고 실패한 기기 정리를 수동 안내한다", { concurrency: false }, async (context) => {
  const { browserWindow, root } = installDomHarness(context);
  const { AccountDeletionControlImpl } = await import("./AccountDeletionControl");
  let ephemeralCalls = 0;
  let cleanupCalls = 0;
  let authenticatedCleanupCalls = 0;
  let atomicRegistrationFlag = false;
  let finishTarget = "";
  const dependencies = baseDependencies({
    registerPersistentToken: async () => ({
      ok: false,
      reason: "REQUEST_FAILED",
    }),
    createEphemeralToken: () => {
      ephemeralCalls += 1;
      return { ok: true, tokenDigest: DIGEST };
    },
    deleteAccount: async (input) => {
      atomicRegistrationFlag = input.useEphemeralCleanupDigest;
      return {
        success: true,
        replayed: false,
        rawIdEraseAfter: "2026-01-31T00:00:00.000Z",
        storageCleanupPending: true,
      };
    },
    clearLocalState: (ownerId) => {
      cleanupCalls += 1;
      return {
        ownerId,
        success: true,
        tokenRemoved: true,
        reason: "CLEARED",
        draftCleanup: null,
        verification: null,
      };
    },
    clearAuthenticatedLocalState: (ownerId) => {
      authenticatedCleanupCalls += 1;
      return {
        ownerId,
        success: false,
        reason: "STORAGE_UNAVAILABLE",
        draftCleanup: null,
        verification: null,
      };
    },
    finishSession: async (target) => {
      finishTarget = target;
    },
  });
  await act(async () => {
    root.render(React.createElement(AccountDeletionControlImpl, {
      ownerId: "student-1",
      dependencies,
      initialFormValues: {
        password: "correct-password",
        confirmation: "계정 삭제",
      },
    }));
  });
  await openAndFillConfirmation(browserWindow);
  await click(browserWindow, findButton(domDocument(browserWindow), "계정 영구 삭제"));
  await waitFor(() => Boolean(finishTarget), "ephemeral 삭제가 수렴하지 않았습니다.");

  assert.equal(ephemeralCalls, 1);
  assert.equal(atomicRegistrationFlag, true);
  assert.equal(cleanupCalls, 0);
  assert.equal(authenticatedCleanupCalls, 1);
  assert.equal(finishTarget, "/login?accountDeleted=1&deviceCleanup=manual");
});
