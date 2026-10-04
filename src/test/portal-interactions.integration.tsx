import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { ReactPlayerProps } from "react-player/types";
import { resolvePortalLocation } from "@/lib/portal-location";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
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
let UnifiedCalendar: typeof import("@/components/student-portal/UnifiedCalendar").UnifiedCalendar;
let VideoPlayer: typeof import("@/components/player/VideoPlayer").VideoPlayer;
let TimelineFeedback: typeof import("@/components/feedback/TimelineFeedback").TimelineFeedback;
let PostDetailClient: typeof import("@/app/community/[postId]/PostDetailClient").PostDetailClient;
let saveComment: typeof import("@/lib/actions/comments").createComment = async () => ({});
let removeComment: typeof import("@/lib/actions/comments").deleteComment = async () => {};
let trashPost: typeof import("@/lib/actions/posts").deletePost = async () => {};
let AssignmentView: typeof import("@/components/student-portal/AssignmentView").AssignmentView;
let FileUploader: typeof import("@/components/upload/FileUploader").FileUploader;
let requestUpload: typeof import("@/lib/actions/upload").requestMediaUpload = async () => ({ success: false, error: "업로드 테스트 미설정" });
let completeUpload: typeof import("@/lib/actions/upload").completeMediaUploadAction = async () => ({ success: false, error: "업로드 테스트 미설정" });
let abandonUpload: typeof import("@/lib/actions/upload").abandonMediaUpload = async () => {};
let saveAssignment: typeof import("@/lib/actions/assignments").submitAssignment = async () => ({});
let loadAssignments: typeof import("@/lib/actions/assignments").getMyAssignments = async () => [];
let saveFeedback: typeof import("@/lib/actions/feedbacks").createFeedback = async () => ({});
let saveEvent: typeof import("@/lib/actions/calendarEvents").createCalendarEvent = async () => ({});
let saveTrack: typeof import("@/lib/actions/digging").createDiggingTrack = async (input) => ({ id: "track", createdAt: new Date(), linkUrl: input.linkUrl ?? null, values: input.values });
let fetchMetadata: typeof import("@/lib/actions/digging").fetchLinkMeta = async () => ({});
let toggleModule: typeof import("@/lib/actions/curriculum").toggleModuleComplete = async () => {};
let loadStudentCalendar: typeof import("@/lib/actions/unifiedItems").getUnifiedItemsForStudent = async () => [];
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

