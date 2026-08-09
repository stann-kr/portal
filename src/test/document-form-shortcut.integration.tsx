import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  createDocumentDraftKey,
  createFormDraftDataSignature,
  createFormDraftRecoveryKey,
  createFormDraftRecoveryPrefix,
  parseFormDraft,
  readFormDraftClearMarker,
  readFormDraftClearMarkers,
  serializeFormDraft,
} from "@/lib/form-draft";

type MockEditorProps = {
  ariaLabel?: string;
  contentVersion?: number;
  disabled?: boolean;
  footer?: React.ReactNode;
  initialContent?: string;
  onDirty?: (readLatestHtml: () => string) => void;
};

function MockFullEditor({
  ariaLabel = "문서 내용",
  contentVersion = 0,
  disabled = false,
  footer,
  initialContent = "",
  onDirty,
}: MockEditorProps) {
  const latestHtmlRef = React.useRef(initialContent);

  React.useEffect(() => {
    latestHtmlRef.current = initialContent;
  }, [contentVersion, initialContent]);

  return (
    <div>
      <textarea
        aria-label={ariaLabel}
        defaultValue={initialContent}
        disabled={disabled}
        onInput={(event) => {
          latestHtmlRef.current = event.currentTarget.value;
          onDirty?.(() => latestHtmlRef.current);
        }}
      />
      {footer}
    </div>
  );
}

type MockLinkProps = Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  href: string | { pathname?: string };
};

const MockLink = React.forwardRef<HTMLAnchorElement, MockLinkProps>(
  ({ href, ...props }, ref) => (
    <a
      ref={ref}
      href={typeof href === "string" ? href : (href.pathname ?? "#")}
      {...props}
    />
  ),
);
MockLink.displayName = "MockLink";

const actionCalls = {
  post: 0,
  qnaInline: 0,
  qnaReply: 0,
  qnaThread: 0,
};

const router = {
  push: () => undefined,
  refresh: () => undefined,
  replace: () => undefined,
};

mock.module("next/dynamic", {
  defaultExport: () => MockFullEditor,
});
mock.module("next/link", {
  defaultExport: MockLink,
});
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => router,
  },
});
mock.module("@/lib/actions/posts", {
  namedExports: {
    createPost: async () => {
      actionCalls.post += 1;
      return {};
    },
  },
});
mock.module("@/lib/actions/categories", {
  namedExports: {
    getCategories: async () => [],
  },
});
mock.module("@/lib/actions/documentDrafts", {
  namedExports: {
    readDocumentServerDraft: async () => ({ ok: true, draft: null }),
    saveDocumentServerDraft: async (input: {
      sourceKey: string;
      expectedDraftVersion: number;
      payloadJson: string;
      writerDeviceId: string;
    }) => ({
      ok: true,
      replayed: false,
      operationResultVersion: input.expectedDraftVersion + 1,
      current: {
        sourceKey: input.sourceKey,
        kind: "community-post",
        contextId: "new",
        payloadJson: input.payloadJson,
        payloadHash: createFormDraftDataSignature(JSON.parse(input.payloadJson)).slice(
          "sha256:".length,
        ),
        draftVersion: input.expectedDraftVersion + 1,
        baseResourceVersion: null,
        writerDeviceId: input.writerDeviceId,
        updatedAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1_000,
      },
    }),
    discardDocumentServerDraft: async () => ({
      ok: true,
      replayed: false,
      operationResultVersion: 0,
      current: null,
    }),
  },
});
mock.module("@/lib/actions/qna", {
  namedExports: {
    createQnaReply: async () => {
      actionCalls.qnaReply += 1;
      return {};
    },
    createQnaThread: async () => {
      actionCalls.qnaThread += 1;
      return {};
    },
    createQnaThreadInline: async () => {
      actionCalls.qnaInline += 1;
      return {};
    },
    updateThreadStatus: async () => ({ success: true, currentRevision: 2 }),
  },
});
mock.module("@/components/upload/FileUploader", {
  namedExports: {
    FileUploader: ({
      disabled,
      onUploadingChange,
    }: {
      disabled?: boolean;
      onUploadingChange?: (isUploading: boolean) => void;
    }) => (
      <button
        data-testid="upload-start"
        disabled={disabled}
        onClick={() => onUploadingChange?.(true)}
        type="button"
      >
        업로드 시작
      </button>
    ),
  },
});
mock.module("@/components/qna/AttachmentField", {
  namedExports: {
    AttachmentField: ({
      disabled,
      onUploadingChange,
    }: {
      disabled?: boolean;
      onUploadingChange?: (isUploading: boolean) => void;
    }) => (
      <div>
        <input name="attachmentUrl" type="hidden" value="" readOnly />
        <button
          data-testid="upload-start"
          disabled={disabled}
          onClick={() => onUploadingChange?.(true)}
          type="button"
        >
          업로드 시작
        </button>
      </div>
    ),
  },
});
mock.module("@/components/qna/ReplyCard", {
  namedExports: {
    ReplyCard: () => <div data-testid="reply-card" />,
  },
});

let NewPostForm: typeof import("@/components/community/NewPostForm").NewPostForm;
let NewQnaForm: typeof import("@/components/qna/NewQnaForm").NewQnaForm;
let NoteEditorForm: typeof import("@/components/notes/NoteEditorForm").NoteEditorForm;
let QnaSlideForm: typeof import("@/components/qna/QnaSlideForm").QnaSlideForm;
let ThreadDetailClient: typeof import("@/components/qna/ThreadDetailClient").ThreadDetailClient;

