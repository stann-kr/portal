import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import * as Y from "yjs";
import { QNA_STATUS_LABELS } from "@/lib/qna-status";

type MockEditorProps = {
  collaboration?: { doc: Y.Doc };
  ariaLabel?: string;
  contentVersion?: number;
  disabled?: boolean;
  footer?: React.ReactNode;
  initialContent?: string;
  onDirty?: (readLatestHtml: () => string) => void;
};

/** 저장 버튼이 있는 form은 그 버튼을, 저장 버튼 없이 자동 저장하는 노트 form은 form 제출을 같은 조작으로 다룬다. */
type SubmitControl = { click(): void; focus(): void; readonly disabled: boolean };
function submitControl(container: Element): SubmitControl {
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) return button;
  const form = container.querySelector<HTMLFormElement>("form");
  assert.ok(form, "제출할 form이 있어야 합니다.");
  return {
    click: () => form.requestSubmit(),
    focus: () => form.querySelector<HTMLElement>('[name="title"]')?.focus(),
    get disabled() {
      return form.getAttribute("aria-busy") === "true";
    },
  };
}
/** 노트 제목도 textarea라서 본문 편집기는 제목이 아닌 textarea로 찾는다. */
const BODY_FIELD = 'textarea:not([name="title"])';

/** 공동 편집 문서의 본문 글자(문단 텍스트 이음). 실제 편집기 대신 Y.Doc 본문을 textarea로 보여 준다. */
function collabFragmentText(doc: Y.Doc): string {
  return doc
    .getXmlFragment("default")
    .toArray()
    .map((node) => (node instanceof Y.XmlElement ? node.toArray().map((child) => (child instanceof Y.XmlText ? child.toString() : "")).join("") : ""))
    .join("\n");
}

function setCollabFragmentText(doc: Y.Doc, text: string): void {
  doc.transact(() => {
    const fragment = doc.getXmlFragment("default");
    if (fragment.length > 0) fragment.delete(0, fragment.length);
    const paragraph = new Y.XmlElement("paragraph");
    const run = new Y.XmlText();
    paragraph.insert(0, [run]);
    fragment.insert(0, [paragraph]);
    if (text) run.insert(0, text);
  });
}

function MockCollabEditor({ collaboration, ariaLabel = "문서 내용", disabled = false, footer }: MockEditorProps & { collaboration: { doc: Y.Doc } }) {
  const { doc } = collaboration;
  const [value, setValue] = React.useState(() => collabFragmentText(doc));
  React.useEffect(() => {
    const sync = () => setValue(collabFragmentText(doc));
    doc.on("update", sync);
    return () => doc.off("update", sync);
  }, [doc]);
  return (
    <div>
      <textarea
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => setCollabFragmentText(doc, event.currentTarget.value)}
      />
      {footer}
    </div>
  );
}

function MockFullEditor(props: MockEditorProps) {
  if (props.collaboration) return <MockCollabEditor {...props} collaboration={props.collaboration} />;
  return <MockPlainEditor {...props} />;
}