mock.module("next/navigation", { namedExports: { useRouter: () => ({ push() {}, refresh() {} }) } });
// Browser/provider loading is exercised separately; this boundary exposes v3's HTML media API.
const HtmlMediaBoundary = React.forwardRef<HTMLVideoElement, ReactPlayerProps>((props, ref) => (
  <video ref={ref} src={props.src} controls={props.controls} onLoadedMetadata={props.onLoadedMetadata} onCanPlay={props.onCanPlay} onError={props.onError} />
));
HtmlMediaBoundary.displayName = "HtmlMediaBoundary";
mock.module("next/dynamic", { defaultExport: () => HtmlMediaBoundary });
mock.module("next/script", { defaultExport: function ScriptBoundary({ onReady }: { onReady?: () => void }) {
  const callback = useRef(onReady);
  useEffect(() => { callback.current?.(); }, []);
  return null;
} });
mock.module("@/lib/actions/assignments", { namedExports: {
  submitAssignment: (...args: Parameters<typeof saveAssignment>) => saveAssignment(...args),
  getMyAssignments: () => loadAssignments(),
} });
mock.module("@/lib/actions/feedbacks", { namedExports: {
  createFeedback: (...args: Parameters<typeof saveFeedback>) => saveFeedback(...args),
  deleteFeedback: async () => {},
  getMyFeedbacksMap: async () => ({}),
  getFeedbacksByAssignment: async () => [],
} });
mock.module("@/lib/actions/comments", { namedExports: {
  createComment: (...args: Parameters<typeof saveComment>) => saveComment(...args),
  deleteComment: (...args: Parameters<typeof removeComment>) => removeComment(...args),
  getCommentsByPost: async () => [],
} });
mock.module("@/lib/actions/posts", { namedExports: { deletePost: (...args: Parameters<typeof trashPost>) => trashPost(...args) } });
mock.module("@/lib/actions/upload", { namedExports: {
  requestMediaUpload: (...args: Parameters<typeof requestUpload>) => requestUpload(...args),
  completeMediaUploadAction: (...args: Parameters<typeof completeUpload>) => completeUpload(...args),
  abandonMediaUpload: (...args: Parameters<typeof abandonUpload>) => abandonUpload(...args),
} });
mock.module("@/components/community/PostEditForm", { namedExports: { PostEditForm: () => null } });
mock.module("@/components/community/PostTrashActions", { namedExports: { PostTrashActions: () => null } });
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
  ["student-portal", "ExternalCalendarConnection"],
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
    confirm: () => false,
    localStorage: browser.localStorage,
    HTMLElement: browser.HTMLElement,
    HTMLInputElement: browser.HTMLInputElement,
    HTMLFormElement: browser.HTMLFormElement,
    HTMLTextAreaElement: browser.HTMLTextAreaElement,
    FormData: browser.FormData,
    XMLHttpRequest: browser.XMLHttpRequest,
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
  ({ UnifiedCalendar } = await import("@/components/student-portal/UnifiedCalendar"));
  ({ VideoPlayer } = await import("@/components/player/VideoPlayer"));
  ({ TimelineFeedback } = await import("@/components/feedback/TimelineFeedback"));
  ({ PostDetailClient } = await import("@/app/community/[postId]/PostDetailClient"));
  ({ AssignmentView } = await import("@/components/student-portal/AssignmentView"));
  ({ FileUploader } = await import("@/components/upload/FileUploader"));
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
  return root;
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
  const input = browser.document.getElementById(id) ?? browser.document.querySelector(`input[name="${id}"]`);
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

function inputValue(name: string): string {
  const input = browser.document.querySelector(`input[name="${name}"]`);
  assert.ok(input instanceof browser.HTMLInputElement);
  return input.value;
}

function mockUploadTransport(context: TestContext) {
  const requests: UploadTransport[] = [];
  class UploadTransport {
    upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
    status = 200;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    aborted = false;
    constructor() { requests.push(this); }
    open() {}
    setRequestHeader() {}
    send() {}
    abort() { this.aborted = true; this.onabort?.(); }
  }
  const original = globalThis.XMLHttpRequest;
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, writable: true, value: UploadTransport });
  context.after(() => {
    globalThis.XMLHttpRequest = original;
    requestUpload = async () => ({ success: false, error: "업로드 테스트 미설정" });
    completeUpload = async () => ({ success: false, error: "업로드 테스트 미설정" });
    abandonUpload = async () => {};
  });
  return requests;
}

async function chooseUploadFile() {
  const input = browser.document.querySelector('input[type="file"]');
  assert.ok(input);
  Object.defineProperty(input, "files", { configurable: true, value: [new browser.File(["fixture"], "fixture.png", { type: "image/png" })] });
  await act(async () => input.dispatchEvent(new browser.Event("change", { bubbles: true })));
}

