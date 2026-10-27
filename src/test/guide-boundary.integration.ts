import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import type { AuthSession } from "@/lib/auth-guard";
import { guidePages, profiles, qnaGuideAnchors } from "@/db/schema";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession | null = null;
let guideActions: typeof import("@/lib/actions/guide");
let qnaActions: typeof import("@/lib/actions/qna");
let draftActions: typeof import("@/lib/actions/documentDrafts");
let formDraft: typeof import("@/lib/form-draft");
let draftContract: typeof import("@/lib/document-server-draft-contract");
let guideContent: typeof import("@/lib/guide-content");

function createSession(id: string, role: "admin" | "student"): AuthSession {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: { id, role, name: id, email: `${id}@example.com`, image: null },
  };
}

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", {
  namedExports: {
    auth: async () => activeSession,
    signIn: async () => "/dashboard",
  },
});
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", {
  namedExports: { revalidatePath: () => undefined },
});

before(async () => {
  [guideActions, qnaActions, draftActions, formDraft, draftContract, guideContent] = await Promise.all([
    import("@/lib/actions/guide"),
    import("@/lib/actions/qna"),
    import("@/lib/actions/documentDrafts"),
    import("@/lib/form-draft"),
    import("@/lib/document-server-draft-contract"),
    import("@/lib/guide-content"),
  ]);
});

after(() => mock.restoreAll());

async function setupDatabase(context: TestContext, session: AuthSession | null): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = session;
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  const db = isolated.db;
  await db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "관리자", role: "admin" },
    { id: "student-a", email: "student-a@example.com", displayName: "학생 A", role: "student" },
    { id: "student-b", email: "student-b@example.com", displayName: "학생 B", role: "student" },
  ]);
  await db.insert(guidePages).values([
    { id: "guide-1", title: "장비 소개", sortOrder: 0, contentHtml: '<p data-block-id="b1">CDJ</p><p data-block-id="b2">믹서</p>' },
    { id: "guide-2", title: "음원 관리", sortOrder: 1, contentHtml: '<p data-block-id="c1">폴더</p>' },
  ]);
  return db;
}

function form(fields: Record<string, string | number>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
  return data;
}

let operationSequence = 1;
function operationId(): string {
  return `00000000-0000-4000-8000-${String(operationSequence++).padStart(12, "0")}`;
}

async function askGuideQuestion(studentId: string, blockId: string, quote: string, pageId = "guide-1") {
  activeSession = createSession(studentId, "student");
  return qnaActions.createQnaThreadInline({}, form({
    operationId: operationId(),
    title: `${studentId} 질문`,
    contentHtml: "<p>이 부분이 궁금합니다</p>",
    guidePageId: pageId,
    guideBlockId: blockId,
    guideQuote: quote,
  }));
}