function MockPlainEditor({
  ariaLabel = "문서 내용",
  contentVersion = 0,
  disabled = false,
  footer,
  initialContent = "",
  onDirty,
}: MockEditorProps) {
  const latestHtmlRef = React.useRef(initialContent);
  // 실제 편집기처럼 본문을 스스로 들고 있어, form action이 끝난 뒤 React의 form reset에 지워지지 않는다.
  // 명시적 교체(contentVersion·initialContent 변경)만 표시값을 바꾼다.
  const [value, setValue] = React.useState(initialContent);
  const [applied, setApplied] = React.useState({ contentVersion, initialContent });
  if (applied.contentVersion !== contentVersion || applied.initialContent !== initialContent) {
    setApplied({ contentVersion, initialContent });
    setValue(initialContent);
  }

  React.useEffect(() => {
    latestHtmlRef.current = initialContent;
  }, [contentVersion, initialContent]);

  return (
    <div>
      <textarea
        aria-label={ariaLabel}
        data-content-version={contentVersion}
        value={value}
        disabled={disabled}
        onChange={() => undefined}
        onInput={(event) => {
          latestHtmlRef.current = event.currentTarget.value;
          setValue(event.currentTarget.value);
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
let restoreNote: typeof import("@/lib/actions/privateNotes").restorePrivateNoteRevision = async () => ({ success: true });
let changeNoteLifecycle: typeof import("@/lib/actions/privateNotes").trashPrivateNote = async () => ({ success: true });
let loadPanelNote: typeof import("@/lib/actions/privateNotes").getPrivateNote = async () => null;
let savePanelNote: typeof import("@/lib/actions/privateNotes").updatePrivateNote = async () => ({});
let restorePost: typeof import("@/lib/actions/posts").restorePostRevision = async () => ({ success: true });
let changePostLifecycle: typeof import("@/lib/actions/posts").restorePost = async () => ({ success: true, purged: false });
let saveQnaReply: typeof import("@/lib/actions/qna").createQnaReply = async () => ({});
let saveQnaThread: typeof import("@/lib/actions/qna").createQnaThread = async () => ({});
let saveQnaInline: typeof import("@/lib/actions/qna").createQnaThreadInline = async () => ({});
let saveNewPost: typeof import("@/lib/actions/posts").createPost = async () => ({});
let savePostEdit: typeof import("@/lib/actions/posts").updatePostContent = async () => ({});
let changeQnaStatus: typeof import("@/lib/actions/qna").updateThreadStatus = async () => ({ success: true, currentRevision: 2 });
let changeQnaLifecycle: typeof import("@/lib/actions/qna").trashQnaThread = async () => ({ success: true, currentRevision: 2 });
let notePageRole: "student" | "admin" = "student";
let notePageData: Awaited<ReturnType<typeof import("@/lib/actions/privateNotes").getPrivateNotes>> = [];
let qnaPageData: Awaited<ReturnType<typeof import("@/lib/actions/qna").getQnaThreads>> = [];
const qnaSearchCalls: string[] = [];
let qnaTrashPageData: Awaited<ReturnType<typeof import("@/lib/actions/qna").getTrashedQnaThreads>> = [];
const notePageTargets: string[] = [];

mock.module("@/lib/auth-guard", { namedExports: {
  getActiveAuthSession: async () => ({ user: { id: `${notePageRole}-search`, role: notePageRole } }),
} });
mock.module("@/lib/actions/students", { namedExports: {
  getStudentById: async (id: string) => ({ id, role: "student", displayName: "대상 학생" }),
} });

mock.module("@/lib/actions/privateNotes", { namedExports: {
  restorePrivateNoteRevision: (...args: Parameters<typeof restoreNote>) => restoreNote(...args),
  trashPrivateNote: (...args: Parameters<typeof changeNoteLifecycle>) => changeNoteLifecycle(...args),
  restorePrivateNote: (...args: Parameters<typeof changeNoteLifecycle>) => changeNoteLifecycle(...args),
  purgePrivateNote: (...args: Parameters<typeof changeNoteLifecycle>) => changeNoteLifecycle(...args),
  getPrivateNotes: async (studentId: string) => { notePageTargets.push(studentId); return notePageData; },
  getPrivateNote: (...args: Parameters<typeof loadPanelNote>) => loadPanelNote(...args),
  getPrivateNoteHead: async () => null,
  updatePrivateNote: (...args: Parameters<typeof savePanelNote>) => savePanelNote(...args),
} });

// Radix는 import 시점에 `globalThis.document`가 있어야 layout effect(Portal mount·Presence)를 켠다. 이 suite는
// 컴포넌트를 먼저 import하고 test마다 DOM 전역을 설치하므로 실제 브라우저처럼 layout effect를 쓰게 고정한다.
mock.module("@radix-ui/react-use-layout-effect", {
  namedExports: { useLayoutEffect: React.useLayoutEffect },
});
mock.module("next/dynamic", {
  defaultExport: () => MockFullEditor,
});
mock.module("next/link", {
  defaultExport: MockLink,
});
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => router,
    redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  },
});
mock.module("@/lib/actions/posts", {
  namedExports: {
    restorePostRevision: (...args: Parameters<typeof restorePost>) => restorePost(...args),
    restorePost: (...args: Parameters<typeof changePostLifecycle>) => changePostLifecycle(...args),
    purgePost: (...args: Parameters<typeof changePostLifecycle>) => changePostLifecycle(...args),
    createPost: async (...args: Parameters<typeof saveNewPost>) => {
      actionCalls.post += 1;
      return saveNewPost(...args);
    },
    updatePostContent: (...args: Parameters<typeof savePostEdit>) => savePostEdit(...args),
  },
});
mock.module("@/lib/actions/categories", {
  namedExports: {
    getCategories: async () => [],
  },
});
mock.module("@/lib/actions/qna", {
  namedExports: {
    getQnaThreads: async (query = "") => { qnaSearchCalls.push(query); return qnaPageData; },
    getTrashedQnaThreads: async () => qnaTrashPageData,
    createQnaReply: async (...args: Parameters<typeof saveQnaReply>) => {
      actionCalls.qnaReply += 1;
      return saveQnaReply(...args);
    },
    createQnaThread: async (...args: Parameters<typeof saveQnaThread>) => {
      actionCalls.qnaThread += 1;
      return saveQnaThread(...args);
    },
    createQnaThreadInline: async (...args: Parameters<typeof saveQnaInline>) => {
      actionCalls.qnaInline += 1;
      return saveQnaInline(...args);
    },
    updateThreadStatus: (...args: Parameters<typeof changeQnaStatus>) => changeQnaStatus(...args),
    trashQnaThread: (...args: Parameters<typeof changeQnaLifecycle>) => changeQnaLifecycle(...args),
    restoreQnaThread: (...args: Parameters<typeof changeQnaLifecycle>) => changeQnaLifecycle(...args),
    purgeQnaThread: (...args: Parameters<typeof changeQnaLifecycle>) => changeQnaLifecycle(...args),
  },
});
const MOCK_UPLOADED_MEDIA_ID = "5b0c2f0e-3c1d-4d8e-9a51-6f0a1c2b3d4e";
const abandonedUploads: string[] = [];
mock.module("@/lib/actions/upload", {
  namedExports: {
    requestMediaUpload: async () => ({ success: false, error: "업로드 테스트 미설정" }),
    completeMediaUploadAction: async () => ({ success: false, error: "업로드 테스트 미설정" }),
    abandonMediaUpload: async (mediaObjectId: string) => { abandonedUploads.push(mediaObjectId); },
    processPendingMediaDeletions: async () => undefined,
  },
});
mock.module("@/components/upload/FileUploader", {
  namedExports: {
    FileUploader: ({
      disabled,
      onUploadingChange,
      onUploadComplete,
    }: {
      disabled?: boolean;
      onUploadingChange?: (isUploading: boolean) => void;
      onUploadComplete?: (upload: { deliveryUrl: string; mediaObjectId: string }) => void;
    }) => (
      <>
        <button
          data-testid="upload-start"
          disabled={disabled}
          onClick={() => onUploadingChange?.(true)}
          type="button"
        >
          업로드 시작
        </button>
        <button
          data-testid="upload-complete"
          disabled={disabled}
          onClick={() => onUploadComplete?.({
            deliveryUrl: `/api/media/${MOCK_UPLOADED_MEDIA_ID}`,
            mediaObjectId: MOCK_UPLOADED_MEDIA_ID,
          })}
          type="button"
        >
          업로드 완료 흉내
        </button>
      </>
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
let PostEditForm: typeof import("@/components/community/PostEditForm").PostEditForm;
let NewQnaForm: typeof import("@/components/qna/NewQnaForm").NewQnaForm;
let QnaSlideForm: typeof import("@/components/qna/QnaSlideForm").QnaSlideForm;
let ThreadDetailClient: typeof import("@/components/qna/ThreadDetailClient").ThreadDetailClient;
let RestoreNoteRevisionButton: typeof import("@/components/notes/RestoreNoteRevisionButton").RestoreNoteRevisionButton;
let DeleteNoteButton: typeof import("@/components/notes/DeleteNoteButton").DeleteNoteButton;
let NoteTrashActions: typeof import("@/components/notes/NoteTrashActions").NoteTrashActions;
let RestorePostRevisionButton: typeof import("@/components/community/RestorePostRevisionButton").RestorePostRevisionButton;
let PostTrashActions: typeof import("@/components/community/PostTrashActions").PostTrashActions;
let QnaThreadLifecycleActions: typeof import("@/components/qna/QnaThreadLifecycleActions").QnaThreadLifecycleActions;
let NoteFullForm: typeof import("@/components/notes/NoteFullForm").NoteFullForm;
let UnifiedNoteDetail: typeof import("@/components/student-portal/UnifiedNoteDetail").UnifiedNoteDetail;
let StudentNotesPage: typeof import("@/app/(app)/dashboard/student/notes/page").default;
let AdminStudentNotesPage: typeof import("@/app/(app)/dashboard/admin/students/[id]/notes/page").default;
let QnaPage: typeof import("@/app/(app)/dashboard/qna/page").default;
let QnaTrashPage: typeof import("@/app/(app)/dashboard/qna/trash/page").default;
let ThreadList: typeof import("@/components/qna/ThreadList").ThreadList;

before(async () => {
  ({ PostEditForm } = await import("@/components/community/PostEditForm"));
  ({ DeleteNoteButton } = await import("@/components/notes/DeleteNoteButton"));
  ({ NoteTrashActions } = await import("@/components/notes/NoteTrashActions"));
  ({ RestorePostRevisionButton } = await import("@/components/community/RestorePostRevisionButton"));
  ({ PostTrashActions } = await import("@/components/community/PostTrashActions"));
  ({ QnaThreadLifecycleActions } = await import("@/components/qna/QnaThreadLifecycleActions"));
  ({ default: QnaTrashPage } = await import("@/app/(app)/dashboard/qna/trash/page"));
  ({ UnifiedNoteDetail } = await import("@/components/student-portal/UnifiedNoteDetail"));
  [
    { NewPostForm },
    { NewQnaForm },
    { QnaSlideForm },
    { ThreadDetailClient },
    { RestoreNoteRevisionButton },
    { NoteFullForm },
    { default: StudentNotesPage },
    { default: AdminStudentNotesPage },
    { default: QnaPage },
    { ThreadList },
  ] = await Promise.all([
    import("@/components/community/NewPostForm"),
    import("@/components/qna/NewQnaForm"),
    import("@/components/qna/QnaSlideForm"),
    import("@/components/qna/ThreadDetailClient"),
    import("@/components/notes/RestoreNoteRevisionButton"),
    import("@/components/notes/NoteFullForm"),
    import("@/app/(app)/dashboard/student/notes/page"),
    import("@/app/(app)/dashboard/admin/students/[id]/notes/page"),
    import("@/app/(app)/dashboard/qna/page"),
    import("@/components/qna/ThreadList"),
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
  rerender: (element: React.ReactElement) => Promise<void>;
};

async function renderForm(
  context: TestContext,
  element: React.ReactElement,
  seed?: (storage: Storage) => void,
): Promise<FormHarness> {
  const browserWindow = new Window({ url: "https://portal.test/editor" });
  const restoreBrowserGlobals = installBrowserGlobals(browserWindow);
  // 실시간 공동 편집 binding이 없는 환경과 같다: 토큰 응답이 혼자 모드를 알려 websocket 없이 이 탭이 저장한다.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/api/collab/token")) {
      return Response.json({ collab: false, key: "solo", mode: "write", userId: "tester", displayName: "테스터" });
    }
    throw new Error(`unexpected fetch ${String(input)}`);
  }) as typeof fetch;
  seed?.(browserWindow.localStorage);
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as Element);

  context.after(async () => {
    await act(async () => root.unmount());
    browserWindow.close();
    restoreBrowserGlobals();
    globalThis.fetch = originalFetch;
  });

  await act(async () => {
    root.render(element);
  });

  return { browserWindow, container: container as unknown as HTMLElement, rerender: (next) => act(async () => root.render(next)) };
}

/** 취소 우선 2단계 확인 영역의 확인 버튼을 누른다. */
async function confirmAction(harness: FormHarness, label: string, scope: ParentNode = harness.container): Promise<void> {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label);
  assert.ok(button, `확인 버튼: ${label}`);
  await act(async () => button.click());
}

test("학생·관리자 노트 검색은 본문을 찾고 상세·작성·휴지통 왕복의 검색과 학생 문맥을 보존한다", { concurrency: false }, async (context) => {
  const harness = await renderForm(context, <div />);
  const date = new Date("2020-01-01T00:00:00Z");
  notePageData = [
    { id: "old-note", title: "오래된 레슨", contentHtml: "<p>비트<strong>매칭</strong> 연습</p>", authorName: "강사", authorId: "teacher", version: 1, noteDate: date, createdAt: date, updatedAt: date },
    { id: "other-note", title: "다른 기록", contentHtml: "<p>다른 본문</p>", authorName: "학생", authorId: "student-search", version: 1, noteDate: null, createdAt: date, updatedAt: date },
  ];
  context.after(() => { notePageData = []; notePageTargets.length = 0; notePageRole = "student"; });
  for (const role of ["student", "admin"] as const) {
    notePageRole = role;
    const studentId = role === "student" ? "student-search" : "student-selected";
    const base = role === "student" ? "/dashboard/student/notes" : `/dashboard/admin/students/${studentId}/notes`;
    const page = (q: string) => role === "student"
      ? StudentNotesPage({ searchParams: Promise.resolve({ q }) })
      : AdminStudentNotesPage({ params: Promise.resolve({ id: studentId }), searchParams: Promise.resolve({ q }) });
    await harness.rerender(await page("비트매칭"));
    assert.equal(notePageTargets.at(-1), studentId);
    assert.match(harness.container.textContent ?? "", /전체 2개 중 1개/u);
    assert.equal(harness.container.querySelectorAll('ul[aria-label="노트 목록"] li').length, 1);
    const form = harness.container.querySelector('form[role="search"]')!;
    assert.equal(form.getAttribute("action"), base);
    assert.equal(form.getAttribute("method"), "get");
    assert.equal(harness.container.querySelector('label[for="note-search"]')?.textContent, "제목·본문 검색");
    const input = harness.container.querySelector<HTMLInputElement>('input[name="q"]')!;
    assert.equal(input.value, "비트매칭");
    const links = [...harness.container.querySelectorAll<HTMLAnchorElement>("a")].map((link) => new URL(link.href, "https://portal.test"));
    const listHref = `${base}?q=${encodeURIComponent("비트매칭")}`;
    for (const path of ["/dashboard/notes/old-note", `${base}/new`, "/dashboard/notes/trash"]) {
      assert.equal(links.find((link) => link.pathname === path)?.searchParams.get("returnTo"), listHref);
    }
    if (role === "admin") assert.equal(links.find((link) => link.pathname === "/dashboard/notes/trash")?.searchParams.get("studentId"), studentId);
    input.value = "전송 전 다른 검색어";
    await harness.rerender(await page(""));
    assert.equal(harness.container.querySelector<HTMLInputElement>('input[name="q"]')?.value, "");
    assert.equal(harness.container.querySelectorAll('ul[aria-label="노트 목록"] li').length, 2);
    await harness.rerender(await page(`${"a".repeat(119)}😀`));
    assert.equal(harness.container.querySelector<HTMLInputElement>('input[name="q"]')?.value, "a".repeat(119));
    assert.match(harness.container.textContent ?? "", /검색 결과가 없습니다/u);
  }
});

test("Q&A 목록은 URL 상태 필터와 상세·작성·휴지통의 복귀 문맥을 첫 렌더부터 보존한다", { concurrency: false }, async (context) => {
  const harness = await renderForm(context, <div />);
  const base = { version: 1, deletedAt: null, studentId: "student-1", studentName: "학생", studentEmail: null, createdAt: null, updatedAt: null };
  qnaPageData = [{ ...base, id: "thread-open", title: "새 질문", status: "OPEN" }, { ...base, id: "thread-answered", title: "지난 답변", status: "ANSWERED" }];
  context.after(() => { qnaPageData = []; notePageRole = "student"; });
  for (const role of ["student", "admin"] as const) {
    notePageRole = role;
    const parent = `/dashboard/${role}?section=${role === "admin" ? "work" : "today"}`;
    const page = (qnaStatus: string) => QnaPage({ searchParams: Promise.resolve({ returnTo: parent, qnaStatus }) });
    await harness.rerender(await page("ANSWERED"));
    // 상태 탭은 서버를 거치지 않는 화면 안 필터다(주소의 qnaStatus만 바꾼다).
    const group = harness.container.querySelector('[role="group"][aria-label="Q&A 상태 필터"]')!;
    assert.ok(group);
    const pressed = [...group.querySelectorAll("button")].filter((button) => button.getAttribute("aria-pressed") === "true");
    assert.equal(pressed.length, 1);
    assert.match(pressed[0].textContent ?? "", new RegExp(QNA_STATUS_LABELS.ANSWERED, "u"));
    const links = [...harness.container.querySelectorAll<HTMLAnchorElement>("a")].map((link) => new URL(link.href, "https://portal.test"));
    const details = links.filter((link) => link.pathname.startsWith("/dashboard/qna/thread-"));
    assert.equal(details.length, 1);
    assert.equal(details[0].pathname, "/dashboard/qna/thread-answered");
    const listHref = details[0].searchParams.get("returnTo")!;
    const list = new URL(listHref, "https://portal.test");
    assert.equal(list.searchParams.get("qnaStatus"), "ANSWERED");
    assert.equal(list.searchParams.get("returnTo"), parent);
    assert.equal(links.find((link) => link.pathname === "/dashboard/qna/trash")?.searchParams.get("returnTo"), listHref);
    if (role === "student") assert.equal(links.find((link) => link.pathname === "/dashboard/qna/new")?.searchParams.get("returnTo"), listHref);
    const allTab = [...group.querySelectorAll("button")].find((button) => (button.textContent ?? "").startsWith("전체"))!;
    await act(async () => allTab.click());
    assert.equal(harness.container.querySelectorAll('a[href^="/dashboard/qna/thread-"]').length, 2, "전체 탭은 서버를 거치지 않고 바로 두 대화를 보인다");
    // 머리의 휴지통 링크도 바꾼 탭(전체)으로 돌아오게 복귀 주소가 바뀐다.
    const trashLink = [...harness.container.querySelectorAll<HTMLAnchorElement>("a")].find((link) => new URL(link.href, "https://portal.test").pathname === "/dashboard/qna/trash")!;
    const trashBack = new URL(new URL(trashLink.href, "https://portal.test").searchParams.get("returnTo")!, "https://portal.test");
    assert.equal(trashBack.searchParams.get("qnaStatus"), null, "탭을 바꾼 뒤 휴지통에서 돌아오면 바꾼 탭");
  }
  await harness.rerender(<ThreadList threads={qnaPageData} isAdmin filter="ANSWERED" returnTo="/dashboard/admin/students/student-1?tab=qna#records" />);
  // 학생 상세 안 Q&A 칩: 상태를 바꿔도 주소의 tab·hash는 그대로 둔다.
  harness.browserWindow.history.replaceState(null, "", "/dashboard/admin/students/student-1?tab=qna&qnaStatus=ANSWERED#records");
  const closedChip = [...harness.container.querySelectorAll('[role="group"][aria-label="Q&A 상태 필터"] button')]
    .find((button) => (button.textContent ?? "").includes(QNA_STATUS_LABELS.CLOSED))! as HTMLButtonElement;
  await act(async () => closedChip.click());
  const chipUrl = new URL(harness.browserWindow.location.href);
  assert.equal(chipUrl.searchParams.get("tab"), "qna");
  assert.equal(chipUrl.searchParams.get("qnaStatus"), "CLOSED");
  assert.equal(chipUrl.hash, "#records");
  const answeredChip = [...harness.container.querySelectorAll('[role="group"][aria-label="Q&A 상태 필터"] button')]
    .find((button) => (button.textContent ?? "").includes(QNA_STATUS_LABELS.ANSWERED))! as HTMLButtonElement;
  await act(async () => answeredChip.click());
  const detail = new URL(harness.container.querySelector<HTMLAnchorElement>('a[href^="/dashboard/qna/"]')!.href, "https://portal.test");
  const back = new URL(detail.searchParams.get("returnTo")!, "https://portal.test");
  assert.equal(back.pathname, "/dashboard/admin/students/student-1");
  assert.equal(back.searchParams.get("tab"), "qna");
  assert.equal(back.searchParams.get("qnaStatus"), "ANSWERED");
});

test("Q&A 검색은 본문 미리보기·빈 결과에서도 검색과 상태·학생 복귀 문맥을 유지한다", { concurrency: false }, async (context) => {
  const harness = await renderForm(context, <div />);
  const thread = { id: "search-thread", title: "오래된 레슨 질문", version: 1, deletedAt: null, studentId: "student-1", studentName: "학생", studentEmail: null, createdAt: null, updatedAt: null, status: "ANSWERED" as const, searchPreview: "EQ & <리듬>을 조절한 답변" };
  context.after(() => { qnaPageData = []; qnaSearchCalls.length = 0; notePageRole = "student"; });
  for (const role of ["student", "admin"] as const) {
    notePageRole = role;
    qnaPageData = [thread];
    const parent = `/dashboard/${role}?section=work`;
    const page = (qnaQuery: string) => QnaPage({ searchParams: Promise.resolve({ qnaQuery, qnaStatus: "ANSWERED", returnTo: parent }) });
    await harness.rerender(await page("  EQ 리듬  "));
    assert.equal(qnaSearchCalls.at(-1), "EQ 리듬");
    const search = harness.container.querySelector<HTMLFormElement>('form[aria-label="Q&A 검색"]')!;
    assert.equal(search.getAttribute("role"), "search");
    const fields = new FormData(search);
    assert.equal(fields.get("qnaQuery"), "EQ 리듬");
    assert.equal(fields.get("qnaStatus"), "ANSWERED");
    assert.equal(fields.get("returnTo"), parent);
    // 검색 중 상태 탭을 바꾸면 검색어는 주소에 그대로 두고 qnaStatus만 바꾼다.
    harness.browserWindow.history.replaceState(null, "", "/dashboard/qna?qnaQuery=EQ+%EB%A6%AC%EB%93%AC&qnaStatus=ANSWERED");
    const openTab = [...harness.container.querySelectorAll('[role="group"][aria-label="Q&A 상태 필터"] button')]
      .find((button) => (button.textContent ?? "").includes(QNA_STATUS_LABELS.OPEN))! as HTMLButtonElement;
    await act(async () => openTab.click());
    const afterUrl = new URL(harness.browserWindow.location.href);
    assert.equal(afterUrl.searchParams.get("qnaQuery"), "EQ 리듬");
    assert.equal(afterUrl.searchParams.get("qnaStatus"), "OPEN");
    const answeredTab = [...harness.container.querySelectorAll('[role="group"][aria-label="Q&A 상태 필터"] button')]
      .find((button) => (button.textContent ?? "").includes(QNA_STATUS_LABELS.ANSWERED))! as HTMLButtonElement;
    await act(async () => answeredTab.click());
    assert.match(harness.container.textContent ?? "", /EQ & <리듬>을 조절한 답변/u);
    assert.equal(harness.container.querySelector("리듬"), null);
    const details = harness.container.querySelector<HTMLAnchorElement>('a[href^="/dashboard/qna/search-thread"]')!;
    const back = new URL(new URL(details.href, "https://portal.test").searchParams.get("returnTo")!, "https://portal.test");
    assert.equal(back.searchParams.get("qnaQuery"), "EQ 리듬");
    assert.equal(back.searchParams.get("qnaStatus"), "ANSWERED");
    assert.equal(back.searchParams.get("returnTo"), parent);
    const clear = [...harness.container.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent === "검색 초기화")!;
    const clearUrl = new URL(clear.href, "https://portal.test");
    assert.equal(clearUrl.searchParams.has("qnaQuery"), false);
    assert.equal(clearUrl.searchParams.get("qnaStatus"), "ANSWERED");
    qnaPageData = [];
    await harness.rerender(await page("없는 내용"));
    assert.match(harness.container.textContent ?? "", /검색 조건에 맞는 대화가 없습니다/u);
    assert.equal(harness.container.querySelector<HTMLInputElement>('input[name="qnaQuery"][type="search"]')?.value, "없는 내용");
    await harness.rerender(await page(""));
    assert.equal(harness.container.querySelector<HTMLInputElement>('input[name="qnaQuery"][type="search"]')?.value, "");
  }
  await harness.rerender(<ThreadList threads={[thread]} isAdmin filter="ANSWERED" query="EQ" returnTo="/dashboard/admin/students/student-1?tab=qna#records" />);
  const search = harness.container.querySelector<HTMLFormElement>('form[aria-label="Q&A 검색"]')!;
  assert.equal(new FormData(search).get("tab"), "qna");
  assert.equal(new FormData(search).get("qnaStatus"), "ANSWERED");
  const back = new URL(new URL(harness.container.querySelector<HTMLAnchorElement>('a[href^="/dashboard/qna/search-thread"]')!.href, "https://portal.test").searchParams.get("returnTo")!, "https://portal.test");
  assert.equal(back.pathname, "/dashboard/admin/students/student-1");
  assert.equal(back.searchParams.get("qnaQuery"), "EQ");
  assert.equal(back.hash, "#records");
});

test("Q&A 휴지통은 전달받은 검색·상태 문맥을 상세 왕복과 목록 복귀에 사용한다", { concurrency: false }, async (context) => {
  const parent = "/dashboard/admin/students/student-1?tab=qna&qnaStatus=ANSWERED&qnaQuery=EQ#records";
  notePageRole = "admin";
  qnaTrashPageData = [{ id: "trashed-thread", title: "보존된 대화", status: "ANSWERED", version: 4, createdAt: null, updatedAt: null, studentId: "student-1", studentName: "학생", studentEmail: null, deletedAt: new Date(), purgeEligibleAt: new Date(Date.now() + 86400000) }];
  context.after(() => { qnaTrashPageData = []; notePageRole = "student"; });
  const page = (returnTo: string) => QnaTrashPage({ searchParams: Promise.resolve({ returnTo }) });
  const harness = await renderForm(context, <div />);
  await harness.rerender(await page(parent));
  const back = [...harness.container.querySelectorAll<HTMLAnchorElement>("a")].find((link) => link.textContent?.includes("목록으로 돌아가기"))!;
  assert.equal(back.getAttribute("href"), parent);
  const detail = new URL(harness.container.querySelector<HTMLAnchorElement>('a[href^="/dashboard/qna/trashed-thread"]')!.href, "https://portal.test");
  const trash = new URL(detail.searchParams.get("returnTo")!, "https://portal.test");
  assert.equal(trash.pathname, "/dashboard/qna/trash");
  assert.equal(trash.searchParams.get("returnTo"), parent);
  await harness.rerender(await page(trash.searchParams.get("returnTo")!));
  assert.equal(harness.container.querySelector<HTMLAnchorElement>("header a")?.getAttribute("href"), parent);
  await harness.rerender(await page("https://outside.example"));
  assert.equal(harness.container.querySelector<HTMLAnchorElement>("header a")?.getAttribute("href"), "/dashboard/qna");
});

test("관리자 노트 작성 화면의 휴지통 링크는 대상 학생과 검색 복귀 위치를 유지한다", { concurrency: false }, async (context) => {
  const returnTo = "/dashboard/admin/students/student-selected/notes?q=EQ";
  const harness = await renderForm(context, <NoteFullForm action={async () => ({})} actorId="admin-search" studentId="student-selected" returnTo={returnTo} spaceLabel="대상 학생" />);
  const link = [...harness.container.querySelectorAll<HTMLAnchorElement>("a")].find((anchor) => anchor.getAttribute("href")?.startsWith("/dashboard/notes/trash?"));
  assert.ok(link);
  const target = new URL(link.getAttribute("href")!, "https://portal.test");
  assert.equal(target.searchParams.get("studentId"), "student-selected");
  assert.equal(target.searchParams.get("returnTo"), returnTo);
});

test("노트 이력은 A→B→A를 새 복원 의도로 처리하고 전송 실패만 같은 ID로 재시도한다", { concurrency: false }, async (context) => {
  const requests: Parameters<typeof restoreNote>[] = [];
  let failNext = false;
  restoreNote = async (...args) => {
    requests.push(args);
    if (failNext) { failNext = false; throw new Error("offline"); }
    return { success: true, currentRevision: args[2] + 1 };
  };
  context.after(() => { restoreNote = async () => ({ success: true }); });
  const screen = (base: number) => <div>{[1, 2].map((target) => <section key={target} data-revision={target}><RestoreNoteRevisionButton noteId="note-history" baseRevision={base} revisionNumber={target} /></section>)}</div>;
  const harness = await renderForm(context, screen(2));
  const click = async (target: number) => {
    const section = harness.container.querySelector(`[data-revision="${target}"]`)!;
    await act(async () => section.querySelector<HTMLButtonElement>("button")!.click());
    await confirmAction(harness, "복원 확인", section);
  };
  await click(1);
  await harness.rerender(screen(3));
  await click(2);
  await harness.rerender(screen(4));
  await click(1);
  assert.deepEqual(requests.map((args) => [args[2], args[3]]), [[2, 1], [3, 2], [4, 1]]);
  assert.notEqual(requests[0]![1], requests[2]![1], "새 head 기준 복원은 이전 완료 요청 ID를 재사용하지 않는다");
  await harness.rerender(screen(5));
  failNext = true;
  await click(2);
  assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /복원하지 못했습니다/);
  await click(2);
  assert.equal(requests[3]![1], requests[4]![1]);
  assert.equal(harness.container.querySelector('[role="alert"]'), null);
});

for (const kind of ["trash", "restore", "purge"] as const) {
  test(`노트 ${kind} 응답 유실은 편집 화면을 유지하고 같은 요청으로 재시도한다`, { concurrency: false }, async (context) => {
    const requests: Parameters<typeof changeNoteLifecycle>[] = [];
    changeNoteLifecycle = async (...args) => {
      requests.push(args);
      if (requests.length === 1) throw new Error("response lost");
      return { success: true };
    };
    context.after(() => { changeNoteLifecycle = async () => ({ success: true }); });
    const push = context.mock.method(router, "push");
    const refresh = context.mock.method(router, "refresh");
    const screen = (version: number) => <div>
      <textarea aria-label="보존할 편집 내용" defaultValue="아직 전송하지 않은 내용" />
      {kind === "trash" ? <DeleteNoteButton noteId="note-retry" version={version} /> :
        <NoteTrashActions noteId="note-retry" version={version} canRestore canPurge returnTo="/dashboard/notes/trash" />}
    </div>;
    const harness = await renderForm(context, screen(2));
    const find = () => [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      kind === "trash" ? button.getAttribute("aria-label") === "노트를 휴지통으로 이동" : button.textContent === (kind === "restore" ? "노트 복원" : "영구 삭제"))!;
    const run = async () => {
      await act(async () => find().click());
      if (kind !== "restore") await confirmAction(harness, kind === "trash" ? "휴지통 이동 확인" : "영구 삭제 확인");
    };
    await run();
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /결과를 확인하지 못했습니다/u);
    assert.equal(harness.container.querySelector("textarea")?.value, "아직 전송하지 않은 내용");
    assert.equal(find().disabled, false);
    assert.equal(push.mock.callCount() + refresh.mock.callCount(), 0);
    await run();
    assert.equal(requests[0][1], requests[1][1]);
    assert.equal(harness.container.querySelector('[role="alert"]'), null);
    assert.equal(push.mock.callCount() + refresh.mock.callCount(), 1);
    await harness.rerender(screen(3));
    await run();
    assert.notEqual(requests[1][1], requests[2][1], "새 version은 새로운 mutation이다");
  });
}

test("게시물 복원은 응답 유실 재시도 ID를 보존하되 기준 revision 변경은 새 요청으로 구분한다", { concurrency: false }, async (context) => {
  const requests: Parameters<typeof restorePost>[] = [];
  restorePost = async (...args) => {
    requests.push(args);
    if (requests.length < 3) throw new Error("response lost");
    return { success: true };
  };
  context.after(() => { restorePost = async () => ({ success: true }); });
  const screen = (baseRevision: number) => <RestorePostRevisionButton postId="post-history" revisionNumber={1} baseRevision={baseRevision} />;
  const harness = await renderForm(context, screen(2));
  const click = async () => {
    await act(async () => harness.container.querySelector<HTMLButtonElement>("button")!.click());
    await confirmAction(harness, "복원 확인");
  };
  await click();
  assert.ok(harness.container.querySelector('[role="alert"]'));
  await click();
  assert.equal(requests[0][1], requests[1][1]);
  await harness.rerender(screen(3));
  await click();
  assert.notEqual(requests[1][1], requests[2][1]);
  assert.deepEqual(requests.map((args) => [args[2], args[3]]), [[2, 1], [2, 1], [3, 1]]);
  assert.equal(harness.container.querySelector('[role="alert"]'), null);
});

test("게시물 휴지통 복원 재시도는 같은 ID를 쓰고 다시 삭제된 새 version은 분리한다", { concurrency: false }, async (context) => {
  const requests: Parameters<typeof changePostLifecycle>[] = [];
  changePostLifecycle = async (...args) => { requests.push(args); throw new Error("response lost"); };
  context.after(() => { changePostLifecycle = async () => ({ success: true, purged: false }); });
  const screen = (version: number) => <PostTrashActions postId="post-trash-retry" version={version} deletedAt={new Date().toISOString()} canRestore canPurge={false} returnTo="/community" />;
  const harness = await renderForm(context, screen(2));
  const click = () => act(async () => harness.container.querySelector<HTMLButtonElement>("button")!.click());
  await click();
  assert.ok(harness.container.querySelector('[role="alert"]'));
  await click();
  assert.equal(requests[0][1], requests[1][1]);
  await harness.rerender(screen(4));
  await click();
  assert.notEqual(requests[1][1], requests[2][1]);
  assert.deepEqual(requests.map((args) => args[2]), [2, 2, 4]);
});

test("게시물 휴지통 화면을 연 채 보관 기간이 지나면 영구 삭제 버튼으로 바뀐다", { concurrency: false }, async (context) => {
  const retentionMilliseconds = 30 * 24 * 60 * 60 * 1000;
  // 만료 80ms 전에 화면을 열고, 서버 값이 만료 뒤 상태(canRestore=false, canPurge=true)로 갱신된 경우다.
  const deletedAt = new Date(Date.now() - retentionMilliseconds + 80).toISOString();
  const screen = (expiredOnServer: boolean) => <PostTrashActions postId="post-trash-expiry" version={2} deletedAt={deletedAt} canRestore={!expiredOnServer} canPurge={expiredOnServer} returnTo="/community" />;
  const harness = await renderForm(context, screen(false));
  const labels = () => [...harness.container.querySelectorAll("button")].map((button) => button.textContent?.trim());
  assert.deepEqual(labels(), ["게시물 복원"]);
  await harness.rerender(screen(true));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
  assert.deepEqual(labels(), ["영구 삭제"]);
});

test("Q&A 휴지통 화면은 기한이 이미 지난 값으로 바뀌면 오래 기다리지 않고 영구 삭제 버튼을 보인다", { concurrency: false }, async (context) => {
  const retentionMilliseconds = 30 * 24 * 60 * 60 * 1000;
  const screen = (deletedAt: string | null, expiredOnServer: boolean) => <QnaThreadLifecycleActions threadId="qna-expiry" version={2} deletedAt={deletedAt} canRestore={!expiredOnServer} canPurge={expiredOnServer} returnTo="/dashboard/qna" />;
  const mountedAt = Date.now();
  const harness = await renderForm(context, screen(null, false));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  // 화면을 연 뒤 시간이 흐른 다음, 그 사이(이미 지난 시각)에 보관 기간이 끝나는 삭제 시각으로 바뀐다.
  await harness.rerender(screen(new Date(mountedAt + 300 - retentionMilliseconds).toISOString(), true));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  assert.ok([...harness.container.querySelectorAll("button")].some((button) => button.textContent?.includes("영구 삭제")));
});

for (const busyKind of ["upload", "reply", "lifecycle"] as const) {
  test(`Q&A ${busyKind} 작업 중에는 답변·첨부·휴지통 작업이 겹치지 않는다`, { concurrency: false }, async (context) => {
    let releaseReply!: (result: Awaited<ReturnType<typeof saveQnaReply>>) => void;
    let releaseLifecycle!: (result: Awaited<ReturnType<typeof changeQnaLifecycle>>) => void;
    let replyCalls = 0;
    let lifecycleCalls = 0;
    saveQnaReply = async () => { replyCalls += 1; return new Promise((resolve) => { releaseReply = resolve; }); };
    changeQnaLifecycle = async () => { lifecycleCalls += 1; return new Promise((resolve) => { releaseLifecycle = resolve; }); };
    context.after(() => {
      saveQnaReply = async () => ({});
      changeQnaLifecycle = async () => ({ success: true, currentRevision: 2 });
    });
    const push = context.mock.method(router, "push");
    const harness = await renderForm(context, <ThreadDetailClient actorId="student-busy" threadId="thread-busy" title="질문" status="OPEN" version={1} isAdmin={false} replies={[]} deletedAt={null} studentName="학생" createdAt={null} returnTo="/dashboard/qna" />);
    await writeCollabBody(harness, "전송할 답변");
    const form = harness.container.querySelector<HTMLFormElement>("form")!;
    const trash = [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === "휴지통으로 이동")!;
    const upload = harness.container.querySelector<HTMLButtonElement>('[data-testid="upload-start"]')!;
    const submit = submitControl(harness.container);
    await waitForCondition(() => !submit.disabled, "답변 초안 준비");
    await act(async () => {
      if (busyKind === "upload") upload.click();
      else if (busyKind === "reply") form.requestSubmit();
      else trash.click();
    });
    if (busyKind === "lifecycle") await confirmAction(harness, "휴지통 이동 확인");
    assert.equal(trash.disabled, true);
    assert.equal(upload.disabled, true);
    assert.equal(submit.disabled, true);
    assert.equal(harness.container.querySelector("textarea")?.disabled, true);
    await act(async () => {
      trash.click();
      upload.click();
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(replyCalls, busyKind === "reply" ? 1 : 0);
    assert.equal(lifecycleCalls, busyKind === "lifecycle" ? 1 : 0);
    assert.equal(push.mock.callCount(), 0);
    await act(async () => {
      releaseReply?.({ error: "다시 시도해 주세요." });
      releaseLifecycle?.({ success: false, error: "다시 시도해 주세요." });
    });
    if (busyKind !== "upload") {
      assert.equal(trash.disabled, false);
      assert.equal(upload.disabled, false);
      assert.equal(submit.disabled, false);
    }
    assert.match(harness.container.querySelector("textarea")?.value ?? "", /전송할 답변/u);
  });
}

test("Q&A 충돌 응답의 version만 채택하지 않고 서버 상태와 답변 초안을 함께 유지한다", { concurrency: false }, async (context) => {
  const requests: Parameters<typeof changeQnaStatus>[] = [];
  changeQnaStatus = async (...args) => {
    requests.push(args);
    return args[3] === 1
      ? { success: false, conflictKind: "VERSION_CONFLICT", currentRevision: 2, error: "최신 상태를 확인해 주세요." }
      : { success: true, currentRevision: 3 };
  };
  context.after(() => { changeQnaStatus = async () => ({ success: true, currentRevision: 2 }); });
  const refresh = context.mock.method(router, "refresh");
  const screen = (status: "OPEN" | "CLOSED" | "ANSWERED", version: number) => <ThreadDetailClient actorId="admin-status" threadId="thread-status" title="질문" status={status} version={version} isAdmin replies={[]} deletedAt={null} studentName="학생" createdAt={null} returnTo="/dashboard/qna" />;
  const harness = await renderForm(context, screen("OPEN", 1));
  await writeCollabBody(harness, "아직 전송하지 않은 답변");
  const statusButton = (label: string) => [...harness.container.querySelectorAll<HTMLButtonElement>('[aria-label="스레드 상태 변경"] button')].find((button) => button.textContent === label)!;
  await waitForCondition(() => !statusButton("답변 완료").disabled, "상태 변경 폼이 준비돼야 합니다.");
  await act(async () => statusButton("답변 완료").click());
  assert.equal(refresh.mock.callCount(), 1);
  await act(async () => statusButton("답변 완료").click());
  assert.deepEqual(requests.map((args) => args[3]), [1, 1], "새 화면 snapshot 전에는 stale 상태와 최신 version을 조합하지 않는다");
  assert.equal(requests[0]![2], requests[1]![2]);
  await harness.rerender(screen("CLOSED", 2));
  assert.equal(statusButton("종료").getAttribute("aria-pressed"), "true");
  assert.match(harness.container.querySelector("textarea")?.value ?? "", /전송하지 않은 답변/);
  await act(async () => statusButton("답변 완료").click());
  assert.equal(requests[2]![3], 2);
  await harness.rerender(screen("ANSWERED", 3));
  assert.equal(statusButton("답변 완료").getAttribute("aria-pressed"), "true");
});

test("Q&A 휴지통 충돌은 오래된 요청을 잠그고 전체 snapshot 재조회 뒤에만 새 요청을 허용한다", { concurrency: false }, async (context) => {
  const requests: Parameters<typeof changeQnaLifecycle>[] = [];
  let throwNext = true;
  changeQnaLifecycle = async (...args) => {
    requests.push(args);
    if (args[2] === 1) return { success: false, conflictKind: "VERSION_CONFLICT", currentRevision: 2, error: "최신 상태를 확인해 주세요." };
    if (throwNext) { throwNext = false; throw new Error("response lost"); }
    return { success: true, currentRevision: 3 };
  };
  context.after(() => { changeQnaLifecycle = async () => ({ success: true, currentRevision: 2 }); });
  const refresh = context.mock.method(router, "refresh", () => { throw new Error("offline"); });
  const screen = (version: number, isAdmin = true) => <ThreadDetailClient actorId="admin-lifecycle" threadId="thread-lifecycle" title="질문" status={version === 1 ? "OPEN" : "CLOSED"} version={version} isAdmin={isAdmin} replies={[]} deletedAt={null} studentName="학생" createdAt={null} returnTo="/dashboard/qna" />;
  const harness = await renderForm(context, screen(1));
  await writeCollabBody(harness, "보관 중인 답변");
  const find = (label: string) => [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => (button.getAttribute("aria-label") ?? button.textContent) === label)!;
  const trashAndConfirm = async () => {
    await act(async () => find("휴지통으로 이동").click());
    await confirmAction(harness, "휴지통 이동 확인");
  };
  await trashAndConfirm();
  assert.equal(find("휴지통으로 이동").disabled, true);
  await act(async () => find("휴지통으로 이동").click());
  assert.equal(requests.length, 1);
  await act(async () => find("최신 상태 확인").click());
  assert.match(harness.container.textContent ?? "", /최신 상태를 불러오지 못했습니다/u);
  refresh.mock.mockImplementation(() => undefined);
  await act(async () => find("최신 상태 확인").click());
  assert.equal(refresh.mock.callCount(), 2);
  assert.equal(find("휴지통으로 이동").disabled, true, "현재 revision 숫자만으로 mutation을 열지 않는다");
  await harness.rerender(screen(2));
  assert.equal(find("휴지통으로 이동").disabled, false);
  assert.match(harness.container.querySelector("textarea")?.value ?? "", /보관 중인 답변/u);
  await trashAndConfirm();
  await trashAndConfirm();
  assert.deepEqual(requests.map((args) => args[2]), [1, 2, 2]);
  assert.notEqual(requests[0][1], requests[1][1]);
  assert.equal(requests[1][1], requests[2][1], "결과 불명확 재시도만 같은 operation을 유지한다");
  await harness.rerender(screen(2, false));
  await trashAndConfirm();
  assert.notEqual(requests[2][1], requests[3][1], "실제 권한 snapshot이 바뀌면 version이 같아도 새 요청이다");
});

/** 공동 편집 작성본 본문에 글을 써 넣는다(편집기 mock이 Y.Doc 본문을 textarea로 보여 준다). 버튼 활성 판단용 본문 지연(200ms)까지 기다린다. */
async function writeCollabBody(harness: FormHarness, text: string, selector = BODY_FIELD): Promise<void> {
  await waitUntil(() => {
    const field = harness.container.querySelector<HTMLTextAreaElement>(selector);
    return Boolean(field && !field.disabled);
  }, 3000, "공동 편집 본문 칸이 준비돼야 합니다.");
  const field = harness.container.querySelector<HTMLTextAreaElement>(selector)!;
  await act(async () => typeInto(harness, field, text));
  await act(async () => { await waitForRealTime(350); });
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

class SaveErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p data-testid="save-error-boundary">편집 화면 오류</p> : this.props.children; }
}

for (const kind of ["new-post", "edit-post", "new-qna", "inline-qna", "qna-reply"] as const) {
  test(`${kind} 저장 예외 뒤 편집 화면·원문·요청 ID를 유지하고 같은 내용으로 재시도한다`, { concurrency: false }, async (context) => {
    const isEdit = kind === "edit-post";
    const isReply = kind === "qna-reply";
    const actorId = `retry-${kind}`;
    const resourceId = `resource-${kind}`;
    const snapshot = { title: "보존할 제목", body: "보존할 본문" };
    const base = { title: "서버 제목", contentHtml: "<p>서버 본문</p>" };
    const submitted: Record<string, FormDataEntryValue>[] = [];
    const action = async (_previous: object, data: FormData) => {
      submitted.push(Object.fromEntries(data));
      throw new Error("save response lost");
    };
    saveNewPost = action;
    savePostEdit = (_id, previous, data) => action(previous, data);
    saveQnaThread = action;
    saveQnaInline = action;
    saveQnaReply = (_id, previous, data) => action(previous, data);
    context.after(() => { saveNewPost = async () => ({}); savePostEdit = async () => ({}); saveQnaThread = async () => ({}); saveQnaInline = async () => ({}); saveQnaReply = async () => ({}); });
    const element = kind === "new-post"
      ? <NewPostForm actorId={actorId} isAdmin={false} defaultBoardType="GENERAL" defaultCategory="general" returnTo="/community" />
      : kind === "edit-post"
        ? <PostEditForm actorId={actorId} post={{ ...base, id: resourceId, version: 1 }} onCancel={() => undefined} onSaved={() => assert.fail("응답을 확인하지 않고 저장 성공을 알리면 안 됩니다.")} />
        : kind === "new-qna"
          ? <NewQnaForm actorId={actorId} returnTo="/dashboard/qna" />
          : kind === "inline-qna"
            ? <QnaSlideForm actorId={actorId} spaceLabel="내 스페이스" returnTo="/dashboard/qna" onClose={() => undefined} onSuccess={() => assert.fail("성공 미확인")} />
            : <ThreadDetailClient actorId={actorId} threadId={resourceId} title="질문" status="OPEN" version={1} isAdmin replies={[]} deletedAt={null} studentName="학생" createdAt={null} returnTo="/dashboard/qna" />;
    const harness = await renderForm(context, <SaveErrorBoundary>{element}</SaveErrorBoundary>);
    await writeCollabBody(harness, snapshot.body);
    if (!isReply) await typeIntoInput(harness, harness.container.querySelector<HTMLInputElement>('input[name="title"]')!, snapshot.title);
    const submit = () => submitControl(harness.container);
    await waitForCondition(() => !submit().disabled, "저장 버튼이 켜져야 합니다.");
    await act(async () => submit().click());
    assert.equal(harness.container.querySelector('[data-testid="save-error-boundary"]'), null, "저장 실패는 편집 subtree를 제거하면 안 됩니다.");
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /저장 결과를 확인하지 못했습니다/u);
    if (!isReply) assert.equal(harness.container.querySelector<HTMLInputElement>('[name="title"]')?.value, snapshot.title);
    assert.equal(harness.container.querySelector<HTMLTextAreaElement>(BODY_FIELD)?.value, snapshot.body);
    assert.equal(submit().disabled, false);
    assert.equal(harness.container.querySelector("form")?.getAttribute("aria-busy"), "false");
    await act(async () => submit().click());
    assert.equal(submitted.length, 2);
    assert.ok(submitted[0]!.operationId, "요청 ID를 보낸다");
    // 게시물 수정은 기준 revision(CAS)이 중복 반영을 막으므로 시도마다 요청 ID를 새로 만든다. 나머지는 모두 같아야 한다.
    const comparable = (entry: Record<string, FormDataEntryValue>) => (isEdit ? { ...entry, operationId: "" } : entry);
    assert.deepEqual(comparable(submitted[1]!), comparable(submitted[0]!), "같은 내용으로 다시 보낸다");
  });
}

const noteTitleValue = (container: HTMLElement) => container.querySelector<HTMLTextAreaElement>("textarea[name=title]")?.value;

test("캘린더 빠른 입력 제목은 저장된 초안이 없으면 새 노트 작성 화면에 채워진다", { concurrency: false }, async (context) => {
  const fresh = await renderForm(context, <NoteFullForm action={async () => ({})} actorId="quick-title" studentId="quick-title" returnTo="/dashboard/student" defaultTitle="레슨 복습" defaultDate="2026-10-30" />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(noteTitleValue(fresh.container), "레슨 복습");
  assert.equal(fresh.container.querySelector<HTMLInputElement>("input[name=noteDate]")?.value, "2026-10-30");
});



const panelNoteRecord = (authorId: string) => ({
  id: "panel-note",
  studentId: "student-1",
  authorId,
  title: "패널 노트",
  contentHtml: "<p>처음 본문</p>",
  noteDate: new Date("2026-10-30T00:00:00.000Z"),
  createdAt: new Date("2026-10-20T00:00:00.000Z"),
  updatedAt: new Date("2026-10-20T00:00:00.000Z"),
  version: 3,
  deletedAt: null,
  authorName: "학생",
});
const panelNoteItem = {
  id: "panel-note",
  type: "NOTE" as const,
  title: "패널 노트",
  date: new Date("2026-10-30T00:00:00.000Z"),
  metadata: { preview: "처음 본문", authorId: "student-1", noteDate: new Date("2026-10-30T00:00:00.000Z") },
  space: { studentId: "student-1", label: "학생" },
  source: { kind: "PORTAL" as const, entity: "PRIVATE_NOTE" as const, label: "포탈" },
};

test("캘린더 패널에서 작성자는 노트를 바로 고치고 저장 결과가 캘린더 항목에 반영된다", { concurrency: false }, async (context) => {
  const saved: Array<{ noteId: string; baseRevision: FormDataEntryValue | null; contentHtml: FormDataEntryValue | null }> = [];
  const updates: Array<{ title: string; preview: unknown }> = [];
  const busy: boolean[] = [];
  loadPanelNote = async () => panelNoteRecord("student-1");
  savePanelNote = async (noteId, _previous, formData) => {
    saved.push({ noteId, baseRevision: formData.get("baseRevision"), contentHtml: formData.get("contentHtml") });
    return { success: true, note: { id: noteId, title: "패널 노트", contentHtml: "<p>패널에서 고친 본문</p>", noteDate: new Date("2026-10-30T00:00:00.000Z"), version: 4 } };
  };
  context.after(() => {
    loadPanelNote = async () => null;
    savePanelNote = async () => ({});
  });
  const harness = await renderForm(context, <UnifiedNoteDetail
    item={panelNoteItem}
    returnTo="/dashboard/student"
    viewer={{ actorId: "student-1", role: "student" }}
    onItemUpdated={(item) => updates.push({ title: item.title, preview: item.metadata.preview })}
    onBusyChange={(value) => busy.push(value)}
  />);
  await waitForCondition(
    () => (harness.container.querySelector('[name="title"]') as unknown as HTMLTextAreaElement | null)?.value === "패널 노트",
    "패널이 노트 편집기를 연다.",
  );
  await writeCollabBody(harness, "패널에서 고친 본문");
  await act(async () => { submitControl(harness.container).click(); });
  await waitForCondition(() => updates.length > 0, "저장 결과가 캘린더 항목으로 전달된다.");
  assert.equal(saved[0]?.noteId, "panel-note");
  assert.equal(saved[0]?.baseRevision, "3", "불러온 revision을 기준으로 저장한다");
  assert.equal(saved[0]?.contentHtml, "<p>패널에서 고친 본문</p>");
  assert.deepEqual(updates.at(-1), { title: "패널 노트", preview: "패널에서 고친 본문" });
  assert.ok(busy.includes(true), "저장하는 동안 패널을 닫지 못하게 알린다");
  assert.equal(busy.at(-1), false);
  assert.match(harness.container.textContent ?? "", /전체 화면으로 열기/u);
});

test("캘린더 패널에서 다른 작성자의 노트는 읽기 전용으로 보인다", { concurrency: false }, async (context) => {
  loadPanelNote = async () => panelNoteRecord("admin-1");
  context.after(() => { loadPanelNote = async () => null; });
  const harness = await renderForm(context, <UnifiedNoteDetail
    item={panelNoteItem}
    returnTo="/dashboard/student"
    viewer={{ actorId: "student-1", role: "student" }}
  />);
  await waitForCondition(() => /읽기 전용/u.test(harness.container.textContent ?? ""), "읽기 전용 안내가 보인다.");
  assert.equal(harness.container.querySelector('[name="title"]'), null);
  assert.match(harness.container.textContent ?? "", /처음 본문/u);
});

test("노트 저장 실패가 폼 밖으로 옮긴 포커스를 가로채지 않는다", { concurrency: false }, async (context) => {
  let rejectSave!: (reason: Error) => void;
  const action = () => new Promise<never>((_resolve, reject) => { rejectSave = reject; });
  const harness = await renderForm(context, <NoteFullForm action={action} actorId="note-focus" studentId="note-focus" returnTo="/dashboard/student/notes" />);
  await writeCollabBody(harness, "보존할 본문");
  const title = harness.container.querySelector<HTMLTextAreaElement>('textarea[name="title"]')!;
  await act(async () => typeInto(harness, title, "원문"));
  const submit = submitControl(harness.container);
  await act(async () => { submit.focus(); submit.click(); });
  await waitForCondition(() => typeof rejectSave === "function", "자동 저장이 시작돼야 합니다.");
  const elsewhere = harness.browserWindow.document.createElement("button");
  elsewhere.textContent = "다른 작업";
  harness.browserWindow.document.body.append(elsewhere);
  await act(async () => { elsewhere.focus(); rejectSave(new Error("offline")); });
  await waitForCondition(() => Boolean(harness.container.querySelector('[role="alert"]')), "저장 실패 안내가 보여야 합니다.");
  assert.ok(harness.browserWindow.document.activeElement === elsewhere);
});


for (const moveFocusElsewhere of [false, true]) {
  test(`Q&A 복원 뒤 ${moveFocusElsewhere ? "사용자가 옮긴 포커스를 보존한다" : "현재 동작 버튼으로 포커스를 이어간다"}`, { concurrency: false }, async (context) => {
    const deletedAt = new Date().toISOString();
    const screen = (restored: boolean) => <ThreadDetailClient actorId="restore-focus" threadId="restore-focus-thread" title="복원 질문" status="OPEN" version={restored ? 2 : 1} isAdmin={false} replies={[]} deletedAt={restored ? null : deletedAt} studentName="학생" createdAt={null} returnTo="/dashboard/qna" />;
    const harness = await renderForm(context, screen(false));
    const restoreButton = [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Q&A 복원")!;
    await act(async () => { restoreButton.focus(); restoreButton.click(); });
    // 실제 브라우저는 요청 중 disabled가 된 버튼에서 포커스를 해제한다.
    restoreButton.blur();
    const elsewhere = harness.browserWindow.document.createElement("button");
    elsewhere.textContent = "다른 작업";
    harness.browserWindow.document.body.append(elsewhere);
    if (moveFocusElsewhere) elsewhere.focus();
    await harness.rerender(screen(true));
    const currentButton = [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === "휴지통으로 이동")!;
    assert.ok(harness.browserWindow.document.activeElement === (moveFocusElsewhere ? elsewhere : currentButton), "복원 결과가 현재 키보드 작업 위치를 잃거나 가로채면 안 됩니다.");
  });
}








test("종료된 Q&A의 답글 입력은 잠기고 저장 단축키와 등록이 아무 요청도 만들지 않는다", { concurrency: false }, async (context) => {
  resetActionCalls();
  const screen = (status: "OPEN" | "CLOSED") => (
    <ThreadDetailClient
      actorId="closed-thread-shortcut-actor"
      createdAt="2026-08-05T00:00:00.000Z"
      isAdmin={false}
      replies={[]}
      returnTo="/dashboard/qna"
      status={status}
      version={1}
      deletedAt={null}
      studentName="학생"
      threadId="closed-thread-shortcut"
      title="종료된 스레드"
    />
  );
  const harness = await renderForm(context, screen("OPEN"));
  await writeCollabBody(harness, "종료 전에 작성한 본문");
  await harness.rerender(screen("CLOSED"));
  const editor = harness.container.querySelector<HTMLTextAreaElement>(BODY_FIELD);
  assert.ok(editor, "종료된 스레드도 작성 중이던 글은 보인다");
  assert.match(editor.value, /종료 전에 작성한 본문/u);
  assert.equal(editor.disabled, true);
  const dispatchResult = dispatchBlockedSaveShortcut(harness, editor);
  assert.deepEqual(dispatchResult, { requestSubmitCount: 0, submitEventCount: 0 });
  assert.equal(harness.container.querySelector('button[type="submit"]'), null);
  assertNoPublicActionCalled();
});




/** 실제 시간이 걸리는 자동 저장(1.5초 idle)을 기다린다. */
async function waitForRealTime(ms: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
}

async function waitUntil(condition: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await waitForRealTime(50);
  }
  assert.fail(message);
}

/** 제어 textarea(제목)·mock 편집기(onInput) 모두에 값을 넣고 변경 흐름을 일으킨다. */
function typeInto(harness: FormHarness, element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(harness.browserWindow.HTMLTextAreaElement.prototype, "value")?.set;
  assert.ok(setter);
  // keyup 경로는 초점이 있는 요소의 값 변화만 읽는다.
  element.focus();
  setter.call(element, value);
  element.dispatchEvent(new harness.browserWindow.Event("input", { bubbles: true, cancelable: true }) as unknown as Event);
  element.dispatchEvent(new harness.browserWindow.Event("change", { bubbles: true }) as unknown as Event);
  // react-dom이 DOM 전역보다 먼저 load되면 input 대신 keyup에서 값 변화를 읽는다.
  element.dispatchEvent(new harness.browserWindow.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event);
}




/** 서버 초안 fixture: 실제 서버처럼 canonical payload hash를 쓴다(휘발 필드는 호출자가 미리 뺀다). */

/** React 제어 input에 값을 넣고 change 흐름을 일으킨다. */
async function typeIntoInput(harness: FormHarness, input: HTMLInputElement, value: string): Promise<void> {
  // 초안 hook의 비동기 서버 동기화가 끝나기 전에 입력하면 복원이 입력을 덮을 수 있어 먼저 한 바퀴 기다린다.
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
  }
  const setter = Object.getOwnPropertyDescriptor(harness.browserWindow.HTMLInputElement.prototype, "value")?.set;
  assert.ok(setter);
  await act(async () => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new harness.browserWindow.Event("input", { bubbles: true }) as unknown as Event);
    input.dispatchEvent(new harness.browserWindow.Event("change", { bubbles: true }) as unknown as Event);
    // react-dom이 DOM 전역보다 먼저 load되면 input 대신 keyup에서 값 변화를 읽는다.
    input.dispatchEvent(new harness.browserWindow.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event);
  });
}

