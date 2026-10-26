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
import { createDocumentSnapshotFingerprint } from "@/lib/document-snapshot-fingerprint";

type MockEditorProps = {
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
let restoreNote: typeof import("@/lib/actions/privateNotes").restorePrivateNoteRevision = async () => ({ success: true });
let changeNoteLifecycle: typeof import("@/lib/actions/privateNotes").trashPrivateNote = async () => ({ success: true });
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
} });

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
let PostEditForm: typeof import("@/components/community/PostEditForm").PostEditForm;
let NewQnaForm: typeof import("@/components/qna/NewQnaForm").NewQnaForm;
let NoteEditorForm: typeof import("@/components/notes/NoteEditorForm").NoteEditorForm;
let QnaSlideForm: typeof import("@/components/qna/QnaSlideForm").QnaSlideForm;
let ThreadDetailClient: typeof import("@/components/qna/ThreadDetailClient").ThreadDetailClient;
let RestoreNoteRevisionButton: typeof import("@/components/notes/RestoreNoteRevisionButton").RestoreNoteRevisionButton;
let DeleteNoteButton: typeof import("@/components/notes/DeleteNoteButton").DeleteNoteButton;
let NoteTrashActions: typeof import("@/components/notes/NoteTrashActions").NoteTrashActions;
let RestorePostRevisionButton: typeof import("@/components/community/RestorePostRevisionButton").RestorePostRevisionButton;
let PostTrashActions: typeof import("@/components/community/PostTrashActions").PostTrashActions;
let QnaThreadLifecycleActions: typeof import("@/components/qna/QnaThreadLifecycleActions").QnaThreadLifecycleActions;
let NoteFullForm: typeof import("@/components/notes/NoteFullForm").NoteFullForm;
let StudentNotesPage: typeof import("@/app/dashboard/student/notes/page").default;
let AdminStudentNotesPage: typeof import("@/app/dashboard/admin/students/[id]/notes/page").default;
let QnaPage: typeof import("@/app/dashboard/qna/page").default;
let QnaTrashPage: typeof import("@/app/dashboard/qna/trash/page").default;
let ThreadList: typeof import("@/components/qna/ThreadList").ThreadList;

