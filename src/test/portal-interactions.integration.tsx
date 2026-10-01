import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { resolvePortalLocation } from "@/lib/portal-location";
let createRoot: typeof import("react-dom/client").createRoot;
let renderToString: typeof import("react-dom/server").renderToString;

let browser: Window;
let PortalShell: typeof import("@/components/ui/portal-shell").PortalShell;
let SlidePanel: typeof import("@/components/student-portal/SlidePanel").SlidePanel;
let CreateEntryDropdown: typeof import("@/components/student-portal/CreateEntryDropdown").CreateEntryDropdown;
let AdminPortalClient: typeof import("@/components/admin-portal/AdminPortalClient").AdminPortalClient;
let StudentPortalClient: typeof import("@/components/student-portal/StudentPortalClient").StudentPortalClient;
let EventFormDialog: typeof import("@/components/calendar/EventFormDialog").EventFormDialog;
let AddTrackDialog: typeof import("@/components/digging/AddTrackDialog").AddTrackDialog;
let CurriculumView: typeof import("@/components/student-portal/CurriculumView").CurriculumView;
let TiptapEditor: typeof import("@tiptap/core").Editor;
let StarterKit: typeof import("@tiptap/starter-kit").default;
let BlockCommandMenu: typeof import("@/components/editor/BlockCommandMenu").BlockCommandMenu;
let saveEvent: typeof import("@/lib/actions/calendarEvents").createCalendarEvent = async () => ({});
let saveTrack: typeof import("@/lib/actions/digging").createDiggingTrack = async (input) => ({ id: "track", createdAt: new Date(), linkUrl: input.linkUrl ?? null, values: input.values });
let fetchMetadata: typeof import("@/lib/actions/digging").fetchLinkMeta = async () => ({});
let toggleModule: typeof import("@/lib/actions/curriculum").toggleModuleComplete = async () => {};
let loadStudentCalendar: typeof import("@/lib/actions/unifiedItems").getUnifiedItemsForStudent = async () => [];
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