for (const waitingAt of ["intent", "complete"] as const) {
  test(`FileUploader는 ${waitingAt} 응답 대기 중 초안을 바꿨다가 돌아와도 이전 응답을 격리한다`, { concurrency: false }, async (context) => {
    const xhrs = mockUploadTransport(context);
    let releaseOldIntent!: (value: Awaited<ReturnType<typeof requestUpload>>) => void;
    let releaseOldComplete!: (value: Awaited<ReturnType<typeof completeUpload>>) => void;
    let releaseNewComplete!: (value: Awaited<ReturnType<typeof completeUpload>>) => void;
    const abandoned: string[] = [];
    const uploaded: string[] = [];
    const errors: string[] = [];
    const busy: boolean[] = [];
    const intent = (id: string) => ({ success: true as const, mediaObjectId: id, deliveryUrl: `/api/media/${id}`, uploadUrl: "https://upload.test/put", uploadContentType: "image/png" });
    let issued = 0;
    requestUpload = async () => {
      issued += 1;
      return issued === 1 && waitingAt === "intent" ? new Promise((resolve) => { releaseOldIntent = resolve; }) : intent(issued === 1 ? "old" : "new");
    };
    completeUpload = async (id) => new Promise((resolve) => { if (id === "old") releaseOldComplete = resolve; else releaseNewComplete = resolve; });
    abandonUpload = async (id) => { abandoned.push(id); };
    const screen = (operation: string) => <FileUploader purpose="QNA_ATTACHMENT" draftOperationId={operation} onUploadComplete={(upload) => uploaded.push(upload.mediaObjectId)} onError={(error) => errors.push(error)} onUploadingChange={(value) => busy.push(value)} />;
    const root = await render(context, screen("draft-a"));
    await chooseUploadFile();
    if (waitingAt === "complete") await act(async () => xhrs[0].onload?.());
    await act(async () => root.render(screen("draft-b")));
    await act(async () => root.render(screen("draft-a")));
    await chooseUploadFile();
    await act(async () => xhrs.at(-1)!.onload?.());
    assert.equal(button("업로드 중...").getAttribute("aria-busy"), "true");
    await act(async () => {
      if (waitingAt === "intent") releaseOldIntent(intent("old"));
      else releaseOldComplete({ success: true, mediaObjectId: "old", deliveryUrl: "/api/media/old" });
    });
    assert.deepEqual(abandoned, ["old"]);
    assert.deepEqual(uploaded, []);
    assert.deepEqual(errors, []);
    assert.equal(busy.at(-1), true, "이전 finally가 새 업로드의 busy를 해제하지 않는다");
    assert.equal(button("업로드 중...").getAttribute("aria-busy"), "true");
    assert.equal(xhrs.length, waitingAt === "intent" ? 1 : 2);
    await act(async () => releaseNewComplete({ success: true, mediaObjectId: "new", deliveryUrl: "/api/media/new" }));
    assert.deepEqual(uploaded, ["new"]);
    assert.equal(busy.at(-1), false);
    assert.equal(button("파일 선택").disabled, false);
  });
}

test("FileUploader는 목적 변경 시 PUT을 중단하고 늦은 진행·오류가 새 업로드를 바꾸지 않는다", { concurrency: false }, async (context) => {
  const xhrs = mockUploadTransport(context);
  const abandoned: string[] = [];
  const errors: string[] = [];
  const uploaded: string[] = [];
  let issued = 0;
  requestUpload = async () => ({ success: true, mediaObjectId: String(++issued), deliveryUrl: `/api/media/${issued}`, uploadUrl: "https://upload.test/put", uploadContentType: "image/png" });
  completeUpload = async (id) => ({ success: true, mediaObjectId: id, deliveryUrl: `/api/media/${id}` });
  abandonUpload = async (id) => { abandoned.push(id); };
  const screen = (purpose: "QNA_ATTACHMENT" | "COMMUNITY_POST_AUDIO") => <FileUploader purpose={purpose} draftOperationId="same-draft" onUploadComplete={(upload) => uploaded.push(upload.mediaObjectId)} onError={(error) => errors.push(error)} />;
  const root = await render(context, screen("QNA_ATTACHMENT"));
  await chooseUploadFile();
  await act(async () => root.render(screen("COMMUNITY_POST_AUDIO")));
  assert.equal(xhrs[0].aborted, true);
  await chooseUploadFile();
  await act(async () => {
    xhrs[1].upload.onprogress?.({ lengthComputable: true, loaded: 20, total: 100 });
    xhrs[0].upload.onprogress?.({ lengthComputable: true, loaded: 99, total: 100 });
    xhrs[0].onerror?.();
  });
  assert.equal(browser.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "20");
  assert.deepEqual(errors, []);
  assert.deepEqual(abandoned, ["1"]);
  await act(async () => xhrs[1].onload?.());
  assert.deepEqual(uploaded, ["2"]);
  assert.equal(button("파일 선택").disabled, false);
});