before(async () => {
  ({ PostEditForm } = await import("@/components/community/PostEditForm"));
  ({ DeleteNoteButton } = await import("@/components/notes/DeleteNoteButton"));
  ({ NoteTrashActions } = await import("@/components/notes/NoteTrashActions"));
  ({ RestorePostRevisionButton } = await import("@/components/community/RestorePostRevisionButton"));
  ({ PostTrashActions } = await import("@/components/community/PostTrashActions"));
  ({ QnaThreadLifecycleActions } = await import("@/components/qna/QnaThreadLifecycleActions"));
  ({ default: QnaTrashPage } = await import("@/app/dashboard/qna/trash/page"));
  [
    { NewPostForm },
    { NewQnaForm },
    { NoteEditorForm },
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
    import("@/components/notes/NoteEditorForm"),
    import("@/components/qna/QnaSlideForm"),
    import("@/components/qna/ThreadDetailClient"),
    import("@/components/notes/RestoreNoteRevisionButton"),
    import("@/components/notes/NoteFullForm"),
    import("@/app/dashboard/student/notes/page"),
    import("@/app/dashboard/admin/students/[id]/notes/page"),
    import("@/app/dashboard/qna/page"),
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
    const form = harness.container.querySelector<HTMLFormElement>('form[aria-label="Q&A 상태 필터"]')!;
    assert.equal(form.method, "get");
    const answered = form.querySelector<HTMLButtonElement>('button[value="ANSWERED"]')!;
    assert.equal(answered.getAttribute("aria-pressed"), "true");
    const data = new FormData(form, answered);
    assert.equal(data.get("qnaStatus"), "ANSWERED");
    assert.equal(data.get("returnTo"), parent);
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
    const all = new FormData(form, form.querySelector<HTMLButtonElement>('button[value="ALL"]')!);
    await harness.rerender(await page(String(all.get("qnaStatus"))));
    assert.equal(harness.container.querySelectorAll('a[href^="/dashboard/qna/thread-"]').length, 2);
  }
  await harness.rerender(<ThreadList threads={qnaPageData} isAdmin filter="ANSWERED" returnTo="/dashboard/admin/students/student-1?tab=qna#records" />);
  const form = harness.container.querySelector<HTMLFormElement>('form[aria-label="Q&A 상태 필터"]')!;
  assert.equal(form.getAttribute("action"), "/dashboard/admin/students/student-1#records");
  assert.equal(new FormData(form).get("tab"), "qna");
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
    const filter = harness.container.querySelector<HTMLFormElement>('form[aria-label="Q&A 상태 필터"]')!;
    const filterFields = new FormData(filter, filter.querySelector<HTMLButtonElement>('button[value="OPEN"]')!);
    assert.equal(filterFields.get("qnaQuery"), "EQ 리듬");
    assert.equal(filterFields.getAll("qnaQuery").length, 1);
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
    const key = createDocumentDraftKey("qna-reply", "student-busy", "thread-busy");
    const harness = await renderForm(context, <ThreadDetailClient actorId="student-busy" threadId="thread-busy" title="질문" status="OPEN" version={1} isAdmin={false} replies={[]} deletedAt={null} studentName="학생" createdAt={null} returnTo="/dashboard/qna" />,
      (storage) => storage.setItem(key, serializeFormDraft({ operationId: "012c1894-ea20-46b2-960f-35b01d873570", contentHtml: "<p>전송할 답변</p>", attachmentUrl: "", attachmentObjectId: "" })));
    const form = harness.container.querySelector<HTMLFormElement>("form")!;
    const trash = [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "휴지통 이동")!;
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
  const key = createDocumentDraftKey("qna-reply", "admin-status", "thread-status");
  const screen = (status: "OPEN" | "CLOSED" | "ANSWERED", version: number) => <ThreadDetailClient actorId="admin-status" threadId="thread-status" title="질문" status={status} version={version} isAdmin replies={[]} deletedAt={null} studentName="학생" createdAt={null} returnTo="/dashboard/qna" />;
  const harness = await renderForm(context, screen("OPEN", 1), (storage) => storage.setItem(key, serializeFormDraft({ operationId: "012c1894-ea20-46b2-960f-35b01d873570", contentHtml: "<p>아직 전송하지 않은 답변</p>", attachmentUrl: "", attachmentObjectId: "" })));
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
  const key = createDocumentDraftKey("qna-reply", "admin-lifecycle", "thread-lifecycle");
  const screen = (version: number, isAdmin = true) => <ThreadDetailClient actorId="admin-lifecycle" threadId="thread-lifecycle" title="질문" status={version === 1 ? "OPEN" : "CLOSED"} version={version} isAdmin={isAdmin} replies={[]} deletedAt={null} studentName="학생" createdAt={null} returnTo="/dashboard/qna" />;
  const harness = await renderForm(context, screen(1), (storage) => storage.setItem(key, serializeFormDraft({ operationId: "012c1894-ea20-46b2-960f-35b01d873570", contentHtml: "<p>보관 중인 답변</p>", attachmentUrl: "", attachmentObjectId: "" })));
  const find = (label: string) => [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label)!;
  const trashAndConfirm = async () => {
    await act(async () => find("휴지통 이동").click());
    await confirmAction(harness, "휴지통 이동 확인");
  };
  await trashAndConfirm();
  assert.equal(find("휴지통 이동").disabled, true);
  await act(async () => find("휴지통 이동").click());
  assert.equal(requests.length, 1);
  await act(async () => find("최신 상태 확인").click());
  assert.match(harness.container.textContent ?? "", /최신 상태를 불러오지 못했습니다/u);
  refresh.mock.mockImplementation(() => undefined);
  await act(async () => find("최신 상태 확인").click());
  assert.equal(refresh.mock.callCount(), 2);
  assert.equal(find("휴지통 이동").disabled, true, "현재 revision 숫자만으로 mutation을 열지 않는다");
  await harness.rerender(screen(2));
  assert.equal(find("휴지통 이동").disabled, false);
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

class SaveErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p data-testid="save-error-boundary">편집 화면 오류</p> : this.props.children; }
}

