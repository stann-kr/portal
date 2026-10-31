/**
 * @file src/test/live-note.integration.tsx
 * @description 읽기 전용 노트 실시간 보기(useLiveNote·LiveNoteArticle·UnifiedNoteDetail 읽기 분기)와
 * 목록 화면 자동 갱신(RouteAutoRefresh)의 DOM 동작. server action은 mock.module로 바꾸고 폴링 간격을 짧게 준다.
 */
import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

type HeadResult = Awaited<ReturnType<typeof import("@/lib/actions/privateNotes").getPrivateNoteHead>>;
type NoteResult = Awaited<ReturnType<typeof import("@/lib/actions/privateNotes").getPrivateNote>>;

const headCalls: string[] = [];
const noteCalls: string[] = [];
let headImpl: (noteId: string) => Promise<HeadResult> = async () => null;
let noteImpl: (noteId: string) => Promise<NoteResult> = async () => null;
const refresh = mock.fn();

mock.module("@/lib/actions/privateNotes", {
  namedExports: {
    getPrivateNoteHead: (noteId: string) => { headCalls.push(noteId); return headImpl(noteId); },
    getPrivateNote: (noteId: string) => { noteCalls.push(noteId); return noteImpl(noteId); },
    updatePrivateNote: async () => ({}),
  },
});
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({ refresh, push: () => undefined, replace: () => undefined }),
  },
});
const MockLink = React.forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>(
  ({ href, ...props }, ref) => <a ref={ref} href={href} {...props} />,
);
MockLink.displayName = "MockLink";
mock.module("next/link", { defaultExport: MockLink });
// 패널의 편집 분기는 이 suite의 대상이 아니다(document-form-shortcut에서 검사).
mock.module("@/components/notes/NoteEditorForm", {
  namedExports: { NoteEditorForm: () => <div data-testid="note-editor" /> },
});

let LiveNoteArticle: typeof import("@/components/notes/LiveNoteArticle").LiveNoteArticle;
let UnifiedNoteDetail: typeof import("@/components/student-portal/UnifiedNoteDetail").UnifiedNoteDetail;
let RouteAutoRefresh: typeof import("@/components/app-shell/RouteAutoRefresh").RouteAutoRefresh;

before(async () => {
  ({ LiveNoteArticle } = await import("@/components/notes/LiveNoteArticle"));
  ({ UnifiedNoteDetail } = await import("@/components/student-portal/UnifiedNoteDetail"));
  ({ RouteAutoRefresh } = await import("@/components/app-shell/RouteAutoRefresh"));
});

after(() => mock.restoreAll());

const GLOBAL_BINDINGS = [
  "window", "document", "navigator", "Event", "Node", "Element", "HTMLElement", "HTMLFormElement",
  "HTMLInputElement", "HTMLTextAreaElement", "MutationObserver", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT", "React",
] as const;
type GlobalBinding = (typeof GLOBAL_BINDINGS)[number];

function installBrowserGlobals(browserWindow: Window): () => void {
  const previous = new Map<GlobalBinding, PropertyDescriptor | undefined>();
  const bindings: Record<GlobalBinding, unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    Event: browserWindow.Event,
    Node: browserWindow.Node,
    Element: browserWindow.Element,
    HTMLElement: browserWindow.HTMLElement,
    HTMLFormElement: browserWindow.HTMLFormElement,
    HTMLInputElement: browserWindow.HTMLInputElement,
    HTMLTextAreaElement: browserWindow.HTMLTextAreaElement,
    MutationObserver: browserWindow.MutationObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };
  for (const name of GLOBAL_BINDINGS) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: bindings[name] });
  }
  return () => {
    for (const name of [...GLOBAL_BINDINGS].reverse()) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

type Harness = {
  browserWindow: Window;
  container: HTMLElement;
  rerender: (element: React.ReactElement) => Promise<void>;
  setVisibility: (state: "visible" | "hidden") => Promise<void>;
  setOnline: (online: boolean) => Promise<void>;
  focusWindow: () => Promise<void>;
};

async function renderLive(context: TestContext, element: React.ReactElement, options: { visibility?: "visible" | "hidden" } = {}): Promise<Harness> {
  const browserWindow = new Window({ url: "https://portal.test/dashboard/notes/live-note" });
  const restoreGlobals = installBrowserGlobals(browserWindow);
  headCalls.length = 0;
  noteCalls.length = 0;
  refresh.mock.resetCalls();
  let visibility: "visible" | "hidden" = options.visibility ?? "visible";
  let online = true;
  // happy-dom의 visibilityState·onLine은 prototype getter라 인스턴스에서 가린다.
  Object.defineProperty(browserWindow.document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(browserWindow.navigator, "onLine", { configurable: true, get: () => online });
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as Element);
  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    restoreGlobals();
    headImpl = async () => null;
    noteImpl = async () => null;
  });
  await act(async () => { root.render(element); });
  const dispatch = (target: Window | Window["document"], type: string) =>
    act(async () => { target.dispatchEvent(new browserWindow.Event(type)); });
  return {
    browserWindow,
    container: container as unknown as HTMLElement,
    rerender: (next) => act(async () => { root.render(next); }),
    setVisibility: async (state) => { visibility = state; await dispatch(browserWindow.document, "visibilitychange"); },
    setOnline: async (next) => { online = next; await dispatch(browserWindow, next ? "online" : "offline"); },
    focusWindow: () => dispatch(browserWindow, "focus"),
  };
}