before(async () => {
  [
    { NewPostForm },
    { NewQnaForm },
    { NoteEditorForm },
    { QnaSlideForm },
    { ThreadDetailClient },
  ] = await Promise.all([
    import("@/components/community/NewPostForm"),
    import("@/components/qna/NewQnaForm"),
    import("@/components/notes/NoteEditorForm"),
    import("@/components/qna/QnaSlideForm"),
    import("@/components/qna/ThreadDetailClient"),
  ]);
});

after(() => {
  mock.restoreAll();
});

const GLOBAL_BINDINGS = [
  "window",
  "document",
  "navigator",
  "CustomEvent",
  "StorageEvent",
  "Event",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLFormElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "FormData",
  "KeyboardEvent",
  "MutationObserver",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
  "React",
] as const;

type GlobalBinding = (typeof GLOBAL_BINDINGS)[number];

function installBrowserGlobals(browserWindow: Window): () => void {
  const previousDescriptors = new Map<
    GlobalBinding,
    PropertyDescriptor | undefined
  >();
  const bindings: Record<GlobalBinding, unknown> = {
    window: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    CustomEvent: browserWindow.CustomEvent,
    StorageEvent: browserWindow.StorageEvent,
    Event: browserWindow.Event,
    Node: browserWindow.Node,
    Element: browserWindow.Element,
    HTMLElement: browserWindow.HTMLElement,
    HTMLFormElement: browserWindow.HTMLFormElement,
    HTMLInputElement: browserWindow.HTMLInputElement,
    HTMLTextAreaElement: browserWindow.HTMLTextAreaElement,
    FormData: browserWindow.FormData,
    KeyboardEvent: browserWindow.KeyboardEvent,
    MutationObserver: browserWindow.MutationObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true,
    React,
  };

  for (const name of GLOBAL_BINDINGS) {
    previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: bindings[name],
    });
  }

  return () => {
    for (const name of [...GLOBAL_BINDINGS].reverse()) {
      const descriptor = previousDescriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

type FormHarness = {
  browserWindow: Window;
  container: HTMLElement;
};

async function renderForm(
  context: TestContext,
  element: React.ReactElement,
  seed?: (storage: Storage) => void,
): Promise<FormHarness> {
  const browserWindow = new Window({ url: "https://portal.test/editor" });
  const restoreBrowserGlobals = installBrowserGlobals(browserWindow);
  seed?.(browserWindow.localStorage);
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as Element);

  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    restoreBrowserGlobals();
  });

  await act(async () => {
    root.render(element);
  });

  return { browserWindow, container: container as unknown as HTMLElement };
}

async function waitForCondition(
  condition: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
  assert.fail(message);
}

type SaveShortcutModifier = "ctrl" | "meta";

function enterEditorAndSaveDraftWithShortcut(
  harness: FormHarness,
  options: {
    editorLabel: string;
    expectedRawBeforeShortcut: string | null;
    latestContentHtml: string;
    modifier?: SaveShortcutModifier;
    storageKey: string;
  },
): Promise<{ requestSubmitCount: number; submitEventCount: number }> {
  const form = harness.container.querySelector("form");
  const editor = harness.container.querySelector(
    `textarea[aria-label="${options.editorLabel}"]`,
  );
  assert.ok(form, "작성 폼이 필요합니다.");
  assert.equal(editor?.tagName, "TEXTAREA");
  const editorElement = editor as unknown as HTMLTextAreaElement;
  assert.equal(
    harness.browserWindow.localStorage.getItem(options.storageKey),
    options.expectedRawBeforeShortcut,
    "단축키 직전에는 input debounce가 최신 본문을 durable 저장하지 않아야 합니다.",
  );

  let requestSubmitCount = 0;
  let submitEventCount = 0;
  Object.defineProperty(form, "requestSubmit", {
    configurable: true,
    value: () => {
      requestSubmitCount += 1;
    },
  });
  form.addEventListener("submit", () => {
    submitEventCount += 1;
  });

  const modifier = options.modifier ?? "ctrl";
  const shortcut = new harness.browserWindow.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: modifier === "ctrl",
    key: "s",
    metaKey: modifier === "meta",
  });
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      harness.browserWindow.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    assert.ok(valueSetter, "브라우저 textarea의 native value setter가 필요합니다.");
    valueSetter.call(editorElement, options.latestContentHtml);
    editorElement.dispatchEvent(
      new harness.browserWindow.Event("input", {
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    );
    editorElement.dispatchEvent(shortcut as unknown as Event);
  });

  assert.equal(shortcut.defaultPrevented, true, "브라우저 Save Page 동작을 막아야 합니다.");
  return Promise.resolve({ requestSubmitCount, submitEventCount });
}

function dispatchBlockedSaveShortcut(
  harness: FormHarness,
  target: Element,
): { requestSubmitCount: number; submitEventCount: number } {
  const form = harness.container.querySelector("form");
  assert.ok(form, "작성 폼이 필요합니다.");
  let requestSubmitCount = 0;
  let submitEventCount = 0;
  Object.defineProperty(form, "requestSubmit", {
    configurable: true,
    value: () => {
      requestSubmitCount += 1;
    },
  });
  form.addEventListener("submit", () => {
    submitEventCount += 1;
  });
  const shortcut = new harness.browserWindow.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: "s",
  });

  act(() => target.dispatchEvent(shortcut as unknown as Event));

  assert.equal(shortcut.defaultPrevented, true);
  return { requestSubmitCount, submitEventCount };
}