test("FileUploader는 아직 반영되지 않은 전환 렌더 때문에 현재 업로드를 잃지 않는다", { concurrency: false }, async (context) => {
  const xhrs = mockUploadTransport(context);
  const uploaded: string[] = [];
  let releaseComplete!: (value: Awaited<ReturnType<typeof completeUpload>>) => void;
  requestUpload = async () => ({ success: true, mediaObjectId: "current", deliveryUrl: "/api/media/current", uploadUrl: "https://upload.test/put", uploadContentType: "image/png" });
  completeUpload = async () => new Promise((resolve) => { releaseComplete = resolve; });
  const suspended = new Promise<void>(() => {});
  function PendingRoute({ pending }: { pending: boolean }) {
    if (pending) throw suspended;
    return null;
  }
  const screen = (operation: string, pending: boolean) => <React.Suspense fallback={<p>전환 중</p>}>
    <FileUploader purpose="QNA_ATTACHMENT" draftOperationId={operation} onUploadComplete={(upload) => uploaded.push(upload.mediaObjectId)} />
    <PendingRoute pending={pending} />
  </React.Suspense>;
  const root = await render(context, screen("visible-draft", false));
  await chooseUploadFile();
  await act(async () => xhrs[0].onload?.());
  await act(async () => React.startTransition(() => root.render(screen("uncommitted-draft", true))));
  assert.equal(button("업로드 중...").getAttribute("aria-busy"), "true");
  await act(async () => releaseComplete({ success: true, mediaObjectId: "current", deliveryUrl: "/api/media/current" }));
  assert.deepEqual(uploaded, ["current"]);
  assert.equal(button("파일 선택").disabled, false);
});

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

test("calendar list detail returns focus to its event link after a pointer opens the row", async (context) => {
  await render(context, <UnifiedCalendar returnTo="/dashboard/student" showSpaceContext={false} items={[{
    id: "practice", type: "EVENT", subType: "PRACTICE", title: "리듬 연습", date: new Date(), metadata: {},
    space: { studentId: "student", label: "학생" }, source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포털" },
  }]} />);
  await press("목록");
  const cell = browser.document.querySelector(".fc-list-event-title");
  assert.ok(cell instanceof browser.HTMLElement);
  await act(async () => { cell.click(); });
  await settle();
  assert.ok(browser.document.querySelector('[role="dialog"]'));
  await escape();
  assert.equal(browser.document.activeElement, browser.document.querySelector(".fc-list-event-title a"));
});

