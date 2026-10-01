import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";

let browser: Window;
let PortalShell: typeof import("@/components/ui/portal-shell").PortalShell;
let SlidePanel: typeof import("@/components/student-portal/SlidePanel").SlidePanel;
let CreateEntryDropdown: typeof import("@/components/student-portal/CreateEntryDropdown").CreateEntryDropdown;
let dialog: typeof import("@/components/ui/dialog");
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

mock.module("next/navigation", { namedExports: { useRouter: () => ({ push() {} }) } });
mock.module("@/components/calendar/EventFormDialog", {
  namedExports: {
    EventFormDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
      <dialog.Dialog open={open} onOpenChange={onOpenChange}>
        <dialog.DialogContent aria-describedby={undefined}>
          <dialog.DialogTitle>새 일정 추가</dialog.DialogTitle>
          <input aria-label="일정 제목" />
        </dialog.DialogContent>
      </dialog.Dialog>
    ),
  },
});
mock.module("@/components/digging/AddTrackDialog", { namedExports: { AddTrackDialog: () => null } });

before(async () => {
  browser = new Window({ url: "https://portal.test/dashboard/student" });
  const bindings = {
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    localStorage: browser.localStorage,
    HTMLElement: browser.HTMLElement,
    HTMLInputElement: browser.HTMLInputElement,
    Node: browser.Node,
    NodeFilter: browser.NodeFilter,
    Element: browser.Element,
    Event: browser.Event,
    CustomEvent: browser.CustomEvent,
    MutationObserver: browser.MutationObserver,
    ResizeObserver: browser.ResizeObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const [name, value] of Object.entries(bindings)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  ({ PortalShell } = await import("@/components/ui/portal-shell"));
  ({ SlidePanel } = await import("@/components/student-portal/SlidePanel"));
  dialog = await import("@/components/ui/dialog");
  ({ CreateEntryDropdown } = await import("@/components/student-portal/CreateEntryDropdown"));
});

after(() => {
  browser.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

async function render(context: TestContext, element: React.ReactElement) {
  const container = browser.document.createElement("div");
  browser.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  context.after(async () => {
    await act(async () => root.unmount());
    await settle();
    container.remove();
  });
  await act(async () => root.render(element));
  await settle();
}

function button(label: string) {
  const found = [...browser.document.querySelectorAll("button")]
    .find((element) => element.getAttribute("aria-label") === label || element.textContent === label);
  assert.ok(found, `button: ${label}`);
  return found;
}

async function press(label: string) {
  await act(async () => { const element = button(label); element.focus(); element.click(); });
  await settle();
}

async function escape() {
  await act(async () => {
    browser.document.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();
}

test("portal navigation restores URL state and does not add history for the active section", async (context) => {
  browser.history.replaceState({ marker: "keep" }, "", "?section=workspace");
  browser.localStorage.setItem("test:section", "community");
  const push = context.mock.method(browser.history, "pushState");
  const items = ["today", "workspace", "community"].map((id) => ({ id, label: id, Icon: () => null }));
  await render(context, (
    <PortalShell items={items} initialItem="today" storageKey="test:section" urlParamKey="section" ariaLabel="포털">
      {(active) => <p data-testid="section">{active}</p>}
    </PortalShell>
  ));
  assert.equal(button("workspace").getAttribute("aria-current"), "page");
  await press("workspace");
  assert.equal(push.mock.callCount(), 0);
  await press("community");
  await press("community");
  assert.equal(push.mock.callCount(), 1);
  assert.deepEqual(browser.history.state, { marker: "keep" });
  assert.equal(browser.localStorage.getItem("test:section"), "community");
  await act(async () => {
    browser.history.replaceState({}, "", "?section=workspace");
    browser.dispatchEvent(new browser.PopStateEvent("popstate"));
  });
  assert.equal(button("workspace").getAttribute("aria-current"), "page");
  assert.equal(browser.document.querySelector('[data-testid="section"]')?.textContent, "workspace");
});

test("controlled panel restores its opener focus and preserves busy dismissal protection", async (context) => {
  function Panel() {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>패널 열기</button>
      <SlidePanel open={open} onOpenChange={setOpen} title="상세" dismissible={!busy}>
        <button onClick={() => setBusy(!busy)}>{busy ? "저장 완료" : "저장 시작"}</button>
      </SlidePanel>
    </>;
  }
  await render(context, <Panel />);
  await press("패널 열기");
  assert.ok(browser.document.querySelector('[role="dialog"]')?.contains(browser.document.activeElement));
  await press("저장 시작");
  assert.equal(button("닫기").disabled, true);
  await escape();
  assert.ok(browser.document.querySelector('[role="dialog"]'));
  await press("저장 완료");
  await escape();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  assert.equal(browser.document.activeElement, button("패널 열기"));
});

test("creation menu hands keyboard focus to its dialog and returns it to the stable add button", async (context) => {
  await render(context, <CreateEntryDropdown studentId="student" diggingColumns={[]} spaceLabel="학생" canCreateQna={false} canCreateDigging={false} />);
  await act(async () => {
    button("새 항목 추가").focus();
    button("새 항목 추가").dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await settle();
  const item = browser.document.querySelector('[role="menuitem"]');
  assert.ok(item);
  assert.equal(browser.document.activeElement, item);
  assert.ok(item.hasAttribute("data-highlighted"));
  await act(async () => { item.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
  assert.equal(browser.document.querySelector('[role="menu"]'), null);
  const content = browser.document.querySelector('[role="dialog"]');
  assert.ok(content);
  assert.ok(content.contains(browser.document.activeElement));
  await escape();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  assert.equal(browser.document.activeElement, button("새 항목 추가"));
});
