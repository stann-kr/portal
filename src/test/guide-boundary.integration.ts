import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import { guideAccess, guideAccessPages, guideAssets, guidePages, profiles, qnaGuideAnchors } from "@/db/schema";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession | null = null;
let guideActions: typeof import("@/lib/actions/guide");
let guideAccessActions: typeof import("@/lib/actions/guideAccess");
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
  [guideActions, guideAccessActions, qnaActions, draftActions, formDraft, draftContract, guideContent] = await Promise.all([
    import("@/lib/actions/guide"),
    import("@/lib/actions/guideAccess"),
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
    { id: "student-new", email: "student-new@example.com", displayName: "새 학생", role: "student" },
  ]);
  // 학생 A·B는 가이드 전체가 열린 학생, 새 학생은 아직 열리지 않은 학생(guide_access 행 없음)이다.
  await db.insert(guideAccess).values([
    { studentId: "student-a", mode: "ALL" },
    { studentId: "student-b", mode: "ALL" },
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
  assert.deepEqual(thread?.guideAnchor, { guidePageId: null, pageTitle: "장비 소개", blockId: "b2", quote: "믹서", pageClosed: false });
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

test("같은 생성 작업 ID로 다른 내용을 보내면 거부하고, 같은 내용의 재전송만 같은 페이지로 돌려준다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  const op = operationId();
  const first = await guideActions.createGuidePage({}, form({ operationId: op, title: "새 페이지", contentHtml: "<p>처음 본문</p>" }));
  assert.equal(first.success, true);
  const replay = await guideActions.createGuidePage({}, form({ operationId: op, title: "새 페이지", contentHtml: "<p>처음 본문</p>" }));
  assert.deepEqual(replay, { success: true, pageId: first.pageId });
  const differentBody = await guideActions.createGuidePage({}, form({ operationId: op, title: "새 페이지", contentHtml: "<p>다른 본문</p>" }));
  assert.equal(differentBody.success, undefined);
  assert.match(differentBody.error ?? "", /다른 내용으로 이미 처리/u);
  const differentTitle = await guideActions.createGuidePage({}, form({ operationId: op, title: "다른 제목", contentHtml: "<p>처음 본문</p>" }));
  assert.ok(differentTitle.error);
  const page = await guideActions.getGuidePage(first.pageId!);
  assert.match(page?.contentHtml ?? "", /처음 본문/u);
  assert.equal((await db.select().from(guidePages)).length, 3);
});

test("이미지 150개를 참조하는 저장도 D1 bind 제한 없이 모두 페이지에 연결한다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  const ids = Array.from({ length: 150 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  for (let start = 0; start < ids.length; start += 10) {
    await db.insert(guideAssets).values(ids.slice(start, start + 10).map((id) => ({
      id, objectKey: `guide/${id}`, contentType: "image/png" as const, sizeBytes: 1,
    })));
  }
  const contentHtml = ids.map((id) => `<img src="/api/guide-assets/${id}" alt="">`).join("");
  const saved = await guideActions.updateGuidePage("guide-1", {}, form({ baseRevision: 1, title: "장비 소개", contentHtml }));
  assert.equal(saved.success, true, saved.error);
  const rows = await db.select({ pageId: guideAssets.guidePageId }).from(guideAssets);
  assert.equal(rows.length, 150);
  assert.ok(rows.every((row) => row.pageId === "guide-1"));
});

test("가이드가 열리지 않은 학생은 목차·본문·질문 위치를 받지 못하고 가이드 질문도 만들 수 없다", { concurrency: false }, async (context) => {
  await setupDatabase(context, createSession("student-new", "student"));
  assert.equal(await guideActions.isGuideClosedForViewer(), true);
  assert.deepEqual(await guideActions.getGuidePages(), []);
  assert.equal(await guideActions.getGuidePage("guide-1"), null);
  assert.deepEqual(await guideActions.getGuideQuestions("guide-1"), []);
  const blocked = await askGuideQuestion("student-new", "b1", "CDJ");
  assert.equal(blocked.success, undefined);
  assert.match(blocked.error ?? "", /가이드 페이지를 찾을 수 없습니다/u);

  activeSession = createSession("student-a", "student");
  assert.equal(await guideActions.isGuideClosedForViewer(), false);
  activeSession = createSession("admin-1", "admin");
  assert.equal(await guideActions.isGuideClosedForViewer(), false, "관리자는 권한 행이 없어도 전체를 본다");
  assert.deepEqual((await guideActions.getGuidePages()).map((page) => page.id), ["guide-1", "guide-2"]);
});