const sleep = (ms: number) => act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, ms)); });

async function waitFor(condition: () => boolean, message: string, attempts = 40): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await sleep(5);
  }
  assert.fail(message);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// 수정 줄("방금 전")은 실제 시계로 계산하므로 고정 시각이 아니라 지금 기준으로 만든다.
const NOW = Date.now();
const noteRecord = (version: number, title: string, contentHtml: string): NonNullable<NoteResult> => ({
  id: "live-note",
  studentId: "student-1",
  authorId: "admin-1",
  title,
  contentHtml,
  noteDate: new Date("2026-10-31T00:00:00.000Z"),
  createdAt: new Date(NOW - 60_000),
  updatedAt: new Date(NOW - 30_000 + version * 1_000),
  version,
  deletedAt: null,
  authorName: "Stann",
});
const head = (version: number): HeadResult => ({ id: "live-note", version, updatedAt: new Date(NOW - 30_000 + version * 1_000) });
const parent = { href: "/dashboard/student/notes", label: "노트", backLabel: "노트 목록으로" };

function article(note: NonNullable<NoteResult>, pollDelay = 10) {
  return (
    <LiveNoteArticle
      note={{ id: note.id, title: note.title, contentHtml: note.contentHtml, noteDate: note.noteDate, createdAt: note.createdAt, updatedAt: note.updatedAt, version: note.version }}
      authorName="Stann"
      now={NOW}
      parent={parent}
      historyHref="/dashboard/notes/live-note/history"
      pollDelay={pollDelay}
    />
  );
}

test("문서 읽기 화면은 head version이 오르면 본문을 다시 받아 제자리에서 바꾼다", { concurrency: false }, async (context) => {
  let version = 1;
  headImpl = async () => head(version);
  noteImpl = async () => noteRecord(version, version === 1 ? "수업 노트" : "수업 노트(수정)", version === 1 ? "<p>처음 본문</p>" : "<p>Stann이 이어 쓴 본문</p>");
  const harness = await renderLive(context, article(noteRecord(1, "수업 노트", "<p>처음 본문</p>")));
  const body = () => harness.container.querySelector(".rich-text")!;
  const bodyElement = body();
  assert.match(bodyElement.innerHTML, /처음 본문/u);
  assert.equal(harness.container.querySelector('[role="status"][aria-live="polite"]')?.textContent, "");

  // version이 같으면 본문을 다시 받지 않는다.
  await waitFor(() => headCalls.length >= 2, "head를 폴링한다");
  assert.equal(noteCalls.length, 0, "변화가 없으면 본문 조회가 없다");

  version = 2;
  await waitFor(() => /이어 쓴 본문/u.test(body().innerHTML), "새 본문으로 바뀐다");
  assert.equal(noteCalls.length, 1);
  assert.equal(body(), bodyElement, "본문 요소를 새로 만들지 않고 내용만 바꾼다");
  assert.match(harness.container.querySelector("h1")?.textContent ?? "", /수업 노트\(수정\)/u);
  assert.match(harness.container.querySelector('nav[aria-label="위치"]')?.textContent ?? "", /수업 노트\(수정\)/u, "위치 줄 제목도 따라온다");
  assert.equal(harness.container.querySelector('[role="status"][aria-live="polite"]')?.textContent, "노트가 방금 갱신되었습니다.");
  assert.match(harness.container.textContent ?? "", /방금 전/u, "수정 줄은 갱신 시각 기준");
  assert.match(harness.container.textContent ?? "", /읽기 전용/u);

  // 같은 version이 이어지면 본문 조회는 더 없다.
  const noteCallsAfter = noteCalls.length;
  await waitFor(() => headCalls.length >= 6, "폴링이 계속된다");
  assert.equal(noteCalls.length, noteCallsAfter);
});