function findRadio(container: ParentNode, label: string): HTMLButtonElement {
  const radio = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((candidate) => candidate.textContent === label);
  assert.ok(radio, `선택지: ${label}`);
  return radio;
}

const MIXSET_LINK_LABEL = "링크 (YouTube·SoundCloud)";
const MIXSET_LINK_SELECTOR = 'input[name="mixsetLinkUrl"]';

/** 믹스셋 작성 폼을 사용자가 쓰듯 채운다(제목·본문). 공동 작성본 room이 준비된 뒤에만 입력이 남는다. */
async function fillFeedbackPost(harness: FormHarness, title: string | null, body = "믹스셋 소개"): Promise<void> {
  await writeCollabBody(harness, body);
  if (title) await typeIntoInput(harness, harness.container.querySelector<HTMLInputElement>('input[name="title"]')!, title);
}

test("새 믹스셋은 업로드 파일을 보관한 채 링크 방식으로 바꾸고, 형식 오류를 알린 뒤 고른 방식의 값만 보낸다", { concurrency: false }, async (context) => {
  resetActionCalls();
  abandonedUploads.length = 0;
  const requests: Record<string, FormDataEntryValue>[] = [];
  saveNewPost = async (_previous, data) => {
    requests.push(Object.fromEntries(data));
    return { error: "테스트에서 등록하지 않습니다." };
  };
  context.after(() => { saveNewPost = async () => ({}); });
  const actorId = "mixset-mode-switch-actor";
  const harness = await renderForm(
    context,
    <NewPostForm actorId={actorId} defaultBoardType="FEEDBACK" defaultCategory="feedback" isAdmin={false} returnTo="/community" />,
  );
  const { container } = harness;
  await fillFeedbackPost(harness, `${actorId} 믹스셋`);
  assert.equal(findRadio(container, "오디오 파일").getAttribute("aria-checked"), "true", "믹스셋은 오디오 방식으로 시작한다.");
  assert.equal(container.querySelector(MIXSET_LINK_SELECTOR), null);

  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="upload-complete"]')!.click());
  assert.match(container.textContent ?? "", /업로드 완료/u);

  await act(async () => findRadio(container, MIXSET_LINK_LABEL).click());
  const linkInput = container.querySelector<HTMLInputElement>(MIXSET_LINK_SELECTOR);
  assert.ok(linkInput, "링크 방식에서는 링크 칸을 보인다.");
  assert.equal(linkInput.required, true);
  assert.equal(container.querySelector('input[name="mediaObjectId"]'), null, "링크 방식에서는 업로드 식별자를 보내지 않는다.");
  assert.equal(container.querySelector('input[name="mediaUrl"]'), null);
  assert.equal(container.querySelector("form")?.noValidate, true);
  assert.match(container.textContent ?? "", /업로드한 오디오 파일은 보관 중입니다/u);

  await typeIntoInput(harness, linkInput, "https://vimeo.com/123");
  await act(async () => submitControl(container).click());
  assert.equal(requests.length, 0, "형식이 틀린 링크는 보내지 않는다.");
  const alert = container.querySelector<HTMLElement>('[role="alert"]');
  assert.equal(alert?.textContent, "YouTube 영상 또는 SoundCloud 트랙·세트 링크만 올릴 수 있습니다.");
  assert.equal(linkInput.getAttribute("aria-invalid"), "true");
  assert.ok(linkInput.getAttribute("aria-describedby")?.split(" ").includes(alert!.id), "오류 문구를 링크 칸 설명에 연결한다.");
  assert.equal(harness.browserWindow.document.activeElement, linkInput, "오류가 난 링크 칸으로 초점을 옮긴다.");

  await typeIntoInput(harness, linkInput, "https://soundcloud.com/stann/sets/lesson-mix");
  assert.equal(container.querySelector('[role="alert"]'), null, "고치기 시작하면 오류를 지운다.");
  await act(async () => { await waitForRealTime(50); });

  await act(async () => submitControl(container).click());
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.mixsetLinkUrl, "https://soundcloud.com/stann/sets/lesson-mix");
  assert.equal("mediaObjectId" in requests[0]!, false);
  assert.equal("mediaUrl" in requests[0]!, false, "링크를 legacy mediaUrl 칸으로 보내지 않는다.");

  await act(async () => findRadio(container, "오디오 파일").click());
  assert.match(container.textContent ?? "", /업로드 완료/u, "오디오로 돌아오면 업로드한 파일이 그대로 있다.");
  assert.equal(container.querySelector(MIXSET_LINK_SELECTOR), null);
  assert.equal(container.querySelector<HTMLInputElement>('input[name="mediaObjectId"]')?.value, MOCK_UPLOADED_MEDIA_ID);
  assert.equal(container.querySelector("form")?.noValidate, false);
  await act(async () => submitControl(container).click());
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.mediaObjectId, MOCK_UPLOADED_MEDIA_ID);
  assert.equal("mixsetLinkUrl" in requests[1]!, false, "오디오 방식에서는 링크를 보내지 않는다.");
  assert.deepEqual(abandonedUploads, [], "방식 전환만으로 업로드 파일을 버리지 않는다.");
});

