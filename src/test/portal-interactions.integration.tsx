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
let AdminPortalClient: typeof import("@/components/admin-portal/AdminPortalClient").AdminPortalClient;
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
mock.module("@/lib/actions/digging", { namedExports: { getOrSeedColumns: async () => [] } });
mock.module("@/lib/actions/unifiedItems", { namedExports: {
  getUnifiedItemsForStudent: async () => [],
  getExternalUnifiedItemsForStudent: async () => [],
} });
// Exercise the actual shell, calendar tabs and FullCalendar without unrelated editors/I/O.
for (const [folder, name] of [
  ["student-portal", "UnifiedItemDetail"], ["student-portal", "DailyListView"],
  ["student-portal", "AllItemsView"], ["student-portal", "CurriculumView"],
  ["student-portal", "AssignmentView"], ["student-portal", "ExternalCalendarConnection"],
  ["student-portal", "AnnouncementSection"], ["student-portal", "CommunitySection"],
  ["admin-portal", "StudentManagementSection"], ["admin-portal", "AdminWorkQueueSection"],
  ["qna", "QnaSlideForm"],
]) {
  mock.module(`@/components/${folder}/${name}`, { namedExports: { [name]: () => null } });
}

before(async () => {
  browser = new Window({ url: "https://portal.test/dashboard/student" });
  const bindings = {
    window: browser,
    self: browser,
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
  ({ AdminPortalClient } = await import("@/components/admin-portal/AdminPortalClient"));
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
  await act(async () => {
    const element = button(label);
    element.dispatchEvent(new browser.MouseEvent("mousedown", { button: 0, bubbles: true }));
    element.focus();
    element.click();
  });
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
  const region = browser.document.querySelector('[role="region"]');
  assert.ok(region);
  await act(async () => {
    region.scrollTop = 180;
    region.dispatchEvent(new browser.Event("scroll"));
  });
  await press("workspace");
  assert.equal(push.mock.callCount(), 0);
  await press("community");
  assert.equal(region.scrollTop, 0);
  await press("community");
  assert.equal(push.mock.callCount(), 1);
  assert.deepEqual(browser.history.state, { marker: "keep" });
  assert.equal(browser.localStorage.getItem("test:section"), "community");
  await act(async () => {
    browser.history.replaceState({}, "", "?section=workspace");
    browser.dispatchEvent(new browser.PopStateEvent("popstate"));
  });
  assert.equal(button("workspace").getAttribute("aria-current"), "page");
  assert.equal(region.scrollTop, 180);
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

test("calendar preserves its date, view and filters across view tabs and admin sections", async (context) => {
  browser.history.replaceState({}, "", "/dashboard/admin?section=schedule&view=calendar&student=student");
  await render(context, <AdminPortalClient
    announcements={[]} initialUnifiedItems={[]} communityPosts={[]}
    adminId="admin" qnaThreads={[]} pendingAssignments={[]} referenceTime={new Date()}
    students={[{ id: "student", email: "student@example.test", displayName: "학생", createdAt: null, currentModule: null, nextLessonDate: null, pendingFeedbackCount: 0 }]}
  />);
  const next = [...browser.document.querySelectorAll("button")].find((element) => element.classList.contains("fc-next-button"));
  assert.ok(next);
  const initialTitle = browser.document.querySelector(".fc-toolbar-title")?.textContent;
  await act(async () => next.click());
  await settle();
  const nextTitle = browser.document.querySelector(".fc-toolbar-title")?.textContent;
  assert.notEqual(nextTitle, initialTitle);
  assert.equal(button("월").getAttribute("aria-pressed"), "true");
  await press("노트 숨기기");
  await press("일별 목록");
  assert.equal(button("일별 목록").getAttribute("aria-selected"), "true");
  // Keyboard arrow navigation moves focus without replacing a heavy view until activation.
  await act(async () => {
    button("일별 목록").dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  await settle();
  assert.equal(button("일별 목록").getAttribute("aria-selected"), "true");
  await press("캘린더");
  assert.equal(button("월").getAttribute("aria-pressed"), "true");
  assert.equal(browser.document.querySelector(".fc-toolbar-title")?.textContent, nextTitle);
  assert.equal(button("노트 표시하기").getAttribute("aria-pressed"), "false");
  await press("주");
  const weekTitle = browser.document.querySelector(".fc-toolbar-title")?.textContent;
  assert.equal(button("주").getAttribute("aria-pressed"), "true");
  await press("업무함");
  await press("일정");
  assert.equal(button("주").getAttribute("aria-pressed"), "true");
  assert.equal(browser.document.querySelector(".fc-toolbar-title")?.textContent, weekTitle);
  assert.equal(button("노트 표시하기").getAttribute("aria-pressed"), "false");
});