for (const kind of ["new-note", "edit-note", "new-post", "edit-post"] as const) {
  for (const boundary of kind === "new-post" ? ["actor"] as const : ["actor", "resource"] as const) {
    test(`${kind} ${boundary} 전환 후 이전 저장 성공은 현재 원문·초안·이동을 변경하지 않는다`, { concurrency: false }, async (context) => {
      type SaveResult = import("@/lib/actions/privateNotes").CreateNoteState & import("@/lib/actions/posts").UpdatePostState & import("@/lib/actions/posts").CreatePostState;
      const isNote = kind.endsWith("note");
      const isEdit = kind.startsWith("edit");
      const actorA = `${kind}-${boundary}-actor-a`;
      const actorB = boundary === "actor" ? `${kind}-${boundary}-actor-b` : actorA;
      const resourceA = "resource-a";
      const resourceB = boundary === "resource" ? "resource-b" : resourceA;
      const requests: { data: Record<string, FormDataEntryValue>; resolve: (result: SaveResult) => void }[] = [];
      const action = (_previous: object, data: FormData) => new Promise<SaveResult>((resolve) => { requests.push({ data: Object.fromEntries(data), resolve }); });
      saveNewPost = action;
      savePostEdit = (_id, previous, data) => action(previous, data);
      context.after(() => { saveNewPost = async () => ({}); savePostEdit = async () => ({}); });
      const navigation = context.mock.method(router, "replace");
      let saves = 0;
      const base = (id: string) => ({ id, title: `서버 ${id}`, contentHtml: `<p>서버 ${id}</p>`, version: 1 });
      const key = (actor: string, id: string) => createDocumentDraftKey(isNote ? "note" : "community-post", actor, isEdit ? id : isNote ? `new:${id}` : undefined);
      const screen = (actor: string, id: string) => kind === "new-note"
        ? <NoteFullForm action={action} actorId={actor} studentId={id} returnTo="/dashboard/admin" />
        : kind === "edit-note"
          ? <NoteEditorForm action={action} actorId={actor} note={{ ...base(id), noteDate: null }} />
          : kind === "new-post"
            ? <NewPostForm actorId={actor} isAdmin={false} defaultBoardType="GENERAL" defaultCategory="general" returnTo="/community" />
            : <PostEditForm actorId={actor} post={base(id)} onCancel={() => undefined} onSaved={() => { saves += 1; }} />;
      const harness = await renderForm(context, screen(actorA, resourceA), (storage) => {
        for (const [actor, id, label] of [[actorA, resourceA, "A"], [actorB, resourceB, "B"]]) {
          storage.setItem(key(actor, id), serializeFormDraft({
            title: `${label} 제목`, contentHtml: `<p>${label} 원문</p>`, operationId: crypto.randomUUID(),
            ...(isNote ? { noteDate: "" } : { boardType: "GENERAL", category: "general", isPinned: false, mediaUrl: "" }),
            ...(isEdit ? { baseRevision: 1, baseFingerprint: createDocumentSnapshotFingerprint({ kind: isNote ? "private-note" : "community-post", ...base(id), noteDate: isNote ? "" : null }) } : {}),
          }));
        }
      });
      const submit = () => submitControl(harness.container);
      const response = (index: number, id: string): SaveResult => {
        const snapshot = { id, title: String(requests[index]!.data.title), contentHtml: String(requests[index]!.data.contentHtml), version: 2 };
        return { success: true, ...(isNote ? { note: { ...snapshot, noteDate: null, createdAt: new Date() } } : isEdit ? { post: snapshot } : { postId: id }) };
      };
      await act(async () => submit().click());
      assert.equal(requests.length, 1);
      await harness.rerender(screen(actorB, resourceB));
      type DraftContent = { title: string; contentHtml: string; operationId: string };
      const beforeRaw = harness.browserWindow.localStorage.getItem(key(actorB, resourceB));
      assert.ok(beforeRaw);
      const before = parseFormDraft<DraftContent>(beforeRaw)!.data;
      assert.equal(submit().disabled, false);
      await act(async () => submit().click());
      assert.equal(requests.length, 2);
      assert.equal(requests[1]!.data.title, "B 제목");
      assert.equal(requests[1]!.data.operationId, before.operationId);
      await act(async () => requests[0]!.resolve(response(0, resourceA)));
      assert.equal(harness.container.querySelector<HTMLInputElement>('[name="title"]')?.value, "B 제목");
      assert.equal(harness.container.querySelector<HTMLTextAreaElement>(BODY_FIELD)?.value, "<p>B 원문</p>");
      const afterRaw = harness.browserWindow.localStorage.getItem(key(actorB, resourceB));
      assert.ok(afterRaw);
      const after = parseFormDraft<DraftContent>(afterRaw)?.data;
      assert.deepEqual(after && { title: after.title, contentHtml: after.contentHtml, operationId: after.operationId }, { title: before.title, contentHtml: before.contentHtml, operationId: before.operationId });
      assert.equal(readFormDraftClearMarkers(harness.browserWindow.localStorage, key(actorB, resourceB)).length, 0);
      assert.equal(navigation.mock.callCount(), 0);
      assert.equal(saves, 0);
      assert.ok(harness.browserWindow.localStorage.getItem(key(actorA, resourceA)), "완료 응답을 분리한 이전 초안은 재시도 가능해야 합니다.");
      assert.equal(submit().disabled, true, "이전 문맥 완료가 새 요청의 진행 잠금을 해제하면 안 됩니다.");
      await act(async () => requests[1]!.resolve(response(1, resourceB)));
      assert.equal(harness.browserWindow.localStorage.getItem(key(actorB, resourceB)), null);
      if (!isEdit) assert.equal(navigation.mock.callCount(), 1);
      else if (!isNote) assert.equal(saves, 1);
      else assert.match(harness.container.textContent ?? "", /저장됨/u);
    });
  }
}