function listStorageKeysWithPrefix(storage: Storage, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function resetActionCalls(): void {
  actionCalls.post = 0;
  actionCalls.qnaInline = 0;
  actionCalls.qnaReply = 0;
  actionCalls.qnaThread = 0;
}

function assertNoPublicActionCalled(): void {
  assert.deepEqual(actionCalls, {
    post: 0,
    qnaInline: 0,
    qnaReply: 0,
    qnaThread: 0,
  });
}

test("새 게시물 Cmd/Ctrl+S는 최신 본문을 로컬 저장하고 게시하지 않는다", { concurrency: false }, async (context) => {
  resetActionCalls();
  const actorId = "post-shortcut-actor";
  const operationId = "012c1894-ea20-46b2-960f-35b01d873570";
  const draftKey = createDocumentDraftKey("community-post", actorId);
  const initialRaw = serializeFormDraft({
    operationId,
    boardType: "GENERAL",
    category: "general",
    isPinned: false,
    title: "단축키 게시물",
    contentHtml: "<p>복원한 게시물 본문</p>",
    mediaUrl: "",
  });
  const harness = await renderForm(
    context,
    <NewPostForm
      actorId={actorId}
      defaultBoardType="GENERAL"
      defaultCategory="general"
      isAdmin={false}
      returnTo="/community"
    />,
    (storage) => storage.setItem(draftKey, initialRaw),
  );
  const dispatchResult = await enterEditorAndSaveDraftWithShortcut(harness, {
    editorLabel: "커뮤니티 게시물 내용",
    expectedRawBeforeShortcut: initialRaw,
    latestContentHtml: "<p>publish 전 최신 게시물 본문</p>",
    storageKey: draftKey,
  });

  assert.deepEqual(dispatchResult, { requestSubmitCount: 0, submitEventCount: 0 });
  assertNoPublicActionCalled();
  const raw = harness.browserWindow.localStorage.getItem(
    draftKey,
  );
  assert.ok(raw);
  const stored = parseFormDraft<{
    boardType: string;
    category: string;
    contentHtml: string;
    isPinned: boolean;
    mediaUrl: string;
    mediaObjectId: string;
    operationId: string;
    title: string;
  }>(raw)?.data;
  assert.ok(stored?.operationId);
  assert.equal(stored.operationId, operationId);
  assert.deepEqual(stored, {
    operationId: stored.operationId,
    boardType: "GENERAL",
    category: "general",
    isPinned: false,
    title: "단축키 게시물",
    contentHtml: "<p>publish 전 최신 게시물 본문</p>",
    mediaUrl: "",
    mediaObjectId: "",
  });
});

test("새 Q&A 페이지 Cmd/Ctrl+S는 최신 본문을 로컬 저장하고 등록하지 않는다", { concurrency: false }, async (context) => {
  resetActionCalls();
  const actorId = "qna-page-shortcut-actor";
  const operationId = "ba6cb254-08e7-4d63-b3ab-f26061f7f493";
  const draftKey = createDocumentDraftKey("qna-thread", actorId);
  const initialRaw = serializeFormDraft({
    operationId,
    title: "단축키 질문",
    contentHtml: "<p>복원한 질문 본문</p>",
    attachmentUrl: "",
  });
  const harness = await renderForm(
    context,
    <NewQnaForm actorId={actorId} returnTo="/dashboard/qna" />,
    (storage) => storage.setItem(draftKey, initialRaw),
  );
  const dispatchResult = await enterEditorAndSaveDraftWithShortcut(harness, {
    editorLabel: "Q&A 질문 내용",
    expectedRawBeforeShortcut: initialRaw,
    latestContentHtml: "<p>publish 전 최신 질문 본문</p>",
    storageKey: draftKey,
  });

  assert.deepEqual(dispatchResult, { requestSubmitCount: 0, submitEventCount: 0 });
  assertNoPublicActionCalled();
  const raw = harness.browserWindow.localStorage.getItem(
    draftKey,
  );
  assert.ok(raw);
  const stored = parseFormDraft<{
    attachmentUrl: string;
    attachmentObjectId: string;
    contentHtml: string;
    operationId: string;
    title: string;
  }>(raw)?.data;
  assert.ok(stored?.operationId);
  assert.deepEqual(stored, {
    operationId: stored.operationId,
    title: "단축키 질문",
    contentHtml: "<p>publish 전 최신 질문 본문</p>",
    attachmentUrl: "",
    attachmentObjectId: "",
  });
});

test("Q&A 슬라이드 Cmd/Ctrl+S는 최신 본문을 로컬 저장하고 등록하지 않는다", { concurrency: false }, async (context) => {
  resetActionCalls();
  const actorId = "qna-slide-shortcut-actor";
  const operationId = "3ed9bf82-8279-4b10-a523-28c91c1dc09a";
  const draftKey = createDocumentDraftKey("qna-thread", actorId);
  const initialRaw = serializeFormDraft({
    operationId,
    title: "슬라이드 단축키 질문",
    contentHtml: "<p>복원한 슬라이드 본문</p>",
    attachmentUrl: "",
  });
  const harness = await renderForm(
    context,
    <QnaSlideForm
      actorId={actorId}
      onClose={() => undefined}
      onSuccess={() => undefined}
      returnTo="/dashboard"
    />,
    (storage) => storage.setItem(draftKey, initialRaw),
  );
  const dispatchResult = await enterEditorAndSaveDraftWithShortcut(harness, {
    editorLabel: "Q&A 질문 내용",
    expectedRawBeforeShortcut: initialRaw,
    latestContentHtml: "<p>publish 전 슬라이드 본문</p>",
    storageKey: draftKey,
  });

  assert.deepEqual(dispatchResult, { requestSubmitCount: 0, submitEventCount: 0 });
  assertNoPublicActionCalled();
  const raw = harness.browserWindow.localStorage.getItem(
    draftKey,
  );
  assert.ok(raw);
  const stored = parseFormDraft<{
    attachmentUrl: string;
    attachmentObjectId: string;
    contentHtml: string;
    operationId: string;
    title: string;
  }>(raw)?.data;
  assert.ok(stored?.operationId);
  assert.deepEqual(stored, {
    operationId: stored.operationId,
    title: "슬라이드 단축키 질문",
    contentHtml: "<p>publish 전 슬라이드 본문</p>",
    attachmentUrl: "",
    attachmentObjectId: "",
  });
});

test("Q&A 답변 Cmd/Ctrl+S는 최신 본문을 로컬 저장하고 등록하지 않는다", { concurrency: false }, async (context) => {
  resetActionCalls();
  const actorId = "qna-reply-shortcut-actor";
  const threadId = "thread-shortcut";
  const draftKey = createDocumentDraftKey("qna-reply", actorId, threadId);
  const harness = await renderForm(
    context,
    <ThreadDetailClient
      actorId={actorId}
      createdAt="2026-08-05T00:00:00.000Z"
      isAdmin={false}
      replies={[]}
      returnTo="/dashboard/qna"
      status="OPEN"
      version={1}
      deletedAt={null}
      studentName="학생"
      threadId={threadId}
      title="단축키 검증 스레드"
    />,
  );
  const dispatchResult = await enterEditorAndSaveDraftWithShortcut(harness, {
    editorLabel: "Q&A 추가 질문 내용",
    expectedRawBeforeShortcut: null,
    latestContentHtml: "<p>publish 전 최신 답변 본문</p>",
    storageKey: draftKey,
  });

  assert.deepEqual(dispatchResult, { requestSubmitCount: 0, submitEventCount: 0 });
  assertNoPublicActionCalled();
  const raw = harness.browserWindow.localStorage.getItem(
    draftKey,
  );
  assert.ok(raw);
  const stored = parseFormDraft<{
    attachmentUrl: string;
    attachmentObjectId: string;
    contentHtml: string;
    operationId: string;
  }>(raw)?.data;
  assert.ok(stored?.operationId);
  assert.deepEqual(stored, {
    operationId: stored.operationId,
    contentHtml: "<p>publish 전 최신 답변 본문</p>",
    attachmentUrl: "",
    attachmentObjectId: "",
  });
});

const FRESH_META_SHORTCUT_CASES: ReadonlyArray<{
  createElement: (actorId: string) => React.ReactElement;
  createStorageKey: (actorId: string) => string;
  editorLabel: string;
  name: string;
}> = [
  {
    name: "새 게시물",
    editorLabel: "커뮤니티 게시물 내용",
    createStorageKey: (actorId) => createDocumentDraftKey("community-post", actorId),
    createElement: (actorId) => (
      <NewPostForm
        actorId={actorId}
        defaultBoardType="GENERAL"
        defaultCategory="general"
        isAdmin={false}
        returnTo="/community"
      />
    ),
  },
  {
    name: "새 Q&A 페이지",
    editorLabel: "Q&A 질문 내용",
    createStorageKey: (actorId) => createDocumentDraftKey("qna-thread", actorId),
    createElement: (actorId) => (
      <NewQnaForm actorId={actorId} returnTo="/dashboard/qna" />
    ),
  },
  {
    name: "Q&A 슬라이드",
    editorLabel: "Q&A 질문 내용",
    createStorageKey: (actorId) => createDocumentDraftKey("qna-thread", actorId),
    createElement: (actorId) => (
      <QnaSlideForm
        actorId={actorId}
        onClose={() => undefined}
        onSuccess={() => undefined}
        returnTo="/dashboard"
      />
    ),
  },
  {
    name: "Q&A 답변",
    editorLabel: "Q&A 추가 질문 내용",
    createStorageKey: (actorId) =>
      createDocumentDraftKey("qna-reply", actorId, "thread-fresh-meta"),
    createElement: (actorId) => (
      <ThreadDetailClient
        actorId={actorId}
        createdAt="2026-08-05T00:00:00.000Z"
        isAdmin={false}
        replies={[]}
        returnTo="/dashboard/qna"
        status="OPEN"
        version={1}
        deletedAt={null}
        studentName="학생"
        threadId="thread-fresh-meta"
        title="fresh Cmd 검증 스레드"
      />
    ),
  },
];

for (const [index, shortcutCase] of FRESH_META_SHORTCUT_CASES.entries()) {
  test(`${shortcutCase.name} fresh mount의 Cmd+S도 로컬 저장만 수행한다`, { concurrency: false }, async (context) => {
    resetActionCalls();
    const actorId = `fresh-meta-actor-${index}`;
    const storageKey = shortcutCase.createStorageKey(actorId);
    const latestContentHtml = `<p>${shortcutCase.name} fresh Cmd 본문</p>`;
    const harness = await renderForm(
      context,
      shortcutCase.createElement(actorId),
    );

    const dispatchResult = await enterEditorAndSaveDraftWithShortcut(harness, {
      editorLabel: shortcutCase.editorLabel,
      expectedRawBeforeShortcut: null,
      latestContentHtml,
      modifier: "meta",
      storageKey,
    });

    assert.deepEqual(dispatchResult, { requestSubmitCount: 0, submitEventCount: 0 });
    assertNoPublicActionCalled();
    const raw = harness.browserWindow.localStorage.getItem(storageKey);
    assert.ok(raw);
    const stored = parseFormDraft<{
      contentHtml: string;
      operationId: string;
    }>(raw)?.data;
    assert.ok(stored?.operationId);
    assert.match(
      stored.operationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    assert.equal(stored.contentHtml, latestContentHtml);
  });
}

const UPLOAD_BUSY_CASES: ReadonlyArray<{
  createDraft: (operationId: string) => unknown;
  createElement: (actorId: string) => React.ReactElement;
  createStorageKey: (actorId: string) => string;
  editorLabel: string;
  name: string;
  titleSelector: string;
}> = [
  {
    name: "새 믹스셋 게시물",
    editorLabel: "커뮤니티 게시물 내용",
    titleSelector: "#post-title",
    createStorageKey: (actorId) => createDocumentDraftKey("community-post", actorId),
    createDraft: (operationId) => ({
      operationId,
      boardType: "FEEDBACK",
      category: "feedback",
      isPinned: false,
      title: "업로드 중 제출 차단 게시물",
      contentHtml: "<p>유효한 게시물 본문</p>",
      mediaUrl: "",
    }),
    createElement: (actorId) => (
      <NewPostForm
        actorId={actorId}
        defaultBoardType="FEEDBACK"
        defaultCategory="feedback"
        isAdmin={false}
        returnTo="/community"
      />
    ),
  },
  {
    name: "새 Q&A 페이지",
    editorLabel: "Q&A 질문 내용",
    titleSelector: "#qna-title",
    createStorageKey: (actorId) => createDocumentDraftKey("qna-thread", actorId),
    createDraft: (operationId) => ({
      operationId,
      title: "업로드 중 제출 차단 질문",
      contentHtml: "<p>유효한 질문 본문</p>",
      attachmentUrl: "",
    }),
    createElement: (actorId) => (
      <NewQnaForm actorId={actorId} returnTo="/dashboard/qna" />
    ),
  },
  {
    name: "Q&A 슬라이드",
    editorLabel: "Q&A 질문 내용",
    titleSelector: "#qna-slide-title",
    createStorageKey: (actorId) => createDocumentDraftKey("qna-thread", actorId),
    createDraft: (operationId) => ({
      operationId,
      title: "업로드 중 제출 차단 슬라이드 질문",
      contentHtml: "<p>유효한 슬라이드 질문 본문</p>",
      attachmentUrl: "",
    }),
    createElement: (actorId) => (
      <QnaSlideForm
        actorId={actorId}
        onClose={() => undefined}
        onSuccess={() => undefined}
        returnTo="/dashboard"
      />
    ),
  },
];

for (const [index, busyCase] of UPLOAD_BUSY_CASES.entries()) {
  test(`${busyCase.name} 작성 폼은 업로드 중 문서 변경과 저장 단축키를 함께 잠근다`, { concurrency: false }, async (context) => {
    resetActionCalls();
    const actorId = `upload-busy-actor-${index}`;
    const storageKey = busyCase.createStorageKey(actorId);
    const operationId = "fbd8512f-2777-42c1-b1dc-22fc49715333";
    const seededRaw = serializeFormDraft(busyCase.createDraft(operationId));
    const harness = await renderForm(
      context,
      busyCase.createElement(actorId),
      (storage) => storage.setItem(storageKey, seededRaw),
    );
    const uploadStart = harness.container.querySelector('[data-testid="upload-start"]');
    assert.equal(uploadStart?.tagName, "BUTTON");
    const uploadButton = uploadStart as unknown as HTMLButtonElement;
    const submitButton = harness.container.querySelector('button[type="submit"]');
    assert.equal(submitButton?.tagName, "BUTTON");
    assert.equal(
      (submitButton as unknown as HTMLButtonElement).disabled,
      false,
      "업로드 전에는 유효한 작성 폼을 제출할 수 있어야 합니다.",
    );

    await act(async () => uploadButton.click());

    const form = harness.container.querySelector("form");
    const titleInput = harness.container.querySelector(busyCase.titleSelector);
    const editor = harness.container.querySelector(
      `textarea[aria-label="${busyCase.editorLabel}"]`,
    );
    assert.ok(form);
    assert.equal(titleInput?.tagName, "INPUT");
    assert.equal(editor?.tagName, "TEXTAREA");
    const titleInputElement = titleInput as unknown as HTMLInputElement;
    const editorElement = editor as unknown as HTMLTextAreaElement;
    assert.equal(form.getAttribute("aria-busy"), "true");
    assert.equal(uploadButton.disabled, true);
    assert.equal(titleInputElement.disabled, true);
    assert.equal(editorElement.disabled, true);
    assert.equal((submitButton as unknown as HTMLButtonElement).disabled, true);

    const blockedSubmit = new harness.browserWindow.Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    act(() => form.dispatchEvent(blockedSubmit as unknown as Event));
    assert.equal(
      blockedSubmit.defaultPrevented,
      true,
      "programmatic submit도 upload busy guard에서 차단해야 합니다.",
    );
    assertNoPublicActionCalled();

    let requestSubmitCount = 0;
    let submitEventCount = 0;
    Object.defineProperty(form, "requestSubmit", {
      configurable: true,
      value: () => {
        requestSubmitCount += 1;
      },
    });
    form.addEventListener("submit", () => {
      submitEventCount += 1;
    });
    const shortcut = new harness.browserWindow.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "s",
    });
    act(() => form.dispatchEvent(shortcut as unknown as Event));

    assert.equal(shortcut.defaultPrevented, true);
    assert.equal(requestSubmitCount, 0);
    assert.equal(submitEventCount, 0);
    assert.equal(harness.browserWindow.localStorage.getItem(storageKey), seededRaw);
    assertNoPublicActionCalled();
  });
}