test("선택으로 열린 학생은 고른 페이지만 보고, 닫힌 페이지의 지난 질문은 링크 없이 남는다", { concurrency: false }, async (context) => {
  await setupDatabase(context, null);
  const asked = await askGuideQuestion("student-a", "c1", "폴더", "guide-2");
  assert.equal(asked.success, true);

  activeSession = createSession("admin-1", "admin");
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessSetting("student-a", "SELECTED"), { ok: true });
  activeSession = createSession("student-a", "student");
  assert.equal(await guideActions.isGuideClosedForViewer(), true, "선택인데 고른 페이지가 없으면 닫힘과 같다");

  activeSession = createSession("admin-1", "admin");
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessPage("student-a", "guide-1", true), { ok: true });
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessPage("student-a", "guide-1", true), { ok: true }, "같은 요청을 다시 보내도 같다");

  activeSession = createSession("student-a", "student");
  assert.equal(await guideActions.isGuideClosedForViewer(), false);
  assert.deepEqual((await guideActions.getGuidePages()).map((page) => page.id), ["guide-1"]);
  assert.equal((await guideActions.getGuidePage("guide-1"))?.title, "장비 소개");
  assert.equal(await guideActions.getGuidePage("guide-2"), null);
  assert.deepEqual(await guideActions.getGuideQuestions("guide-2"), [], "닫힌 페이지에는 본인 질문 위치도 주지 않는다");
  assert.ok((await askGuideQuestion("student-a", "c1", "폴더", "guide-2")).error);
  assert.equal((await askGuideQuestion("student-a", "b1", "CDJ", "guide-1")).success, true);

  activeSession = createSession("student-a", "student");
  const thread = await qnaActions.getQnaThread(asked.thread!.id);
  assert.deepEqual(thread?.guideAnchor, { guidePageId: null, pageTitle: "음원 관리", blockId: "c1", quote: "폴더", pageClosed: true });
  activeSession = createSession("admin-1", "admin");
  const adminView = await qnaActions.getQnaThread(asked.thread!.id);
  assert.equal(adminView?.guideAnchor?.guidePageId, "guide-2", "관리자에게는 링크가 그대로 간다");

  // 학생 B의 전체 열람은 학생 A의 설정과 무관하다.
  activeSession = createSession("student-b", "student");
  assert.deepEqual((await guideActions.getGuidePages()).map((page) => page.id), ["guide-1", "guide-2"]);
});

test("선택으로 열린 학생에게는 본문에서 열리지 않은 페이지로 가는 링크가 글자로만 가고, 관리자·전체 학생은 그대로다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, null);
  const linked = '<p data-block-id="b1">CDJ는 <a href="/dashboard/guide/guide-2#c1">음원 관리</a>와 <a href="/dashboard/guide/guide-1#b2"><strong>믹서</strong></a>를 보세요. <a href="https://example.com/dashboard/guide/guide-2">바깥</a></p>';
  await db.update(guidePages).set({ contentHtml: linked }).where(eq(guidePages.id, "guide-1"));

  activeSession = createSession("admin-1", "admin");
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessSetting("student-a", "SELECTED"), { ok: true });
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessPage("student-a", "guide-1", true), { ok: true });
  assert.equal((await guideActions.getGuidePage("guide-1"))?.contentHtml, linked, "관리자는 본문 그대로");

  activeSession = createSession("student-a", "student");
  assert.equal(
    (await guideActions.getGuidePage("guide-1"))?.contentHtml,
    '<p data-block-id="b1">CDJ는 음원 관리와 <a href="/dashboard/guide/guide-1#b2"><strong>믹서</strong></a>를 보세요. <a href="https://example.com/dashboard/guide/guide-2">바깥</a></p>',
    "닫힌 페이지 링크만 글자로 남고, 열린 페이지·바깥 링크는 그대로다",
  );

  activeSession = createSession("student-b", "student");
  assert.equal((await guideActions.getGuidePage("guide-1"))?.contentHtml, linked, "전체 학생은 본문 그대로");
});