test("새 믹스셋을 링크 방식으로 게시하면 보관만 하던 업로드 파일은 게시 뒤 정리한다", { concurrency: false }, async (context) => {
  resetActionCalls();
  abandonedUploads.length = 0;
  const requests: Record<string, FormDataEntryValue>[] = [];
  saveNewPost = async (_previous, data) => {
    requests.push(Object.fromEntries(data));
    return { postId: "mixset-link-post" };
  };
  context.after(() => { saveNewPost = async () => ({}); });
  const actorId = "mixset-link-publish-actor";
  const harness = await renderForm(
    context,
    <NewPostForm actorId={actorId} defaultBoardType="FEEDBACK" defaultCategory="feedback" isAdmin={false} returnTo="/community" />,
  );
  const { container } = harness;
  await fillFeedbackPost(harness, `${actorId} 믹스셋`);
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="upload-complete"]')!.click());
  await act(async () => findRadio(container, MIXSET_LINK_LABEL).click());
  await typeIntoInput(harness, container.querySelector<HTMLInputElement>(MIXSET_LINK_SELECTOR)!, "https://youtu.be/aqz-KE-bpKQ");
  assert.equal(findRadio(container, "믹스셋").getAttribute("aria-checked"), "true");

  await waitForCondition(() => !submitControl(container).disabled, "게시 버튼이 켜져야 합니다.");
  await act(async () => submitControl(container).click());
  await waitForCondition(() => abandonedUploads.length > 0, "링크로 게시하면 붙지 않은 업로드를 정리한다.");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.mixsetLinkUrl, "https://youtu.be/aqz-KE-bpKQ");
  assert.equal(requests[0]!.boardType, "FEEDBACK");
  assert.equal("mediaObjectId" in requests[0]!, false);
  assert.deepEqual(abandonedUploads, [MOCK_UPLOADED_MEDIA_ID]);
});

