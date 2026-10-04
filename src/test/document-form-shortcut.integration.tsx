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
let restoreNote: typeof import("@/lib/actions/privateNotes").restorePrivateNoteRevision = async () => ({ success: true });
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
    getQnaThreads: async (query = "") => { qnaSearchCalls.push(query); return qnaPageData; },
    getTrashedQnaThreads: async () => qnaTrashPageData,
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
let NewQnaForm: typeof import("@/components/qna/NewQnaForm").NewQnaForm;
let NoteEditorForm: typeof import("@/components/notes/NoteEditorForm").NoteEditorForm;
let QnaSlideForm: typeof import("@/components/qna/QnaSlideForm").QnaSlideForm;
let ThreadDetailClient: typeof import("@/components/qna/ThreadDetailClient").ThreadDetailClient;
let RestoreNoteRevisionButton: typeof import("@/components/notes/RestoreNoteRevisionButton").RestoreNoteRevisionButton;
let NoteFullForm: typeof import("@/components/notes/NoteFullForm").NoteFullForm;
let StudentNotesPage: typeof import("@/app/dashboard/student/notes/page").default;
let AdminStudentNotesPage: typeof import("@/app/dashboard/admin/students/[id]/notes/page").default;
let QnaPage: typeof import("@/app/dashboard/qna/page").default;
let QnaTrashPage: typeof import("@/app/dashboard/qna/trash/page").default;
let ThreadList: typeof import("@/components/qna/ThreadList").ThreadList;

before(async () => {
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
  "confirm",
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
    confirm: () => true,
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
  const click = async (target: number) => act(async () => harness.container.querySelector<HTMLButtonElement>(`[data-revision="${target}"] button`)!.click());
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
  await act(async () => find("휴지통 이동").click());
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
  await act(async () => find("휴지통 이동").click());
  await act(async () => find("휴지통 이동").click());
  assert.deepEqual(requests.map((args) => args[2]), [1, 2, 2]);
  assert.notEqual(requests[0][1], requests[1][1]);
  assert.equal(requests[1][1], requests[2][1], "결과 불명확 재시도만 같은 operation을 유지한다");
  await harness.rerender(screen(2, false));
  await act(async () => find("휴지통 이동").click());
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
