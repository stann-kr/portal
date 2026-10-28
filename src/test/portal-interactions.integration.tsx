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
let SlidePanelDock: typeof import("@/components/student-portal/SlidePanel").SlidePanelDock;
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
let CalendarQuickCreate: typeof import("@/components/calendar/CalendarQuickCreate").CalendarQuickCreate;
let renderCalendarEventContent: typeof import("@/components/calendar/CalendarEventChip").renderCalendarEventContent;
let VideoPlayer: typeof import("@/components/player/VideoPlayer").VideoPlayer;
let TimelineFeedback: typeof import("@/components/feedback/TimelineFeedback").TimelineFeedback;
let PostDetailClient: typeof import("@/app/community/[postId]/PostDetailClient").PostDetailClient;
let saveComment: typeof import("@/lib/actions/comments").createComment = async () => ({});
let removeComment: typeof import("@/lib/actions/comments").deleteComment = async () => {};
let trashPost: typeof import("@/lib/actions/posts").deletePost = async () => ({ success: true });
let AssignmentView: typeof import("@/components/student-portal/AssignmentView").AssignmentView;
let AssignmentDetailClient: typeof import("@/app/dashboard/student/assignments/[id]/AssignmentDetailClient").AssignmentDetailClient;
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
let saveTaskSubmission: typeof import("@/lib/actions/assignmentTasks").submitAssignmentTask = async () => ({});
let loadTasks: typeof import("@/lib/actions/assignmentTasks").getMyAssignmentTasks = async () => [];
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