test("student portal reflects new server records and removals without a full reload", async (context) => {
  browser.history.replaceState({}, "", "/dashboard/student?section=today");
  const item: UnifiedItem = { id: "before", type: "ASSIGNMENT", title: "믹스셋", date: new Date(), metadata: {},
    space: { studentId: "student", label: "학생" }, source: { kind: "PORTAL", entity: "ASSIGNMENT", label: "포털" } };
  const portal = (items: UnifiedItem[]) => <StudentPortalClient
    initialLocation={resolvePortalLocation("student", { section: "today" })}
    announcements={[]} unifiedItems={items} communityPosts={[]} curriculumModules={[]} assignments={[]}
    studentId="student" displayName="학생" spaceLabel="학생" externalCalendarConnection={{ connected: false }} referenceTime={new Date()}
  />;
  const root = await render(context, portal([item]));
  assert.ok(browser.document.querySelector('a[href="/dashboard/student/assignments/before"]'));
  await act(async () => root.render(portal([{ ...item, id: "after" }])));
  assert.ok(browser.document.querySelector('a[href="/dashboard/student/assignments/after"]'));
  assert.equal(browser.document.querySelector('a[href="/dashboard/student/assignments/before"]'), null);
  await act(async () => root.render(portal([])));
  assert.equal(browser.document.querySelector('a[href="/dashboard/student/assignments/after"]'), null);
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

test("media source and queued or repeated feedback seeks use the HTML media contract", async (context) => {
  const url = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
  const root = await render(context, <VideoPlayer url={url} seekRequest={{ seconds: 90 }} />);
  const video = browser.document.querySelector("video");
  assert.ok(video);
  assert.equal(video.src, url);
  assert.equal(video.controls, true);
  assert.equal(video.currentTime, 0, "seek waits until metadata is ready");
  await act(async () => { video.dispatchEvent(new browser.Event("loadedmetadata")); });
  assert.equal(video.currentTime, 90);
  video.currentTime = 105;
  await act(async () => { root.render(<VideoPlayer url={url} seekRequest={{ seconds: 90 }} />); });
  assert.equal(video.currentTime, 90, "the same timestamp can be requested again");
  await act(async () => { video.dispatchEvent(new browser.Event("error")); });
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /원본 링크/);
  assert.equal(browser.document.querySelector('a[target="_blank"]')?.getAttribute("href"), url);
});

test("SoundCloud queues seconds as widget milliseconds and releases its listeners", async (context) => {
  const listeners = new Map<string, () => void>();
  const seeks: number[] = [];
  let plays = 0;
  let pauses = 0;
  let widgetFrame: HTMLIFrameElement;
  const widget = { bind: (event: string, callback: () => void) => listeners.set(event, callback), unbind: (event: string) => {
    assert.ok(widgetFrame.isConnected, "SDK teardown must run before the iframe is detached");
    listeners.delete(event);
  }, seekTo: (value: number) => seeks.push(value), play: () => { plays++; }, pause: () => { pauses++; } };
  Object.defineProperty(browser, "SC", { configurable: true, value: { Widget: Object.assign((frame: HTMLIFrameElement) => { widgetFrame = frame; return widget; }, { Events: { READY: "ready", ERROR: "error" } }) } });
  context.after(() => Reflect.deleteProperty(browser, "SC"));
  const url = "https://soundcloud.com/artist/mix";
  const root = await render(context, <VideoPlayer url={url} seekRequest={{ seconds: 90 }} />);
  const iframe = browser.document.querySelector("iframe");
  assert.ok(iframe);
  assert.equal(new URL(iframe.src).searchParams.get("url"), url);
  assert.deepEqual(seeks, []);
  const ready = listeners.get("ready");
  assert.ok(ready);
  await act(async () => ready());
  assert.deepEqual(seeks, [90000]);
  await act(async () => root.render(<VideoPlayer url={url} seekRequest={{ seconds: 90 }} />));
  assert.deepEqual(seeks, [90000, 90000]);
  assert.equal(plays, 2);
  await act(async () => root.render(<div />));
  assert.equal(listeners.size, 0);
  assert.equal(pauses, 1);
  await act(async () => ready());
  assert.equal(seeks.length, 2);
});

test("feedback failure keeps the time and text; only a confirmed save clears them", async (context) => {
  let refreshes = 0;
  const operationIds: unknown[] = [];
  saveFeedback = async (_id, _previous, data) => { operationIds.push(data.get("operationId")); return { error: "내용을 확인해 주세요." }; };
  context.after(() => { saveFeedback = async () => ({}); });
  const screen = () => <TimelineFeedback assignmentId="assignment" actorId="admin-1" feedbackList={[]} isAdmin onRefresh={() => { refreshes++; }} />;
  const root = await render(context, screen());
  await fill("feedback-time-marker", "01:30");
  await fill("feedback-content", "전환 지점에서 저음을 천천히 교환해 주세요.");
  await press("추가");
  assert.equal((browser.document.getElementById("feedback-time-marker") as unknown as HTMLInputElement).value, "01:30");
  assert.match((browser.document.getElementById("feedback-content") as unknown as HTMLInputElement).value, /저음을/);
  assert.equal(refreshes, 0);
  assert.ok(operationIds[0]);
  await act(async () => root.render(<div />));
  await act(async () => root.render(screen()));
  await settle();
  saveFeedback = async (_id, _previous, data) => { operationIds.push(data.get("operationId")); throw new Error("response lost"); };
  await press("추가");
  saveFeedback = async (_id, _previous, data) => { operationIds.push(data.get("operationId")); return { success: true }; };
  await press("추가");
  assert.deepEqual(operationIds, [operationIds[0], operationIds[0], operationIds[0]], "실패·remount 후 재시도는 같은 제출이다");
  assert.equal((browser.document.getElementById("feedback-content") as unknown as HTMLInputElement).value, "");
  assert.equal(refreshes, 1);
  await fill("feedback-time-marker", "01:30");
  await fill("feedback-content", "전환 지점에서 저음을 천천히 교환해 주세요.");
  await press("추가");
  assert.notEqual(operationIds[3], operationIds[0], "성공 뒤 의도적인 새 피드백은 새 제출이다");
});

test("community comment failure and remount preserve the author's draft", async (context) => {
  browser.localStorage.clear();
  const operationIds: unknown[] = [];
  saveComment = async (_id, _previous, data) => { operationIds.push(data.get("operationId")); return { error: "댓글을 저장하지 못했습니다." }; };
  context.after(() => { saveComment = async () => ({}); });
  const post = {
    id: "draft-post", authorId: "student-1", title: "레슨 이야기", contentHtml: "<p>본문</p>",
    category: "general", boardType: "GENERAL" as const, isPinned: false, mediaUrl: null,
    mediaObjectId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    deletedById: null, version: 1, authorName: "학생", authorEmail: null,
  };
  const screen = (actorId: string) => <PostDetailClient postId={post.id} post={post} initialCommentList={[]} currentUserId={actorId} isAdmin={false} returnTo="/community" />;
  const root = await render(context, screen("student-1"));
  await fill("content", "이 부분을 다음 레슨에서 다시 연습하고 싶어요.");
  await press("등록");
  assert.equal(inputValue("content"), "이 부분을 다음 레슨에서 다시 연습하고 싶어요.");
  await act(async () => root.render(<div />));
  await act(async () => root.render(screen("student-2")));
  await settle();
  assert.equal(inputValue("content"), "");
  await act(async () => root.render(<div />));
  await act(async () => root.render(screen("student-1")));
  await settle();
  assert.match(inputValue("content"), /다음 레슨/);
  saveComment = async (_id, _previous, data) => { operationIds.push(data.get("operationId")); throw new Error("offline"); };
  await press("등록");
  assert.match(inputValue("content"), /다음 레슨/);
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /저장 결과/);
  saveComment = async (_id, _previous, data) => { operationIds.push(data.get("operationId")); return { success: true, commentId: "confirmed-comment" }; };
  await press("등록");
  assert.ok(operationIds[0]);
  assert.deepEqual(operationIds, [operationIds[0], operationIds[0], operationIds[0]]);
  assert.equal(inputValue("content"), "");
  await act(async () => root.render(<div />));
  await act(async () => root.render(screen("student-1")));
  await settle();
  assert.equal(inputValue("content"), "");
  await fill("content", "이 부분을 다음 레슨에서 다시 연습하고 싶어요.");
  await press("등록");
  assert.notEqual(operationIds[3], operationIds[0]);
});