test("새 게시물에서 믹스셋이 아닌 게시판으로 바꾸면 링크 칸과 링크 값을 함께 비운다", { concurrency: false }, async (context) => {
  resetActionCalls();
  const actorId = "mixset-board-switch-actor";
  const harness = await renderForm(
    context,
    <NewPostForm actorId={actorId} defaultBoardType="FEEDBACK" defaultCategory="feedback" isAdmin={false} returnTo="/community" />,
  );
  const { container } = harness;
  await fillFeedbackPost(harness, null);
  await act(async () => findRadio(container, MIXSET_LINK_LABEL).click());
  await typeIntoInput(harness, container.querySelector<HTMLInputElement>(MIXSET_LINK_SELECTOR)!, "https://youtu.be/aqz-KE-bpKQ");
  assert.ok(container.querySelector(MIXSET_LINK_SELECTOR));
  await act(async () => findRadio(container, "자유").click());
  assert.equal(container.querySelector(MIXSET_LINK_SELECTOR), null);
  assert.equal(container.querySelector('[role="radiogroup"] [role="radio"][aria-checked="true"]')?.textContent, "자유");
  await act(async () => findRadio(container, "믹스셋").click());
  assert.equal(findRadio(container, "오디오 파일").getAttribute("aria-checked"), "true");
  assert.equal(container.querySelector(MIXSET_LINK_SELECTOR), null);
});