test("탭이 숨겨져 있으면 폴링하지 않고, 다시 보이면 즉시 한 번 조회한다", { concurrency: false }, async (context) => {
  headImpl = async () => head(1);
  const harness = await renderLive(context, article(noteRecord(1, "수업 노트", "<p>처음 본문</p>"), 10), { visibility: "hidden" });
  await sleep(60);
  assert.equal(headCalls.length, 0, "숨김 상태에서는 head 조회가 없다");

  await harness.setVisibility("visible");
  await waitFor(() => headCalls.length >= 1, "보이면 즉시 조회한다", 4);
  await waitFor(() => headCalls.length >= 3, "보이는 동안 폴링이 이어진다");

  // 다시 숨기면 멈추고, 오프라인이면 멈추고, 온라인이 되면 바로 조회한다.
  await harness.setVisibility("hidden");
  const countWhileHidden = headCalls.length;
  await sleep(60);
  assert.ok(headCalls.length <= countWhileHidden + 1, "숨긴 뒤에는 진행 중이던 한 번 외에 조회가 없다");
  await harness.setVisibility("visible");
  await harness.setOnline(false);
  const countWhileOffline = headCalls.length;
  await sleep(60);
  assert.ok(headCalls.length <= countWhileOffline + 1, "오프라인에서는 조회가 없다");
  await harness.setOnline(true);
  await waitFor(() => headCalls.length >= countWhileOffline + 2, "온라인이 되면 바로 조회한다", 4);
});

test("늦게 도착한 옛 본문은 더 새로운 본문을 덮지 않는다", { concurrency: false }, async (context) => {
  const lateBody = deferred<NoteResult>();
  headImpl = async () => head(2);
  noteImpl = () => lateBody.promise;
  const harness = await renderLive(context, article(noteRecord(1, "수업 노트", "<p>처음 본문</p>")));
  await waitFor(() => noteCalls.length === 1, "version 2를 보고 본문을 요청한다");

  // 그 사이 서버가 더 새 노트(version 3)를 넘긴다(router.refresh 등).
  await harness.rerender(article(noteRecord(3, "서버 v3", "<p>서버가 준 v3 본문</p>")));
  assert.match(harness.container.querySelector(".rich-text")?.innerHTML ?? "", /v3 본문/u);

  await act(async () => { lateBody.resolve(noteRecord(2, "늦은 v2", "<p>늦게 온 v2 본문</p>")); });
  await sleep(30);
  assert.match(harness.container.querySelector(".rich-text")?.innerHTML ?? "", /v3 본문/u, "v2가 v3를 덮지 않는다");
  assert.doesNotMatch(harness.container.querySelector("h1")?.textContent ?? "", /늦은 v2/u);
  assert.equal(harness.container.querySelector('[role="status"][aria-live="polite"]')?.textContent, "", "갱신 안내도 내지 않는다");
});

test("head가 사라지면(휴지통) 마지막 본문을 둔 채 안내만 바꾼다", { concurrency: false }, async (context) => {
  headImpl = async () => null;
  const harness = await renderLive(context, article(noteRecord(1, "수업 노트", "<p>처음 본문</p>")));
  await waitFor(() => /더 이상 볼 수 없습니다/u.test(harness.container.textContent ?? ""), "missing 안내");
  assert.match(harness.container.querySelector(".rich-text")?.innerHTML ?? "", /처음 본문/u);
  assert.equal(noteCalls.length, 0);
});