for (const kind of ["new-note", "edit-note", "new-post", "edit-post", "new-qna", "inline-qna", "qna-reply"] as const) {
  test(`${kind} 저장 예외 뒤 편집 화면·원문·요청 ID를 유지하고 같은 내용으로 재시도한다`, { concurrency: false }, async (context) => {
    const isNote = kind.endsWith("note");
    const isEdit = kind.startsWith("edit");
    const isQna = kind.includes("qna");
    const isReply = kind === "qna-reply";
    const actorId = `retry-${kind}`;
    const resourceId = `resource-${kind}`;
    const draftKey = createDocumentDraftKey(isQna ? isReply ? "qna-reply" : "qna-thread" : isNote ? "note" : "community-post", actorId, isEdit || isReply ? resourceId : isNote ? `new:${actorId}` : undefined);
    const snapshot = { title: "보존할 제목", contentHtml: "<p>보존할 본문</p>" };
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
    const element = kind === "new-note"
      ? <NoteFullForm action={action} actorId={actorId} studentId={actorId} returnTo="/dashboard/student/notes" />
      : kind === "edit-note"
        ? <NoteEditorForm action={action} actorId={actorId} note={{ ...base, id: resourceId, noteDate: null, version: 1 }} />
        : kind === "new-post"
          ? <NewPostForm actorId={actorId} isAdmin={false} defaultBoardType="GENERAL" defaultCategory="general" returnTo="/community" />
          : kind === "edit-post"
            ? <PostEditForm actorId={actorId} post={{ ...base, id: resourceId, version: 1 }} onCancel={() => undefined} onSaved={() => assert.fail("응답을 확인하지 않고 저장 성공을 알리면 안 됩니다.")} />
            : kind === "new-qna"
              ? <NewQnaForm actorId={actorId} returnTo="/dashboard/qna" />
              : kind === "inline-qna"
                ? <QnaSlideForm actorId={actorId} spaceLabel="내 스페이스" returnTo="/dashboard/qna" onClose={() => undefined} onSuccess={() => assert.fail("성공 미확인")} />
                : <ThreadDetailClient actorId={actorId} threadId={resourceId} title="질문" status="OPEN" version={1} isAdmin replies={[]} deletedAt={null} studentName="학생" createdAt={null} returnTo="/dashboard/qna" />;
    const harness = await renderForm(context, <SaveErrorBoundary>{element}</SaveErrorBoundary>, (storage) => storage.setItem(draftKey, serializeFormDraft({
      ...snapshot,
      operationId: crypto.randomUUID(),
      ...(isQna ? { attachmentUrl: "", attachmentObjectId: "" } : isNote ? { noteDate: "" } : { boardType: "GENERAL", category: "general", isPinned: false, mediaUrl: "" }),
      ...(isEdit ? { baseRevision: 1, baseFingerprint: createDocumentSnapshotFingerprint({ kind: isNote ? "private-note" : "community-post", id: resourceId, ...base, noteDate: isNote ? "" : null }) } : {}),
    })));
    const submit = () => submitControl(harness.container);
    await act(async () => submit().click());
    assert.equal(harness.container.querySelector('[data-testid="save-error-boundary"]'), null, "저장 실패는 편집 subtree를 제거하면 안 됩니다.");
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /저장 결과를 확인하지 못했습니다/u);
    if (kind === "new-note") {
      assert.ok(document.activeElement === harness.container.querySelector<HTMLDivElement>('[role="alert"]'), "긴 노트 화면에서도 저장 실패 안내를 바로 확인할 수 있어야 합니다.");
    }
    if (!isReply) assert.equal(harness.container.querySelector<HTMLInputElement>('[name="title"]')?.value, snapshot.title);
    assert.equal(harness.container.querySelector<HTMLTextAreaElement>(BODY_FIELD)?.value, snapshot.contentHtml);
    assert.equal(submit().disabled, false);
    assert.equal(harness.container.querySelector("form")?.getAttribute("aria-busy"), "false");
    assert.ok(harness.browserWindow.localStorage.getItem(draftKey), "실패한 초안은 저장소에 남아야 합니다.");
    assert.equal(readFormDraftClearMarkers(harness.browserWindow.localStorage, draftKey).length, 0);
    await act(async () => submit().click());
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted[1], submitted[0]);
    if (kind === "new-note") assert.ok(document.activeElement === harness.container.querySelector<HTMLDivElement>('[role="alert"]'));
  });
}