test("게시물 수정 form은 mixsetLinkUrl prop이 없으면 링크 칸 없이 예전처럼 저장한다", { concurrency: false }, async (context) => {
  const post = { id: "post-plain", title: "일반 게시물", contentHtml: "<p>일반 본문</p>", version: 1 };
  const requests: Record<string, FormDataEntryValue>[] = [];
  savePostEdit = async (_id, _previous, data) => {
    requests.push(Object.fromEntries(data));
    return { success: true, post: { ...post, version: 2 } };
  };
  context.after(() => { savePostEdit = async () => ({}); });
  const harness = await renderForm(context, <PostEditForm actorId="post-plain-actor" post={post} mixsetLinkUrl={null} onCancel={() => undefined} onSaved={() => undefined} />);
  await waitUntil(() => Boolean(harness.container.querySelector(BODY_FIELD)) && !(submitControl(harness.container) as HTMLButtonElement).disabled, 3000, "수정 작업본이 열리고 저장할 수 있어야 합니다.");
  assert.equal(harness.container.querySelector(MIXSET_LINK_SELECTOR), null);
  assert.equal(harness.container.querySelector("form")?.noValidate, false);
  await act(async () => submitControl(harness.container).click());
  assert.equal(requests.length, 1);
  assert.equal("mixsetLinkUrl" in requests[0]!, false, "링크 칸이 없으면 매체를 바꾸지 않도록 칸을 보내지 않는다.");
});