test("캘린더 패널의 읽기 전용 노트도 폴링으로 본문을 바꾸고 캘린더 항목에 알린다", { concurrency: false }, async (context) => {
  let version = 3;
  headImpl = async () => head(version);
  noteImpl = async () => ({ ...noteRecord(version, version === 3 ? "패널 노트" : "패널 노트(수정)", version === 3 ? "<p>처음 본문</p>" : "<p>패널에서 바뀐 본문</p>"), id: "panel-note" });
  const updates: Array<{ title: string; preview: unknown }> = [];
  const item = {
    id: "panel-note",
    type: "NOTE" as const,
    title: "패널 노트",
    date: new Date("2026-10-31T00:00:00.000Z"),
    metadata: { preview: "처음 본문", authorId: "admin-1", noteDate: new Date("2026-10-31T00:00:00.000Z") },
    space: { studentId: "student-1", label: "학생" },
    source: { kind: "PORTAL" as const, entity: "PRIVATE_NOTE" as const, label: "포탈" },
  };
  const harness = await renderLive(context, (
    <UnifiedNoteDetail
      item={item}
      returnTo="/dashboard/student"
      viewer={{ actorId: "student-1", role: "student" }}
      onItemUpdated={(updated) => updates.push({ title: updated.title, preview: updated.metadata.preview })}
      livePollDelay={10}
    />
  ));
  await waitFor(() => /읽기 전용/u.test(harness.container.textContent ?? ""), "읽기 전용 본문이 열린다");
  assert.equal(harness.container.querySelector('[data-testid="note-editor"]'), null, "편집기는 열지 않는다");
  assert.equal(noteCalls.length, 1, "패널이 처음 본문을 한 번 받는다");

  version = 4;
  await waitFor(() => /패널에서 바뀐 본문/u.test(harness.container.querySelector(".rich-text")?.innerHTML ?? ""), "패널 본문이 바뀐다");
  assert.match(harness.container.querySelector("h2")?.textContent ?? "", /패널 노트\(수정\)/u);
  assert.deepEqual(updates.at(-1), { title: "패널 노트(수정)", preview: "패널에서 바뀐 본문" });
});

test("목록 자동 갱신은 보일 때 주기·focus에서 refresh하고 입력 중에는 건너뛴다", { concurrency: false }, async (context) => {
  const harness = await renderLive(context, (
    <div>
      <RouteAutoRefresh intervalMs={15} minGapMs={0} />
      <textarea aria-label="본문" />
      <div contentEditable="true" data-testid="editor" />
      <form data-testid="form"><input name="title" /></form>
    </div>
  ));
  await waitFor(() => refresh.mock.callCount() >= 2, "주기적으로 refresh한다");

  const textarea = harness.container.querySelector("textarea")!;
  await act(async () => { textarea.focus(); });
  refresh.mock.resetCalls();
  await sleep(50);
  await harness.focusWindow();
  assert.equal(refresh.mock.callCount(), 0, "textarea 입력 중에는 refresh하지 않는다");

  const editor = harness.container.querySelector<HTMLElement>('[data-testid="editor"]')!;
  editor.setAttribute("tabindex", "0");
  await act(async () => { editor.focus(); });
  await sleep(50);
  assert.equal(refresh.mock.callCount(), 0, "contenteditable 입력 중에도 refresh하지 않는다");

  await act(async () => { editor.blur(); });
  harness.container.querySelector("form")!.setAttribute("aria-busy", "true");
  await sleep(50);
  assert.equal(refresh.mock.callCount(), 0, "제출 중인 form이 있으면 refresh하지 않는다");
  harness.container.querySelector("form")!.removeAttribute("aria-busy");

  await harness.focusWindow();
  assert.equal(refresh.mock.callCount(), 1, "입력이 끝나면 focus에서 바로 refresh한다");

  await harness.setVisibility("hidden");
  refresh.mock.resetCalls();
  await sleep(50);
  assert.equal(refresh.mock.callCount(), 0, "숨김 상태에서는 refresh하지 않는다");
  await harness.setVisibility("visible");
  assert.equal(refresh.mock.callCount(), 1, "다시 보이면 바로 refresh한다");
});