const noteTitleValue = (container: HTMLElement) => container.querySelector<HTMLTextAreaElement>("textarea[name=title]")?.value;

test("캘린더 빠른 입력 제목은 저장된 초안이 없으면 새 노트 작성 화면에 채워진다", { concurrency: false }, async (context) => {
  const fresh = await renderForm(context, <NoteFullForm action={async () => ({})} actorId="quick-title" studentId="quick-title" returnTo="/dashboard/student" defaultTitle="레슨 복습" defaultDate="2026-10-30" />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(noteTitleValue(fresh.container), "레슨 복습");
  assert.equal(fresh.container.querySelector<HTMLInputElement>("input[name=noteDate]")?.value, "2026-10-30");
});

test("캘린더 빠른 입력 제목은 쓰던 새 노트 초안의 제목을 덮어쓰지 않는다", { concurrency: false }, async (context) => {
  const restored = await renderForm(context, <NoteFullForm action={async () => ({})} actorId="quick-draft" studentId="quick-draft" returnTo="/dashboard/student" defaultTitle="새 제목" />, (storage) => storage.setItem(
    createDocumentDraftKey("note", "quick-draft", "new:quick-draft"),
    serializeFormDraft({ operationId: crypto.randomUUID(), title: "쓰던 초안", contentHtml: "<p>보존할 본문</p>", noteDate: "" }),
  ));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(noteTitleValue(restored.container), "쓰던 초안");
});

test("노트 저장 실패가 폼 밖으로 옮긴 포커스를 가로채지 않는다", { concurrency: false }, async (context) => {
  let rejectSave!: (reason: Error) => void;
  const action = () => new Promise<never>((_resolve, reject) => { rejectSave = reject; });
  const harness = await renderForm(context, <NoteFullForm action={action} actorId="note-focus" studentId="note-focus" returnTo="/dashboard/student/notes" />, (storage) => storage.setItem(
    createDocumentDraftKey("note", "note-focus", "new:note-focus"),
    serializeFormDraft({ operationId: crypto.randomUUID(), title: "원문", contentHtml: "<p>보존할 본문</p>", noteDate: "" }),
  ));
  const submit = submitControl(harness.container);
  await act(async () => { submit.focus(); submit.click(); });
  const elsewhere = harness.browserWindow.document.createElement("button");
  elsewhere.textContent = "다른 작업";
  harness.browserWindow.document.body.append(elsewhere);
  await act(async () => { elsewhere.focus(); rejectSave(new Error("offline")); });
  assert.ok(harness.container.querySelector('[role="alert"]'));
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
    const currentButton = [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "휴지통 이동")!;
    assert.ok(harness.browserWindow.document.activeElement === (moveFocusElsewhere ? elsewhere : currentButton), "복원 결과가 현재 키보드 작업 위치를 잃거나 가로채면 안 됩니다.");
  });
}