test("게시물 수정 form은 링크 게시물에 링크 칸을 두고 검증·제출에 포함한다", { concurrency: false }, async (context) => {
  const post = { id: "post-mixset-link", title: "링크 믹스셋", contentHtml: "<p>링크 본문</p>", version: 1 };
  const requests: Record<string, FormDataEntryValue>[] = [];
  savePostEdit = async (_id, _previous, data) => {
    requests.push(Object.fromEntries(data));
    return { success: true, post: { ...post, title: String(data.get("title")), contentHtml: String(data.get("contentHtml")), version: 2, mediaUrl: String(data.get("mixsetLinkUrl") ?? "") } };
  };
  context.after(() => { savePostEdit = async () => ({}); });

  const actorId = "post-mixset-link-actor";
  const harness = await renderForm(
    context,
    <PostEditForm actorId={actorId} post={post} mixsetLinkUrl="https://www.youtube.com/watch?v=aqz-KE-bpKQ" onCancel={() => undefined} onSaved={() => undefined} />,
  );
  const { container } = harness;
  await waitUntil(() => Boolean(container.querySelector(MIXSET_LINK_SELECTOR)) && !container.querySelector<HTMLTextAreaElement>(BODY_FIELD)?.disabled, 3000, "수정 작업본이 열려야 합니다.");
  const linkInput = container.querySelector<HTMLInputElement>(MIXSET_LINK_SELECTOR);
  assert.ok(linkInput);
  assert.equal(linkInput.value, "https://www.youtube.com/watch?v=aqz-KE-bpKQ", "게시본의 링크로 작업본을 연다.");
  assert.equal(linkInput.required, true);
  assert.equal(container.querySelector(`label[for="${linkInput.id}"]`)?.textContent?.includes("믹스셋 링크"), true);
  assert.equal(container.querySelector("form")?.noValidate, true);

  await typeIntoInput(harness, linkInput, "");
  await act(async () => submitControl(container).click());
  assert.equal(requests.length, 0, "빈 링크는 저장하지 않는다.");
  const alert = container.querySelector<HTMLElement>('[role="alert"]');
  assert.equal(alert?.textContent, "믹스셋 링크를 입력해 주세요.");
  assert.ok(linkInput.getAttribute("aria-describedby")?.split(" ").includes(alert!.id));
  assert.equal(harness.browserWindow.document.activeElement, linkInput);

  await typeIntoInput(harness, linkInput, "https://soundcloud.com/stann/new-track");
  await act(async () => { await waitForRealTime(50); });
  await act(async () => submitControl(container).click());
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.mixsetLinkUrl, "https://soundcloud.com/stann/new-track");
  assert.equal(requests[0]!.title, post.title);
});