const routerReplacements: string[] = [];
mock.module("next/navigation", { namedExports: {
  useRouter: () => ({ push() {}, refresh() {}, replace(href: string) { routerReplacements.push(href); } }),
  // 관리자 학생 상세의 좁은 화면 편집 모드(`?edit=1`)처럼 주소 값을 읽는 화면용. 테스트 창의 현재 주소를 준다.
  useSearchParams: () => new URLSearchParams(globalThis.location?.search ?? ""),
} });
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
mock.module("@/lib/actions/assignmentTasks", { namedExports: {
  getMyAssignmentTasks: () => loadTasks(),
  submitAssignmentTask: (...args: Parameters<typeof saveTaskSubmission>) => saveTaskSubmission(...args),
  updateMyTaskSubmission: async () => ({ error: "테스트 미설정" }),
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
  moveCalendarEvent: async () => ({ ok: false, error: "테스트에서는 옮기지 않습니다." }),
} });
mock.module("@/lib/actions/lessons", { namedExports: {
  createLesson: (...args: Parameters<typeof saveLesson>) => saveLesson(...args),
  rescheduleLesson: (...args: Parameters<typeof moveLesson>) => moveLesson(...args),
  deleteLesson: (...args: Parameters<typeof removeLesson>) => removeLesson(...args),
  moveLesson: async () => ({ error: "테스트에서는 옮기지 않습니다." }),
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
mock.module("@/lib/actions/calendarSync", { namedExports: {
  syncAndGetExternalItems: async () => ({ items: [], localChanged: false }),
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
  ({ SlidePanel, SlidePanelDock } = await import("@/components/student-portal/SlidePanel"));
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
  ({ CalendarQuickCreate } = await import("@/components/calendar/CalendarQuickCreate"));
  ({ renderCalendarEventContent } = await import("@/components/calendar/CalendarEventChip"));
  ({ VideoPlayer } = await import("@/components/player/VideoPlayer"));
  ({ TimelineFeedback } = await import("@/components/feedback/TimelineFeedback"));
  ({ PostDetailClient } = await import("@/app/community/[postId]/PostDetailClient"));
  ({ AssignmentView } = await import("@/components/student-portal/AssignmentView"));
  ({ AssignmentDetailClient } = await import("@/app/dashboard/student/assignments/[id]/AssignmentDetailClient"));
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

test("FullEditor 고정 서식 줄은 compact에서 네 칸만 두고, none·bare에서는 없애며 마크다운 전환을 상태 줄이나 상위 자리로 옮긴다", { concurrency: false }, async (context) => {
  const changes: string[] = [];
  const toolbarLabels = () => [...browser.document.querySelectorAll('[role="toolbar"] button')].map((element) => element.getAttribute("aria-label"));
  const root = await render(context, <FullEditor initialContent="<p>본문</p>" ariaLabel="본문" toolbar="compact" onChange={(html) => changes.push(html)} />);
  await settleEditor();
  assert.equal(browser.document.querySelector('[role="toolbar"]')?.getAttribute("aria-label"), "서식");
  assert.deepEqual(toolbarLabels(), ["굵게", "기울임", "목록", "이미지"], "QnaNew 보드의 네 칸만 둔다");
  assert.ok(button("마크다운"), "마크다운 전환은 상태 줄로 옮긴다");
  await act(async () => button("목록").click());
  await settleEditor();
  assert.match(changes.at(-1) ?? "", /<ul/u, "목록 칸은 기존 글머리 목록 동작을 쓴다");

  await act(async () => root.render(<FullEditor initialContent="<p>본문</p>" ariaLabel="본문" toolbar="none" />));
  await settleEditor();
  assert.equal(browser.document.querySelector('[role="toolbar"]'), null, "none은 고정 줄을 그리지 않는다");
  assert.ok(button("마크다운"));
  assert.ok(browser.document.querySelector('input[type="file"]'), "`/` 메뉴의 이미지 올리기가 쓰는 파일 입력은 남는다");

  function BareHarness() {
    const [tools, setTools] = React.useState<HTMLElement | null>(null);
    return (
      <div>
        <FullEditor variant="bare" initialContent="<p>본문</p>" ariaLabel="본문" toolsContainer={tools} />
        <span data-testid="editor-tools" ref={setTools} />
      </div>
    );
  }
  await act(async () => root.render(<BareHarness />));
  await settleEditor();
  const tools = browser.document.querySelector('[data-testid="editor-tools"]');
  assert.equal(browser.document.querySelector('[role="toolbar"]'), null);
  assert.ok(tools?.querySelector('[role="status"]'), "이미지 업로드 상태는 상위 화면이 정한 자리에 둔다");
  assert.equal(tools?.querySelector("button")?.textContent, "마크다운");
});

test("FileUploader composer 버튼은 클립 아이콘과 '파일 첨부' 이름을 쓰고 업로드 진행을 버튼 아래 막대로 보인다", { concurrency: false }, async (context) => {
  const xhrs = mockUploadTransport(context);
  const uploaded: string[] = [];
  requestUpload = async () => ({ success: true, mediaObjectId: "composer", deliveryUrl: "/api/media/composer", uploadUrl: "https://upload.test/put", uploadContentType: "image/png" });
  completeUpload = async (id) => ({ success: true, mediaObjectId: id, deliveryUrl: `/api/media/${id}` });
  await render(context, <FileUploader purpose="QNA_ATTACHMENT" draftOperationId="composer-draft" label="파일 첨부" trigger="composer" onUploadComplete={(upload) => uploaded.push(upload.mediaObjectId)} />);
  assert.ok(button("파일 첨부").querySelector("svg"), "클립 아이콘이 있다");
  await chooseUploadFile();
  assert.equal(button("업로드 중...").getAttribute("aria-busy"), "true");
  await act(async () => xhrs[0].upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 }));
  assert.equal(browser.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "40");
  await act(async () => xhrs[0].onload?.());
  assert.deepEqual(uploaded, ["composer"]);
  assert.equal(button("파일 첨부").disabled, false);
});

test("portal sections follow the URL from sidebar navigation and keep each section's scroll", async (context) => {
  browser.history.replaceState({ marker: "keep" }, "", "?section=workspace");
  browser.localStorage.setItem("test:section", "community");
  const items = ["today", "workspace", "community"].map((id) => ({ id }));
  await render(context, (
    <PortalShell items={items} initialItem="today" storageKey="test:section" urlParamKey="section" ariaLabel="포탈">
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

test("docked panel keeps its presentation while busy when the dock is switched off, then follows the viewport", async (context) => {
  function Panel() {
    const [enabled, setEnabled] = useState(true);
    const [busy, setBusy] = useState(false);
    return (
      <SlidePanelDock enabled={enabled}>
        <button onClick={() => setEnabled(!enabled)}>폭 바꾸기</button>
        <SlidePanel open onOpenChange={() => {}} title="상세" dismissible={!busy} docked>
          <button onClick={() => setBusy(!busy)}>{busy ? "저장 완료" : "저장 시작"}</button>
        </SlidePanel>
      </SlidePanelDock>
    );
  }
  const docked = () => browser.document.querySelector('aside[aria-label="상세"]');
  await render(context, <Panel />);
  assert.ok(docked());
  await press("저장 시작");
  await press("폭 바꾸기");
  assert.ok(docked(), "저장 중에는 붙는 패널을 유지해 본문을 다시 마운트하지 않는다");
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  await press("저장 완료");
  assert.equal(docked(), null, "작업이 끝나면 지금 폭에 맞는 모달로 옮긴다");
  assert.ok(browser.document.querySelector('[role="dialog"]'));
});

test("docked panel opens beside the page without a modal, keeps busy protection and returns focus only from inside", async (context) => {
  function Panel() {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    return (
      <SlidePanelDock>
        <button onClick={() => setOpen(true)}>패널 열기</button>
        <button onClick={() => setOpen(false)}>바깥에서 닫기</button>
        <SlidePanel open={open} onOpenChange={setOpen} title="상세" dismissible={!busy} docked>
          <button onClick={() => setBusy(!busy)}>{busy ? "저장 완료" : "저장 시작"}</button>
        </SlidePanel>
      </SlidePanelDock>
    );
  }
  const panel = () => browser.document.querySelector('aside[aria-label="상세"]');
  const pressEscapeInside = async () => {
    await act(async () => {
      browser.document.activeElement?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await settle();
  };
  await render(context, <Panel />);
  await press("패널 열기");
  assert.ok(panel(), "넓은 화면 dock 안에서는 화면 옆 패널(complementary)로 연다");
  assert.equal(browser.document.querySelector('[role="dialog"]'), null, "모달 대화상자가 아니다");
  assert.equal(browser.document.querySelector(".portal-backdrop"), null, "뒤 화면을 어둡게 하지 않는다");
  assert.ok(panel()?.parentElement?.hasAttribute("data-slide-panel-dock"), "화면 내용 옆 패널 자리에 붙는다");
  assert.ok(panel()?.contains(browser.document.activeElement), "열면 초점이 패널로 옮겨진다");
  await press("저장 시작");
  assert.equal(button("닫기").disabled, true);
  await pressEscapeInside();
  assert.ok(panel(), "저장 중에는 Esc로 닫히지 않는다");
  await press("저장 완료");
  await pressEscapeInside();
  assert.equal(panel(), null, "초점이 패널 안에 있으면 Esc로 닫힌다");
  assert.equal(browser.document.activeElement, button("패널 열기"), "연 요소로 초점을 돌려준다");

  await press("패널 열기");
  assert.ok(panel()?.contains(browser.document.activeElement));
  await press("바깥에서 닫기");
  assert.equal(panel(), null);
  assert.equal(browser.document.activeElement, button("바깥에서 닫기"), "사용자가 패널 밖으로 옮긴 초점은 되돌리지 않는다");
});

test("creation menu hands keyboard focus to its dialog and returns it to the stable add button", async (context) => {
  await render(context, <CreateEntryDropdown studentId="student" diggingColumns={[]} spaceLabel="학생" noteCreateHref="/dashboard/student/notes/new" canCreateQna={false} canCreateDigging={false} />);
  await act(async () => {
    button("새로 만들기").focus();
    button("새로 만들기").dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
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
  assert.equal(browser.document.activeElement, button("새로 만들기"));
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
  // 관리자 일정 머리는 만들 수 있는 항목이 레슨 하나라 메뉴 없이 "레슨 예약" 버튼으로 바로 연다(AdminSchedule).
  assert.equal(browser.document.querySelector('[aria-haspopup="menu"]'), null);
  await press("레슨 예약");
  assert.ok(browser.document.querySelector('[role="dialog"]')?.contains(browser.document.activeElement));
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
    space: { studentId: "student-1", label: "민지" }, source: { kind: "PORTAL", entity: "LESSON", label: "포탈" },
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
  await press("레슨 저장");
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
    initialUnifiedItems={[]}
    adminId="admin" qnaThreads={[]} pendingAssignments={[]} referenceTime={new Date()}
    students={[{ id: "student", email: "student@example.test", displayName: "학생", createdAt: null, currentModule: null, nextLessonDate: null, pendingFeedbackCount: 0 }]}
  />);
  // 관리자 일정은 "월·주·일별·전체" 한 세그먼트에서 주 보기로 시작한다(AdminSchedule).
  const tabs = [...browser.document.querySelectorAll('[role="tablist"][aria-label="보기"] [role="tab"]')];
  assert.deepEqual(tabs.map((tab) => tab.textContent), ["월", "주", "일별", "전체"]);
  assert.equal(button("주").getAttribute("aria-selected"), "true");
  await press("월");
  assert.equal(button("월").getAttribute("aria-selected"), "true");
  const next = browser.document.querySelector('[data-calendar-title] ~ button[aria-label="다음 달"]');
  assert.ok(next instanceof browser.HTMLElement);
  const initialTitle = browser.document.querySelector("[data-calendar-title]")?.textContent;
  await act(async () => next.click());
  await settle();
  const nextTitle = browser.document.querySelector("[data-calendar-title]")?.textContent;
  assert.notEqual(nextTitle, initialTitle);
  assert.equal(browser.location.search.includes("view=calendar"), true);
  await press("노트 숨기기");
  await press("일별");
  assert.equal(button("일별").getAttribute("aria-selected"), "true");
  assert.equal(new URLSearchParams(browser.location.search).get("view"), "daily", "일별 보기도 주소의 view 값을 지킨다");
  // Keyboard arrow navigation moves focus without replacing a heavy view until activation.
  await act(async () => {
    button("일별").dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  await settle();
  assert.equal(button("일별").getAttribute("aria-selected"), "true");
  await press("월");
  assert.equal(button("월").getAttribute("aria-selected"), "true");
  assert.equal(new URLSearchParams(browser.location.search).get("view"), "calendar");
  assert.equal(browser.document.querySelector("[data-calendar-title]")?.textContent, nextTitle);
  assert.equal(button("노트 표시하기").getAttribute("aria-pressed"), "false");
  await press("주");
  const weekTitle = browser.document.querySelector("[data-calendar-title]")?.textContent;
  assert.equal(button("주").getAttribute("aria-selected"), "true");
  assert.ok(browser.document.querySelector('[data-calendar-title] ~ button[aria-label="다음 주"]'));
  await act(async () => { navigateWithinPage("/dashboard/admin?section=work&student=student"); });
  await settle();
  await act(async () => { navigateWithinPage("/dashboard/admin?section=schedule&view=calendar&student=student"); });
  await settle();
  assert.equal(button("주").getAttribute("aria-selected"), "true");
  assert.equal(browser.document.querySelector("[data-calendar-title]")?.textContent, weekTitle);
  assert.equal(button("노트 표시하기").getAttribute("aria-pressed"), "false");
});

test("top bar + opens today's quick create or lesson booking once and clears the create address", async (context) => {
  browser.history.replaceState({}, "", "/dashboard/student?section=workspace&view=calendar&create=today");
  const student = await render(context, <StudentPortalClient
    initialLocation={resolvePortalLocation("student", { section: "workspace", view: "calendar" })}
    announcements={[]} unifiedItems={[]} curriculumModules={[]} assignments={[]}
    studentId="student" displayName="학생" spaceLabel="학생" externalCalendarConnection={{ connected: false }} referenceTime={new Date()}
  />);
  const sheet = browser.document.querySelector('[role="dialog"]');
  assert.ok(sheet, "오늘 날짜 빠른 만들기가 열린다");
  assert.match(sheet.textContent ?? "", /에 만들기/u);
  assert.equal(sheet.querySelector('[role="radio"][aria-checked="true"]')?.textContent, "노트", "하루 칸처럼 노트부터 고른다");
  assert.equal(new URLSearchParams(browser.location.search).get("create"), null, "뒤로 가기에 다시 열리지 않게 주소에서 지운다");
  assert.equal(new URLSearchParams(browser.location.search).get("view"), "calendar");
  await act(async () => { button("빠른 만들기 닫기").click(); });
  await settle();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  assert.equal(browser.document.activeElement, button("새로 만들기"), "주소로 바로 연 창을 닫으면 머리의 만들기 버튼으로 초점이 간다");
  // 위쪽 막대 +처럼 초점을 가진 요소로 열면 닫을 때 그 요소로, 그 요소가 사라졌으면 머리의 만들기 버튼으로 돌아간다.
  const topBarPlus = browser.document.createElement("a");
  topBarPlus.href = "/dashboard/student?section=workspace&create=today";
  topBarPlus.textContent = "오늘 만들기";
  browser.document.body.append(topBarPlus);
  context.after(() => topBarPlus.remove());
  for (const removeOpener of [false, true]) {
    topBarPlus.focus();
    await act(async () => { navigateWithinPage("/dashboard/student?section=workspace&view=calendar&create=today"); });
    await settle();
    assert.ok(browser.document.querySelector('[role="dialog"]'), "같은 화면 안의 이동으로도 다시 열린다");
    if (removeOpener) topBarPlus.remove();
    await act(async () => { button("빠른 만들기 닫기").click(); });
    await settle();
    assert.equal(browser.document.querySelector('[role="dialog"]'), null);
    assert.equal(browser.document.activeElement, removeOpener ? button("새로 만들기") : topBarPlus);
  }
  await act(async () => student.unmount());
  await settle();

  browser.history.replaceState({}, "", "/dashboard/admin?section=work&student=student");
  await render(context, <AdminPortalClient
    initialUnifiedItems={[]}
    adminId="admin" qnaThreads={[]} pendingAssignments={[]} referenceTime={new Date()}
    students={[{ id: "student", email: "student@example.test", displayName: "학생", createdAt: null, currentModule: null, nextLessonDate: null, pendingFeedbackCount: 0 }]}
  />);
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  // 같은 화면 안의 이동(pushState + popstate)으로도 열린다.
  await act(async () => { navigateWithinPage("/dashboard/admin?section=schedule&create=lesson&student=student"); });
  await settle();
  const dialog = browser.document.querySelector('[role="dialog"]');
  assert.match(dialog?.textContent ?? "", /레슨 예약/u);
  assert.ok(browser.document.getElementById("lesson-schedule-start"));
  assert.equal(new URLSearchParams(browser.location.search).get("create"), null);
  await escape();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  assert.equal(browser.document.activeElement, button("레슨 예약"), "연 요소가 없으면 머리의 레슨 예약 버튼으로 초점이 간다");
  const lessonPlus = browser.document.createElement("a");
  lessonPlus.href = "/dashboard/admin?section=schedule&create=lesson";
  lessonPlus.textContent = "레슨 예약하기";
  browser.document.body.append(lessonPlus);
  lessonPlus.focus();
  await act(async () => { navigateWithinPage("/dashboard/admin?section=schedule&create=lesson&student=student"); });
  await settle();
  assert.match(browser.document.querySelector('[role="dialog"]')?.textContent ?? "", /레슨 예약/u);
  lessonPlus.remove();
  await escape();
  await settle();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  assert.equal(browser.document.activeElement, button("레슨 예약"), "연 요소가 사라졌으면 머리의 레슨 예약 버튼으로 돌아간다");
  await act(async () => { browser.dispatchEvent(new browser.PopStateEvent("popstate")); });
  await settle();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null, "같은 주소로 돌아와도 다시 열리지 않는다");
});

test("student calendar docks item detail beside the calendar column instead of a modal", async (context) => {
  // 붙는 패널은 1280px(80rem) 이상에서만 쓴다. happy-dom 기본 폭(1024)에서는 넓은 화면을 흉내 낸다.
  const originalMatchMedia = browser.matchMedia.bind(browser);
  browser.matchMedia = ((query: string) => (query === "(min-width: 80rem)"
    ? { ...originalMatchMedia(query), matches: true, media: query, addEventListener() {}, removeEventListener() {} }
    : originalMatchMedia(query))) as typeof browser.matchMedia;
  context.after(() => { browser.matchMedia = originalMatchMedia; });
  browser.history.replaceState({}, "", "/dashboard/student?section=workspace&view=calendar");
  await render(context, <StudentPortalClient
    initialLocation={resolvePortalLocation("student", { section: "workspace", view: "calendar" })}
    announcements={[]} curriculumModules={[]} assignments={[]}
    unifiedItems={[{
      id: "practice", type: "EVENT", subType: "PRACTICE", title: "리듬 연습", date: new Date(), metadata: {},
      space: { studentId: "student", label: "학생" }, source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포탈" },
    }]}
    studentId="student" displayName="학생" spaceLabel="학생" externalCalendarConnection={{ connected: false }} referenceTime={new Date()}
  />);
  const chip = browser.document.querySelector(".fc-daygrid-event");
  assert.ok(chip instanceof browser.HTMLElement);
  await act(async () => { chip.click(); });
  await settle();
  const panel = browser.document.querySelector("aside[data-slide-panel]");
  assert.ok(panel, "넓은 화면 캘린더는 항목 상세를 옆 패널로 연다");
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  assert.equal(browser.document.querySelector(".portal-backdrop"), null);
  const row = panel.parentElement?.parentElement;
  assert.ok(panel.parentElement?.hasAttribute("data-slide-panel-dock"));
  const segment = browser.document.querySelector('[role="tablist"][aria-label="보기"]');
  assert.ok(segment && row?.contains(segment), "캘린더 머리·달력과 같은 줄에 붙는다");
  assert.ok(panel.contains(browser.document.activeElement));
  await act(async () => {
    browser.document.activeElement?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await settle();
  assert.equal(browser.document.querySelector("aside[data-slide-panel]"), null);
  assert.equal(browser.document.activeElement, chip);
});

test("calendar menu without a view ignores a stale assignments tab while an explicit view still opens it", async (context) => {
  const props = {
    announcements: [], unifiedItems: [], curriculumModules: [], assignments: [],
    studentId: "student", displayName: "학생", spaceLabel: "학생", externalCalendarConnection: { connected: false }, referenceTime: new Date(),
  };
  const headings = () => [...browser.document.querySelectorAll("h1")].map((heading) => heading.textContent);
  context.after(() => browser.localStorage.removeItem("studentPortal:calendarTab"));
  browser.localStorage.setItem("studentPortal:calendarTab", "assignments");
  browser.history.replaceState({}, "", "/dashboard/student?section=workspace");
  const calendar = await render(context, <StudentPortalClient initialLocation={resolvePortalLocation("student", { section: "workspace" })} {...props} />);
  assert.equal(button("월").getAttribute("aria-selected"), "true", "사이드바 캘린더는 예전 기기 저장값(과제)이 있어도 캘린더를 연다");
  assert.equal(new URLSearchParams(browser.location.search).get("view"), "calendar");
  assert.ok(!headings().includes("과제"));
  await act(async () => calendar.unmount());
  await settle();

  browser.history.replaceState({}, "", "/dashboard/student?section=workspace&view=assignments");
  await render(context, <StudentPortalClient initialLocation={resolvePortalLocation("student", { section: "workspace", view: "assignments" })} {...props} />);
  assert.ok(headings().includes("과제"), "주소에 과제 보기가 있으면 그대로 연다");
  assert.equal(browser.document.querySelector('[role="tablist"][aria-label="보기"]'), null);
});

test("월·주 tabs control the always-mounted calendar panel without remounting the calendar", async (context) => {
  browser.history.replaceState({}, "", "/dashboard/student?section=workspace&view=calendar");
  await render(context, <StudentPortalClient
    initialLocation={resolvePortalLocation("student", { section: "workspace", view: "calendar" })}
    announcements={[]} unifiedItems={[]} curriculumModules={[]} assignments={[]}
    studentId="student" displayName="학생" spaceLabel="학생" externalCalendarConnection={{ connected: false }} referenceTime={new Date()}
  />);
  const controlled = (label: string) => browser.document.getElementById(button(label).getAttribute("aria-controls") ?? "");
  const panel = controlled("월");
  assert.ok(panel, "활성 월 탭이 실제 패널을 가리킨다");
  assert.equal(panel.getAttribute("role"), "tabpanel");
  assert.equal(panel.getAttribute("aria-labelledby"), button("월").id);
  const calendarRoot = panel.querySelector(".fc");
  assert.ok(calendarRoot, "월 패널 안에 달력이 있다");
  assert.equal(controlled("주"), panel, "월이 활성일 때도 주 탭이 같은 패널을 가리킨다");
  await press("주");
  assert.equal(controlled("주"), panel, "주 탭도 같은 자리의 패널을 가리킨다");
  assert.equal(controlled("월"), panel, "주가 활성일 때도 월 탭이 같은 패널을 가리킨다");
  assert.equal(panel.getAttribute("aria-labelledby"), button("주").id, "패널 이름은 활성 탭을 따른다");
  assert.equal(panel.querySelector(".fc"), calendarRoot, "보기를 바꿔도 달력을 다시 마운트하지 않는다");
  await press("일별");
  assert.ok(panel.hasAttribute("hidden"), "다른 보기에서는 달력 패널을 숨긴다");
  assert.equal(panel.querySelector(".fc"), calendarRoot);
});

test("top bar lesson booking without any student clears the create address and explains why", async (context) => {
  browser.history.replaceState({}, "", "/dashboard/admin?section=work");
  await render(context, <AdminPortalClient
    initialUnifiedItems={[]}
    adminId="admin" qnaThreads={[]} pendingAssignments={[]} referenceTime={new Date()} students={[]}
  />);
  await act(async () => { navigateWithinPage("/dashboard/admin?section=schedule&create=lesson"); });
  await settle();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  assert.equal(new URLSearchParams(browser.location.search).get("create"), null, "열 수 없는 만들기도 주소에서 지운다");
  const notice = [...browser.document.querySelectorAll('[role="status"]')].find((element) => /등록된 수강생이 없습니다/u.test(element.textContent ?? ""));
  assert.ok(notice, "학생이 없어 레슨을 예약할 수 없다고 알린다");
  assert.ok(notice.querySelector('a[href="/dashboard/admin/students/new"]'));
  await press("알림 닫기");
  assert.equal([...browser.document.querySelectorAll('[role="status"]')].some((element) => /등록된 수강생이 없습니다/u.test(element.textContent ?? "")), false);
});

test("portal deep links render their section, view and selected student before hydration", async (context) => {
  const document = browser.document;
  const markup = document.createElement("div");
  markup.innerHTML = renderToString(<StudentPortalClient
    initialLocation={resolvePortalLocation("student", { section: "workspace", view: "curriculum" })}
    announcements={[]} unifiedItems={[]} curriculumModules={[]} assignments={[]}
    studentId="student" displayName="학생" spaceLabel="학생" externalCalendarConnection={{ connected: false }} referenceTime={new Date()}
  />);
  // 구역 이동은 사이드바가 맡고, 화면은 주소의 보기를 제목으로 바로 그린다.
  // 커리큘럼은 숨겨져 있어(src/lib/curriculum-visibility.ts) 예전 커리큘럼 주소도 캘린더로 그린다.
  assert.equal(markup.querySelector("h1")?.textContent, "캘린더");
  assert.doesNotMatch(markup.textContent ?? "", /커리큘럼/u);

  const students = ["first", "requested"].map((id) => ({ id, email: `${id}@example.test`, displayName: id, createdAt: null, currentModule: null, nextLessonDate: null, pendingFeedbackCount: 0 }));
  const admin = <AdminPortalClient
    initialLocation={resolvePortalLocation("admin", { section: "schedule", view: "all", type: "NOTE" })}
    initialStudentId="requested" students={students} initialUnifiedItems={[]}
    adminId="admin" qnaThreads={[]} pendingAssignments={[]} referenceTime={new Date()}
  />;
  markup.innerHTML = renderToString(admin);
  assert.equal(markup.querySelector("h1")?.textContent, "일정");
  assert.equal(markup.querySelector('[role="tab"][aria-selected="true"]')?.textContent, "전체");
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

test("calendar chips leave the week-view selection preview to FullCalendar and survive missing item metadata", () => {
  type ContentArg = Parameters<typeof renderCalendarEventContent>[0];
  const arg = (overrides: { view: string; isMirror?: boolean; extendedProps?: Record<string, unknown>; allDay?: boolean }) => ({
    view: { type: overrides.view },
    isMirror: overrides.isMirror ?? false,
    event: { title: "리듬 연습", allDay: overrides.allDay ?? false, extendedProps: overrides.extendedProps ?? {} },
  }) as unknown as ContentArg;
  assert.equal(renderCalendarEventContent(arg({ view: "timeGridWeek", isMirror: true })), true, "the slot selection preview has no item data");
  const dragged = renderCalendarEventContent(arg({ view: "timeGridWeek", isMirror: true, extendedProps: { itemType: "EVENT", timeLabel: "14:00", movable: true } }));
  assert.notEqual(dragged, true, "a dragged item keeps its chip");
  const markup = browser.document.createElement("div");
  markup.innerHTML = renderToString(<>{dragged}</>);
  assert.match(markup.textContent ?? "", /14:00리듬 연습/u);
  assert.ok(markup.querySelector(".calendar-chip-dot"), "a known item type keeps its type dot");
  markup.innerHTML = renderToString(<>{renderCalendarEventContent(arg({ view: "dayGridMonth", extendedProps: { itemType: "UNKNOWN" } }))}</>);
  assert.equal(markup.querySelector(".calendar-chip-dot"), null);
  assert.equal(markup.querySelector("svg"), null);
  assert.match(markup.textContent ?? "", /리듬 연습/u);
});

test("calendar views share one 월·주·일별·전체 segment on the server and leave no separate list view", () => {
  const markup = browser.document.createElement("div");
  markup.innerHTML = renderToString(<StudentPortalClient
    initialLocation={resolvePortalLocation("student", { section: "workspace", view: "calendar" })}
    announcements={[]} unifiedItems={[]} curriculumModules={[]} assignments={[]}
    studentId="student" displayName="학생" spaceLabel="학생" externalCalendarConnection={{ connected: false }} referenceTime={new Date()}
  />);
  const tabs = [...markup.querySelectorAll('[role="tablist"][aria-label="보기"] [role="tab"]')];
  assert.deepEqual(tabs.map((tab) => tab.textContent), ["월", "주", "일별", "전체"]);
  assert.equal(markup.querySelector('[role="tab"][aria-selected="true"]')?.textContent, "월", "학생 캘린더는 월 보기로 시작한다");
  assert.equal(markup.querySelector('[aria-label="달력 보기"]'), null, "달력 안의 월/주/목록 전환은 세그먼트로 합쳤다");
  assert.equal(markup.querySelector(".fc-list"), null);
  assert.equal(markup.querySelector("[data-calendar-title]")?.textContent, "", "기간 제목은 달력이 실제 기간을 알린 뒤 채운다");
  assert.ok([...markup.querySelectorAll("button")].some((element) => element.textContent?.includes("새로 만들기")));
});

test("calendar detail returns focus to the month chip that opened it", async (context) => {
  await render(context, <UnifiedCalendar returnTo="/dashboard/student" showSpaceContext={false} items={[{
    id: "practice", type: "EVENT", subType: "PRACTICE", title: "리듬 연습", date: new Date(), metadata: {},
    space: { studentId: "student", label: "학생" }, source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포탈" },
  }]} />);
  const chip = browser.document.querySelector(".fc-daygrid-event");
  assert.ok(chip instanceof browser.HTMLElement);
  assert.match(chip.textContent ?? "", /리듬 연습/u);
  await act(async () => { chip.click(); });
  await settle();
  const panel = browser.document.querySelector('[role="dialog"]');
  assert.ok(panel);
  assert.match(panel.textContent ?? "", /일정/u, "panel header shows the type");
  await escape();
  assert.equal(browser.document.querySelector('[role="dialog"]'), null);
  assert.equal(browser.document.activeElement, chip);
});

test("wide calendar opens item detail beside the grid, switches items in place and returns focus to the chip", async (context) => {
  const item = (id: string, title: string): UnifiedItem => ({
    id, type: "EVENT", subType: "PRACTICE", title, date: new Date(), metadata: {},
    space: { studentId: "student", label: "학생" }, source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포탈" },
  });
  await render(context, <SlidePanelDock className="flex">
    <div><UnifiedCalendar returnTo="/dashboard/student" showSpaceContext={false} items={[item("practice", "리듬 연습"), item("gig", "합주")]} /></div>
  </SlidePanelDock>);
  const chip = (title: string) => {
    const found = [...browser.document.querySelectorAll(".fc-daygrid-event")].find((element) => element.textContent?.includes(title));
    assert.ok(found instanceof browser.HTMLElement, `chip: ${title}`);
    return found;
  };
  const first = chip("리듬 연습");
  await act(async () => { first.click(); });
  await settle();
  let panel = browser.document.querySelector("aside[data-slide-panel]");
  assert.ok(panel, "항목 상세가 캘린더 옆 패널로 열린다");
  assert.equal(panel.getAttribute("aria-label"), "리듬 연습");
  assert.equal(browser.document.querySelector('[role="dialog"]'), null, "모달이 아니라 캘린더를 계속 조작할 수 있다");
  assert.match(panel.textContent ?? "", /일정/u, "panel header shows the type");
  assert.ok(panel.contains(browser.document.activeElement), "열면 초점이 패널로 옮겨진다");
  assert.ok(first.classList.contains("calendar-event-selected"), "연 항목을 캘린더에서 표시한다");

  const second = chip("합주");
  await act(async () => { second.click(); });
  await settle();
  panel = browser.document.querySelector("aside[data-slide-panel]");
  assert.equal(panel?.getAttribute("aria-label"), "합주", "패널을 닫지 않고 다른 항목으로 바꾼다");
  assert.ok(panel?.contains(browser.document.activeElement));
  await act(async () => {
    browser.document.activeElement?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await settle();
  assert.equal(browser.document.querySelector("aside[data-slide-panel]"), null);
  assert.equal(browser.document.activeElement, chip("합주"), "마지막으로 연 칩으로 초점을 돌려준다");
});

test("calendar quick create works from the keyboard and keeps a typed title on outside clicks", async (context) => {
  const created: UnifiedItem[] = [];
  let closes = 0;
  const submitted: FormData[] = [];
  saveEvent = async (_previous, formData) => {
    submitted.push(formData);
    return { id: "quick-event", event: {
      id: "quick-event", title: String(formData.get("title")), eventType: "PRACTICE",
      startTime: "2026-10-27T00:00:00.000Z", endTime: "2026-10-27T01:00:00.000Z", description: null,
    } };
  };
  context.after(() => { saveEvent = async () => ({}); });
  await render(context, <CalendarQuickCreate
    selection={{ startStr: "2026-10-27", endStr: "2026-10-28", allDay: true }}
    anchor={null}
    options={{ buildNoteHref: (date, title) => `/notes/new?date=${date}&title=${title}`, canCreateEvent: true, canCreateLesson: false, studentId: "student", spaceLabel: "학생" }}
    onCreated={(item) => created.push(item)}
    onClose={() => { closes += 1; }}
  />);
  const dialog = browser.document.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.equal(browser.document.activeElement?.getAttribute("aria-label"), "노트 제목", "the title field takes focus first");
  assert.equal(button("노트").getAttribute("aria-checked"), "true", "a day cell starts with a note");
  assert.deepEqual([button("노트").tabIndex, button("일정").tabIndex], [0, -1], "only the chosen kind is a tab stop");
  await act(async () => {
    button("노트").focus();
    button("노트").dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  assert.equal(button("일정").getAttribute("aria-checked"), "true", "arrow keys move the choice");
  assert.equal(browser.document.activeElement, button("일정"));
  await act(async () => {
    button("일정").dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  assert.equal(button("노트").getAttribute("aria-checked"), "true", "the choice wraps around");
  await press("일정");
  assert.equal(button("일정").getAttribute("aria-checked"), "true");

  const title = browser.document.querySelector('input[aria-label="일정 제목"]');
  assert.ok(title instanceof browser.HTMLInputElement);
  const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(title, "리듬 연습");
    title.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  await act(async () => {
    browser.document.body.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true }));
  });
  assert.equal(closes, 0, "an outside click does not discard a typed title");

  await act(async () => {
    title.form?.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].get("title"), "리듬 연습");
  assert.equal(submitted[0].get("startTime"), "2026-10-27T09:00");
  assert.equal(submitted[0].get("endTime"), "2026-10-27T10:00");
  assert.deepEqual(created.map((item) => [item.title, item.source.entity]), [["리듬 연습", "CALENDAR_EVENT"]]);
  assert.equal(closes, 1);
});

test("calendar quick create follows a new selection while open and keeps the typed title", async (context) => {
  const options = { buildNoteHref: () => "/notes/new", canCreateEvent: true, canCreateLesson: false, studentId: "student", spaceLabel: "학생" };
  const container = browser.document.createElement("div");
  browser.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  context.after(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const view = (startStr: string, endStr: string) => <CalendarQuickCreate
    selection={{ startStr, endStr, allDay: false }} anchor={null} options={options} onCreated={() => {}} onClose={() => {}}
  />;
  await act(async () => root.render(view("2026-10-27T14:00:00+09:00", "2026-10-27T15:00:00+09:00")));
  const title = browser.document.querySelector('input[aria-label="일정 제목"]');
  assert.ok(title instanceof browser.HTMLInputElement);
  const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(title, "합주");
    title.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  await act(async () => root.render(view("2026-10-28T10:00:00+09:00", "2026-10-28T11:30:00+09:00")));
  const times = [...browser.document.querySelectorAll('[role="dialog"] input[type="datetime-local"]')]
    .map((input) => (input as unknown as { value: string }).value);
  assert.deepEqual(times, ["2026-10-28T10:00", "2026-10-28T11:30"], "the form moves with the header");
  assert.match(browser.document.querySelector('[role="dialog"]')?.textContent ?? "", /10월 28일/u);
  assert.equal((browser.document.querySelector('input[aria-label="일정 제목"]') as unknown as { value: string } | null)?.value, "합주");
});

test("calendar quick create closes with Escape and on an outside click while empty", async (context) => {
  let closes = 0;
  await render(context, <CalendarQuickCreate
    selection={{ startStr: "2026-10-27T14:00:00+09:00", endStr: "2026-10-27T15:00:00+09:00", allDay: false }}
    anchor={{ x: 200, y: 200 }}
    options={{ canCreateEvent: false, canCreateLesson: true, studentId: "student", spaceLabel: "학생" }}
    onCreated={() => {}}
    onClose={() => { closes += 1; }}
  />);
  assert.equal(browser.document.querySelector('[role="radiogroup"]'), null, "a single choice needs no switch");
  assert.match(browser.document.querySelector('[role="dialog"]')?.textContent ?? "", /14:00–15:00/u);
  await act(async () => {
    browser.document.querySelector('[role="dialog"]')?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(closes, 1);
  await act(async () => {
    browser.document.body.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true }));
  });
  assert.equal(closes, 2);
});

test("student portal reflects new server records and removals without a full reload", async (context) => {
  browser.history.replaceState({}, "", "/dashboard/student?section=today");
  const item: UnifiedItem = { id: "before", type: "ASSIGNMENT", title: "믹스셋", date: new Date(), metadata: {},
    space: { studentId: "student", label: "학생" }, source: { kind: "PORTAL", entity: "ASSIGNMENT", label: "포탈" } };
  const portal = (items: UnifiedItem[]) => <StudentPortalClient
    initialLocation={resolvePortalLocation("student", { section: "today" })}
    announcements={[]} unifiedItems={items} curriculumModules={[]} assignments={[]}
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
    space: { studentId: "student", label: "학생" }, source: { kind: "PORTAL", entity: "CALENDAR_EVENT", label: "포탈" },
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

test("digging board opens the inline add row from its link prompt and the read-only board has no edit controls", async (context) => {
  const columns = [
    { id: "title", name: "트랙명", columnType: "text" as const, options: null, isDefault: true, sortOrder: 0 },
    { id: "rating", name: "별점", columnType: "rating" as const, options: null, isDefault: true, sortOrder: 1 },
    { id: "link", name: "링크", columnType: "link" as const, options: null, isDefault: true, sortOrder: 2 },
  ];
  const tracks = [{ id: "track-1", linkUrl: null, createdAt: new Date("2026-10-09T01:00:00.000Z"), values: { title: "Intro", rating: 3 } }];
  const root = await render(context, <DiggingBoard initialColumns={columns} initialTracks={tracks} />);
  assert.equal(browser.document.querySelector('table input[aria-label="링크"]'), null, "the add row starts as a single prompt");
  await press("링크를 붙여넣어 트랙 추가");
  const link = browser.document.querySelector('table input[aria-label="링크"]');
  assert.ok(link instanceof browser.HTMLInputElement);
  assert.equal(browser.document.activeElement, link, "the link cell takes focus");
  assert.ok(button("디깅 트랙 추가"));
  await act(async () => { link.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(browser.document.querySelector('table input[aria-label="링크"]'), null);
  assert.equal(browser.document.activeElement, button("링크를 붙여넣어 트랙 추가"), "Escape returns to the prompt");

  await act(async () => root.render(<DiggingBoard key="readonly" initialColumns={columns} initialTracks={tracks} readonly />));
  assert.equal(browser.document.querySelectorAll("table input, table textarea, table select").length, 0);
  assert.equal([...browser.document.querySelectorAll("button")].some((element) => ["디깅 트랙 삭제", "링크를 붙여넣어 트랙 추가", "트랙 삭제"].includes(element.getAttribute("aria-label") ?? element.textContent ?? "")), false);
  assert.ok(browser.document.querySelector('table [role="img"][aria-label="별점 3점"]'), "read-only stars read as one rating");
  assert.match(browser.document.querySelector("table tbody")?.textContent ?? "", /2026년 10월 9일 \(.\) · 1곡/u);
});

test("curriculum rolls back failed optimistic completion and allows a successful retry", async (context) => {
  const pending = Promise.withResolvers<void>();
  toggleModule = async () => pending.promise;
  context.after(() => { pending.resolve(); toggleModule = async () => {}; });
  await render(context, <CurriculumView initialModules={[{ id: "module", weekNum: 1, title: "비트 매칭", description: null, isCompleted: false }]} />);
  assert.equal(button("완료 표시: 비트 매칭").getAttribute("aria-pressed"), "false");
  await press("완료 표시: 비트 매칭");
  assert.equal(browser.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "100");
  assert.equal(button("완료 취소: 비트 매칭").disabled, true);
  await act(async () => pending.reject(new Error("offline")));
  await settle();
  assert.equal(browser.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"), "0");
  assert.equal(button("완료 표시: 비트 매칭").getAttribute("aria-pressed"), "false");
  assert.ok(browser.document.querySelector('[role="alert"]'));
  toggleModule = async () => {};
  await press("완료 표시: 비트 매칭");
  assert.equal(button("완료 취소: 비트 매칭").getAttribute("aria-pressed"), "true");
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
  await render(context, <AssignmentView actorId="student-1" initialAssignments={[]} />);
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

test("a received text task submits only the text field, keeps the draft on failure, and refreshes the task list", async (context) => {
  const task = {
    id: "task-text", title: "연습 일지", descriptionHtml: "<p>이번 주 연습</p>", submissionFormat: "TEXT" as const,
    dueAt: new Date(Date.now() + 86_400_000), occurrenceDate: null, recurrenceId: null, version: 1, createdAt: new Date(), submission: null,
  };
  const submissions: { taskId: string; text: string; mediaUrl: unknown }[] = [];
  saveTaskSubmission = async (taskId, _previous, data) => {
    submissions.push({ taskId, text: String(data.get("text")), mediaUrl: data.get("mediaUrl") });
    return submissions.length === 1 ? { error: "제출하지 못했습니다." } : { success: true, id: "submission-1" };
  };
  let taskLoads = 0;
  loadTasks = async () => {
    taskLoads++;
    return [{ ...task, submission: { id: "submission-1", mediaUrl: null, textHtml: "<p>BPM 맞추기</p>", submittedAt: new Date(), updatedAt: null, feedbackCount: 0 } }];
  };
  context.after(() => { saveTaskSubmission = async () => ({}); loadTasks = async () => []; });
  await render(context, <AssignmentView actorId="student-task" initialAssignments={[]} initialTasks={[task]} />);
  assert.match(browser.document.body.textContent ?? "", /받은 과제/);
  assert.match(browser.document.body.textContent ?? "", /미제출/);
  await press("제출하기");
  assert.equal(browser.document.querySelector('input[name="mediaUrl"][type="url"]:not(#assignment-media-url)'), null, "글 과제는 링크 칸이 없다");
  const textarea = browser.document.getElementById("task-task-text-text");
  assert.ok(textarea instanceof browser.HTMLTextAreaElement);
  const setter = Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    textarea.focus();
    setter?.call(textarea, "BPM 맞추기");
    textarea.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
  await settle();
  await act(async () => { (textarea.form as unknown as HTMLFormElement).requestSubmit(); });
  await settle();
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /제출하지 못했습니다/);
  assert.equal((browser.document.getElementById("task-task-text-text") as unknown as HTMLTextAreaElement).value, "BPM 맞추기", "실패하면 쓴 글을 지우지 않는다");
  await act(async () => { (textarea.form as unknown as HTMLFormElement).requestSubmit(); });
  await settle();
  assert.deepEqual(submissions.map(({ taskId, text, mediaUrl }) => [taskId, text, mediaUrl]), [["task-text", "BPM 맞추기", null], ["task-text", "BPM 맞추기", null]]);
  assert.equal(taskLoads, 1);
  assert.match(browser.document.body.textContent ?? "", /피드백 대기/);
  assert.equal(browser.document.getElementById("task-task-text-text"), null, "제출 뒤 폼을 닫는다");
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
    authorName: "학생", authorEmail: null, commentCount: 2,
  };
  const previousUrl = browser.location.href;
  context.after(() => browser.history.replaceState({}, "", previousUrl));
  browser.history.replaceState({}, "", "/community?boardType=GENERAL&category=general");
  const root = await render(context, <CommunityClient isAdmin={false} initial={{ boardType: "GENERAL", category: "general", categories: [category], posts: [post], nextCursor: null }} />);
  assert.match(browser.document.body.textContent ?? "", /레슨 후기/u);
  assert.doesNotMatch(browser.document.body.textContent ?? "", /아직 게시물이 없습니다/u);
  assert.equal(requests.length, 0, "server list is not fetched again on mount");
  assert.match(browser.document.body.textContent ?? "", /댓글 2/u, "the list row shows the comment count");
  // 게시판과 자유 게시판 채널은 한 줄(nav)에 있다. 채널 칩 줄을 따로 두지 않는다.
  assert.equal(browser.document.querySelector('[role="group"][aria-label="채널"]'), null);
  assert.equal(
    [...browser.document.querySelectorAll('nav[aria-label="게시판"] a')].find((anchor) => anchor.textContent === "#자유")?.getAttribute("aria-current"),
    "page",
  );

  // 게시판 탭은 주소를 가진 링크다. 같은 화면에서 주소만 바꾸고 목록을 다시 읽는다.
  const openBoard = async (label: string) => {
    const tab = [...browser.document.querySelectorAll('nav[aria-label="게시판"] a')].find((anchor) => anchor.textContent === label);
    assert.ok(tab, `board tab: ${label}`);
    await act(async () => { tab.dispatchEvent(new browser.MouseEvent("click", { button: 0, bubbles: true, cancelable: true })); });
    await settle();
  };
  await openBoard("믹스셋");
  assert.deepEqual(requests, ["FEEDBACK"]);
  assert.equal(new URL(browser.location.href).searchParams.get("boardType"), "FEEDBACK");
  assert.equal([...browser.document.querySelectorAll('nav[aria-label="게시판"] a')].find((anchor) => anchor.textContent === "믹스셋")?.getAttribute("aria-current"), "page");
  assert.match(browser.document.body.textContent ?? "", /공유된 믹스셋이 없습니다/u);

  // 응답 전에 이미 받은 목록으로 돌아오면 취소된 요청 때문에 skeleton에 머물지 않는다.
  const pendingAnnouncements = Promise.withResolvers<Awaited<ReturnType<typeof loadCommunityPage>>>();
  loadCommunityPage = async ({ boardType }) => { requests.push(boardType); return pendingAnnouncements.promise; };
  await openBoard("공지");
  assert.ok(browser.document.querySelector('[aria-label="게시물을 불러오는 중"]'));
  await openBoard("믹스셋");
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
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null, version: 1, authorName: "학생", authorEmail: null, commentCount: 0,
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
      ? { success: false, error: "피드백이 등록된 제출은 삭제할 수 없습니다. 필요하면 Stann에게 문의해 주세요." }
      : { success: true };
  };
  context.after(() => { removeAssignment = async () => ({ success: true }); routerReplacements.length = 0; });
  const listHref = "/dashboard/student?section=workspace&view=assignments";
  // 목록 행은 상세(타임라인 피드백) 화면으로 이동하고, 삭제는 상세 화면에서 한다.
  const root = await render(context, <AssignmentView actorId="student-1" initialAssignments={[{ id: "mistake", taskId: null, taskTitle: null, mediaUrl: "https://youtu.be/aqz-KE-bpKQ", hasText: false, submittedAt: new Date(), feedbackCount: 0 }]} />);
  const listItem = [...browser.document.querySelectorAll("a")].find((element) => element.textContent?.includes("YouTube 믹스셋"));
  assert.equal(listItem?.getAttribute("href"), `/dashboard/student/assignments/mistake?returnTo=${encodeURIComponent(listHref)}`);
  const detail = (feedbackList: { id: string; timeMarker: number; content: string; createdAt: Date | null }[]) => (
    <AssignmentDetailClient
      assignmentId="mistake" actorId="student-1" mediaUrl="https://youtu.be/aqz-KE-bpKQ" textHtml={null} task={null} feedbackList={feedbackList}
      isAdmin={false} deleteReturnTo={listHref} title="YouTube 믹스셋" submittedLabel="2026년 10월 18일 19:05 제출"
      submittedLabelShort="10월 18일 19:05 제출" breadcrumb={{ href: listHref, label: "과제" }} returnTo={listHref}
    />
  );
  await act(async () => root.render(detail([{ id: "reviewed", timeMarker: 90, content: "전환을 늦춰 보세요.", createdAt: null }])));
  assert.equal([...browser.document.querySelectorAll("button")].some((element) => element.textContent === "제출 삭제"), false, "a reviewed submission offers no deletion");
  await act(async () => root.render(detail([])));
  await press("제출 삭제");
  assert.equal(browser.document.activeElement?.textContent, "취소", "focus starts on the safe choice");
  assert.deepEqual(requests, []);
  await press("취소");
  assert.equal(browser.document.activeElement?.textContent, "제출 삭제", "cancel returns focus to the trigger");
  assert.equal(browser.document.querySelector('[aria-label="제출 삭제 확인"]'), null);
  await press("제출 삭제");
  await press("삭제");
  assert.match(browser.document.querySelector('[role="alert"]')?.textContent ?? "", /피드백이 등록된 제출/u);
  assert.ok(browser.document.querySelector('[aria-label="제출 삭제 확인"]'), "the confirmation stays open after a refusal");
  assert.deepEqual(routerReplacements, []);
  await press("삭제");
  assert.deepEqual(requests, ["mistake", "mistake"]);
  assert.deepEqual(routerReplacements, [listHref], "a confirmed deletion returns to the list, which reloads without the submission");
});

test("admin module edit keeps input on refusal and returns focus to the row after saving", async (context) => {
  const requests: [string, string, string | null, string | null][] = [];
  editModule = async (moduleId, studentId, _previous, data) => {
    requests.push([moduleId, studentId, data.get("weekNum") as string | null, data.get("title") as string | null]);
    return requests.length === 1 ? { error: "주차는 1부터 520 사이의 정수로 입력해 주세요." } : { success: true };
  };
  context.after(() => { editModule = async () => ({ success: true }); });
  await render(context, <OverviewTab studentId="student-1" showCurriculum lessons={[]} modules={[{ id: "module-1", weekNum: 1, title: "비트 매칭", isCompleted: true }]} />);
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
  assert.match(browser.document.querySelector('[role="status"]')?.textContent ?? "", /새 비밀번호를 저장했습니다\. 포탈로 이동합니다/u);
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
  assert.match(browser.document.body.textContent ?? "", /캘린더 구독발급 전/u);
  await press("구독 URL 발급");
  assert.deepEqual(issued, ["new-student"], "a first URL has no subscription to break");
  assert.equal(browser.document.querySelector("code")?.textContent, "https://portal.test/api/calendar/feed?token=token-1");
  await press("구독 URL 다시 발급");
  assert.deepEqual(issued, ["new-student"], "replacing the URL just issued also asks first");
  await press("취소");

  await act(async () => first.render(<CalendarFeedControl key="subscribed" studentId="subscribed-student" issuedAt={new Date("2026-10-01T01:30:00.000Z")} />));
  assert.match(browser.document.body.textContent ?? "", /10월 1일 발급 · 사용 중/u);
  assert.equal(browser.document.querySelector("code"), null, "a reloaded screen never shows the earlier URL");
  await press("구독 URL 다시 발급");
  assert.deepEqual(issued, ["new-student"]);
  assert.equal(browser.document.activeElement?.textContent, "취소");
  await press("구독 URL 다시 발급 확인");
  assert.deepEqual(issued, ["new-student", "subscribed-student"]);
  assert.equal(browser.document.querySelector("code")?.textContent, "https://portal.test/api/calendar/feed?token=token-2");
});

test("admin overview shows the curriculum ledger with its progress count only when the switch is on", async (context) => {
  await render(context, <OverviewTab
    studentId="student-1"
    showCurriculum
    modules={[
      { id: "module-1", weekNum: 1, title: "장비와 신호 흐름", isCompleted: true },
      { id: "module-2", weekNum: 2, title: "BPM 매칭", isCompleted: false },
    ]}
    lessons={[]}
  />);
  const heading = browser.document.getElementById("curriculum-heading");
  assert.match(heading?.textContent ?? "", /커리큘럼\s*1 \/ 2/u);
});

test("admin overview gathers account rows first, keeps each issue button in order, and orders lessons next → later → past", async (context) => {
  const referenceTime = new Date("2026-10-26T03:00:00.000Z");
  await render(context, <OverviewTab
    studentId="student-1"
    referenceTime={referenceTime}
    modules={[
      { id: "module-1", weekNum: 1, title: "장비와 신호 흐름", isCompleted: true },
      { id: "module-2", weekNum: 2, title: "BPM 매칭", isCompleted: false },
    ]}
    lessons={[
      { id: "lesson-past", scheduledAt: new Date("2026-10-21T10:00:00.000Z") },
      { id: "lesson-later", scheduledAt: new Date("2026-11-04T10:00:00.000Z") },
      { id: "lesson-next", scheduledAt: new Date("2026-10-28T10:00:00.000Z") },
    ]}
    calendarFeedIssuedAt={new Date("2026-10-14T01:00:00.000Z")}
    account={{ kind: "temporary" }}
  />);
  // 커리큘럼은 숨김 스위치가 꺼져 있으면 그리지 않는다. 켠 상태는 아래 테스트가 확인한다.
  assert.equal(browser.document.getElementById("curriculum-heading"), null);
  assert.doesNotMatch(browser.document.body.textContent ?? "", /커리큘럼|모듈 추가|장비와 신호 흐름/u);
  const lessonRows = [...browser.document.querySelectorAll('[aria-labelledby="lessons-heading"] li')].map((row) => row.textContent ?? "");
  assert.deepEqual(lessonRows.map((text) => text.slice(0, 15)), ["10.28 (수) 19:00", "11.04 (수) 19:00", "10.21 (수) 19:00"]);
  assert.match(lessonRows[0], /다음 레슨/u);
  assert.match(lessonRows[2], /지난 레슨/u);

  const account = browser.document.querySelector('[aria-labelledby="account-heading"] > div:last-of-type');
  assert.ok(account);
  const order = (element: { className: string }) => element.className.split(/\s+/u).find((name) => /^order-\d$/u.test(name));
  const children = [...account.children];
  const rowFor = (label: string) => children.find((child) => child.tagName === "P" && child.textContent?.startsWith(label));
  assert.equal(order(rowFor("가입")!), "order-1");
  assert.match(rowFor("가입")?.textContent ?? "", /임시 비밀번호를 학생이 아직 바꾸지 않았습니다/u);
  assert.equal(order(rowFor("캘린더 구독")!), "order-2");
  assert.match(rowFor("캘린더 구독")?.textContent ?? "", /10월 14일 발급 · 사용 중/u);
  const actionOrder = children.filter((child) => child.querySelector("button")).map((child) => [child.querySelector("button")?.textContent, order(child)]);
  assert.deepEqual(actionOrder, [["구독 URL 다시 발급", "order-3"], ["임시 비밀번호 다시 발급", "order-4"]], "tab order follows the visual button order");

  await press("레슨 추가");
  assert.equal(browser.document.activeElement, browser.document.getElementById("lesson-scheduled-at"), "the revealed form takes focus");
  await act(async () => {
    browser.document.activeElement?.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await act(async () => { await new Promise((resolve) => browser.requestAnimationFrame(() => resolve(undefined))); });
  assert.equal(browser.document.getElementById("lesson-scheduled-at"), null);
  assert.equal(browser.document.activeElement, browser.document.getElementById("lesson-add-trigger"), "Esc returns focus to the add button");
});

test("public lesson calendar keeps a refused address for correction and sends only the address", async (context) => {
  const submitted: [string, string | null][] = [];
  connectCalendar = async (_previous, data) => {
    submitted.push([String(data.get("url")), data.get("provider") as string | null]);
    return submitted.length === 1
      ? { error: "Google 또는 iCloud의 전용 공개 레슨 캘린더 주소만 사용할 수 있습니다." }
      : { success: "공개 레슨 캘린더를 연결했습니다." };
  };
  context.after(() => { connectCalendar = async () => ({}); });
  await render(context, <ExternalCalendarConnection connection={{ connected: false }} />);
  assert.equal(browser.document.querySelector("select"), null, "the provider follows the pasted address");
  const privateUrl = "https://example.com/calendar.ics";
  await fill("external-calendar-url", privateUrl);
  await press("연결");
  assert.match(browser.document.getElementById("external-calendar-error")?.textContent ?? "", /전용 공개 레슨 캘린더 주소/u);
  assert.equal(inputValue("url"), privateUrl, "the refused address stays for correction");
  const publicUrl = "https://calendar.google.com/calendar/ical/abc/public/basic.ics";
  await fill("external-calendar-url", publicUrl);
  await press("연결");
  assert.deepEqual(submitted, [[privateUrl, null], [publicUrl, null]]);
  assert.equal(inputValue("url"), "");
});