for (const kind of ["note", "post"] as const) {
  test(`${kind} 편집 재시도는 다시 열어도 요청을 유지하고 본문 변경은 새 요청으로 분리한다`, { concurrency: false }, async (context) => {
    const post = { id: `${kind}-edit-retry`, title: "기준 제목", contentHtml: "<p>기준 본문</p>", version: 3 };
    const actorId = `${kind}-edit-retry-actor`;
    const draftKey = createDocumentDraftKey(kind === "note" ? "note" : "community-post", actorId, post.id);
    const requests: Record<string, FormDataEntryValue>[] = [];
    const action = async (_previous: object, data: FormData) => { requests.push(Object.fromEntries(data)); throw new Error("response lost"); };
    savePostEdit = (_id, previous, data) => action(previous, data);
    context.after(() => { savePostEdit = async () => ({}); });
    const screen = kind === "note"
      ? <NoteEditorForm actorId={actorId} note={{ ...post, noteDate: null }} action={action} />
      : <PostEditForm actorId={actorId} post={post} onCancel={() => undefined} onSaved={() => assert.fail("성공 미확인")} />;
    const harness = await renderForm(context, screen, (storage) => storage.setItem(draftKey, serializeFormDraft({
      title: "편집 중 제목", contentHtml: "<p>편집 중 본문</p>",
      ...(kind === "note" ? { noteDate: "" } : {}),
      baseFingerprint: createDocumentSnapshotFingerprint({ kind: kind === "note" ? "private-note" : "community-post", ...post, noteDate: kind === "note" ? "" : null }),
    })));
    const submit = () => submitControl(harness.container);
    await act(async () => submit().click());
    await harness.rerender(<div />);
    await harness.rerender(screen);
    await act(async () => submit().click());
    assert.deepEqual(requests[1], requests[0], "복원한 제출의 operation/base/content는 이전과 같아야 합니다.");

    await harness.rerender(<div />);
    await harness.rerender(screen);
    const editor = harness.container.querySelector<HTMLTextAreaElement>(BODY_FIELD)!;
    await act(async () => {
      editor.value = "<p>실패 뒤 의도적으로 고친 본문</p>";
      editor.dispatchEvent(new harness.browserWindow.Event("input", { bubbles: true }) as unknown as Event);
    });
    await act(async () => submit().click());
    assert.notEqual(requests[2]!.operationId, requests[1]!.operationId);
    assert.equal(requests[2]!.baseRevision, "3");
    assert.equal(requests[2]!.contentHtml, "<p>실패 뒤 의도적으로 고친 본문</p>");
    await act(async () => submit().click());
    assert.deepEqual(requests[3], requests[2]);
  });
}