mock.module("next/navigation", { namedExports: { useRouter: () => ({ push() {} }) } });
mock.module("@/lib/actions/calendarEvents", { namedExports: { createCalendarEvent: (...args: Parameters<typeof saveEvent>) => saveEvent(...args) } });
mock.module("@/lib/actions/curriculum", { namedExports: { toggleModuleComplete: (...args: Parameters<typeof toggleModule>) => toggleModule(...args) } });
mock.module("@/lib/actions/digging", { namedExports: {
  getOrSeedColumns: async () => [],
  createDiggingTrack: (...args: Parameters<typeof saveTrack>) => saveTrack(...args),
  fetchLinkMeta: (...args: Parameters<typeof fetchMetadata>) => fetchMetadata(...args),
} });
mock.module("@/lib/actions/unifiedItems", { namedExports: {
  getUnifiedItemsForStudent: (...args: Parameters<typeof loadStudentCalendar>) => loadStudentCalendar(...args),
  getExternalUnifiedItemsForStudent: async () => [],
  getExternalUnifiedItems: async () => [],
} });
// Exercise the actual shell, calendar tabs and FullCalendar without unrelated editors/I/O.
for (const [folder, name] of [
  ["student-portal", "UnifiedItemDetail"], ["student-portal", "DailyListView"],
  ["student-portal", "AllItemsView"],
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
    HTMLFormElement: browser.HTMLFormElement,
    HTMLTextAreaElement: browser.HTMLTextAreaElement,
    FormData: browser.FormData,
    DOMParser: browser.DOMParser,
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
  ({ createRoot } = await import("react-dom/client"));
  ({ renderToString } = await import("react-dom/server"));
  ({ PortalShell } = await import("@/components/ui/portal-shell"));
  ({ SlidePanel } = await import("@/components/student-portal/SlidePanel"));
  ({ EventFormDialog } = await import("@/components/calendar/EventFormDialog"));
  ({ AddTrackDialog } = await import("@/components/digging/AddTrackDialog"));
  ({ CurriculumView } = await import("@/components/student-portal/CurriculumView"));
  ({ Editor: TiptapEditor } = await import("@tiptap/core"));
  ({ default: StarterKit } = await import("@tiptap/starter-kit"));
  ({ BlockCommandMenu } = await import("@/components/editor/BlockCommandMenu"));
  ({ CreateEntryDropdown } = await import("@/components/student-portal/CreateEntryDropdown"));
  ({ AdminPortalClient } = await import("@/components/admin-portal/AdminPortalClient"));
  ({ StudentPortalClient } = await import("@/components/student-portal/StudentPortalClient"));
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

async function fill(id: string, value: string) {
  const input = browser.document.getElementById(id);
  assert.ok(input instanceof browser.HTMLInputElement);
  const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")?.set;
  assert.ok(setter);
  await act(async () => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new browser.Event("input", { bubbles: true }));
    input.dispatchEvent(new browser.Event("change", { bubbles: true }));
  });
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

test("portal deep links render their section, view and selected student before hydration", async (context) => {
  const document = browser.document;
  const markup = document.createElement("div");
  markup.innerHTML = renderToString(<StudentPortalClient
    initialLocation={resolvePortalLocation("student", { section: "workspace", view: "curriculum" })}
    announcements={[]} unifiedItems={[]} communityPosts={[]} curriculumModules={[]} assignments={[]}
    studentId="student" displayName="학생" spaceLabel="학생" externalCalendarConnection={{ connected: false }} referenceTime={new Date()}
  />);
  assert.equal(markup.querySelector('nav [aria-current="page"]')?.textContent, "워크스페이스");
  assert.equal(markup.querySelector('[role="tab"][aria-selected="true"]')?.textContent, "커리큘럼");

  const students = ["first", "requested"].map((id) => ({ id, email: `${id}@example.test`, displayName: id, createdAt: null, currentModule: null, nextLessonDate: null, pendingFeedbackCount: 0 }));
  const admin = <AdminPortalClient
    initialLocation={resolvePortalLocation("admin", { section: "schedule", view: "all", type: "NOTE" })}
    initialStudentId="requested" students={students} initialUnifiedItems={[]}
    announcements={[]} communityPosts={[]} adminId="admin" qnaThreads={[]} pendingAssignments={[]} referenceTime={new Date()}
  />;
  markup.innerHTML = renderToString(admin);
  assert.equal(markup.querySelector('nav [aria-current="page"]')?.textContent, "일정");
  assert.equal(markup.querySelector('[role="tab"][aria-selected="true"]')?.textContent, "전체 항목");
  assert.equal(markup.querySelector("select")?.value, "requested");
  const loads: string[] = [];
  loadStudentCalendar = async (id) => { loads.push(id); return []; };
  context.after(() => { loadStudentCalendar = async () => []; });
  browser.history.replaceState({}, "", "/dashboard/admin?section=schedule&view=all&type=NOTE&student=requested");
  await render(context, admin);
  assert.equal(document.querySelector("select")?.value, "requested");
  assert.deepEqual(loads, [], "the server-loaded student is not fetched a second time on mount");
  assert.deepEqual(resolvePortalLocation("admin", { section: "workspace", view: "curriculum", type: "invalid", preset: "invalid" }), {
    section: "work", view: "calendar", type: null, preset: null,
  });
});

test("event save protects every dismissal path while pending and keeps input after an error", async (context) => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof saveEvent>>>();
  saveEvent = async () => pending.promise;
  context.after(() => { pending.resolve({ error: "정리" }); saveEvent = async () => ({}); });
  function EventHarness() {
    const [open, setOpen] = useState(true);
    return <EventFormDialog open={open} onOpenChange={setOpen} defaultStart="2026-10-02T15:00" />;
  }
  await render(context, <EventHarness />);
  await fill("event-title", "리듬 연습");
  await press("저장");
  assert.equal(button("닫기").disabled, true);
  assert.equal(button("취소").disabled, true);
  await escape();
  await act(async () => browser.document.body.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })));
  assert.ok(browser.document.querySelector('[role="dialog"]'));
  await act(async () => pending.resolve({ error: "종료 시간을 확인해 주세요." }));
  await settle();
  assert.equal(browser.document.querySelector('[role="alert"]')?.textContent, "종료 시간을 확인해 주세요.");
  assert.equal((browser.document.getElementById("event-title") as unknown as HTMLInputElement).value, "리듬 연습");
  assert.equal(button("닫기").disabled, false);
  await escape();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
});

