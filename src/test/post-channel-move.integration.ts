import assert from "node:assert/strict";
import { before, mock, test, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import { categories, documentOperationLedger, postRevisions, posts, profiles } from "@/db/schema";
import { CREATION_OPERATION_FIELD } from "@/lib/creation-operation";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

/**
 * 자유 게시판 글 채널 옮기기(감사 보완 #3): 작성자·Stann만, 있는 채널로만, 자유 게시판 글만, 휴지통 글은 거부.
 * 본문은 그대로 두고 판 하나와 이력을 남기며, 같은 요청 재전송은 한 번만 반영한다. 이전 판으로 되돌려도 지금 채널에 남는다.
 */
type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession = createSession("student-1", "student");
let postActions: typeof import("@/lib/actions/posts");
let categoryActions: typeof import("@/lib/actions/categories");

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
  },
});
mock.module("@/lib/push/notify", { namedExports: { notifyPush: async () => undefined } });

before(async () => {
  [postActions, categoryActions] = await Promise.all([import("@/lib/actions/posts"), import("@/lib/actions/categories")]);
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
  await isolated.db.insert(categories).values([
    { id: "cat-free", slug: "free", name: "자유", description: "", sortOrder: 0 },
    { id: "cat-gear", slug: "gear", name: "장비", description: "", sortOrder: 1 },
    { id: "cat-old", slug: "old", name: "옛 채널", description: "", sortOrder: 2 },
  ]);
  activeSession = createSession("student-1", "student");
  const created = await postActions.createPost({}, form({
    [CREATION_OPERATION_FIELD]: crypto.randomUUID(),
    title: "헤드폰 추천",
    contentHtml: "<p>추천해 주세요</p>",
    boardType: "GENERAL",
    category: "free",
    returnTo: "community-editor",
  }));
  assert.equal(created.success, true, JSON.stringify(created));
  return { db: isolated.db, postId: created.postId! };
}

async function readPost(db: PortalTestDb, postId: string) {
  const [row] = await db.select({ category: posts.category, version: posts.version, contentHtml: posts.contentHtml }).from(posts).where(eq(posts.id, postId));
  return row!;
}

test("채널 옮기기: 작성자·Stann만 있는 채널로 옮기고, 판과 이력을 남기며 재전송은 한 번만 반영한다", { concurrency: false }, async (context) => {
  const { db, postId } = await setup(context);

  // 다른 학생은 옮길 수 없다(있는지도 알리지 않는다).
  activeSession = createSession("student-2", "student");
  assert.equal((await postActions.movePostToChannel(postId, "gear", crypto.randomUUID(), 1)).success, false);
  // 없는 채널은 거부한다.
  activeSession = createSession("student-1", "student");
  assert.equal((await postActions.movePostToChannel(postId, "nope", crypto.randomUUID(), 1)).success, false);
  assert.equal((await readPost(db, postId)).category, "free");

  // 작성자: 옮기고, 같은 요청 재전송은 그대로 성공(판은 한 번만 오른다).
  const operationId = crypto.randomUUID();
  const moved = await postActions.movePostToChannel(postId, "gear", operationId, 1);
  assert.equal(moved.success, true, JSON.stringify(moved));
  const replay = await postActions.movePostToChannel(postId, "gear", operationId, 1);
  assert.equal(replay.success, true, JSON.stringify(replay));
  assert.deepEqual(await readPost(db, postId), { category: "gear", version: 2, contentHtml: "<p>추천해 주세요</p>" });
  // 같은 요청 id로 다른 채널을 보내면 같은 작업이 아니다.
  assert.equal((await postActions.movePostToChannel(postId, "old", operationId, 1)).success, false);
  // 옛 판을 기준으로 보낸 새 이동은 덮지 않는다.
  assert.equal((await postActions.movePostToChannel(postId, "old", crypto.randomUUID(), 1)).conflictKind, "VERSION_CONFLICT");

  const revisions = await db.select({ number: postRevisions.revisionNumber, category: postRevisions.category }).from(postRevisions).where(eq(postRevisions.postId, postId)).orderBy(postRevisions.revisionNumber);
  assert.deepEqual(revisions, [{ number: 1, category: "free" }, { number: 2, category: "gear" }]);
  const [receipt] = await db.select({ version: documentOperationLedger.requestHashVersion }).from(documentOperationLedger).where(eq(documentOperationLedger.operationId, operationId));
  assert.equal(receipt!.version, 4);

  // Stann도 학생 글을 옮길 수 있다.
  activeSession = createSession("admin-1", "admin");
  assert.equal((await postActions.movePostToChannel(postId, "old", crypto.randomUUID(), 2)).success, true);

  // 옮긴 뒤 비운 채널은 지울 수 있고, 이전 판(1판, free)으로 되돌려도 지금 채널(old)에 남는다.
  activeSession = createSession("student-1", "student");
  assert.equal((await postActions.movePostToChannel(postId, "free", crypto.randomUUID(), 3)).success, true);
  activeSession = createSession("admin-1", "admin");
  assert.equal((await categoryActions.deleteCategory("cat-gear")).success, true);
  activeSession = createSession("student-1", "student");
  const restored = await postActions.restorePostRevision(postId, crypto.randomUUID(), 4, 2);
  assert.equal(restored.success, true, JSON.stringify(restored));
  assert.equal((await readPost(db, postId)).category, "free", "되돌리기는 지운 채널(gear)로 돌아가지 않는다");
});

test("채널 옮기기: 자유 게시판 글이 아니거나 휴지통 글이면 거부한다", { concurrency: false }, async (context) => {
  const { db, postId } = await setup(context);
  activeSession = createSession("admin-1", "admin");
  const announcement = await postActions.createPost({}, form({
    [CREATION_OPERATION_FIELD]: crypto.randomUUID(),
    title: "공지",
    contentHtml: "<p>공지</p>",
    boardType: "ANNOUNCEMENT",
    returnTo: "community-editor",
  }));
  assert.equal(announcement.success, true, JSON.stringify(announcement));
  assert.equal((await postActions.movePostToChannel(announcement.postId!, "gear", crypto.randomUUID(), 1)).success, false);

  activeSession = createSession("student-1", "student");
  const trashed = await postActions.trashPost(postId, crypto.randomUUID(), 1);
  assert.equal(trashed.success, true, JSON.stringify(trashed));
  const [{ version }] = await db.select({ version: posts.version }).from(posts).where(eq(posts.id, postId));
  assert.equal((await postActions.movePostToChannel(postId, "gear", crypto.randomUUID(), version)).success, false);
  assert.equal((await readPost(db, postId)).category, "free");
});
