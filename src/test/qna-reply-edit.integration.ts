import assert from "node:assert/strict";
import { before, mock, test, type TestContext } from "node:test";
import type { AuthSession } from "@/lib/auth-guard";
import { profiles, qnaReplies, qnaReplyRevisions } from "@/db/schema";
import { CREATION_OPERATION_FIELD } from "@/lib/creation-operation";
import { eq } from "drizzle-orm";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

/**
 * Q&A 답글 고치기(감사 보완 #7): 작성자 본인만, 휴지통 질문 거부, 고치기 시작할 때 본 본문과 다르면 덮지 않음,
 * 같은 본문 재전송은 새 기록 없이 성공, 원래 글은 그대로 남고 화면·이력은 고친 본문을 보인다.
 */
type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession = createSession("student-1", "student");
let qna: typeof import("@/lib/actions/qna");

function createSession(id: string, role: "admin" | "student"): AuthSession {
  return { expires: "2099-01-01T00:00:00.000Z", user: { id, role, name: id, email: `${id}@example.com`, image: null } };
}

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", { namedExports: { auth: async () => activeSession } });
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
mock.module("next/navigation", {
  namedExports: {
    redirect: (path: string) => {
      throw new Error(`예상하지 않은 redirect: ${path}`);
    },
    notFound: () => {
      throw new Error("예상하지 않은 notFound");
    },
  },
});
mock.module("@/lib/push/notify", { namedExports: { notifyPush: async () => undefined } });

before(async () => {
  qna = await import("@/lib/actions/qna");
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function setup(context: TestContext) {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values([
    { id: "admin-1", email: "admin-1@example.com", displayName: "Stann", role: "admin" },
    { id: "student-1", email: "student-1@example.com", displayName: "김학생", role: "student" },
    { id: "student-2", email: "student-2@example.com", displayName: "이학생", role: "student" },
  ]);
  activeSession = createSession("student-1", "student");
  const created = await qna.createQnaThread({}, form({ [CREATION_OPERATION_FIELD]: crypto.randomUUID(), title: "킥 볼륨", contentHtml: "<p>처음 질문</p>" }));
  assert.equal(created.success, true, JSON.stringify(created));
  const threadId = created.thread!.id;
  activeSession = createSession("admin-1", "admin");
  const answered = await qna.createQnaReply(threadId, {}, form({ [CREATION_OPERATION_FIELD]: crypto.randomUUID(), contentHtml: "<p>답변</p>" }));
  assert.equal(answered.success, true, JSON.stringify(answered));
  const replies = await isolated.db.select().from(qnaReplies).where(eq(qnaReplies.threadId, threadId)).orderBy(qnaReplies.createdAt);
  const question = replies.find((reply) => reply.authorId === "student-1")!;
  const answer = replies.find((reply) => reply.authorId === "admin-1")!;
  return { db: isolated.db, threadId, question, answer };
}

test("Q&A 고치기: 작성자 본인만 고치고, 원래 글은 남기며 화면·이력은 고친 본문을 보인다", { concurrency: false }, async (context) => {
  const { db, threadId, question, answer } = await setup(context);

  // 남의 글: 학생이 관리자 답변을, 관리자가 학생 질문을, 다른 학생이 질문을 고칠 수 없다.
  activeSession = createSession("student-1", "student");
  assert.equal((await qna.editQnaReply(answer.id, { expectedHtml: answer.contentHtml, contentHtml: "<p>바꿈</p>" })).ok, false);
  activeSession = createSession("admin-1", "admin");
  assert.equal((await qna.editQnaReply(question.id, { expectedHtml: question.contentHtml, contentHtml: "<p>바꿈</p>" })).ok, false);
  activeSession = createSession("student-2", "student");
  assert.equal((await qna.editQnaReply(question.id, { expectedHtml: question.contentHtml, contentHtml: "<p>바꿈</p>" })).ok, false);
  assert.equal((await db.select().from(qnaReplyRevisions)).length, 0);

  // 본인: 고치고, 같은 본문 재전송은 새 기록 없이 성공.
  activeSession = createSession("student-1", "student");
  const first = await qna.editQnaReply(question.id, { expectedHtml: question.contentHtml, contentHtml: "<p>고친 질문</p>" });
  assert.equal(first.ok, true, JSON.stringify(first));
  const retry = await qna.editQnaReply(question.id, { expectedHtml: question.contentHtml, contentHtml: "<p>고친 질문</p>" });
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal((await db.select().from(qnaReplyRevisions)).length, 1, "재전송은 새 기록을 쌓지 않는다");

  // 옛 본문을 기준으로 다른 본문을 보내면(다른 기기에서 먼저 고침) 덮지 않고 지금 본문을 돌려준다.
  const stale = await qna.editQnaReply(question.id, { expectedHtml: question.contentHtml, contentHtml: "<p>다른 기기</p>" });
  assert.equal(stale.ok, false);
  assert.equal(!stale.ok && stale.currentHtml, "<p>고친 질문</p>");

  // 빈 글은 거부한다.
  assert.equal((await qna.editQnaReply(question.id, { expectedHtml: "<p>고친 질문</p>", contentHtml: "<p></p>" })).ok, false);

  // 이어서 한 번 더 고치면 2번 기록.
  const second = await qna.editQnaReply(question.id, { expectedHtml: "<p>고친 질문</p>", contentHtml: "<p>두 번째</p>" });
  assert.equal(second.ok, true, JSON.stringify(second));

  // 원래 행은 그대로, 화면은 마지막 본문과 고친 시각, 이력은 두 기록.
  const [original] = await db.select().from(qnaReplies).where(eq(qnaReplies.id, question.id));
  assert.equal(original!.contentHtml, "<p>처음 질문</p>");
  const thread = await qna.getQnaThread(threadId);
  const shown = thread!.replies.find((reply) => reply.id === question.id)!;
  assert.equal(shown.contentHtml, "<p>두 번째</p>");
  assert.ok(shown.editedAt instanceof Date);
  assert.equal(thread!.replies.find((reply) => reply.id === answer.id)!.editedAt, null);
  const edits = await qna.getQnaReplyEdits(threadId);
  assert.deepEqual(edits.map((edit) => [edit.editNumber, edit.contentHtml]).sort(), [[1, "<p>고친 질문</p>"], [2, "<p>두 번째</p>"]]);

  // 다른 학생은 이 질문의 고친 기록을 읽을 수 없다.
  activeSession = createSession("student-2", "student");
  assert.deepEqual(await qna.getQnaReplyEdits(threadId), []);

  // 관리자는 자기 답변을 고칠 수 있다.
  activeSession = createSession("admin-1", "admin");
  assert.equal((await qna.editQnaReply(answer.id, { expectedHtml: answer.contentHtml, contentHtml: "<p>고친 답변</p>" })).ok, true);
});

test("Q&A 고치기: 휴지통에 있는 질문의 글은 고칠 수 없다", { concurrency: false }, async (context) => {
  const { db, threadId, question } = await setup(context);
  activeSession = createSession("student-1", "student");
  const current = await qna.getQnaThread(threadId);
  const trashed = await qna.trashQnaThread(threadId, crypto.randomUUID(), current!.version);
  assert.ok(!("error" in trashed) || !trashed.error, JSON.stringify(trashed));
  const result = await qna.editQnaReply(question.id, { expectedHtml: question.contentHtml, contentHtml: "<p>바꿈</p>" });
  assert.equal(result.ok, false);
  assert.equal((await db.select().from(qnaReplyRevisions)).length, 0);
});