test("가이드 쓰기는 관리자만, 읽기는 로그인한 사용자만 할 수 있다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, null);
  await assert.rejects(guideActions.getGuidePages(), /Unauthorized/);
  await assert.rejects(guideActions.createGuidePage({}, form({ operationId: operationId(), title: "x", contentHtml: "" })), /Unauthorized/);

  activeSession = createSession("student-a", "student");
  assert.deepEqual((await guideActions.getGuidePages()).map((page) => page.id), ["guide-1", "guide-2"]);
  assert.equal((await guideActions.getGuidePage("guide-1"))?.title, "장비 소개");
  await assert.rejects(guideActions.createGuidePage({}, form({ operationId: operationId(), title: "학생 페이지", contentHtml: "<p>x</p>" })), /Admin only/);
  await assert.rejects(guideActions.updateGuidePage("guide-1", {}, form({ baseRevision: 1, title: "변조", contentHtml: "<p>x</p>" })), /Admin only/);
  await assert.rejects(guideActions.reorderGuidePages(["guide-2", "guide-1"]), /Admin only/);
  await assert.rejects(guideActions.deleteGuidePage("guide-1", 1), /Admin only/);
  const pages = await db.select().from(guidePages);
  assert.deepEqual(pages.map((page) => [page.id, page.title, page.version, page.sortOrder]).sort(), [
    ["guide-1", "장비 소개", 1, 0],
    ["guide-2", "음원 관리", 1, 1],
  ]);

  activeSession = createSession("admin-1", "admin");
  const created = await guideActions.createGuidePage({}, form({ operationId: operationId(), title: "새 페이지", contentHtml: '<p onclick="x()">본문<script>alert(1)</script></p>' }));
  assert.equal(created.success, true);
  const createdPage = await guideActions.getGuidePage(created.pageId!);
  assert.equal(createdPage?.sortOrder, 2);
  assert.doesNotMatch(createdPage?.contentHtml ?? "", /onclick|script/u);
  assert.equal(guideContent.listGuideBlockIds(createdPage?.contentHtml ?? "").length, 1);

  assert.deepEqual(await guideActions.reorderGuidePages(["guide-2", created.pageId!, "guide-1"]), { ok: true });
  assert.deepEqual((await guideActions.getGuidePages()).map((page) => page.id), ["guide-2", created.pageId!, "guide-1"]);
  const stale = await guideActions.reorderGuidePages(["guide-1", "guide-2"]);
  assert.equal(stale.ok, false);
});

test("오래된 기준 버전으로 저장하면 VERSION_CONFLICT와 서버 최신본을 돌려준다", { concurrency: false }, async (context) => {
  await setupDatabase(context, createSession("admin-1", "admin"));
  const saved = await guideActions.updateGuidePage("guide-1", {}, form({ baseRevision: 1, title: "장비 소개", contentHtml: '<p data-block-id="b1">CDJ-3000</p><p data-block-id="b1">나눈 문단</p>' }));
  assert.equal(saved.success, true);
  assert.equal(saved.page?.version, 2);
  const ids = guideContent.listGuideBlockIds(saved.page?.contentHtml ?? "");
  assert.equal(ids[0], "b1");
  assert.equal(new Set(ids).size, 2, "문단 나누기로 복사된 중복 식별자는 새로 받는다");

  const retried = await guideActions.updateGuidePage("guide-1", {}, form({ baseRevision: 1, title: "장비 소개", contentHtml: saved.page!.contentHtml }));
  assert.equal(retried.success, true, "응답을 잃은 같은 저장의 재전송은 성공으로 본다");

  const stale = await guideActions.updateGuidePage("guide-1", {}, form({ baseRevision: 1, title: "다른 수정", contentHtml: "<p>덮어쓰기</p>" }));
  assert.equal(stale.conflictKind, "VERSION_CONFLICT");
  assert.equal(stale.conflictPage?.version, 2);
  assert.match(stale.conflictPage?.contentHtml ?? "", /CDJ-3000/u);
  const deleteStale = await guideActions.deleteGuidePage("guide-1", 1);
  assert.equal(deleteStale.ok, false);
});

test("가이드 질문은 본인과 관리자만 보고, 관리자는 가이드 질문을 만들 수 없다", { concurrency: false }, async (context) => {
  await setupDatabase(context, null);
  const a = await askGuideQuestion("student-a", "b1", "  CDJ  ");
  assert.equal(a.success, true);
  const b = await askGuideQuestion("student-b", "b2", "믹서");
  assert.equal(b.success, true);

  activeSession = createSession("student-a", "student");
  const seenByA = await guideActions.getGuideQuestions("guide-1");
  assert.deepEqual(seenByA.map((question) => [question.studentId, question.blockId, question.quote]), [["student-a", "b1", "CDJ"]]);
  await assert.doesNotReject(qnaActions.getQnaThread(a.thread!.id));
  assert.equal(await qnaActions.getQnaThread(b.thread!.id), null);

  activeSession = createSession("admin-1", "admin");
  const seenByAdmin = await guideActions.getGuideQuestions("guide-1");
  assert.deepEqual(seenByAdmin.map((question) => [question.studentName, question.blockId]).sort(), [["학생 A", "b1"], ["학생 B", "b2"]]);
  const adminQuestion = await qnaActions.createQnaThreadInline({}, form({
    operationId: operationId(), title: "관리자 질문", contentHtml: "<p>x</p>", guidePageId: "guide-1", guideBlockId: "b1", guideQuote: "CDJ",
  }));
  assert.equal(adminQuestion.success, undefined);
  assert.ok(adminQuestion.error);

  activeSession = createSession("student-a", "student");
  const badBlock = await qnaActions.createQnaThreadInline({}, form({
    operationId: operationId(), title: "잘못된 위치", contentHtml: "<p>x</p>", guidePageId: "guide-1", guideBlockId: "bad id", guideQuote: "CDJ",
  }));
  assert.ok(badBlock.error);
  const missingPage = await askGuideQuestion("student-a", "b1", "CDJ", "no-such-page");
  assert.ok(missingPage.error);
});

