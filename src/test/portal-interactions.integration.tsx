import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act, useEffect, useRef, useState, useTransition } from "react";
import type { Editor } from "@tiptap/core";
import type { ReactPlayerProps } from "react-player/types";
import { resolvePortalLocation } from "@/lib/portal-location";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
let createRoot: typeof import("react-dom/client").createRoot;
let renderToString: typeof import("react-dom/server").renderToString;

let browser: Window;
let PortalShell: typeof import("@/components/ui/portal-shell").PortalShell;
let navigateWithinPage: typeof import("@/components/app-shell/navigation").navigateWithinPage;
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
let trashPost: typeof import("@/lib/actions/posts").deletePost = async () => ({ success: true });
let AssignmentView: typeof import("@/components/student-portal/AssignmentView").AssignmentView;
let FileUploader: typeof import("@/components/upload/FileUploader").FileUploader;
let FullEditor: typeof import("@/components/editor/FullEditor").FullEditor;
let pastedEditorImageFiles: typeof import("@/components/editor/useEditorImageUpload").pastedEditorImageFiles;
let requestUpload: typeof import("@/lib/actions/upload").requestMediaUpload = async () => ({ success: false, error: "업로드 테스트 미설정" });
let completeUpload: typeof import("@/lib/actions/upload").completeMediaUploadAction = async () => ({ success: false, error: "업로드 테스트 미설정" });
let abandonUpload: typeof import("@/lib/actions/upload").abandonMediaUpload = async () => {};
let saveAssignment: typeof import("@/lib/actions/assignments").submitAssignment = async () => ({});
let loadAssignments: typeof import("@/lib/actions/assignments").getMyAssignments = async () => [];
let removeAssignment: typeof import("@/lib/actions/assignments").deleteMyAssignment = async () => ({ success: true });
let saveFeedback: typeof import("@/lib/actions/feedbacks").createFeedback = async () => ({});
let saveEvent: typeof import("@/lib/actions/calendarEvents").createCalendarEvent = async () => ({});
let editEvent: typeof import("@/lib/actions/calendarEvents").updateCalendarEventDetails = async () => ({});
let removeEvent: typeof import("@/lib/actions/calendarEvents").deleteCalendarEvent = async () => {};
let CalendarEventActions: typeof import("@/components/calendar/CalendarEventActions").CalendarEventActions;
let LessonActions: typeof import("@/components/calendar/LessonActions").LessonActions;
let saveLesson: typeof import("@/lib/actions/lessons").createLesson = async () => ({});
let moveLesson: typeof import("@/lib/actions/lessons").rescheduleLesson = async () => ({});
let removeLesson: typeof import("@/lib/actions/lessons").deleteLesson = async () => {};
let saveTrack: typeof import("@/lib/actions/digging").createDiggingTrack = async (input) => ({ id: "track", createdAt: new Date(), linkUrl: input.linkUrl ?? null, values: input.values });
let fetchMetadata: typeof import("@/lib/actions/digging").fetchLinkMeta = async () => ({});
let saveTrackValue: typeof import("@/lib/actions/digging").updateDiggingTrackValue = async () => {};
let DiggingBoard: typeof import("@/components/digging/DiggingBoard").DiggingBoard;
let toggleModule: typeof import("@/lib/actions/curriculum").toggleModuleComplete = async () => {};
let editModule: typeof import("@/lib/actions/curriculum").updateModule = async () => ({ success: true });
let OverviewTab: typeof import("@/components/admin/OverviewTab").OverviewTab;
let changePassword: typeof import("@/lib/actions/password").changeOwnPassword = async () => ({ success: true });
let PasswordChangeControl: typeof import("@/components/auth/PasswordChangeControl").PasswordChangeControl;
let PasswordChangeForm: typeof import("@/components/auth/PasswordChangeControl").PasswordChangeForm;
let resetPassword: typeof import("@/lib/actions/students").resetStudentPassword = async () => "abcd-efgh-jkmn";
let StudentPasswordResetControl: typeof import("@/components/admin/StudentPasswordResetControl").StudentPasswordResetControl;
let createStudentAction: typeof import("@/lib/actions/students").createStudent = async () => ({});
let reissueInvite: typeof import("@/lib/actions/students").reissueStudentInvite = async () => "/invite#student-1.secret";
let StudentInviteControl: typeof import("@/components/admin/StudentInviteControl").StudentInviteControl;
let NewStudentPage: typeof import("@/app/dashboard/admin/students/new/page").default;
let inviteStatus: typeof import("@/lib/actions/invite").getInviteStatus = async () => ({ status: "invalid" });
let completeInviteAction: typeof import("@/lib/actions/invite").completeInvite = async () => ({ success: true });
let InviteSignup: typeof import("@/components/auth/InviteSignup").InviteSignup;
let confirmActionModule: typeof import("@/components/ui/confirm-action");
let issueFeedUrl: typeof import("@/lib/actions/calendarFeed").issueStudentCalendarFeedUrl = async () => "/api/calendar/feed?token=test";
let CalendarFeedControl: typeof import("@/components/admin/CalendarFeedControl").CalendarFeedControl;
let connectCalendar: typeof import("@/lib/actions/externalCalendars").connectExternalCalendar = async () => ({});
let ExternalCalendarConnection: typeof import("@/components/student-portal/ExternalCalendarConnection").ExternalCalendarConnection;
let loadStudentCalendar: typeof import("@/lib/actions/unifiedItems").getUnifiedItemsForStudent = async () => [];
let login: typeof import("@/lib/actions/session").loginWithCredentials = async () => ({});
let loadCommunityPage: typeof import("@/lib/actions/posts").getCommunityPostPage = async () => ({ posts: [], nextCursor: null });
let CommunityClient: typeof import("@/app/community/CommunityClient").default;
let LoginForm: typeof import("@/components/auth/LoginForm").LoginForm;
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
  deleteMyAssignment: (...args: Parameters<typeof removeAssignment>) => removeAssignment(...args),
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
mock.module("@/lib/actions/posts", { namedExports: {
  deletePost: (...args: Parameters<typeof trashPost>) => trashPost(...args),
  getCommunityPostPage: (...args: Parameters<typeof loadCommunityPage>) => loadCommunityPage(...args),
  togglePinPost: async () => ({ success: true }),
} });
mock.module("@/lib/actions/categories", { namedExports: { getCategories: async () => [] } });
mock.module("@/lib/actions/upload", { namedExports: {
  requestMediaUpload: (...args: Parameters<typeof requestUpload>) => requestUpload(...args),
  completeMediaUploadAction: (...args: Parameters<typeof completeUpload>) => completeUpload(...args),
  abandonMediaUpload: (...args: Parameters<typeof abandonUpload>) => abandonUpload(...args),
} });
mock.module("@/components/community/PostEditForm", { namedExports: { PostEditForm: () => null } });
mock.module("@/components/community/PostTrashActions", { namedExports: { PostTrashActions: () => null } });
mock.module("@/lib/actions/calendarEvents", { namedExports: {
  createCalendarEvent: (...args: Parameters<typeof saveEvent>) => saveEvent(...args),
  updateCalendarEventDetails: (...args: Parameters<typeof editEvent>) => editEvent(...args),
  deleteCalendarEvent: (...args: Parameters<typeof removeEvent>) => removeEvent(...args),
} });
mock.module("@/lib/actions/lessons", { namedExports: {
  createLesson: (...args: Parameters<typeof saveLesson>) => saveLesson(...args),
  rescheduleLesson: (...args: Parameters<typeof moveLesson>) => moveLesson(...args),
  deleteLesson: (...args: Parameters<typeof removeLesson>) => removeLesson(...args),
} });
mock.module("@/lib/actions/curriculum", { namedExports: {
  toggleModuleComplete: (...args: Parameters<typeof toggleModule>) => toggleModule(...args),
  createModule: async () => ({ success: true }),
  updateModule: (...args: Parameters<typeof editModule>) => editModule(...args),
  deleteModule: async () => {},
} });
mock.module("@/lib/actions/calendarFeed", { namedExports: {
  issueStudentCalendarFeedUrl: (...args: Parameters<typeof issueFeedUrl>) => issueFeedUrl(...args),
  getStudentCalendarFeedIssuedAt: async () => null,
} });
mock.module("@/lib/actions/password", { namedExports: { changeOwnPassword: (...args: Parameters<typeof changePassword>) => changePassword(...args) } });
mock.module("@/lib/actions/students", { namedExports: {
  resetStudentPassword: (...args: Parameters<typeof resetPassword>) => resetPassword(...args),
  createStudent: (...args: Parameters<typeof createStudentAction>) => createStudentAction(...args),
  reissueStudentInvite: (...args: Parameters<typeof reissueInvite>) => reissueInvite(...args),
  getStudentAccountState: async () => ({ kind: "active" }),
} });
mock.module("@/lib/actions/invite", { namedExports: {
  getInviteStatus: (...args: Parameters<typeof inviteStatus>) => inviteStatus(...args),
  completeInvite: (...args: Parameters<typeof completeInviteAction>) => completeInviteAction(...args),
} });
mock.module("@/lib/actions/digging", { namedExports: {
  getOrSeedColumns: async () => [],
  createDiggingTrack: (...args: Parameters<typeof saveTrack>) => saveTrack(...args),
  fetchLinkMeta: (...args: Parameters<typeof fetchMetadata>) => fetchMetadata(...args),
  updateDiggingTrackValue: (...args: Parameters<typeof saveTrackValue>) => saveTrackValue(...args),
  deleteDiggingTrack: async () => {},
  addDiggingColumn: async () => {},
  deleteDiggingColumn: async () => {},
} });
mock.module("@/lib/actions/externalCalendars", { namedExports: {
  connectExternalCalendar: (...args: Parameters<typeof connectCalendar>) => connectCalendar(...args),
  disconnectExternalCalendar: async () => {},
  getExternalCalendarConnectionSummary: async () => ({ connected: false }),
} });
mock.module("@/lib/actions/session", { namedExports: {
  loginWithCredentials: (...args: Parameters<typeof login>) => login(...args),
  logoutCurrentUser: async () => {},
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
  ({ navigateWithinPage } = await import("@/components/app-shell/navigation"));
  ({ SlidePanel } = await import("@/components/student-portal/SlidePanel"));
  ({ EventFormDialog } = await import("@/components/calendar/EventFormDialog"));
  ({ CalendarEventActions } = await import("@/components/calendar/CalendarEventActions"));
  ({ LessonActions } = await import("@/components/calendar/LessonActions"));
  ({ AddTrackDialog } = await import("@/components/digging/AddTrackDialog"));
  ({ DiggingBoard } = await import("@/components/digging/DiggingBoard"));
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
  ({ FullEditor } = await import("@/components/editor/FullEditor"));
  ({ pastedEditorImageFiles } = await import("@/components/editor/useEditorImageUpload"));
  ({ CreateEntryDropdown } = await import("@/components/student-portal/CreateEntryDropdown"));
  ({ AdminPortalClient } = await import("@/components/admin-portal/AdminPortalClient"));
  ({ StudentPortalClient } = await import("@/components/student-portal/StudentPortalClient"));
  ({ LoginForm } = await import("@/components/auth/LoginForm"));
  ({ default: CommunityClient } = await import("@/app/community/CommunityClient"));
  ({ OverviewTab } = await import("@/components/admin/OverviewTab"));
  ({ PasswordChangeControl, PasswordChangeForm } = await import("@/components/auth/PasswordChangeControl"));
  ({ StudentPasswordResetControl } = await import("@/components/admin/StudentPasswordResetControl"));
  ({ StudentInviteControl } = await import("@/components/admin/StudentInviteControl"));
  ({ default: NewStudentPage } = await import("@/app/dashboard/admin/students/new/page"));
  ({ InviteSignup } = await import("@/components/auth/InviteSignup"));
  confirmActionModule = await import("@/components/ui/confirm-action");
  ({ CalendarFeedControl } = await import("@/components/admin/CalendarFeedControl"));
  ({ ExternalCalendarConnection } = await import("@/components/student-portal/ExternalCalendarConnection"));
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

test("FullEditor는 고른 이미지를 Worker 경로로 올린 뒤 본문에 업로드 주소로 넣고 형식·크기 문제를 알린다", { concurrency: false }, async (context) => {
  const imageId = "30000000-0000-4000-8000-000000000001";
  const changes: string[] = [];
  const requests: { purpose: string; mimeType: string; fileSize: number }[] = [];
  const puts: { url: string; method?: string; contentType?: string }[] = [];
  requestUpload = async (input) => {
    requests.push({ purpose: input.purpose, mimeType: input.mimeType, fileSize: input.fileSize });
    return { success: true, mediaObjectId: imageId, deliveryUrl: `/api/media/${imageId}`, uploadUrl: `/api/media/upload/${imageId}`, uploadContentType: input.mimeType };
  };
  completeUpload = async (id) => ({ success: true, mediaObjectId: id, deliveryUrl: `/api/media/${id}` });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    puts.push({ url: String(url), method: init?.method, contentType: new Headers(init?.headers).get("content-type") ?? undefined });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    requestUpload = async () => ({ success: false, error: "업로드 테스트 미설정" });
    completeUpload = async () => ({ success: false, error: "업로드 테스트 미설정" });
  });

  await render(context, <FullEditor initialContent="<p>본문</p>" ariaLabel="본문" onChange={(html) => changes.push(html)} />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const input = browser.document.querySelector('input[type="file"]');
  assert.ok(input, "이미지 파일 선택 입력이 있다");
  assert.equal(input.getAttribute("accept"), "image/gif,image/jpeg,image/png,image/webp");
  const choose = async (files: File[]) => {
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => {
      input.dispatchEvent(new browser.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
  };

  await choose([new browser.File(["png"], "무대 사진.png", { type: "image/png" }) as unknown as File]);
  assert.deepEqual(requests, [{ purpose: "DOCUMENT_IMAGE", mimeType: "image/png", fileSize: 3 }]);
  assert.deepEqual(puts, [{ url: `/api/media/upload/${imageId}`, method: "PUT", contentType: "image/png" }]);
  assert.match(changes.at(-1) ?? "", new RegExp(`<img[^>]+src="/api/media/${imageId}"[^>]*alt="무대 사진"|<img[^>]+alt="무대 사진"[^>]*src="/api/media/${imageId}"`, "u"));

  await choose([new browser.File(["<svg/>"], "vector.svg", { type: "image/svg+xml" }) as unknown as File]);
  assert.equal(requests.length, 1, "허용하지 않는 형식은 서버에 요청하지 않는다");
  assert.match(browser.document.querySelector('[role="status"]')?.textContent ?? "", /JPG, PNG, GIF, WebP/u);

  const oversized = new browser.File(["x"], "big.png", { type: "image/png" }) as unknown as File;
  Object.defineProperty(oversized, "size", { value: 10 * 1024 * 1024 + 1 });
  await choose([oversized]);
  assert.equal(requests.length, 1, "10MB를 넘는 이미지는 서버에 요청하지 않는다");
  assert.match(browser.document.querySelector('[role="status"]')?.textContent ?? "", /10MB/u);
});

test("편집기 붙여넣기는 글과 함께 온 미리보기 그림을 올리지 않고 그림만 있을 때 올린다", () => {
  const image = new browser.File(["png"], "shot.png", { type: "image/png" }) as unknown as File;
  assert.equal(pastedEditorImageFiles({ types: ["text/html", "Files"], files: [image] }), null);
  assert.equal(pastedEditorImageFiles({ types: ["text/plain", "Files"], files: [image] }), null);
  assert.deepEqual(pastedEditorImageFiles({ types: ["Files"], files: [image] }), [image]);
  assert.equal(pastedEditorImageFiles({ types: ["Files"], files: [] }), null);
  assert.equal(pastedEditorImageFiles(null), null);
});

function mockEditorImageUpload(context: TestContext) {
  const releases: ((value: Awaited<ReturnType<typeof completeUpload>>) => void)[] = [];
  const abandoned: string[] = [];
  let issued = 0;
  requestUpload = async (input) => {
    issued += 1;
    const id = `30000000-0000-4000-8000-${String(issued).padStart(12, "0")}`;
    return { success: true, mediaObjectId: id, deliveryUrl: `/api/media/${id}`, uploadUrl: `/api/media/upload/${id}`, uploadContentType: input.mimeType };
  };
  completeUpload = async (id) => new Promise((resolve) => {
    releases.push(() => resolve({ success: true, mediaObjectId: id, deliveryUrl: `/api/media/${id}` }));
  });
  abandonUpload = async (id) => { abandoned.push(id); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    requestUpload = async () => ({ success: false, error: "업로드 테스트 미설정" });
    completeUpload = async () => ({ success: false, error: "업로드 테스트 미설정" });
    abandonUpload = async () => {};
  });
  return { releases, abandoned };
}

async function chooseEditorImage() {
  const input = browser.document.querySelector('input[type="file"]');
  assert.ok(input);
  Object.defineProperty(input, "files", { configurable: true, value: [new browser.File(["png"], "photo.png", { type: "image/png" })] });
  await act(async () => {
    input.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

const settleEditor = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });

test("FullEditor는 업로드 중 본문이 다른 초안으로 바뀌면 늦게 끝난 이미지를 넣지 않고 버린다", { concurrency: false }, async (context) => {
  const { releases, abandoned } = mockEditorImageUpload(context);
  const changes: string[] = [];
  const uploading: boolean[] = [];
  const screen = (version: number, content: string) => <FullEditor initialContent={content} contentVersion={version} ariaLabel="본문" onChange={(html) => changes.push(html)} onUploadingChange={(value) => uploading.push(value)} />;
  const root = await render(context, screen(0, "<p>초안 A</p>"));
  await settleEditor();
  await chooseEditorImage();
  assert.equal(uploading.at(-1), true, "올리는 동안 상위 form에 알린다");
  await act(async () => root.render(screen(1, "<p>복원한 초안 B</p>")));
  await act(async () => { releases[0]?.(undefined as never); await new Promise((resolve) => setTimeout(resolve, 10)); });
  await settleEditor();
  assert.deepEqual(abandoned, ["30000000-0000-4000-8000-000000000001"]);
  assert.equal(changes.some((html) => html.includes("<img")), false);
  assert.equal(uploading.at(-1), false);
});

test("FullEditor는 잠긴 동안 끝난 업로드를 잠금이 풀린 뒤 넣는다", { concurrency: false }, async (context) => {
  const { releases, abandoned } = mockEditorImageUpload(context);
  const changes: string[] = [];
  const uploading: boolean[] = [];
  const screen = (disabled: boolean) => <FullEditor initialContent="<p>본문</p>" ariaLabel="본문" disabled={disabled} onChange={(html) => changes.push(html)} onUploadingChange={(value) => uploading.push(value)} />;
  const root = await render(context, screen(false));
  await settleEditor();
  await chooseEditorImage();
  await act(async () => root.render(screen(true)));
  await act(async () => { releases[0]?.(undefined as never); await new Promise((resolve) => setTimeout(resolve, 10)); });
  await settleEditor();
  assert.equal(changes.some((html) => html.includes("<img")), false, "잠긴 동안에는 본문을 바꾸지 않는다");
  assert.equal(uploading.at(-1), true, "넣기를 기다리는 동안에도 제출을 막는다");
  await act(async () => root.render(screen(false)));
  await settleEditor();
  assert.match(changes.at(-1) ?? "", /<img[^>]+src="\/api\/media\/30000000-0000-4000-8000-000000000001"/u);
  assert.equal(uploading.at(-1), false);
  assert.deepEqual(abandoned, []);
});

test("FullEditor는 빈 본문에 여러 장을 차례로 넣어도 앞 이미지를 바꾸지 않는다", { concurrency: false }, async (context) => {
  const { releases } = mockEditorImageUpload(context);
  const changes: string[] = [];
  await render(context, <FullEditor initialContent="" ariaLabel="본문" onChange={(html) => changes.push(html)} />);
  await settleEditor();
  const input = browser.document.querySelector('input[type="file"]');
  assert.ok(input);
  Object.defineProperty(input, "files", { configurable: true, value: [
    new browser.File(["a"], "first.png", { type: "image/png" }),
    new browser.File(["b"], "second.png", { type: "image/png" }),
  ] });
  await act(async () => {
    input.dispatchEvent(new browser.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await act(async () => { releases[0]?.(undefined as never); await new Promise((resolve) => setTimeout(resolve, 10)); });
  await act(async () => { releases[1]?.(undefined as never); await new Promise((resolve) => setTimeout(resolve, 10)); });
  await settleEditor();
  const html = changes.at(-1) ?? "";
  const sources = [...html.matchAll(/<img[^>]+src="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(sources, [
    "/api/media/30000000-0000-4000-8000-000000000001",
    "/api/media/30000000-0000-4000-8000-000000000002",
  ]);
});

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
    // 돌아온 직후 중단된 이전 요청 때문에 선택 버튼이 잠겨 보이면 안 된다.
    assert.equal(button("파일 선택").disabled, false);
    assert.notEqual(button("파일 선택").getAttribute("aria-busy"), "true");
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

test("portal sections follow the URL from sidebar navigation and keep each section's scroll", async (context) => {
  browser.history.replaceState({ marker: "keep" }, "", "?section=workspace");
  browser.localStorage.setItem("test:section", "community");
  const items = ["today", "workspace", "community"].map((id) => ({ id }));
  await render(context, (
    <PortalShell items={items} initialItem="today" storageKey="test:section" urlParamKey="section" ariaLabel="포털">
      {(active) => <p data-testid="section">{active}</p>}
    </PortalShell>
  ));
  const section = () => browser.document.querySelector('[data-testid="section"]')?.textContent;
  assert.equal(section(), "workspace");
  const region = browser.document.querySelector('[role="region"]');
  assert.ok(region);
  await act(async () => {
    region.scrollTop = 180;
    region.dispatchEvent(new browser.Event("scroll"));
  });
  await act(async () => {
    assert.equal(navigateWithinPage(`${browser.location.pathname}?section=community`), true);
  });
  assert.equal(section(), "community");
  assert.equal(region.scrollTop, 0);
  assert.deepEqual(browser.history.state, { marker: "keep" });
  await act(async () => {
    browser.history.replaceState(browser.history.state, "", "?section=workspace");
    browser.dispatchEvent(new browser.PopStateEvent("popstate"));
  });
  assert.equal(section(), "workspace");
  assert.equal(region.scrollTop, 180);
  assert.equal(navigateWithinPage("/elsewhere-route?section=today"), false);
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

test("admin lesson booking from the calendar keeps the chosen time on failure and adds the lesson", async (context) => {
  const created: UnifiedItem[] = [];
  const requests: { studentId: string; scheduledAt: unknown }[] = [];
  saveLesson = async (studentId, _previous, data) => {
    requests.push({ studentId, scheduledAt: data.get("scheduledAt") });
    return { error: "유효하지 않은 날짜입니다." };
  };
  context.after(() => { saveLesson = async () => ({}); });
  await render(context, <CreateEntryDropdown studentId="student-1" diggingColumns={[]} spaceLabel="민지" defaultDate="2026-10-09T09:00"
    canCreateQna={false} canCreateEvent={false} canCreateDigging={false} canCreateLesson onSuccess={(item) => created.push(item)} />);
  await act(async () => {
    button("새 항목 추가").focus();
    button("새 항목 추가").dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  await settle();
  const item = browser.document.querySelector('[role="menuitem"]');
  assert.match(item?.textContent ?? "", /레슨 예약/u);
  await act(async () => { item!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
  assert.equal(inputValue("scheduledAt"), "2026-10-09T09:00", "선택한 날짜와 기본 시각으로 시작한다");
  await fill("lesson-schedule-start", "2026-10-09T19:30");
  await press("레슨 저장");
  assert.equal(browser.document.querySelector('[role="alert"]')?.textContent, "유효하지 않은 날짜입니다.");
  assert.equal(inputValue("scheduledAt"), "2026-10-09T19:30");
  assert.deepEqual(requests[0], { studentId: "student-1", scheduledAt: "2026-10-09T19:30" });

  saveLesson = async () => ({ success: true, lesson: { id: "lesson-9", scheduledAt: "2026-10-09T10:30:00.000Z" } });
  await press("레슨 저장");
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  assert.deepEqual(created.map((entry) => [entry.id, entry.subType, entry.source.entity, entry.space.studentId]), [["lesson-9", "LESSON", "LESSON", "student-1"]]);
});

test("admin lesson detail reschedules and deletes only after a cancel-first confirmation", async (context) => {
  const lesson: UnifiedItem = {
    id: "lesson-1", type: "EVENT", subType: "LESSON", title: "레슨", date: new Date("2026-10-09T10:00:00.000Z"), endDate: null, metadata: {},
    space: { studentId: "student-1", label: "민지" }, source: { kind: "PORTAL", entity: "LESSON", label: "포털" },
  };
  const updates: UnifiedItem[] = [];
  const removals: string[] = [];
  moveLesson = async (lessonId, studentId, _previous, data) => {
    assert.deepEqual([lessonId, studentId], ["lesson-1", "student-1"]);
    return { success: true, lesson: { id: lessonId, scheduledAt: new Date(`${String(data.get("scheduledAt"))}:00+09:00`).toISOString() } };
  };
  removeLesson = async () => { throw new Error("offline"); };
  context.after(() => { moveLesson = async () => ({}); removeLesson = async () => {}; });
  await render(context, <LessonActions item={lesson} onUpdated={(next) => updates.push(next)} onDeleted={(removed) => removals.push(removed.id)} />);

  await press("레슨 시간 변경");
  assert.equal(inputValue("scheduledAt"), "2026-10-09T19:00");
  await fill("lesson-reschedule-lesson-1", "2026-10-10T20:00");
  await press("저장");
  assert.equal(updates[0]?.date.toISOString(), "2026-10-10T11:00:00.000Z");
  assert.equal(browser.document.querySelector('[role="status"]')?.textContent, "레슨 시간을 변경했습니다.");

  await press("레슨 삭제");
  assert.equal(browser.document.activeElement?.textContent, "취소");
  await press("삭제");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /삭제하지 못했습니다/u);
  removeLesson = async () => {};
  await press("삭제");
  assert.deepEqual(removals, ["lesson-1"]);
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
  await act(async () => { navigateWithinPage("/dashboard/admin?section=work&student=student"); });
  await settle();
  await act(async () => { navigateWithinPage("/dashboard/admin?section=schedule&view=calendar&student=student"); });
  await settle();
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
  // 구역 이동은 사이드바가 맡고, 화면은 주소의 보기를 제목으로 바로 그린다.
  assert.equal(markup.querySelector("h1")?.textContent, "커리큘럼");

  const students = ["first", "requested"].map((id) => ({ id, email: `${id}@example.test`, displayName: id, createdAt: null, currentModule: null, nextLessonDate: null, pendingFeedbackCount: 0 }));
  const admin = <AdminPortalClient
    initialLocation={resolvePortalLocation("admin", { section: "schedule", view: "all", type: "NOTE" })}
    initialStudentId="requested" students={students} initialUnifiedItems={[]}
    announcements={[]} communityPosts={[]} adminId="admin" qnaThreads={[]} pendingAssignments={[]} referenceTime={new Date()}
  />;
  markup.innerHTML = renderToString(admin);
  assert.equal(markup.querySelector("h1")?.textContent, "일정");
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
  const assignmentLink = (id: string) => browser.document.querySelector(`a[href="/dashboard/student/assignments/${id}?returnTo=%2Fdashboard%2Fstudent%3Fsection%3Dtoday"]`);
  const root = await render(context, portal([item]));
  assert.ok(assignmentLink("before"));
  await act(async () => root.render(portal([{ ...item, id: "after" }])));
  assert.ok(assignmentLink("after"));
  assert.equal(assignmentLink("before"), null);
  await act(async () => root.render(portal([])));
  assert.equal(assignmentLink("after"), null);
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

test("own calendar event edit keeps input on failure and delete confirms before removing", async (context) => {
  const item: UnifiedItem = {
    id: "event-1", type: "EVENT", subType: "PRACTICE", title: "리듬 연습", description: "기존 메모",
    date: new Date("2026-10-09T01:00:00.000Z"), endDate: new Date("2026-10-09T02:00:00.000Z"), metadata: {},
    space: { studentId: "student", label: "학생" }, source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포털" },
  };
  const updates: UnifiedItem[] = [];
  const removals: UnifiedItem[] = [];
  const busy: boolean[] = [];
  const submitted: FormData[] = [];
  editEvent = async (_previous, data) => { submitted.push(data); return { error: "종료 시간은 시작 시간 이후여야 합니다." }; };
  removeEvent = async () => { throw new Error("offline"); };
  context.after(() => { editEvent = async () => ({}); removeEvent = async () => {}; });
  await render(context, <CalendarEventActions item={item} onUpdated={(next) => updates.push(next)} onDeleted={(removed) => removals.push(removed)} onBusyChange={(value) => busy.push(value)} />);

  await press("일정 수정");
  assert.equal((browser.document.getElementById("event-edit-event-1-title") as unknown as HTMLInputElement).value, "리듬 연습");
  assert.equal((browser.document.getElementById("event-edit-event-1-start") as unknown as HTMLInputElement).value, "2026-10-09T10:00");
  await fill("event-edit-event-1-title", "리듬 연습 2");
  await press("저장");
  assert.equal(browser.document.querySelector('[role="alert"]')?.textContent, "종료 시간은 시작 시간 이후여야 합니다.");
  assert.equal((browser.document.getElementById("event-edit-event-1-title") as unknown as HTMLInputElement).value, "리듬 연습 2");
  assert.equal(submitted[0]?.get("eventId"), "event-1");
  assert.equal(updates.length, 0);
  assert.ok(busy.includes(true), "save locks the surrounding panel");

  editEvent = async (_previous, data) => ({ id: "event-1", event: {
    id: "event-1", title: String(data.get("title")), eventType: "PRACTICE",
    startTime: "2026-10-09T01:00:00.000Z", endTime: "2026-10-09T02:00:00.000Z", description: "기존 메모",
  } });
  await press("저장");
  assert.equal(updates[0]?.title, "리듬 연습 2");
  assert.equal(browser.document.querySelector('[role="status"]')?.textContent, "일정을 저장했습니다.");
  assert.equal(busy.at(-1), false);

  await press("일정 삭제");
  assert.equal(browser.document.activeElement?.textContent, "취소", "irreversible delete starts on cancel");
  await press("삭제");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /삭제하지 못했습니다/u);
  assert.equal(removals.length, 0);
  removeEvent = async () => {};
  await press("삭제");
  assert.deepEqual(removals.map((removed) => removed.id), ["event-1"]);
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

test("digging board saves only changed cells, clears numbers and ratings without coercing to zero", async (context) => {
  const saves: [string, string, unknown][] = [];
  saveTrackValue = async (trackId, columnId, value) => { saves.push([trackId, columnId, value]); };
  context.after(() => { saveTrackValue = async () => {}; });
  await render(context, <DiggingBoard
    initialColumns={[
      { id: "title", name: "트랙명", columnType: "text", options: null, isDefault: true, sortOrder: 0 },
      { id: "bpm", name: "BPM", columnType: "number", options: null, isDefault: false, sortOrder: 1 },
      { id: "rating", name: "별점", columnType: "rating", options: null, isDefault: true, sortOrder: 2 },
    ]}
    initialTracks={[{ id: "track-1", linkUrl: null, createdAt: new Date("2026-10-09T01:00:00.000Z"), values: { title: "Intro", bpm: 124, rating: 3 } }]}
  />);
  const desktopInput = (label: string) => {
    const input = browser.document.querySelector(`table input[aria-label="${label}"]`);
    assert.ok(input instanceof browser.HTMLInputElement);
    return input;
  };
  const blur = async (input: ReturnType<typeof desktopInput>) => act(async () => {
    input.dispatchEvent(new browser.FocusEvent("focusout", { bubbles: true }));
    input.dispatchEvent(new browser.FocusEvent("blur"));
  });

  await blur(desktopInput("트랙명"));
  await settle();
  assert.deepEqual(saves, [], "focus leaving an unchanged cell does not save");

  const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")?.set;
  assert.ok(setter);
  const bpm = desktopInput("BPM");
  await act(async () => {
    setter.call(bpm, "");
    bpm.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  await blur(bpm);
  await settle();
  assert.deepEqual(saves.at(-1), ["track-1", "bpm", ""], "clearing a number stores empty, not 0");

  const ratingGroup = browser.document.querySelector('table [role="radiogroup"][aria-label="별점"]');
  assert.ok(ratingGroup);
  const selectedStar = [...ratingGroup.querySelectorAll("button")].find((star) => star.getAttribute("aria-checked") === "true");
  assert.ok(selectedStar);
  await act(async () => selectedStar.click());
  await settle();
  assert.deepEqual(saves.at(-1), ["track-1", "rating", ""], "pressing the selected star clears the rating");
});

test("curriculum rolls back failed optimistic completion and allows a successful retry", async (context) => {
  const pending = Promise.withResolvers<void>();
  toggleModule = async () => pending.promise;
  context.after(() => { pending.resolve(); toggleModule = async () => {}; });
  await render(context, <CurriculumView initialModules={[{ id: "module", weekNum: 1, title: "비트 매칭", description: null, isCompleted: false }]} />);
  assert.equal(button("비트 매칭 완료").getAttribute("aria-pressed"), "false");
  await press("비트 매칭 완료");
  assert.equal(browser.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "100");
  assert.equal(button("비트 매칭 완료").disabled, true);
  await act(async () => pending.reject(new Error("offline")));
  await settle();
  assert.equal(browser.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "0");
  assert.equal(button("비트 매칭 완료").getAttribute("aria-pressed"), "false");
  assert.ok(browser.document.querySelector('[role="alert"]'));
  toggleModule = async () => {};
  await press("비트 매칭 완료");
  assert.equal(button("비트 매칭 완료").getAttribute("aria-pressed"), "true");
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

test("media players expose the playback position only while ready and release the reader", async (context) => {
  const readers: (null | (() => Promise<number | null>))[] = [];
  const track = (reader: (() => Promise<number | null>) | null) => { readers.push(reader); };
  const url = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
  const root = await render(context, <VideoPlayer url={url} onPositionReaderChange={track} />);
  const reader = readers.at(-1);
  assert.ok(reader);
  assert.equal(await reader(), null, "metadata 전에는 위치를 추정하지 않는다");
  const video = browser.document.querySelector("video");
  assert.ok(video);
  await act(async () => { video.dispatchEvent(new browser.Event("loadedmetadata")); });
  video.currentTime = 2715.4;
  assert.equal(await reader(), 2715.4);
  await act(async () => root.render(<div />));
  assert.equal(readers.at(-1), null, "unmount 뒤에는 오래된 player를 읽지 않는다");
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
  }, seekTo: (value: number) => seeks.push(value), play: () => { plays++; }, pause: () => { pauses++; },
  getPosition: (callback: (milliseconds: number) => void) => callback(125_500) };
  Object.defineProperty(browser, "SC", { configurable: true, value: { Widget: Object.assign((frame: HTMLIFrameElement) => { widgetFrame = frame; return widget; }, { Events: { READY: "ready", ERROR: "error" } }) } });
  context.after(() => Reflect.deleteProperty(browser, "SC"));
  const url = "https://soundcloud.com/artist/mix";
  let positionReader: (() => Promise<number | null>) | null = null;
  const trackReader = (reader: (() => Promise<number | null>) | null) => { positionReader = reader; };
  const root = await render(context, <VideoPlayer url={url} seekRequest={{ seconds: 90 }} onPositionReaderChange={trackReader} />);
  const iframe = browser.document.querySelector("iframe");
  assert.ok(iframe);
  assert.equal(new URL(iframe.src).searchParams.get("url"), url);
  assert.deepEqual(seeks, []);
  const ready = listeners.get("ready");
  assert.ok(ready);
  assert.equal(await positionReader!(), null, "widget READY 전에는 위치를 읽지 않는다");
  await act(async () => ready());
  assert.deepEqual(seeks, [90000]);
  assert.equal(await positionReader!(), 125.5, "widget milliseconds를 초로 바꾼다");
  await act(async () => root.render(<VideoPlayer url={url} seekRequest={{ seconds: 90 }} onPositionReaderChange={trackReader} />));
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

test("feedback time can be filled from the current playback position", async (context) => {
  let position: number | null = null;
  await render(context, <TimelineFeedback assignmentId="position" actorId="admin-1" feedbackList={[]} isAdmin readPlaybackPosition={async () => position} />);
  await press("현재 위치");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /재생 위치를 읽지 못했습니다/u);
  assert.equal(inputValue("timeMarker"), "");
  position = 2715.9;
  await press("현재 위치");
  assert.equal(inputValue("timeMarker"), "45:15", "초 단위 내림으로 MM:SS를 채운다");
  assert.equal(browser.document.activeElement?.id, "feedback-content", "이어서 피드백 내용을 입력한다");
  assert.equal(browser.document.querySelector('[role="alert"]'), null);
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
  const deletePost = async () => {
    await press("게시물 삭제");
    await press("휴지통 이동 확인");
  };
  const requests: Parameters<typeof trashPost>[] = [];
  trashPost = async (...args) => { requests.push(args); throw new Error("response lost"); };
  context.after(() => { trashPost = async () => ({ success: true }); });
  const post = {
    id: "delete-retry-post", authorId: "student-1", title: "레슨 이야기", contentHtml: "<p>본문</p>",
    category: "general", boardType: "GENERAL" as const, isPinned: false, mediaUrl: null,
    mediaObjectId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    deletedById: null, version: 1, authorName: "학생", authorEmail: null,
  };
  const screen = (version: number, deletedAt: Date | null = null) => <PostDetailClient postId={post.id} post={{ ...post, version, deletedAt }} initialCommentList={[]} currentUserId="student-1" isAdmin={false} returnTo="/community" />;
  const root = await render(context, screen(1));
  await deletePost();
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /휴지통으로 이동하지 못했습니다/u);
  await deletePost();
  assert.equal(requests[0][1], requests[1][1]);
  await act(async () => root.render(screen(2, new Date())));
  await act(async () => root.render(screen(3)));
  await deletePost();
  assert.notEqual(requests[1][1], requests[2][1]);
  assert.deepEqual(requests.map((args) => args[2]), [1, 1, 3]);

  // 서버가 돌려준 충돌 안내는 production에서도 그대로 보여 준다.
  trashPost = async () => ({ success: false, error: "다른 화면에서 이 게시물이 먼저 변경되었습니다. 현재 초안은 유지됩니다." });
  await deletePost();
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /먼저 변경되었습니다/u);
});

test("failed comment deletion keeps the conversation and unfinished reply visible", async (context) => {
  browser.localStorage.clear();
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
  assert.equal(browser.document.activeElement?.textContent, "취소", "확인은 취소에서 시작한다");
  await press("댓글 삭제 확인");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /댓글을 삭제하지 못했습니다/);
  assert.equal(browser.document.activeElement?.getAttribute("aria-label"), "학생 댓글 삭제", "실패 뒤 확인을 연 버튼으로 돌아간다");
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

test("failed login keeps the email and return target and moves focus to the password", async (context) => {
  const submitted: { email: string; callbackUrl: string }[] = [];
  login = async (_previous, data) => {
    submitted.push({ email: String(data.get("email")), callbackUrl: String(data.get("callbackUrl")) });
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다.", email: String(data.get("email")) };
  };
  context.after(() => { login = async () => ({}); });
  await render(context, <LoginForm callbackUrl="https://portal.test/dashboard/qna/thread-1" />);
  await fill("email", "student@example.com");
  await fill("password", "wrong-password");
  await press("로그인");
  assert.deepEqual(submitted, [{ email: "student@example.com", callbackUrl: "https://portal.test/dashboard/qna/thread-1" }]);
  assert.equal(inputValue("email"), "student@example.com");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /올바르지 않습니다/u);
  assert.equal(browser.document.activeElement, browser.document.getElementById("password"));
});

test("community shows the server-loaded list first and explains a board without channels", async (context) => {
  const requests: string[] = [];
  loadCommunityPage = async ({ boardType, category }) => {
    requests.push(boardType === "GENERAL" ? `GENERAL:${category}` : boardType);
    return { posts: [], nextCursor: null };
  };
  context.after(() => { loadCommunityPage = async () => ({ posts: [], nextCursor: null }); });
  const category = { id: "category-1", slug: "general", name: "자유", description: null, sortOrder: 0, createdAt: null };
  const post = {
    id: "post-1", authorId: "student-1", category: "general", boardType: "GENERAL" as const, isPinned: false,
    mediaUrl: null, mediaObjectId: null, title: "레슨 후기", contentHtml: "<p>오늘 배운 것</p>",
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null, version: 1,
    authorName: "학생", authorEmail: null,
  };
  const previousUrl = browser.location.href;
  context.after(() => browser.history.replaceState({}, "", previousUrl));
  browser.history.replaceState({}, "", "/community?boardType=GENERAL&category=general");
  const root = await render(context, <CommunityClient isAdmin={false} initial={{ boardType: "GENERAL", category: "general", categories: [category], posts: [post], nextCursor: null }} />);
  assert.match(browser.document.body.textContent ?? "", /레슨 후기/u);
  assert.doesNotMatch(browser.document.body.textContent ?? "", /아직 게시물이 없습니다/u);
  assert.equal(requests.length, 0, "server list is not fetched again on mount");

  await press("믹스셋");
  assert.deepEqual(requests, ["FEEDBACK"]);
  assert.match(browser.document.body.textContent ?? "", /공유된 믹스셋이 없습니다/u);

  // 응답 전에 이미 받은 목록으로 돌아오면 취소된 요청 때문에 skeleton에 머물지 않는다.
  const pendingAnnouncements = Promise.withResolvers<Awaited<ReturnType<typeof loadCommunityPage>>>();
  loadCommunityPage = async ({ boardType }) => { requests.push(boardType); return pendingAnnouncements.promise; };
  await press("공지");
  assert.ok(browser.document.querySelector('[aria-label="게시물을 불러오는 중"]'));
  await press("믹스셋");
  assert.equal(browser.document.querySelector('[aria-label="게시물을 불러오는 중"]'), null);
  assert.match(browser.document.body.textContent ?? "", /공유된 믹스셋이 없습니다/u);
  pendingAnnouncements.resolve({ posts: [], nextCursor: null });
  await settle();
  assert.match(browser.document.body.textContent ?? "", /공유된 믹스셋이 없습니다/u);

  browser.history.replaceState({}, "", "/community");
  await act(async () => root.render(<CommunityClient key="empty" isAdmin initial={{ boardType: "GENERAL", category: "", categories: [], posts: [], nextCursor: null }} />));
  await settle();
  assert.ok([...browser.document.querySelectorAll("a")].some((anchor) => anchor.getAttribute("href") === "/dashboard/admin/categories" && anchor.textContent === "채널 추가하기"));
  assert.equal([...browser.document.querySelectorAll("a")].some((anchor) => anchor.textContent === "새 글"), false);
});

test("community load-more appends the next page once and stops at the last page", async (context) => {
  const cursors: (string | null | undefined)[] = [];
  const makePost = (index: number) => ({
    id: `post-${index}`, authorId: "student-1", category: "general", boardType: "GENERAL" as const, isPinned: false,
    mediaUrl: null, mediaObjectId: null, title: `기록 ${index}`, contentHtml: "<p>본문</p>",
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null, version: 1, authorName: "학생", authorEmail: null,
  });
  loadCommunityPage = async ({ cursor }) => {
    cursors.push(cursor);
    // 같은 게시물이 다시 와도 한 번만 보인다.
    return { posts: [makePost(2), makePost(3)], nextCursor: null };
  };
  context.after(() => { loadCommunityPage = async () => ({ posts: [], nextCursor: null }); });
  const previousUrl = browser.location.href;
  context.after(() => browser.history.replaceState({}, "", previousUrl));
  browser.history.replaceState({}, "", "/community?boardType=GENERAL&category=general");
  const category = { id: "category-1", slug: "general", name: "자유", description: null, sortOrder: 0, createdAt: null };
  await render(context, <CommunityClient isAdmin={false} initial={{ boardType: "GENERAL", category: "general", categories: [category], posts: [makePost(1), makePost(2)], nextCursor: "cursor-1" }} />);
  assert.match(browser.document.getElementById("community-list-count")?.textContent ?? "", /2개/u);
  await press("게시물 더 보기");
  assert.deepEqual(cursors, ["cursor-1"]);
  const titles = [...browser.document.querySelectorAll("a")].map((anchor) => anchor.textContent ?? "").filter((text) => text.includes("기록"));
  assert.equal(titles.length, 3, "post-2 is not duplicated");
  assert.equal(browser.document.getElementById("community-list-count"), null, "no more button after the last page");
});

test("a submission without feedback is deleted only after a cancel-first confirmation", async (context) => {
  const requests: string[] = [];
  removeAssignment = async (assignmentId) => {
    requests.push(assignmentId);
    return requests.length === 1
      ? { success: false, error: "피드백이 등록된 제출은 삭제할 수 없습니다. 필요하면 강사에게 문의해 주세요." }
      : { success: true };
  };
  context.after(() => { removeAssignment = async () => ({ success: true }); });
  await render(context, <AssignmentView initialAssignments={[{ id: "mistake", mediaUrl: "https://youtu.be/aqz-KE-bpKQ", submittedAt: new Date(), feedbackCount: 0 }]} />);
  const listItem = [...browser.document.querySelectorAll("button")].find((element) => element.textContent?.includes("YouTube 믹스셋"));
  assert.ok(listItem);
  await act(async () => listItem.click());
  await settle();
  await press("제출 삭제");
  assert.equal(browser.document.activeElement?.textContent, "취소", "focus starts on the safe choice");
  assert.deepEqual(requests, []);
  await press("삭제");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /피드백이 등록된 제출/u);
  assert.ok(browser.document.querySelector('[aria-label="제출 삭제 확인"]'), "the confirmation stays open after a refusal");
  await press("삭제");
  assert.deepEqual(requests, ["mistake", "mistake"]);
  assert.match(browser.document.querySelector('[role="status"]')?.textContent ?? "", /제출을 삭제했습니다/u);
  assert.equal([...browser.document.querySelectorAll("button")].some((element) => element.textContent?.includes("YouTube 믹스셋")), false);
});

test("admin module edit keeps input on refusal and returns focus to the row after saving", async (context) => {
  const requests: [string, string, string | null, string | null][] = [];
  editModule = async (moduleId, studentId, _previous, data) => {
    requests.push([moduleId, studentId, data.get("weekNum") as string | null, data.get("title") as string | null]);
    return requests.length === 1 ? { error: "주차는 1부터 520 사이의 정수로 입력해 주세요." } : { success: true };
  };
  context.after(() => { editModule = async () => ({ success: true }); });
  await render(context, <OverviewTab studentId="student-1" lessons={[]} modules={[{ id: "module-1", weekNum: 1, title: "비트 매칭", isCompleted: true }]} />);
  await press("비트 매칭 모듈 수정");
  assert.equal(browser.document.activeElement, browser.document.getElementById("module-edit-module-1-title"));
  await fill("module-edit-module-1-title", "EQ 전환");
  await press("저장");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /주차는/u);
  assert.equal((browser.document.getElementById("module-edit-module-1-title") as unknown as HTMLInputElement).value, "EQ 전환");
  await press("저장");
  await act(async () => { await new Promise((resolve) => browser.requestAnimationFrame(() => resolve(undefined))); });
  assert.deepEqual(requests, [["module-1", "student-1", "1", "EQ 전환"], ["module-1", "student-1", "1", "EQ 전환"]]);
  assert.equal(browser.document.getElementById("module-edit-module-1-title"), null);
  assert.equal(browser.document.activeElement, browser.document.getElementById("module-edit-trigger-module-1"));
});

test("password change keeps typed values on a refused field and confirms success without leaving secrets", async (context) => {
  const submitted: string[] = [];
  changePassword = async (_previous, data) => {
    submitted.push(String(data.get("currentPassword")));
    return submitted.length === 1
      ? { error: "현재 비밀번호가 올바르지 않습니다.", field: "currentPassword" }
      : { success: true };
  };
  context.after(() => { changePassword = async () => ({ success: true }); });
  await render(context, <PasswordChangeControl />);
  await press("비밀번호 변경");
  const inputs = () => [...browser.document.querySelectorAll('[role="dialog"] input[type="password"]')]
    .filter((element) => element instanceof browser.HTMLInputElement) as InstanceType<typeof browser.HTMLInputElement>[];
  assert.equal(inputs().length, 3);
  const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")?.set;
  for (const [index, value] of ["wrong-password", "second-password", "second-password"].entries()) {
    await act(async () => {
      setter?.call(inputs()[index], value);
      inputs()[index].dispatchEvent(new browser.Event("input", { bubbles: true }));
    });
  }
  const submit = () => browser.document.querySelector('[role="dialog"] button[type="submit"]') as InstanceType<typeof browser.HTMLButtonElement>;
  await act(async () => submit().click());
  await settle();
  assert.match(browser.document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? "", /현재 비밀번호가 올바르지 않습니다/u);
  assert.equal(browser.document.activeElement, inputs()[0]);
  assert.equal(inputs()[0].getAttribute("aria-invalid"), "true");
  assert.deepEqual(inputs().map((input) => input.value), ["wrong-password", "second-password", "second-password"]);

  await act(async () => {
    setter?.call(inputs()[0], "first-password");
    inputs()[0].dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  await act(async () => submit().click());
  await settle();
  assert.deepEqual(submitted, ["wrong-password", "first-password"]);
  assert.match(browser.document.querySelector('[role="dialog"] [role="status"]')?.textContent ?? "", /비밀번호를 변경했습니다/u);
  assert.equal(inputs().length, 0, "the success view no longer holds the typed passwords");
});

test("required password change asks for the temporary password and enters the portal once saved", async (context) => {
  const submitted: string[][] = [];
  changePassword = async (_previous, data) => {
    submitted.push(["currentPassword", "newPassword", "confirmPassword"].map((name) => String(data.get(name))));
    return { success: true };
  };
  context.after(() => { changePassword = async () => ({ success: true }); });
  let entered = 0;
  await render(context, <PasswordChangeForm variant="required" onDone={() => { entered += 1; }} />);
  const labels = [...browser.document.querySelectorAll("label")].map((label) => label.textContent);
  assert.deepEqual(labels, ["임시 비밀번호", "새 비밀번호", "새 비밀번호 확인"]);
  for (const [name, value] of [["currentPassword", "abcd-efgh-jkmn"], ["newPassword", "my-new-password"], ["confirmPassword", "my-new-password"]]) {
    await fill(name, value);
  }
  await press("새 비밀번호 저장");
  assert.deepEqual(submitted, [["abcd-efgh-jkmn", "my-new-password", "my-new-password"]]);
  assert.match(browser.document.querySelector('[role="status"]')?.textContent ?? "", /새 비밀번호를 저장했습니다\. 포털로 이동합니다/u);
  assert.equal(browser.document.querySelectorAll('input[type="password"]').length, 0);
  assert.equal(entered, 1, "the saved login opens the portal without another click");
  await settle();
  assert.equal(entered, 1, "re-renders never navigate twice");
});

test("student password reset confirms first and shows the temporary password only once", async (context) => {
  const issued: string[] = [];
  resetPassword = async (studentId) => { issued.push(studentId); return `temp-${issued.length}`; };
  context.after(() => { resetPassword = async () => "abcd-efgh-jkmn"; });

  const root = await render(context, <StudentPasswordResetControl studentId="student-1" />);
  await press("임시 비밀번호 발급");
  assert.deepEqual(issued, [], "issuing expires the student's password, so it never runs on the first click");
  assert.equal(browser.document.activeElement?.textContent, "취소");
  assert.match(browser.document.body.textContent ?? "", /모든 기기의 로그인이 즉시 만료됩니다/u);
  await press("임시 비밀번호 발급 확인");
  assert.deepEqual(issued, ["student-1"]);
  assert.equal(browser.document.querySelector("code")?.textContent, "temp-1");
  button("임시 비밀번호 다시 발급");

  await act(async () => root.render(<StudentPasswordResetControl key="pending" studentId="student-2" changePending />));
  assert.equal(browser.document.querySelector("code"), null, "a reloaded screen never shows an earlier temporary password");
  assert.match(browser.document.body.textContent ?? "", /학생이 아직 바꾸지 않았습니다/u);
  await press("임시 비밀번호 다시 발급");
  await press("임시 비밀번호 발급 확인");
  assert.deepEqual(issued, ["student-1", "student-2"]);
  assert.equal(browser.document.querySelector("code")?.textContent, "temp-2");
});

test("creating a student shows the signup link once and starts a fresh form for the next student", async (context) => {
  const submitted: string[][] = [];
  createStudentAction = async (_previous, data) => {
    submitted.push([String(data.get("displayName")), String(data.get("email")), String(data.get("password"))]);
    return { created: { studentId: "student-9", displayName: "민지", invitePath: "/invite#student-9.secret-value" } };
  };
  context.after(() => { createStudentAction = async () => ({}); });
  await render(context, <NewStudentPage />);
  assert.equal(browser.document.querySelector('input[name="password"]'), null, "the admin never sets the student's password");
  await fill("displayName", "민지");
  await fill("email", "minji@example.com");
  await press("계정 생성");
  assert.deepEqual(submitted, [["민지", "minji@example.com", "null"]]);
  assert.equal(browser.document.querySelector("code")?.textContent, "https://portal.test/invite#student-9.secret-value");
  assert.equal(browser.document.activeElement?.id, "created-student-heading");
  const detail = [...browser.document.querySelectorAll("a")].find((link) => link.textContent === "학생 상세로 이동");
  assert.equal(detail?.getAttribute("href"), "/dashboard/admin/students/student-9?tab=overview");
  await press("다른 학생 추가");
  assert.equal(browser.document.querySelector("code"), null, "the link is not shown again");
  assert.equal((browser.document.getElementById("displayName") as InstanceType<typeof browser.HTMLInputElement> | null)?.value, "");
});

test("signup link checks the token, lets the student set a password and enters the portal once", async (context) => {
  const statusCalls: string[] = [];
  const submitted: string[][] = [];
  inviteStatus = async (token) => { statusCalls.push(token); return { status: "valid", displayName: "민지", email: "minji@example.com" }; };
  completeInviteAction = async (_previous, data) => {
    submitted.push(["token", "newPassword", "confirmPassword"].map((name) => String(data.get(name))));
    return submitted.length === 1 ? { error: "비밀번호 확인이 일치하지 않습니다.", field: "confirmPassword" } : { success: true };
  };
  context.after(() => {
    inviteStatus = async () => ({ status: "invalid" });
    completeInviteAction = async () => ({ success: true });
  });
  let entered = 0;
  await render(context, <InviteSignup readToken={() => "student-9.secret-value"} onSignedIn={() => { entered += 1; }} />);
  assert.deepEqual(statusCalls, ["student-9.secret-value"]);
  assert.match(browser.document.querySelector("h1")?.textContent ?? "", /민지님, 환영합니다/u);
  assert.match(browser.document.body.textContent ?? "", /minji@example\.com/u);
  const passwordInputs = () => [...browser.document.querySelectorAll('input[type="password"]')] as InstanceType<typeof browser.HTMLInputElement>[];
  await fill(passwordInputs()[0].id, "minji-pass-1");
  await fill(passwordInputs()[1].id, "different-1");
  await press("가입 완료");
  assert.equal(browser.document.activeElement, passwordInputs()[1]);
  assert.equal(passwordInputs()[1].getAttribute("aria-invalid"), "true");
  await fill(passwordInputs()[1].id, "minji-pass-1");
  await press("가입 완료");
  assert.deepEqual(submitted.at(-1), ["student-9.secret-value", "minji-pass-1", "minji-pass-1"]);
  assert.match(browser.document.querySelector('[role="status"]')?.textContent ?? "", /가입을 마쳤습니다/u);
  assert.equal(entered, 1);
  await settle();
  assert.equal(entered, 1);
});

test("signup link explains an expired or missing token without showing the form", async (context) => {
  inviteStatus = async () => ({ status: "expired" });
  context.after(() => { inviteStatus = async () => ({ status: "invalid" }); });
  const root = await render(context, <InviteSignup readToken={() => "student-9.old"} onSignedIn={() => undefined} />);
  assert.equal(browser.document.querySelector("h1")?.textContent, "가입 링크가 만료됐습니다");
  assert.equal(browser.document.querySelector('input[type="password"]'), null);
  assert.equal(browser.document.activeElement, browser.document.querySelector("h1"));
  await act(async () => root.render(<InviteSignup key="missing" readToken={() => ""} onSignedIn={() => undefined} />));
  await settle();
  assert.equal(browser.document.querySelector("h1")?.textContent, "가입 링크를 열 수 없습니다");
});

test("signup link reissue confirms first while a link is live and shows the new link once", async (context) => {
  const issued: string[] = [];
  reissueInvite = async (studentId) => { issued.push(studentId); return `/invite#${studentId}.new-${issued.length}`; };
  context.after(() => { reissueInvite = async () => "/invite#student-1.secret"; });
  const root = await render(context, <StudentInviteControl studentId="student-live" expiresAt={new Date("2026-10-21T03:00:00.000Z")} expired={false} />);
  assert.match(browser.document.body.textContent ?? "", /10월 21일/u);
  await press("가입 링크 다시 발급");
  assert.deepEqual(issued, [], "a live link is not broken on the first click");
  assert.equal(browser.document.activeElement?.textContent, "취소");
  await press("가입 링크 다시 발급 확인");
  assert.equal(browser.document.querySelector("code")?.textContent, "https://portal.test/invite#student-live.new-1");

  await act(async () => root.render(<StudentInviteControl key="expired" studentId="student-old" expiresAt={new Date("2026-10-01T03:00:00.000Z")} expired />));
  assert.match(browser.document.body.textContent ?? "", /가입 링크가 만료됐습니다/u);
  await press("가입 링크 다시 발급");
  assert.deepEqual(issued, ["student-live", "student-old"], "an expired link has nothing to break, so it is issued directly");
});

test("confirm panel starts on cancel, closes on Escape, and stays open only while the confirmed action runs", async (context) => {
  const { ConfirmPanel, useConfirmAction } = confirmActionModule;
  let runs = 0;
  let release: () => void = () => undefined;
  function Harness() {
    const confirm = useConfirmAction();
    const [isPending, startTransition] = useTransition();
    return <div>
      <button type="button" aria-expanded={confirm.isOpen} onClick={(event) => confirm.request(event.currentTarget)}>위험 작업</button>
      {confirm.isOpen ? <ConfirmPanel confirm={confirm} message="되돌릴 수 없습니다." confirmLabel="작업 확인" pendingLabel="처리 중..." pending={isPending}
        onConfirm={() => startTransition(async () => {
          runs += 1;
          await new Promise<void>((resolve) => { release = resolve; });
        })} /> : null}
    </div>;
  }
  await render(context, <Harness />);
  const panel = () => browser.document.querySelector('[role="group"][aria-labelledby]');

  await press("위험 작업");
  assert.equal(browser.document.activeElement?.textContent, "취소");
  assert.equal(button("위험 작업").getAttribute("aria-expanded"), "true");
  await act(async () => {
    browser.document.activeElement?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(panel(), null);
  assert.equal(browser.document.activeElement, button("위험 작업"), "Esc returns focus to the trigger");
  assert.equal(runs, 0);

  await press("위험 작업");
  await press("작업 확인");
  assert.equal(runs, 1);
  assert.ok(panel(), "the confirmation stays visible while the action is pending");
  assert.equal(button("처리 중...").disabled, true);
  assert.equal(button("취소").disabled, true);
  await act(async () => release());
  await settle();
  assert.equal(panel(), null);
  assert.equal(browser.document.activeElement, button("위험 작업"));
});

test("calendar feed replacement asks before expiring the student's existing subscription", async (context) => {
  const issued: string[] = [];
  issueFeedUrl = async (studentId) => { issued.push(studentId); return `/api/calendar/feed?token=token-${issued.length}`; };
  context.after(() => { issueFeedUrl = async () => "/api/calendar/feed?token=test"; });

  const first = await render(context, <CalendarFeedControl studentId="new-student" issuedAt={null} />);
  await press("구독 URL 발급");
  assert.deepEqual(issued, ["new-student"], "a first URL has no subscription to break");
  assert.match(browser.document.body.textContent ?? "", /token-1/u);
  await press("새 URL로 교체");
  assert.deepEqual(issued, ["new-student"], "replacing the URL just issued also asks first");
  await press("취소");

  await act(async () => first.render(<CalendarFeedControl key="subscribed" studentId="subscribed-student" issuedAt={new Date("2026-10-01T01:30:00.000Z")} />));
  assert.match(browser.document.body.textContent ?? "", /2026년 10월 1일/u);
  await press("새 URL로 교체");
  assert.deepEqual(issued, ["new-student"]);
  assert.equal(browser.document.activeElement?.textContent, "취소");
  await press("URL 교체 확인");
  assert.deepEqual(issued, ["new-student", "subscribed-student"]);
  assert.match(browser.document.body.textContent ?? "", /token-2/u);
});

test("public lesson calendar keeps a refused address for correction and sends only the address", async (context) => {
  const submitted: [string, string | null][] = [];
  connectCalendar = async (_previous, data) => {
    submitted.push([String(data.get("url")), data.get("provider") as string | null]);
    return submitted.length === 1
      ? { error: "Google 공개 iCal 기본 주소만 사용할 수 있습니다." }
      : { success: "공개 레슨 캘린더를 연결했습니다." };
  };
  context.after(() => { connectCalendar = async () => ({}); });
  await render(context, <ExternalCalendarConnection connection={{ connected: false }} />);
  assert.equal(browser.document.querySelector("select"), null, "the provider follows the pasted address");
  const privateUrl = "https://calendar.google.com/calendar/ical/abc/private-123/basic.ics";
  await fill("external-calendar-url", privateUrl);
  await press("연결");
  assert.match(browser.document.getElementById("external-calendar-error")?.textContent ?? "", /공개 iCal 기본 주소/u);
  assert.equal(inputValue("url"), privateUrl, "the refused address stays for correction");
  const publicUrl = "https://calendar.google.com/calendar/ical/abc/public/basic.ics";
  await fill("external-calendar-url", publicUrl);
  await press("연결");
  assert.deepEqual(submitted, [[privateUrl, null], [publicUrl, null]]);
  assert.equal(inputValue("url"), "");
});