for (const [index, shortcutCase] of FRESH_META_SHORTCUT_CASES.entries()) {
  test(`${shortcutCase.name} 작성 폼은 미래 version canonical이 있으면 저장 단축키도 격리한다`, { concurrency: false }, async (context) => {
    resetActionCalls();
    const actorId = `future-canonical-actor-${index}`;
    const storageKey = shortcutCase.createStorageKey(actorId);
    const futureRaw = JSON.stringify({
      version: 2,
      savedAt: Date.now(),
      data: {
        operationId: "fbd8512f-2777-42c1-b1dc-22fc49715333",
        title: "미래 앱 초안",
        contentHtml: "<p>보존할 미래 본문</p>",
      },
    });
    const harness = await renderForm(
      context,
      shortcutCase.createElement(actorId),
      (storage) => storage.setItem(storageKey, futureRaw),
    );
    const editor = harness.container.querySelector(
      `textarea[aria-label="${shortcutCase.editorLabel}"]`,
    );
    assert.equal(editor?.tagName, "TEXTAREA");

    const dispatchResult = dispatchBlockedSaveShortcut(harness, editor);

    assert.deepEqual(dispatchResult, { requestSubmitCount: 0, submitEventCount: 0 });
    assert.equal(harness.browserWindow.localStorage.getItem(storageKey), futureRaw);
    assert.deepEqual(
      listStorageKeysWithPrefix(
        harness.browserWindow.localStorage,
        createFormDraftRecoveryPrefix(storageKey),
      ),
      [],
    );
    assertNoPublicActionCalled();
  });
}

