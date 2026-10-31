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
/** head 조회가 시작된 시각(ms). backoff 간격 검사에 쓴다. */
const headCallTimes: number[] = [];
const noteCalls: string[] = [];
let headImpl: (noteId: string) => Promise<HeadResult> = async () => null;
let noteImpl: (noteId: string) => Promise<NoteResult> = async () => null;
const refresh = mock.fn();

mock.module("@/lib/actions/privateNotes", {
  namedExports: {
    getPrivateNoteHead: (noteId: string) => { headCalls.push(noteId); headCallTimes.push(Date.now()); return headImpl(noteId); },
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
let useHistoryReturn: typeof import("@/components/app-shell/RouteAutoRefresh").useHistoryReturn;

before(async () => {
  ({ LiveNoteArticle } = await import("@/components/notes/LiveNoteArticle"));
  ({ UnifiedNoteDetail } = await import("@/components/student-portal/UnifiedNoteDetail"));
  ({ RouteAutoRefresh, useHistoryReturn } = await import("@/components/app-shell/RouteAutoRefresh"));
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
  headCallTimes.length = 0;
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
  const tree = (intervalMs: number) => (
    <div>
      <RouteAutoRefresh intervalMs={intervalMs} minGapMs={0} />
      <textarea aria-label="본문" />
      <div contentEditable="true" data-testid="editor" />
      <form data-testid="form"><input name="title" /></form>
    </div>
  );
  const harness = await renderLive(context, tree(15));
  await waitFor(() => refresh.mock.callCount() >= 2, "주기적으로 refresh한다");
  // 이후 단계는 focus·visibilitychange만 세므로 주기 틱이 끼어들지 않게 간격을 길게 바꾼다.
  await harness.rerender(tree(10_000));

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

test("head 조회가 거듭 실패하면 변화 없음과 같이 간격이 늘고, 복구되면 본문을 다시 받는다", { concurrency: false }, async (context) => {
  headImpl = async () => { throw new Error("session expired"); };
  const harness = await renderLive(context, article(noteRecord(1, "수업 노트", "<p>처음 본문</p>"), 10));
  // 10ms 기본에서 실패 3회마다 두 배: 10·10·10·20·20·20·40·40·40·80… 10번째 조회 앞 간격이 80ms쯤이다.
  await waitFor(() => headCalls.length >= 10, "실패해도 폴링은 이어진다", 160);
  const firstGap = headCallTimes[1] - headCallTimes[0];
  const laterGap = headCallTimes[9] - headCallTimes[8];
  assert.ok(laterGap >= firstGap * 3, `실패가 쌓이면 간격이 늘어난다(처음 ${firstGap}ms, 나중 ${laterGap}ms)`);
  assert.equal(noteCalls.length, 0);
  assert.match(harness.container.querySelector(".rich-text")?.innerHTML ?? "", /처음 본문/u, "오류 중에도 마지막 본문을 둔다");

  headImpl = async () => head(2);
  noteImpl = async () => noteRecord(2, "수업 노트(복구)", "<p>복구 뒤 본문</p>");
  await waitFor(() => /복구 뒤 본문/u.test(harness.container.querySelector(".rich-text")?.innerHTML ?? ""), "복구되면 다음 조회에서 본문을 받는다", 160);
});

test("진행 중 조회에 wake가 겹친 뒤 숨겨지면 응답이 와도 바로 다시 조회하지 않는다", { concurrency: false }, async (context) => {
  const pendingHead = deferred<HeadResult>();
  headImpl = () => pendingHead.promise;
  const harness = await renderLive(context, article(noteRecord(1, "수업 노트", "<p>처음 본문</p>"), 10));
  await waitFor(() => headCalls.length === 1, "첫 조회가 진행 중이다");

  await harness.focusWindow();
  assert.equal(headCalls.length, 1, "진행 중이면 wake는 다음 조회 예약만 한다");
  await harness.setVisibility("hidden");
  headImpl = async () => head(1);
  await act(async () => { pendingHead.resolve(head(1)); });
  await sleep(60);
  assert.equal(headCalls.length, 1, "숨겨진 뒤 도착한 응답은 추가 조회를 만들지 않는다");

  await harness.setVisibility("visible");
  await waitFor(() => headCalls.length >= 2, "다시 보이면 즉시 조회한다", 4);
});

test("목록 자동 갱신은 history 복귀(popstate) 직후 mount에서만 한 번 다시 받는다", { concurrency: false }, async (context) => {
  const autoRefresh = <RouteAutoRefresh intervalMs={10_000} minGapMs={0} />;
  const editor = <div contentEditable="true" tabIndex={0} data-testid="editor" />;
  // (b) 일반 진입: 서버가 방금 렌더했으므로 mount 때 받지 않는다.
  const harness = await renderLive(context, <div>{editor}{autoRefresh}</div>);
  await sleep(30);
  assert.equal(refresh.mock.callCount(), 0, "popstate 없는 mount에서는 refresh하지 않는다");

  // (a) 다른 화면으로 갔다가(unmount) 뒤로(popstate) 돌아와 mount되면 한 번 받는다.
  await harness.rerender(<div>{editor}</div>);
  await act(async () => { harness.browserWindow.dispatchEvent(new harness.browserWindow.PopStateEvent("popstate")); });
  await harness.rerender(<div>{editor}{autoRefresh}</div>);
  await sleep(30);
  assert.equal(refresh.mock.callCount(), 1, "popstate 직후 mount에서 한 번 refresh한다");

  // 같은 popstate로 다시 mount돼도(StrictMode·두 번째 인스턴스) 더 받지 않는다.
  await harness.rerender(<div>{editor}</div>);
  await harness.rerender(<div>{editor}{autoRefresh}</div>);
  await sleep(30);
  assert.equal(refresh.mock.callCount(), 1, "소비한 popstate로는 다시 refresh하지 않는다");

  // (c) popstate 뒤 mount이지만 contenteditable에 입력 중이면 건너뛴다.
  await harness.rerender(<div>{editor}</div>);
  const editorElement = harness.container.querySelector<HTMLElement>('[data-testid="editor"]')!;
  await act(async () => { editorElement.focus(); });
  await act(async () => { harness.browserWindow.dispatchEvent(new harness.browserWindow.PopStateEvent("popstate")); });
  await harness.rerender(<div>{editor}{autoRefresh}</div>);
  await sleep(30);
  assert.equal(refresh.mock.callCount(), 1, "입력 중이면 history 복귀 mount에서도 refresh하지 않는다");
  await act(async () => { editorElement.blur(); });
  await harness.focusWindow();
  assert.equal(refresh.mock.callCount(), 2, "입력이 끝나면 focus에서 받는다(건너뛴 것이지 꺼진 것이 아니다)");

  // bfcache 복원(pageshow persisted)은 mount 없이 그대로 돌아오므로 그 자리에서 한 번 받는다.
  refresh.mock.resetCalls();
  await act(async () => {
    const pageShow = new harness.browserWindow.Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: true });
    harness.browserWindow.dispatchEvent(pageShow);
  });
  assert.equal(refresh.mock.callCount(), 1, "bfcache 복원에서 refresh한다");
  await act(async () => {
    const pageShow = new harness.browserWindow.Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: false });
    harness.browserWindow.dispatchEvent(pageShow);
  });
  assert.equal(refresh.mock.callCount(), 1, "일반 pageshow(persisted=false)에서는 refresh하지 않는다");
});

test("history 복귀 hook은 props를 state로 쓰는 화면(관리자 홈 캘린더)에 popstate 직후 mount·bfcache 복원에서만 알린다", { concurrency: false }, async (context) => {
  let returns = 0;
  function Probe() {
    useHistoryReturn(() => { returns += 1; });
    return null;
  }
  const harness = await renderLive(context, <div><Probe /></div>);
  await sleep(10);
  assert.equal(returns, 0, "일반 진입 mount에서는 알리지 않는다");

  await harness.rerender(<div />);
  await act(async () => { harness.browserWindow.dispatchEvent(new harness.browserWindow.PopStateEvent("popstate")); });
  await harness.rerender(<div><Probe /></div>);
  await sleep(10);
  assert.equal(returns, 1, "뒤로/앞으로 직후 mount에서 한 번 알린다");

  await act(async () => {
    const pageShow = new harness.browserWindow.Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: true });
    harness.browserWindow.dispatchEvent(pageShow);
  });
  assert.equal(returns, 2, "bfcache 복원에서 알린다");

  // React 19 eager transition: Next의 popstate 리스너 안에서 되살린 트리가 먼저 mount되고 우리 리스너는 그 뒤에 불린다.
  await harness.rerender(<div />);
  await harness.rerender(<div><Probe /></div>);
  assert.equal(returns, 2, "popstate 전 mount 시점에는 아직 알리지 않는다");
  await act(async () => { harness.browserWindow.dispatchEvent(new harness.browserWindow.PopStateEvent("popstate")); });
  assert.equal(returns, 3, "mount 직후 도착한 popstate에서 그 mount를 복귀로 보고 알린다");
  await act(async () => { harness.browserWindow.dispatchEvent(new harness.browserWindow.PopStateEvent("popstate")); });
  assert.equal(returns, 3, "이미 알린 mount는 같은 화면 안의 다음 popstate로 다시 알리지 않는다");
});