test("링크 게시물 수정에서 제목을 비우고 Cmd/Ctrl+S로 저장하면 버튼 저장처럼 빈 제목을 알린다", { concurrency: false }, async (context) => {
  const post = { id: "post-mixset-link-empty-title", title: "링크 믹스셋", contentHtml: "<p>링크 본문</p>", version: 1 };
  const requests: Record<string, FormDataEntryValue>[] = [];
  savePostEdit = async (_id, _previous, data) => {
    requests.push(Object.fromEntries(data));
    return { success: true, post: { ...post, title: String(data.get("title")), version: 2, mediaUrl: String(data.get("mixsetLinkUrl") ?? "") } };
  };
  context.after(() => { savePostEdit = async () => ({}); });
  const harness = await renderForm(
    context,
    <PostEditForm actorId="post-mixset-link-empty-title-actor" post={post} mixsetLinkUrl="https://youtu.be/aqz-KE-bpKQ" onCancel={() => undefined} onSaved={() => undefined} />,
  );
  const { container } = harness;
  assert.equal(container.querySelector("form")?.noValidate, true, "링크 칸이 있으면 브라우저 필수 안내가 뜨지 않는다.");
  const titleInput = container.querySelector<HTMLInputElement>('input[name="title"]');
  assert.ok(titleInput);
  await typeIntoInput(harness, titleInput, "   ");
  const shortcut = new harness.browserWindow.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key: "s" });
  await act(async () => { titleInput.dispatchEvent(shortcut as unknown as Event); });
  assert.equal(shortcut.defaultPrevented, true);
  assert.equal(requests.length, 0, "빈 제목은 저장하지 않는다.");
  const alert = container.querySelector<HTMLElement>('[role="alert"]');
  assert.equal(alert?.textContent, "제목을 입력해 주세요.");
  assert.equal(titleInput.getAttribute("aria-invalid"), "true");
  assert.equal(titleInput.getAttribute("aria-describedby"), alert!.id);
  assert.equal(harness.browserWindow.document.activeElement, titleInput, "빈 제목 칸으로 초점을 옮긴다.");

  await typeIntoInput(harness, titleInput, "고친 제목");
  assert.equal(container.querySelector('[role="alert"]'), null, "제목을 쓰기 시작하면 안내를 지운다.");
  assert.equal(titleInput.getAttribute("aria-invalid"), null);
});

test("새 믹스셋 링크 방식에서 제목 없이 키보드로 제출하면 빈 제목을 알리고 게시하지 않는다", { concurrency: false }, async (context) => {
  resetActionCalls();
  const requests: Record<string, FormDataEntryValue>[] = [];
  saveNewPost = async (_previous, data) => {
    requests.push(Object.fromEntries(data));
    return { error: "테스트에서 등록하지 않습니다." };
  };
  context.after(() => { saveNewPost = async () => ({}); });
  const actorId = "mixset-link-empty-title-actor";
  const harness = await renderForm(
    context,
    <NewPostForm actorId={actorId} defaultBoardType="FEEDBACK" defaultCategory="feedback" isAdmin={false} returnTo="/community" />,
  );
  const { container } = harness;
  await fillFeedbackPost(harness, null);
  await act(async () => findRadio(container, MIXSET_LINK_LABEL).click());
  await typeIntoInput(harness, container.querySelector<HTMLInputElement>(MIXSET_LINK_SELECTOR)!, "https://youtu.be/aqz-KE-bpKQ");
  const form = container.querySelector("form");
  assert.equal(form?.noValidate, true);
  const titleInput = container.querySelector<HTMLInputElement>('input[name="title"]');
  assert.ok(titleInput);
  assert.equal(titleInput.value, "");
  // 버튼은 빈 제목에서 잠겨 브라우저가 암묵 제출을 하지 않는다. 링크 칸의 실제 Enter가 form에서 안내로 이어져야 한다.
  const linkInput = container.querySelector<HTMLInputElement>(MIXSET_LINK_SELECTOR);
  assert.ok(linkInput);
  const enter = new harness.browserWindow.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => { linkInput.dispatchEvent(enter as unknown as Event); });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(requests.length, 0, "빈 제목은 게시하지 않는다.");
  const alert = container.querySelector<HTMLElement>('[role="alert"]');
  assert.equal(alert?.textContent, "제목을 입력해 주세요.");
  assert.equal(titleInput.getAttribute("aria-invalid"), "true");
  assert.equal(titleInput.getAttribute("aria-describedby"), alert!.id);
  assert.equal(harness.browserWindow.document.activeElement, titleInput);

  await typeIntoInput(harness, titleInput, "금요일 믹스셋");
  assert.equal(container.querySelector('[role="alert"]'), null);
  await waitForCondition(() => !submitControl(container).disabled, "제목을 쓰면 게시 버튼이 켜져야 합니다.");
  await act(async () => submitControl(container).click());
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.title, "금요일 믹스셋");
});

test("링크 게시물 수정에서 제목을 비우고 링크 칸에서 Enter를 누르면 빈 제목을 알리고 저장하지 않는다", { concurrency: false }, async (context) => {
  const post = { id: "post-mixset-link-enter", title: "기준 제목", contentHtml: "<p>기준 본문</p>", version: 1 };
  const requests: Record<string, FormDataEntryValue>[] = [];
  savePostEdit = async (_id, _previous, data) => {
    requests.push(Object.fromEntries(data));
    return {};
  };
  context.after(() => { savePostEdit = async () => ({}); });
  const harness = await renderForm(
    context,
    <PostEditForm actorId="post-mixset-link-enter-actor" post={post} mixsetLinkUrl="https://youtu.be/aqz-KE-bpKQ" onCancel={() => undefined} onSaved={() => undefined} />,
  );
  const { container } = harness;
  const titleInput = container.querySelector<HTMLInputElement>('input[name="title"]');
  assert.ok(titleInput);
  await typeIntoInput(harness, titleInput, "");
  const linkInput = container.querySelector<HTMLInputElement>(MIXSET_LINK_SELECTOR);
  assert.ok(linkInput);
  const enter = new harness.browserWindow.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => { linkInput.dispatchEvent(enter as unknown as Event); });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(requests.length, 0);
  assert.equal(container.querySelector('[role="alert"]')?.textContent, "제목을 입력해 주세요.");
  assert.equal(harness.browserWindow.document.activeElement, titleInput);

  // 제목이 있으면 Enter를 가로채지 않는다(기존 암묵 제출 그대로).
  await typeIntoInput(harness, titleInput, "새 제목");
  const enterWithTitle = new harness.browserWindow.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => { linkInput.dispatchEvent(enterWithTitle as unknown as Event); });
  assert.equal(enterWithTitle.defaultPrevented, false);
});

test("링크 게시물 저장이 충돌하면 선택창 없이 최신 version 기준으로 내 링크를 한 번 더 저장한다", { concurrency: false }, async (context) => {
  const post = { id: "post-mixset-link-conflict", title: "기준 제목", contentHtml: "<p>기준 본문</p>", version: 1 };
  const latest = { ...post, title: "다른 화면 제목", contentHtml: "<p>다른 화면 본문</p>", version: 2, mediaUrl: "https://soundcloud.com/stann/latest-set" };
  const requests: Record<string, FormDataEntryValue>[] = [];
  let saved = 0;
  savePostEdit = async (_id, _previous, data) => {
    requests.push(Object.fromEntries(data));
    return requests.length === 1
      ? { error: "다른 화면에서 먼저 변경되었습니다.", conflictKind: "VERSION_CONFLICT", currentRevision: 2, conflictPost: latest }
      : { success: true, post: { ...latest, version: 3 } };
  };
  context.after(() => { savePostEdit = async () => ({}); });
  const harness = await renderForm(
    context,
    <PostEditForm actorId="post-mixset-link-conflict-actor" post={post} mixsetLinkUrl="https://youtu.be/aqz-KE-bpKQ" onCancel={() => undefined} onSaved={() => { saved += 1; }} />,
  );
  const { container } = harness;
  await waitUntil(() => Boolean(container.querySelector(MIXSET_LINK_SELECTOR)) && !container.querySelector<HTMLTextAreaElement>(BODY_FIELD)?.disabled, 3000, "수정 작업본이 열려야 합니다.");
  await typeIntoInput(harness, container.querySelector<HTMLInputElement>(MIXSET_LINK_SELECTOR)!, "https://soundcloud.com/stann/my-set");
  await waitForCondition(() => !submitControl(container).disabled, "저장 버튼이 켜져야 합니다.");
  await act(async () => submitControl(container).click());
  await waitForCondition(() => saved === 1, "충돌 뒤 한 번 더 저장해 끝낸다.");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.baseRevision, "1");
  assert.equal(requests[1]!.baseRevision, "2", "서버 최신 version을 기준으로 다시 저장한다.");
  assert.equal(requests[1]!.mixsetLinkUrl, "https://soundcloud.com/stann/my-set", "내 링크를 그대로 보낸다.");
  assert.doesNotMatch(container.textContent ?? "", /서버 최신본 사용|현재 초안으로 계속|더 최신 서버|계정 초안/u);
});