for (const choice of ["현재 초안으로 계속", "서버 최신본 사용"] as const) {
  test(`게시물 충돌은 최신본을 보여 주고 '${choice}' 선택 뒤 새 기준으로 저장한다`, { concurrency: false }, async (context) => {
    const post = { id: "post-edit-conflict", title: "기준 제목", contentHtml: "<p>기준 본문</p>", version: 1 };
    const latest = { ...post, title: "다른 화면에서 저장한 제목", contentHtml: "<p>다른 화면에서 저장한 본문</p>", version: 2 };
    const requests: Record<string, FormDataEntryValue>[] = [];
    let saved = 0;
    savePostEdit = async (_id, _previous, data) => {
      requests.push(Object.fromEntries(data));
      return requests.length === 1
        ? { error: "다른 화면에서 먼저 변경되었습니다.", conflictKind: "VERSION_CONFLICT", currentRevision: 2, conflictPost: latest }
        : { success: true, post: { ...latest, title: String(data.get("title")), contentHtml: String(data.get("contentHtml")), version: 3 } };
    };
    context.after(() => { savePostEdit = async () => ({}); });
    const actorId = "post-edit-conflict-actor";
    const draftKey = createDocumentDraftKey("community-post", actorId, post.id);
    const harness = await renderForm(context, <PostEditForm actorId={actorId} post={post} onCancel={() => undefined} onSaved={() => { saved += 1; }} />, (storage) => storage.setItem(draftKey, serializeFormDraft({
      title: "내 제목", contentHtml: "<p>내 본문</p>",
      baseFingerprint: createDocumentSnapshotFingerprint({ kind: "community-post", ...post, noteDate: null }),
    })));
    const submit = () => submitControl(harness.container);
    await act(async () => submit().click());
    assert.equal(submit().disabled, true);
    assert.match(harness.container.textContent ?? "", /서버 최신본 2번 확인·복사/u);
    assert.match(harness.container.textContent ?? "", /다른 화면에서 저장한 본문/u);
    assert.equal(harness.container.querySelector<HTMLTextAreaElement>(BODY_FIELD)?.value, "<p>내 본문</p>");
    await act(async () => harness.container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    assert.equal(requests.length, 1, "선택 전 강제 제출도 막아야 합니다.");
    const button = [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(choice));
    assert.ok(button);
    await act(async () => button.click());
    assert.equal(harness.browserWindow.document.activeElement?.getAttribute("name"), "title", "사라지는 선택 버튼에서 편집 입력으로 초점을 넘겨야 합니다.");
    assert.equal(submit().disabled, false);
    assert.equal(harness.container.querySelector<HTMLInputElement>('input[name="baseRevision"]')?.value, "2");
    await act(async () => submit().click());
    assert.equal(saved, 1);
    assert.notEqual(requests[1]!.operationId, requests[0]!.operationId);
    assert.equal(requests[1]!.baseRevision, "2");
    assert.equal(requests[1]!.baseFingerprint, createDocumentSnapshotFingerprint({ kind: "community-post", ...latest, noteDate: null }));
    assert.equal(requests[1]!.contentHtml, choice === "현재 초안으로 계속" ? "<p>내 본문</p>" : latest.contentHtml);
    assert.equal(harness.browserWindow.localStorage.getItem(draftKey), null);
  });
}

for (const kind of ["note", "post"] as const) {
  test(`${kind} 저장 중 먼저 도착한 화면보다 늦은 충돌 응답이 최신이면 그 원문과 version을 함께 제시한다`, { concurrency: false }, async (context) => {
    const post = { id: "post-pending-conflict", title: "기준 제목", contentHtml: "<p>기준 본문</p>", version: 1 };
    const actorId = "post-pending-conflict-actor";
    type SaveResult = import("@/lib/actions/posts").UpdatePostState & import("@/lib/actions/privateNotes").UpdateNoteState;
    let respond: (state: SaveResult) => void = () => assert.fail("저장 요청 전 응답");
    const action = () => new Promise<SaveResult>((resolve) => { respond = resolve; });
    savePostEdit = action;
    context.after(() => { savePostEdit = async () => ({}); });
    const screen = (snapshot: typeof post) => kind === "post"
      ? <PostEditForm actorId={actorId} post={snapshot} onCancel={() => undefined} onSaved={() => undefined} />
      : <NoteEditorForm actorId={actorId} note={{ ...snapshot, noteDate: null }} action={action} />;
    const harness = await renderForm(context, screen(post), (storage) => storage.setItem(createDocumentDraftKey(kind === "note" ? "note" : "community-post", actorId, post.id), serializeFormDraft({
      title: "내 제목", contentHtml: "<p>내 본문</p>",
      ...(kind === "note" ? { noteDate: "" } : {}),
      baseFingerprint: createDocumentSnapshotFingerprint({ kind: kind === "note" ? "private-note" : "community-post", ...post, noteDate: kind === "note" ? "" : null }),
    })));
    await act(async () => submitControl(harness.container).click());
    await harness.rerender(screen({ ...post, title: "두 번째 제목", contentHtml: "<p>두 번째 본문</p>", version: 2 }));
    const latest = { ...post, title: "세 번째 제목", contentHtml: "<p>세 번째 본문</p>", version: 3 };
    await act(async () => respond({ error: "먼저 변경되었습니다.", conflictKind: "VERSION_CONFLICT", currentRevision: 3, ...(kind === "post" ? { conflictPost: latest } : { conflictNote: { ...latest, noteDate: null } }) }));
    assert.match(harness.container.querySelector("summary")?.textContent ?? "", /서버 최신본 3번/u);
    assert.match(harness.container.querySelector("details")?.textContent ?? "", /세 번째 본문/u);
    assert.equal(harness.container.querySelector<HTMLTextAreaElement>(BODY_FIELD)?.value, "<p>내 본문</p>");
    const keep = [...harness.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("현재 초안으로 계속"))!;
    await act(async () => keep.click());
    assert.equal(harness.browserWindow.document.activeElement?.getAttribute("name"), "title");
    assert.equal(harness.container.querySelector<HTMLInputElement>('input[name="baseRevision"]')?.value, "3");
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
      spaceLabel="테스트 학생"
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
        spaceLabel="테스트 학생"
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
        spaceLabel="테스트 학생"
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
  const titleInput = harness.container.querySelector('[name="title"]');
  assert.equal(titleInput?.tagName, "TEXTAREA");

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

  const submitButton = submitControl(harness.container);
  assert.equal(
    (harness.container.querySelector('[name="title"]') as unknown as HTMLInputElement)
      .value,
    "  새 제목  ",
  );
  assert.equal(
    submitButton.disabled,
    false,
    "지연 publish 중에도 최신 reader로 제출할 수 있어야 합니다.",
  );
  await act(async () => {
    submitButton.click();
  });
  await waitForCondition(
    () =>
      (harness.container.querySelector('[name="title"]') as
        | HTMLInputElement
        | null)?.value === "  새 제목  " &&
      /저장됨/u.test(harness.container.textContent ?? ""),
    "정규화된 자체 저장 결과와 완료 상태가 반영되어야 합니다.",
  );

  assert.equal(
    (harness.container.querySelector('[name="title"]') as unknown as HTMLInputElement)
      .value,
    "  새 제목  ",
    "서버가 지운 앞뒤 공백 때문에 입력 중인 제목을 바꾸지 않는다.",
  );
  assert.match(harness.container.textContent ?? "", /저장됨/u);
  assert.doesNotMatch(harness.container.textContent ?? "", /더 최신 서버 노트가 있습니다\./u);
  assert.equal(
    submitControl(harness.container)
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
  const titleInput = harness.container.querySelector('[name="title"]');
  const operationInput = harness.container.querySelector(
    'input[name="operationId"]',
  );
  const baseRevisionInput = harness.container.querySelector(
    'input[name="baseRevision"]',
  );
  assert.equal(titleInput?.tagName, "TEXTAREA");
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
  const submitButton = submitControl(harness.container);
  await act(async () => {
    submitButton.click();
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

  const submitButton = submitControl(harness.container);
  assert.equal(submitButton.disabled, false);
  await act(async () => {
    submitButton.click();
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

  const submitButton = submitControl(harness.container);
  assert.equal(submitButton.disabled, false);
  await act(async () => {
    submitButton.click();
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