test("가이드 열람 설정은 관리자만 학생에게 하고, 닫아도 고른 페이지는 남으며 페이지를 지우면 함께 정리된다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-a", "student"));
  await assert.rejects(guideAccessActions.getStudentGuideAccess("student-a"), /Admin only/);
  await assert.rejects(guideAccessActions.setStudentGuideAccessSetting("student-a", "ALL"), /Admin only/);
  await assert.rejects(guideAccessActions.setStudentGuideAccessPage("student-new", "guide-1", true), /Admin only/);
  assert.equal((await db.select().from(guideAccessPages)).length, 0);

  activeSession = createSession("admin-1", "admin");
  await assert.rejects(guideAccessActions.setStudentGuideAccessSetting("admin-1", "ALL"), /Student not found/);
  await assert.rejects(guideAccessActions.setStudentGuideAccessSetting("no-such-student", "ALL"), /Student not found/);
  assert.deepEqual(await guideAccessActions.getStudentGuideAccess("student-new"), {
    setting: "CLOSED",
    pageIds: [],
    pages: [{ id: "guide-1", title: "장비 소개" }, { id: "guide-2", title: "음원 관리" }],
  });
  const badSetting = await guideAccessActions.setStudentGuideAccessSetting("student-new", "EVERYONE" as never);
  assert.equal(badSetting.ok, false);
  const missingPage = await guideAccessActions.setStudentGuideAccessPage("student-new", "no-such-page", true);
  assert.equal(missingPage.ok, false);
  assert.equal((await db.select().from(guideAccess)).filter((row) => row.studentId === "student-new").length, 0);

  assert.deepEqual(await guideAccessActions.setStudentGuideAccessSetting("student-new", "SELECTED"), { ok: true });
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessPage("student-new", "guide-2", true), { ok: true });
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessPage("student-new", "guide-1", true), { ok: true });
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessPage("student-new", "guide-1", false), { ok: true });
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessSetting("student-new", "CLOSED"), { ok: true });
  const closed = await guideAccessActions.getStudentGuideAccess("student-new");
  assert.deepEqual([closed.setting, closed.pageIds], ["CLOSED", ["guide-2"]], "닫아도 고른 페이지는 남는다");
  activeSession = createSession("student-new", "student");
  assert.deepEqual(await guideActions.getGuidePages(), []);

  activeSession = createSession("admin-1", "admin");
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessSetting("student-new", "ALL"), { ok: true });
  activeSession = createSession("student-new", "student");
  assert.deepEqual((await guideActions.getGuidePages()).map((page) => page.id), ["guide-1", "guide-2"]);

  activeSession = createSession("admin-1", "admin");
  assert.deepEqual(await guideActions.deleteGuidePage("guide-2", 1), { ok: true });
  assert.equal((await db.select().from(guideAccessPages)).length, 0, "지운 페이지의 열람 행은 남지 않는다");
  assert.deepEqual((await guideAccessActions.getStudentGuideAccess("student-new")).pageIds, []);
});

test("가이드 페이지의 열람 학생 목록은 관리자만 받고, 학생마다 설정·볼 수 있는지·열린 페이지 수를 이름순으로 준다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-a", "student"));
  await assert.rejects(guideAccessActions.getGuidePageViewers("guide-1"), /Admin only/, "학생은 다른 학생의 열람 설정을 받지 못한다");

  activeSession = createSession("admin-1", "admin");
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessSetting("student-b", "SELECTED"), { ok: true });
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessPage("student-b", "guide-2", true), { ok: true });
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessSetting("student-new", "SELECTED"), { ok: true });

  assert.deepEqual(await guideAccessActions.getGuidePageViewers("guide-1"), {
    pageId: "guide-1",
    totalPages: 2,
    students: [
      { studentId: "student-new", name: "새 학생", setting: "SELECTED", canView: false, openCount: 0 },
      { studentId: "student-a", name: "학생 A", setting: "ALL", canView: true, openCount: 0 },
      { studentId: "student-b", name: "학생 B", setting: "SELECTED", canView: false, openCount: 1 },
    ],
  });

  // 패널의 체크는 학생 상세와 같은 쓰기(setStudentGuideAccessPage)를 쓴다. 닫힘 학생은 패널에서 바뀌지 않는다.
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessPage("student-b", "guide-1", true), { ok: true });
  assert.deepEqual(await guideAccessActions.setStudentGuideAccessSetting("student-a", "CLOSED"), { ok: true });
  const after = await guideAccessActions.getGuidePageViewers("guide-1");
  assert.deepEqual(after?.students.map((row) => [row.studentId, row.setting, row.canView, row.openCount]), [
    ["student-new", "SELECTED", false, 0],
    ["student-a", "CLOSED", false, 0],
    ["student-b", "SELECTED", true, 2],
  ]);

  assert.equal(await guideAccessActions.getGuidePageViewers("no-such-page"), null);
  assert.equal(await guideAccessActions.getGuidePageViewers("../guide-1"), null);
  assert.equal((await db.select().from(guideAccess)).length, 2, "읽기는 아무것도 쓰지 않는다");
});