test("블록을 지운 편집과 페이지 삭제 뒤에도 질문과 인용이 남는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, null);
  const asked = await askGuideQuestion("student-a", "b2", "믹서");
  assert.equal(asked.success, true);

  activeSession = createSession("admin-1", "admin");
  const edited = await guideActions.updateGuidePage("guide-1", {}, form({ baseRevision: 1, title: "장비 소개 (개정)", contentHtml: '<p data-block-id="b1">CDJ만 남김</p>' }));
  assert.equal(edited.success, true);
  assert.equal(guideContent.listGuideBlockIds(edited.page!.contentHtml).includes("b2"), false);
  activeSession = createSession("student-a", "student");
  const afterEdit = await guideActions.getGuideQuestions("guide-1");
  assert.deepEqual(afterEdit.map((question) => [question.blockId, question.quote]), [["b2", "믹서"]]);

  activeSession = createSession("admin-1", "admin");
  assert.deepEqual(await guideActions.deleteGuidePage("guide-1", 2), { ok: true });
  const anchors = await db.select().from(qnaGuideAnchors);
  assert.deepEqual(anchors.map((anchor) => [anchor.guidePageId, anchor.pageTitle, anchor.anchorQuote]), [[null, "장비 소개", "믹서"]]);
  activeSession = createSession("student-a", "student");
  const thread = await qnaActions.getQnaThread(asked.thread!.id);
  assert.deepEqual(thread?.guideAnchor, { guidePageId: null, pageTitle: "장비 소개", blockId: "b2", quote: "믹서" });
});

test("가이드 서버 초안은 관리자만 가질 수 있다", { concurrency: false }, async (context) => {
  await setupDatabase(context, createSession("student-a", "student"));
  const studentKey = formDraft.createDocumentDraftKey("guide-page", "student-a", "guide-1");
  assert.deepEqual(await draftActions.readDocumentServerDraft(studentKey), { ok: false, reason: "INVALID_INPUT" });
  const payloadJson = draftContract.serializeDocumentServerDraftPayload({ title: "t", contentHtml: "<p>x</p>", baseRevision: 1 });
  const studentSave = await draftActions.saveDocumentServerDraft({
    sourceKey: studentKey,
    operationId: operationId(),
    expectedDraftVersion: 0,
    payloadJson,
    baseResourceVersion: 1,
    writerDeviceId: operationId(),
  });
  assert.equal(studentSave.ok, false);
  assert.equal(studentSave.ok ? null : studentSave.reason, "INVALID_INPUT");

  activeSession = createSession("admin-1", "admin");
  const adminKey = formDraft.createDocumentDraftKey("guide-page", "admin-1", "guide-1");
  const adminSave = await draftActions.saveDocumentServerDraft({
    sourceKey: adminKey,
    operationId: operationId(),
    expectedDraftVersion: 0,
    payloadJson,
    baseResourceVersion: 1,
    writerDeviceId: operationId(),
  });
  assert.equal(adminSave.ok, true);
  const read = await draftActions.readDocumentServerDraft(adminKey);
  assert.equal(read.ok && read.draft?.kind, "guide-page");
});
