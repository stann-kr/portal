import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { DraftStatus } from "./DraftStatus";
import type { FormDraftRecoverySummary } from "@/lib/form-draft";

function createRecovery(
  index: number,
  savedAt = new Date(`2026-08-0${index + 1}T04:05:00.000Z`),
): FormDraftRecoverySummary {
  return {
    storageKey: `recovery-${index}`,
    savedAt,
    isCurrent: index === 0,
    preview: {
      title: `복구 제목 ${index}`,
      body: `복구 본문 ${index}`,
    },
  };
}

function findButton(container: Element, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.ok(button, `${label} 버튼이 필요합니다.`);
  return button as unknown as HTMLButtonElement;
}

test("복구본은 날짜·시간과 안전한 preview를 표시하되 최신 5개 계약을 유지한다", async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/editor" });
  const testGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    React?: typeof React;
  };
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousActEnvironment = testGlobals.IS_REACT_ACT_ENVIRONMENT;
  const previousReact = testGlobals.React;
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  });

  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const domContainer = container as unknown as Element;
  const root = createRoot(domContainer);
  const recoveries = Array.from({ length: 6 }, (_, index) => createRecovery(index));

  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    Object.assign(globalThis, {
      window: previousWindow,
      document: previousDocument,
      IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
      React: previousReact,
    });
  });

  await act(async () => {
    root.render(
      React.createElement(DraftStatus, {
        status: "incompatible",
        canSubmit: false,
        savedAt: null,
        restored: false,
        recoveries,
        onRestoreRecovery: () => undefined,
        onDiscardRecovery: () => undefined,
      }),
    );
  });

  assert.equal(container.querySelectorAll("li").length, 5);
  assert.match(container.textContent ?? "", /나머지 1개/u);
  assert.match(container.textContent ?? "", /제목 · 복구 제목 0/u);
  assert.match(container.textContent ?? "", /본문 · 복구 본문 0/u);
  assert.match(container.textContent ?? "", /현재 화면본/u);
  assert.match(container.textContent ?? "", /더 최신 앱 버전/u);
  assert.match(container.textContent ?? "", /새 탭에서 열어 주세요/u);
  assert.match(container.textContent ?? "", /이 화면에서는 제출할 수 없/u);

  const firstTime = container.querySelector("time");
  assert.ok(firstTime);
  const expectedDateTime = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(recoveries[0]!.savedAt);
  assert.match(firstTime.textContent ?? "", new RegExp(expectedDateTime.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.equal(firstTime.getAttribute("datetime"), recoveries[0]!.savedAt.toISOString());

  const showAllButton = findButton(domContainer, "모든 복구본 보기");
  assert.equal(showAllButton.getAttribute("aria-expanded"), "false");
  await act(async () => showAllButton.click());
  assert.equal(container.querySelectorAll("li").length, 6);
  const collapseButton = findButton(domContainer, "최신 5개만 보기");
  assert.equal(collapseButton.getAttribute("aria-expanded"), "true");
  await act(async () => collapseButton.click());
  assert.equal(container.querySelectorAll("li").length, 5);

  await act(async () => {
    root.render(
      React.createElement(DraftStatus, {
        status: "error",
        canSubmit: false,
        savedAt: null,
        restored: false,
      }),
    );
  });
  assert.match(container.textContent ?? "", /이 화면에서는 제출할 수 없습니다/u);
  assert.match(container.textContent ?? "", /새로 입력한 내용을 복사해 보관/u);
  assert.doesNotMatch(container.textContent ?? "", /직접 저장해 주세요/u);

  await act(async () => {
    root.render(
      React.createElement(DraftStatus, {
        status: "error",
        canSubmit: true,
        savedAt: null,
        restored: false,
      }),
    );
  });
  assert.match(container.textContent ?? "", /저장 버튼으로 직접 저장해 주세요/u);
});

test("복구본 삭제는 취소에 초점을 두는 2단계 확인 뒤에만 실행된다", async (context) => {
  const browserWindow = new Window({ url: "https://portal.test/editor" });
  const testGlobals = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    React?: typeof React;
  };
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousActEnvironment = testGlobals.IS_REACT_ACT_ENVIRONMENT;
  const previousReact = testGlobals.React;
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  });

  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const domContainer = container as unknown as Element;
  const root = createRoot(domContainer);
  const discardedKeys: string[] = [];
  const recovery = createRecovery(0);

  function DeletionHarness() {
    const [currentRecoveries, setCurrentRecoveries] = React.useState([recovery]);
    return React.createElement(DraftStatus, {
      status: "conflict",
      canSubmit: true,
      savedAt: recovery.savedAt,
      restored: false,
      recoveries: currentRecoveries,
      onDiscardRecovery: (storageKey: string) => {
        discardedKeys.push(storageKey);
        setCurrentRecoveries([]);
      },
    });
  }

  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    Object.assign(globalThis, {
      window: previousWindow,
      document: previousDocument,
      IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
      React: previousReact,
    });
  });

  await act(async () => {
    root.render(React.createElement(DeletionHarness));
  });

  const stableFocusTarget = container.querySelector(
    '[role="group"][aria-label="임시 저장 상태"]',
  );
  assert.ok(stableFocusTarget);

  const firstDiscardTrigger = findButton(domContainer, "삭제");
  await act(async () => firstDiscardTrigger.click());
  assert.deepEqual(discardedKeys, []);
  assert.match(container.textContent ?? "", /현재 화면.*되돌릴 수 없습니다/u);
  const firstCancelButton = findButton(domContainer, "취소");
  assert.equal(browserWindow.document.activeElement, firstCancelButton);

  await act(async () => firstCancelButton.click());
  assert.deepEqual(discardedKeys, []);
  const restoredDiscardTrigger = findButton(domContainer, "삭제");
  assert.equal(browserWindow.document.activeElement, restoredDiscardTrigger);

  await act(async () => restoredDiscardTrigger.click());
  const escapeCancelButton = findButton(domContainer, "취소");
  await act(async () => {
    escapeCancelButton.dispatchEvent(
      new browserWindow.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }) as unknown as Event,
    );
  });
  assert.deepEqual(discardedKeys, []);
  assert.equal(
    findButton(domContainer, "삭제"),
    browserWindow.document.activeElement,
  );

  await act(async () => findButton(domContainer, "삭제").click());
  const confirmButton = findButton(domContainer, "삭제 확인");
  assert.ok(confirmButton.getAttribute("aria-describedby"));
  await act(async () => confirmButton.click());
  assert.deepEqual(discardedKeys, [recovery.storageKey]);
  assert.equal(container.querySelectorAll("li").length, 0);
  assert.equal(browserWindow.document.activeElement, stableFocusTarget);
});