test("track metadata cannot overwrite newer typing and track save locks custom controls and dismissal", async (context) => {
  const metadata = Promise.withResolvers<Awaited<ReturnType<typeof fetchMetadata>>>();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof saveTrack>>>();
  fetchMetadata = async () => metadata.promise;
  saveTrack = async () => pending.promise;
  context.after(() => { metadata.resolve({}); pending.resolve({ id: "cleanup", createdAt: new Date(), linkUrl: null, values: {} }); fetchMetadata = async () => ({}); });
  function TrackHarness() {
    const [open, setOpen] = useState(true);
    return <AddTrackDialog open={open} onOpenChange={setOpen} onSuccess={() => {}} columns={[
      { id: "link", name: "링크", columnType: "link", options: null },
      { id: "title", name: "트랙명", columnType: "text", options: null },
      { id: "rating", name: "평가", columnType: "rating", options: null },
      { id: "key", name: "키", columnType: "camelot_key", options: null },
    ]} />;
  }
  await render(context, <TrackHarness />);
  await fill("digging-link", "https://example.test/track");
  await fill("digging-column-title", "직접 입력한 트랙명");
  await act(async () => metadata.resolve({ title: "늦게 도착한 제목" }));
  assert.equal((browser.document.getElementById("digging-column-title") as unknown as HTMLInputElement).value, "직접 입력한 트랙명");
  await press("추가");
  assert.equal(button("5점").disabled, true);
  assert.equal(button("키").disabled, true);
  assert.equal(button("닫기").disabled, true);
  await escape();
  assert.ok(browser.document.querySelector('[role="dialog"]'));
  await act(async () => pending.reject(new Error("offline")));
  await settle();
  assert.ok(browser.document.querySelector('[role="alert"]'));
  assert.equal((browser.document.getElementById("digging-column-title") as unknown as HTMLInputElement).value, "직접 입력한 트랙명");
  assert.equal(button("닫기").disabled, false);
});

test("curriculum rolls back failed optimistic completion and allows a successful retry", async (context) => {
  const pending = Promise.withResolvers<void>();
  toggleModule = async () => pending.promise;
  context.after(() => { pending.resolve(); toggleModule = async () => {}; });
  await render(context, <CurriculumView initialModules={[{ id: "module", weekNum: 1, title: "비트 매칭", description: null, isCompleted: false }]} />);
  await press("비트 매칭: 완료로 변경");
  assert.equal(browser.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "100");
  assert.equal(button("비트 매칭: 미완료로 변경").disabled, true);
  await act(async () => pending.reject(new Error("offline")));
  await settle();
  assert.equal(browser.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "0");
  assert.ok(browser.document.querySelector('[role="alert"]'));
  toggleModule = async () => {};
  await press("비트 매칭: 완료로 변경");
  assert.equal(button("비트 매칭: 미완료로 변경").getAttribute("aria-pressed"), "true");
  assert.equal(browser.document.querySelector('[role="alert"]'), null);
});

test("editor command popup stays in its dialog and Escape closes only the popup", async (context) => {
  const ready = { editor: null as Editor | null };
  function EditorBody() {
    const host = useRef<HTMLDivElement>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    useEffect(() => {
      const value = new TiptapEditor({ element: host.current!, extensions: [StarterKit], content: "<p></p>", injectCSS: false });
      ready.editor = value;
      setEditor(value);
      return () => value.destroy();
    }, []);
    return <><div ref={host} />{editor && <BlockCommandMenu editor={editor} />}</>;
  }
  function Harness() {
    const [open, setOpen] = useState(true);
    return <SlidePanel open={open} onOpenChange={setOpen} title="작성"><EditorBody /></SlidePanel>;
  }
  await render(context, <Harness />);
  assert.ok(ready.editor);
  const editor = ready.editor;
  const panel = browser.document.querySelector('[role="dialog"]');
  assert.ok(panel);
  // DOM tests supply geometry; actual clipping and hit testing are checked in the browser.
  context.mock.method(panel, "getBoundingClientRect", () => new browser.DOMRect(360, 0, 640, 768));
  context.mock.method(editor.view, "coordsAtPos", () => ({ left: 420, right: 420, top: 160, bottom: 180 }));
  await act(async () => { editor.view.dom.focus(); editor.commands.insertContent("/"); });
  const menu = browser.document.querySelector('[role="listbox"]');
  assert.ok(menu);
  assert.ok(panel.contains(menu));
  assert.equal(editor.view.dom.getAttribute("aria-controls"), menu.id);
  await act(async () => {
    editor.view.dom.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event);
  });
  assert.equal(browser.document.querySelector('[role="listbox"]'), null);
  assert.ok(browser.document.querySelector('[role="dialog"]'));
  assert.equal(editor.view.dom.getAttribute("aria-controls"), null);
  await act(async () => { editor.view.dispatch(editor.state.tr); });
  assert.equal(browser.document.querySelector('[role="listbox"]'), null, "a selection refresh must not reopen the dismissed command menu");
  await act(async () => { editor.commands.insertContent("h"); });
  assert.ok(browser.document.querySelector('[role="listbox"]'), "typing a new query opens the command menu again");
  await act(async () => {
    editor.view.dom.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event);
  });
  await escape();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
});