test("feedback draft survives leaving the assignment before submitting", async (context) => {
  browser.localStorage.clear();
  const screen = (actorId = "admin-1", assignmentId = "feedback-draft-assignment") => <TimelineFeedback assignmentId={assignmentId} actorId={actorId} feedbackList={[]} isAdmin />;
  const root = await render(context, screen());
  await fill("feedback-time-marker", "01:30");
  await fill("feedback-content", "다음 전환에서는 저음을 천천히 바꿔주세요.");
  await act(async () => root.render(<div />));
  await act(async () => root.render(screen("admin-2")));
  await settle();
  assert.equal(inputValue("content"), "");
  await act(async () => root.render(screen("admin-1", "other-assignment")));
  await settle();
  assert.equal(inputValue("content"), "");
  await act(async () => root.render(screen()));
  await settle();
  assert.equal((browser.document.getElementById("feedback-time-marker") as unknown as HTMLInputElement).value, "01:30");
  assert.match((browser.document.getElementById("feedback-content") as unknown as HTMLInputElement).value, /저음을/);
  saveFeedback = async () => ({ success: true });
  context.after(() => { saveFeedback = async () => ({}); });
  await press("추가");
  await act(async () => root.render(<div />));
  await act(async () => root.render(screen()));
  await settle();
  assert.equal(inputValue("content"), "");
  assert.equal(inputValue("timeMarker"), "");
});