test("종료된 Q&A의 보존 초안은 보이되 저장 단축키와 등록을 잠근다", { concurrency: false }, async (context) => {
  resetActionCalls();
  const actorId = "closed-thread-shortcut-actor";
  const threadId = "closed-thread-shortcut";
  const storageKey = createDocumentDraftKey("qna-reply", actorId, threadId);
  const initialRaw = serializeFormDraft({
    operationId: "2582730e-9edb-48cc-a6a7-b8939801a371",
    contentHtml: "<p>종료 전에 작성한 본문</p>",
    attachmentUrl: "",
  });
  const harness = await renderForm(
    context,
    <ThreadDetailClient
      actorId={actorId}
      createdAt="2026-08-05T00:00:00.000Z"
      isAdmin={false}
      replies={[]}
      returnTo="/dashboard/qna"
      status="CLOSED"
      version={1}
      deletedAt={null}
      studentName="학생"
      threadId={threadId}
      title="종료된 스레드"
    />,
    (storage) => storage.setItem(storageKey, initialRaw),
  );
  const editor = harness.container.querySelector(
    'textarea[aria-label="Q&A 추가 질문 내용"]',
  );
  assert.equal(editor?.tagName, "TEXTAREA");
  const editorElement = editor as unknown as HTMLTextAreaElement;
  assert.equal(editorElement.disabled, true);

  const dispatchResult = dispatchBlockedSaveShortcut(harness, editor);

  assert.deepEqual(dispatchResult, { requestSubmitCount: 0, submitEventCount: 0 });
  assert.equal(harness.browserWindow.localStorage.getItem(storageKey), initialRaw);
  assert.equal(harness.container.querySelector('button[type="submit"]'), null);
  assertNoPublicActionCalled();
});