test("게시물 삭제는 응답 유실 재시도와 복원 후 새 삭제 의도를 구분한다", async (context) => {
  browser.localStorage.clear();
  context.mock.method(globalThis, "confirm", () => true);
  const requests: Parameters<typeof trashPost>[] = [];
  trashPost = async (...args) => { requests.push(args); throw new Error("response lost"); };
  context.after(() => { trashPost = async () => {}; });
  const post = {
    id: "delete-retry-post", authorId: "student-1", title: "레슨 이야기", contentHtml: "<p>본문</p>",
    category: "general", boardType: "GENERAL" as const, isPinned: false, mediaUrl: null,
    mediaObjectId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    deletedById: null, version: 1, authorName: "학생", authorEmail: null,
  };
  const screen = (version: number, deletedAt: Date | null = null) => <PostDetailClient postId={post.id} post={{ ...post, version, deletedAt }} initialCommentList={[]} currentUserId="student-1" isAdmin={false} returnTo="/community" />;
  const root = await render(context, screen(1));
  await press("게시물 삭제");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /response lost/u);
  await press("게시물 삭제");
  assert.equal(requests[0][1], requests[1][1]);
  await act(async () => root.render(screen(2, new Date())));
  await act(async () => root.render(screen(3)));
  await press("게시물 삭제");
  assert.notEqual(requests[1][1], requests[2][1]);
  assert.deepEqual(requests.map((args) => args[2]), [1, 1, 3]);
});

test("failed comment deletion keeps the conversation and unfinished reply visible", async (context) => {
  browser.localStorage.clear();
  context.mock.method(globalThis, "confirm", () => true);
  removeComment = async () => { throw new Error("offline"); };
  context.after(() => { removeComment = async () => {}; });
  const post = {
    id: "delete-post", authorId: "student-1", title: "레슨 이야기", contentHtml: "<p>본문</p>",
    category: "general", boardType: "GENERAL" as const, isPinned: false, mediaUrl: null,
    mediaObjectId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    deletedById: null, version: 1, authorName: "학생", authorEmail: null,
  };
  const comment = { id: "comment-1", postId: post.id, authorId: "student-1", contentHtml: "<p>기존 대화</p>", createdAt: new Date(), authorName: "학생", authorEmail: null };
  await render(context, <PostDetailClient postId={post.id} post={post} initialCommentList={[comment]} currentUserId="student-1" isAdmin={false} returnTo="/community" />);
  await fill("content", "아직 작성 중인 답글");
  await press("학생 댓글 삭제");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /댓글을 삭제하지 못했습니다/);
  assert.match(browser.document.body.textContent, /기존 대화/);
  assert.equal(inputValue("content"), "아직 작성 중인 답글");
});

test("assignment errors retain the URL and a failed refresh retries without resubmission", async (context) => {
  let submissions = 0;
  saveAssignment = async () => ({ error: "지원하지 않는 링크입니다." });
  context.after(() => { saveAssignment = async () => ({}); loadAssignments = async () => []; });
  await render(context, <AssignmentView initialAssignments={[]} />);
  await fill("assignment-media-url", "https://example.test/mix");
  await press("제출");
  assert.equal((browser.document.getElementById("assignment-media-url") as unknown as HTMLInputElement).value, "https://example.test/mix");
  saveAssignment = async () => { submissions++; return { success: true, id: "saved" }; };
  loadAssignments = async () => { throw new Error("offline"); };
  await fill("assignment-media-url", "https://youtu.be/aqz-KE-bpKQ");
  await press("제출");
  assert.equal((browser.document.getElementById("assignment-media-url") as unknown as HTMLInputElement).value, "");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /제출은 완료/);
  loadAssignments = async () => [];
  await press("목록 다시 불러오기");
  assert.equal(submissions, 1);
  assert.equal(browser.document.querySelector('[role="alert"]'), null);
});