test("노트 자체 저장의 정규화 결과와 서버 prop이 먼저 반영돼도 stale 잠금을 남기지 않는다", { concurrency: false }, async (context) => {
  const noteId = "note-normalized-own-save";
  const actorId = "normalized-own-save-actor";
  const initialNote = {
    id: noteId,
    title: "  새 제목  ",
    contentHtml: "<p>본문</p>",
    noteDate: null,
  };
  let submittedContentHtml: string | null = null;

  function NormalizedNoteSaveHarness() {
    const [note, setNote] = React.useState(initialNote);
    const action = React.useCallback(
      async (_previous: object, formData: FormData) => {
        submittedContentHtml = String(formData.get("contentHtml") ?? "");
        const savedNote = {
          id: noteId,
          title: String(formData.get("title") ?? "").trim(),
          contentHtml: submittedContentHtml,
          noteDate: null,
        };
        // revalidatePath 결과가 action state보다 먼저 보이는 순서를 재현한다.
        setNote(savedNote);
        await Promise.resolve();
        return { success: true, note: savedNote };
      },
      [],
    );

    return (
      <NoteEditorForm
        action={action}
        actorId={actorId}
        note={note}
      />
    );
  }

  const harness = await renderForm(context, <NormalizedNoteSaveHarness />);
  const titleInput = harness.container.querySelector('input[name="title"]');
  assert.equal(titleInput?.tagName, "INPUT");

  const editor = harness.container.querySelector('textarea[aria-label="노트 내용"]');
  assert.equal(editor?.tagName, "TEXTAREA");
  const editorElement = editor as unknown as HTMLTextAreaElement;
  const editorValueSetter = Object.getOwnPropertyDescriptor(
    harness.browserWindow.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  assert.ok(editorValueSetter);
  const latestContentHtml = "<p>React publish 전 최신 노트 본문</p>";
  await act(async () => {
    editorValueSetter.call(editorElement, latestContentHtml);
    editorElement.dispatchEvent(
      new harness.browserWindow.Event("input", {
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    );
  });

  const submitButton = harness.container.querySelector('button[type="submit"]');
  assert.equal(submitButton?.tagName, "BUTTON");
  assert.equal(
    (harness.container.querySelector('input[name="title"]') as unknown as HTMLInputElement)
      .value,
    "  새 제목  ",
  );
  assert.equal(
    (submitButton as unknown as HTMLButtonElement).disabled,
    false,
    "지연 publish 중에도 최신 reader로 제출할 수 있어야 합니다.",
  );
  await act(async () => {
    (submitButton as unknown as HTMLButtonElement).click();
  });
  await waitForCondition(
    () =>
      (harness.container.querySelector('input[name="title"]') as
        | HTMLInputElement
        | null)?.value === "새 제목" &&
      /변경사항을 저장했습니다\./u.test(harness.container.textContent ?? ""),
    "정규화된 자체 저장 결과와 완료 상태가 반영되어야 합니다.",
  );

  assert.equal(
    (harness.container.querySelector('input[name="title"]') as unknown as HTMLInputElement)
      .value,
    "새 제목",
  );
  assert.match(harness.container.textContent ?? "", /변경사항을 저장했습니다\./u);
  assert.doesNotMatch(harness.container.textContent ?? "", /더 최신 서버 노트가 있습니다\./u);
  assert.equal(
    (harness.container.querySelector('button[type="submit"]') as unknown as HTMLButtonElement)
      .disabled,
    false,
  );
  assert.equal(
    submittedContentHtml,
    latestContentHtml,
    "지연 editor reader의 최신 본문이 실제 FormData에 반영되어야 합니다.",
  );
  assert.equal(
    readFormDraftClearMarkers(
      harness.browserWindow.localStorage,
      createDocumentDraftKey("note", actorId, noteId),
    ).length,
    3,
    "compact·legacy full-base·bare 표현을 모두 제출 tombstone으로 남겨야 합니다.",
  );
});

test("노트 version 충돌은 내 초안을 보존하고 서버 최신본 확인·선택 뒤 새 operation으로 재시도한다", { concurrency: false }, async (context) => {
  const noteId = "note-version-conflict-choice";
  const actorId = "note-version-conflict-actor";
  const action = async () => ({
    error: "다른 화면에서 이 노트가 먼저 변경되었습니다.",
    conflictKind: "VERSION_CONFLICT" as const,
    currentRevision: 2,
    conflictNote: {
      id: noteId,
      title: "서버 최신 제목",
      contentHtml: "<p>서버 최신 본문</p>",
      noteDate: null,
      version: 2,
    },
  });
  const harness = await renderForm(
    context,
    <NoteEditorForm
      action={action}
      actorId={actorId}
      note={{
        id: noteId,
        title: "기준 제목",
        contentHtml: "<p>기준 본문</p>",
        noteDate: null,
        version: 1,
      }}
    />,
  );
  const titleInput = harness.container.querySelector('input[name="title"]');
  const operationInput = harness.container.querySelector(
    'input[name="operationId"]',
  );
  const baseRevisionInput = harness.container.querySelector(
    'input[name="baseRevision"]',
  );
  assert.equal(titleInput?.tagName, "INPUT");
  assert.equal(operationInput?.tagName, "INPUT");
  assert.equal(baseRevisionInput?.tagName, "INPUT");
  const firstOperationId = (operationInput as unknown as HTMLInputElement).value;
  const editor = harness.container.querySelector('textarea[aria-label="노트 내용"]');
  assert.equal(editor?.tagName, "TEXTAREA");
  const editorValueSetter = Object.getOwnPropertyDescriptor(
    harness.browserWindow.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  assert.ok(editorValueSetter);
  await act(async () => {
    editorValueSetter.call(editor, "<p>내 충돌 본문</p>");
    editor?.dispatchEvent(
      new harness.browserWindow.Event("input", { bubbles: true }) as unknown as Event,
    );
  });
  const submitButton = harness.container.querySelector('button[type="submit"]');
  assert.equal(submitButton?.tagName, "BUTTON");
  await act(async () => {
    (submitButton as unknown as HTMLButtonElement).click();
  });
  await waitForCondition(
    () => /서버 최신본 2번 확인·복사/u.test(harness.container.textContent ?? ""),
    "version 충돌 뒤 서버 최신본 비교 UI가 표시되어야 합니다.",
  );

  assert.equal(
    (harness.container.querySelector('textarea[aria-label="노트 내용"]') as unknown as HTMLTextAreaElement)
      .value,
    "<p>내 충돌 본문</p>",
  );
  assert.match(harness.container.textContent ?? "", /서버 최신 제목/u);
  assert.match(harness.container.textContent ?? "", /서버 최신 본문/u);
  const keepDraftButton = [...harness.container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("현재 초안으로 계속"),
  );
  assert.ok(keepDraftButton);
  await act(async () => {
    (keepDraftButton as unknown as HTMLButtonElement).click();
  });

  assert.equal(
    (harness.container.querySelector('textarea[aria-label="노트 내용"]') as unknown as HTMLTextAreaElement)
      .value,
    "<p>내 충돌 본문</p>",
  );
  assert.equal(
    (harness.container.querySelector('input[name="baseRevision"]') as unknown as HTMLInputElement)
      .value,
    "2",
  );
  assert.notEqual(
    (harness.container.querySelector('input[name="operationId"]') as unknown as HTMLInputElement)
      .value,
    firstOperationId,
  );
  assert.doesNotMatch(harness.container.textContent ?? "", /더 최신 서버 노트가 있습니다/u);
});

test("stale legacy 노트를 유지해 제출하면 canonical을 지우고 old-base recovery ghost를 숨긴다", { concurrency: false }, async (context) => {
  const noteId = "note-stale-legacy-submit";
  const actorId = "stale-legacy-submit-actor";
  const draftKey = createDocumentDraftKey("note", actorId, noteId);
  const recoveryKey = createFormDraftRecoveryKey(draftKey, "sleeping-old-client");
  const serverNote = {
    id: noteId,
    title: "현재 서버 제목",
    contentHtml: "<p>현재 서버 본문</p>",
    noteDate: null,
  };
  const restoredLegacyDraft = {
    title: "제출할 legacy 초안",
    noteDate: "",
    contentHtml: "<p>제출할 legacy 본문</p>",
    base: {
      title: "이전 서버 제목",
      noteDate: "",
      contentHtml: "<p>이전 서버 본문</p>",
    },
  };
  const restoredLegacyRaw = serializeFormDraft(
    restoredLegacyDraft,
    Date.now() - 10_000,
  );
  const action = async (_previous: object, formData: FormData) => ({
    success: true,
    note: {
      id: noteId,
      title: String(formData.get("title") ?? ""),
      contentHtml: String(formData.get("contentHtml") ?? ""),
      noteDate: null,
    },
  });
  const harness = await renderForm(
    context,
    <NoteEditorForm action={action} actorId={actorId} note={serverNote} />,
    (storage) => {
      storage.setItem(draftKey, restoredLegacyRaw);
      storage.setItem(recoveryKey, restoredLegacyRaw);
    },
  );
  const keepDraftButton = [...harness.container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("현재 초안으로 계속"),
  );
  assert.ok(keepDraftButton, "stale legacy 초안의 유지 선택지가 필요합니다.");

  await act(async () => {
    (keepDraftButton as unknown as HTMLButtonElement).click();
  });

  const submitButton = harness.container.querySelector('button[type="submit"]');
  assert.equal(submitButton?.tagName, "BUTTON");
  assert.equal((submitButton as unknown as HTMLButtonElement).disabled, false);
  await act(async () => {
    (submitButton as unknown as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });

  const storage = harness.browserWindow.localStorage;
  const exactLegacySignature = createFormDraftDataSignature(restoredLegacyDraft);
  assert.equal(storage.getItem(draftKey), null);
  assert.equal(
    storage.getItem(recoveryKey),
    restoredLegacyRaw,
    "mutable rolling recovery는 exact marker로 숨기되 원문을 보존해야 합니다.",
  );
  assert.equal(
    readFormDraftClearMarkers(storage, draftKey).some(
      (marker) => marker.signature === exactLegacySignature,
    ),
    true,
  );
  assert.equal(
    readFormDraftClearMarker(storage, draftKey)?.signature,
    exactLegacySignature,
    "head-only rolling client도 exact old-base 제출 tombstone을 읽어야 합니다.",
  );
});

test("stale compact S0 노트를 S1 기준으로 유지·제출하면 exact fingerprint ghost를 숨긴다", { concurrency: false }, async (context) => {
  const noteId = "note-stale-compact-submit";
  const actorId = "stale-compact-submit-actor";
  const draftKey = createDocumentDraftKey("note", actorId, noteId);
  const recoveryKey = createFormDraftRecoveryKey(draftKey, "sleeping-compact-client");
  const serverNote = {
    id: noteId,
    title: "S1 서버 제목",
    contentHtml: "<p>S1 서버 본문</p>",
    noteDate: null,
  };
  const restoredCompactDraft = {
    title: "제출할 compact 초안",
    noteDate: "",
    contentHtml: "<p>제출할 compact 본문</p>",
    baseFingerprint: `sha256:${"a".repeat(64)}`,
    base: { title: "", noteDate: "", contentHtml: "" },
  };
  const restoredCompactRaw = serializeFormDraft(
    restoredCompactDraft,
    Date.now() - 10_000,
  );
  const action = async (_previous: object, formData: FormData) => ({
    success: true,
    note: {
      id: noteId,
      title: String(formData.get("title") ?? ""),
      contentHtml: String(formData.get("contentHtml") ?? ""),
      noteDate: null,
    },
  });
  const harness = await renderForm(
    context,
    <NoteEditorForm action={action} actorId={actorId} note={serverNote} />,
    (storage) => {
      storage.setItem(draftKey, restoredCompactRaw);
      storage.setItem(recoveryKey, restoredCompactRaw);
    },
  );
  const keepDraftButton = [...harness.container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("현재 초안으로 계속"),
  );
  assert.ok(keepDraftButton, "stale compact 초안의 유지 선택지가 필요합니다.");

  await act(async () => {
    (keepDraftButton as unknown as HTMLButtonElement).click();
  });

  const submitButton = harness.container.querySelector('button[type="submit"]');
  assert.equal(submitButton?.tagName, "BUTTON");
  assert.equal((submitButton as unknown as HTMLButtonElement).disabled, false);
  await act(async () => {
    (submitButton as unknown as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });

  const storage = harness.browserWindow.localStorage;
  const exactCompactSignature = createFormDraftDataSignature(restoredCompactDraft);
  assert.equal(storage.getItem(draftKey), null);
  assert.equal(storage.getItem(recoveryKey), restoredCompactRaw);
  assert.equal(
    readFormDraftClearMarkers(storage, draftKey).some(
      (marker) => marker.signature === exactCompactSignature,
    ),
    true,
  );
  assert.equal(
    readFormDraftClearMarker(storage, draftKey)?.signature,
    exactCompactSignature,
    "S0 exact compact representation이 마지막 marker head에 남아야 합니다.",
  );
});
