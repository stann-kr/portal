import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { count, eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import {
  categories,
  privateNotes,
  posts,
  profiles,
  qnaReplies,
  qnaThreads,
} from "@/db/schema";
import {
  createIsolatedPortalD1,
  type IsolatedPortalD1,
} from "@/test/isolated-d1";
import { createQnaReplyAtomically } from "@/lib/qna-atomic";
import {
  CREATION_OPERATION_FIELD,
  deriveCreationResourceId,
} from "@/lib/creation-operation";

type PortalTestDb = IsolatedPortalD1["db"];
type D1TestContext = { kind: "d1"; db: PortalTestDb };

let activeDb: PortalTestDb | null = null;
let activeDbContext: D1TestContext | null = null;
let activeSession: AuthSession = createSession("student-1", "student");
let qnaActions: typeof import("@/lib/actions/qna");
let privateNoteActions: typeof import("@/lib/actions/privateNotes");
let postActions: typeof import("@/lib/actions/posts");

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", {
  namedExports: {
    auth: async () => activeSession,
  },
});
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => activeDbContext ?? { kind: "d1", db: requireActiveDb() },
  },
});
mock.module("next/cache", {
  namedExports: {
    revalidatePath: () => undefined,
  },
});
mock.module("next/navigation", {
  namedExports: {
    redirect: (path: string) => {
      throw new Error(`예상하지 않은 redirect: ${path}`);
    },
  },
});

before(async () => {
  [qnaActions, privateNoteActions, postActions] = await Promise.all([
    import("@/lib/actions/qna"),
    import("@/lib/actions/privateNotes"),
    import("@/lib/actions/posts"),
  ]);
});

after(() => {
  mock.restoreAll();
});

function createSession(id: string, role: "admin" | "student"): AuthSession {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id,
      role,
      name: role === "admin" ? "Admin" : "Student",
      email: `${id}@example.com`,
      image: null,
    },
  };
}

async function setupDatabase(
  context: TestContext,
  session = createSession("student-1", "student"),
): Promise<IsolatedPortalD1> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeDbContext = null;
  activeSession = session;

  context.after(async () => {
    activeDbContext = null;
    activeDb = null;
    await isolated.dispose();
  });

  return isolated;
}

async function seedProfile(
  db: PortalTestDb,
  id: string,
  role: "admin" | "student" = "student",
): Promise<void> {
  await db.insert(profiles).values({
    id,
    email: `${id}@example.com`,
    displayName: id,
    role,
  });
}

function createDocumentForm(
  title: string,
  contentHtml: string,
  operationId = crypto.randomUUID(),
): FormData {
  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, operationId);
  formData.set("title", title);
  formData.set("contentHtml", contentHtml);
  return formData;
}

function createNoteForm(
  operationId: string,
  title: string,
  contentHtml: string,
  noteDate = "",
): FormData {
  const formData = createDocumentForm(title, contentHtml, operationId);
  formData.set("noteDate", noteDate);
  return formData;
}

function createPostForm(
  operationId: string,
  title: string,
  contentHtml: string,
): FormData {
  const formData = createDocumentForm(title, contentHtml, operationId);
  formData.set("boardType", "FEEDBACK");
  formData.set("category", "feedback");
  formData.set("mediaUrl", "https://cdn.example.com/mix.mp3");
  formData.set("returnTo", "community-editor");
  return formData;
}

function createReplyForm(operationId: string, contentHtml: string): FormData {
  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, operationId);
  formData.set("contentHtml", contentHtml);
  return formData;
}

async function countTableRows(
  db: PortalTestDb,
  table: typeof qnaThreads | typeof qnaReplies,
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table);
  return row?.value ?? 0;
}

test("Q&A 스레드와 첫 본문을 한 번에 생성한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");

  const result = await qnaActions.createQnaThread(
    {},
    createDocumentForm("첫 질문", "<p>질문 본문</p>"),
  );

  assert.equal(result.success, true);
  assert.ok(result.thread?.id);
  const [thread] = await db
    .select()
    .from(qnaThreads)
    .where(eq(qnaThreads.id, result.thread.id));
  const replies = await db
    .select()
    .from(qnaReplies)
    .where(eq(qnaReplies.threadId, result.thread.id));

  assert.equal(thread?.status, "OPEN");
  assert.equal(thread?.studentId, "student-1");
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.authorId, "student-1");
  assert.equal(replies[0]?.contentHtml, "<p>질문 본문</p>");
});

test("관리자 답변과 ANSWERED 상태를 한 번에 반영한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "admin-1", "admin");
  await db.insert(qnaThreads).values({
    id: "thread-1",
    studentId: "student-1",
    title: "답변 대기",
    status: "OPEN",
  });

  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, crypto.randomUUID());
  formData.set("contentHtml", "<p>관리자 답변</p>");
  const result = await qnaActions.createQnaReply("thread-1", {}, formData);

  assert.equal(result.success, true);
  assert.ok(result.replyId);
  const [thread] = await db
    .select({ status: qnaThreads.status })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, "thread-1"));
  const replies = await db
    .select()
    .from(qnaReplies)
    .where(eq(qnaReplies.threadId, "thread-1"));

  assert.equal(thread?.status, "ANSWERED");
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.id, result.replyId);
  assert.equal(replies[0]?.authorId, "admin-1");
});

test("관리자 reply insert가 실패하면 ANSWERED 상태 변경도 rollback한다", { concurrency: false }, async (context) => {
  const { binding, db } = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "admin-1", "admin");
  await db.insert(qnaThreads).values({
    id: "thread-reply-failure",
    studentId: "student-1",
    title: "답변 실패",
    status: "OPEN",
  });
  await binding
    .prepare(
      "CREATE TRIGGER integration_fail_admin_reply_insert " +
        "BEFORE INSERT ON qna_replies " +
        "BEGIN SELECT RAISE(ABORT, 'injected admin reply failure'); END",
    )
    .run();

  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, crypto.randomUUID());
  formData.set("contentHtml", "<p>저장되면 안 되는 관리자 답변</p>");
  const result = await qnaActions.createQnaReply(
    "thread-reply-failure",
    {},
    formData,
  );

  assert.match(result.error ?? "", /저장하지 못했습니다/u);
  const [thread] = await db
    .select({ status: qnaThreads.status })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, "thread-reply-failure"));
  assert.equal(thread?.status, "OPEN");
  assert.equal(await countTableRows(db, qnaReplies), 0);
});

test("첫 reply insert가 실패하면 별도 delete 없이 batch가 thread를 rollback한다", { concurrency: false }, async (context) => {
  const { binding, db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await binding
    .prepare(
      "CREATE TRIGGER integration_fail_reply_insert " +
        "BEFORE INSERT ON qna_replies " +
        "BEGIN SELECT RAISE(ABORT, 'injected reply failure'); END",
    )
    .run();
  await binding
    .prepare(
      "CREATE TRIGGER integration_fail_thread_cleanup " +
        "BEFORE DELETE ON qna_threads " +
        "BEGIN SELECT RAISE(ABORT, 'injected cleanup failure'); END",
    )
    .run();

  const result = await qnaActions.createQnaThread(
    {},
    createDocumentForm("실패 질문", "<p>저장되면 안 됨</p>"),
  );

  assert.match(result.error ?? "", /저장하지 못했습니다/u);
  assert.equal(await countTableRows(db, qnaThreads), 0);
  assert.equal(await countTableRows(db, qnaReplies), 0);
});

test("OPEN precheck 직후 CLOSED가 되면 reply 없이 CLOSED 상태를 보존한다", { concurrency: false }, async (context) => {
  const { binding, db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(qnaThreads).values({
    id: "thread-race",
    studentId: "student-1",
    title: "종료 경쟁",
    status: "OPEN",
  });

  const originalBatch = db.batch.bind(db);
  let raceInjected = false;
  const racingDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "batch") {
        return async (queries: Parameters<typeof originalBatch>[0]) => {
          if (!raceInjected) {
            raceInjected = true;
            await binding
              .prepare(
                "UPDATE qna_threads " +
                  "SET status = 'CLOSED', updated_at = strftime('%s', 'now') " +
                  "WHERE id = ?",
              )
              .bind("thread-race")
              .run();
          }
          return originalBatch(queries);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  activeDbContext = { kind: "d1", db: racingDb };

  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, crypto.randomUUID());
  formData.set("contentHtml", "<p>경쟁 중 답변</p>");
  const result = await qnaActions.createQnaReply("thread-race", {}, formData);

  assert.equal(raceInjected, true);
  assert.match(result.error ?? "", /종료된 스레드/u);
  const [thread] = await db
    .select({ status: qnaThreads.status })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, "thread-race"));
  assert.equal(thread?.status, "CLOSED");
  assert.equal(await countTableRows(db, qnaReplies), 0);
});

test("D1 원자 쓰기는 다른 학생의 직접 reply 호출도 rollback한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(qnaThreads).values({
    id: "thread-owner-guard",
    studentId: "student-1",
    title: "소유자 전용 질문",
    status: "ANSWERED",
  });

  await assert.rejects(
    createQnaReplyAtomically(
      { kind: "d1", db },
      {
        threadId: "thread-owner-guard",
        replyId: "unauthorized-reply",
        actorId: "student-2",
        isAdmin: false,
        contentHtml: "<p>저장되면 안 되는 답변</p>",
        attachmentUrl: null,
      },
    ),
  );

  const [thread] = await db
    .select({ status: qnaThreads.status })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, "thread-owner-guard"));
  assert.equal(thread?.status, "ANSWERED");
  assert.equal(await countTableRows(db, qnaReplies), 0);
});

test("노트 CAS에서 늦은 저장이 먼저 저장된 내용을 덮어쓰지 않는다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(privateNotes).values({
    id: "note-1",
    studentId: "student-1",
    authorId: "student-1",
    title: "기준 제목",
    contentHtml: "<p>기준 본문</p>",
  });

  const createUpdateForm = (title: string, contentHtml: string) => {
    const formData = createDocumentForm(title, contentHtml);
    formData.set("noteDate", "");
    formData.set("baseTitle", "기준 제목");
    formData.set("baseContentHtml", "<p>기준 본문</p>");
    formData.set("baseNoteDate", "");
    return formData;
  };

  const first = await privateNoteActions.updatePrivateNote(
    "note-1",
    {},
    createUpdateForm("먼저 저장", "<p>첫 내용</p>"),
  );
  const late = await privateNoteActions.updatePrivateNote(
    "note-1",
    {},
    createUpdateForm("늦은 저장", "<p>덮어쓰면 안 됨</p>"),
  );

  assert.equal(first.success, true);
  assert.match(late.error ?? "", /먼저 변경/u);
  const [note] = await db
    .select({ title: privateNotes.title, contentHtml: privateNotes.contentHtml })
    .from(privateNotes)
    .where(eq(privateNotes.id, "note-1"));
  assert.deepEqual(note, { title: "먼저 저장", contentHtml: "<p>첫 내용</p>" });
});

test("게시물 CAS에서 늦은 저장이 먼저 저장된 내용을 덮어쓰지 않는다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(posts).values({
    id: "post-1",
    authorId: "student-1",
    category: "general",
    title: "기준 제목",
    contentHtml: "<p>기준 본문</p>",
    boardType: "GENERAL",
  });

  const createUpdateForm = (title: string, contentHtml: string) => {
    const formData = createDocumentForm(title, contentHtml);
    formData.set("baseTitle", "기준 제목");
    formData.set("baseContentHtml", "<p>기준 본문</p>");
    return formData;
  };

  const first = await postActions.updatePostContent(
    "post-1",
    {},
    createUpdateForm("먼저 저장", "<p>첫 내용</p>"),
  );
  const late = await postActions.updatePostContent(
    "post-1",
    {},
    createUpdateForm("늦은 저장", "<p>덮어쓰면 안 됨</p>"),
  );

  assert.equal(first.success, true);
  assert.match(late.error ?? "", /먼저 변경/u);
  const [post] = await db
    .select({ title: posts.title, contentHtml: posts.contentHtml })
    .from(posts)
    .where(eq(posts.id, "post-1"));
  assert.deepEqual(post, { title: "먼저 저장", contentHtml: "<p>첫 내용</p>" });
});

test("같은 노트 생성 작업을 재전송해도 한 건만 만들고 같은 결과를 반환한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const operationId = crypto.randomUUID();

  const first = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(operationId, "멱등 노트", "<p>한 번만 저장</p>", "2026-08-05"),
  );
  const retry = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(operationId, "멱등 노트", "<p>한 번만 저장</p>", "2026-08-05"),
  );

  const expectedId = deriveCreationResourceId(
    operationId,
    JSON.stringify(["private-note", "student-1", "student-1"]),
  );
  assert.equal(first.success, true);
  assert.equal(first.note?.id, expectedId);
  assert.equal(retry.note?.id, expectedId);
  assert.equal(
    first.note?.createdAt?.getTime() ?? null,
    retry.note?.createdAt?.getTime() ?? null,
  );
  const notes = await db
    .select()
    .from(privateNotes)
    .where(eq(privateNotes.id, expectedId));
  assert.equal(notes.length, 1);
});

test("같은 노트 작업 ID의 다른 payload는 기존 노트를 보존하고 충돌로 반환한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const operationId = crypto.randomUUID();

  const first = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(operationId, "원본", "<p>원본 내용</p>"),
  );
  const conflict = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(operationId, "다른 제목", "<p>덮어쓰면 안 됨</p>"),
  );

  assert.equal(first.success, true);
  assert.equal(conflict.operationConflict, true);
  assert.equal(conflict.conflictedOperationId, operationId);
  assert.equal(conflict.existingId, first.note?.id);
  const [stored] = await db
    .select({ title: privateNotes.title, contentHtml: privateNotes.contentHtml })
    .from(privateNotes)
    .where(eq(privateNotes.id, first.note!.id));
  assert.deepEqual(stored, { title: "원본", contentHtml: "<p>원본 내용</p>" });
});

test("동일 게시물 생성 작업의 동시 재전송도 한 건으로 수렴한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const operationId = crypto.randomUUID();

  const [first, concurrentRetry] = await Promise.all([
    postActions.createPost(
      {},
      createPostForm(operationId, "동시 게시물", "<p>한 건만 생성</p>"),
    ),
    postActions.createPost(
      {},
      createPostForm(operationId, "동시 게시물", "<p>한 건만 생성</p>"),
    ),
  ]);

  assert.equal(first.success, true);
  assert.equal(concurrentRetry.success, true);
  assert.equal(concurrentRetry.postId, first.postId);
  const stored = await db
    .select()
    .from(posts)
    .where(eq(posts.id, first.postId!));
  assert.equal(stored.length, 1);
});

test("같은 게시물 작업 ID의 다른 저장 payload는 원본을 보존하고 충돌로 반환한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const operationId = crypto.randomUUID();
  const first = await postActions.createPost(
    {},
    createPostForm(operationId, "원본 게시물", "<p>원본 본문</p>"),
  );
  const conflict = await postActions.createPost(
    {},
    createPostForm(operationId, "다른 게시물", "<p>다른 본문</p>"),
  );

  assert.equal(first.success, true);
  assert.equal(conflict.operationConflict, true);
  assert.equal(conflict.existingId, first.postId);
  const [stored] = await db
    .select({ title: posts.title, contentHtml: posts.contentHtml })
    .from(posts)
    .where(eq(posts.id, first.postId!));
  assert.deepEqual(stored, {
    title: "원본 게시물",
    contentHtml: "<p>원본 본문</p>",
  });
});

test("GENERAL 게시물도 검증된 채널과 동일 operation ID로 재전송된다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(categories).values({
    id: "category-1",
    slug: "practice",
    name: "연습",
  });
  const operationId = crypto.randomUUID();
  const form = () => {
    const value = createDocumentForm("연습 질문", "<p>채널 본문</p>", operationId);
    value.set("boardType", "GENERAL");
    value.set("category", "practice");
    value.set("returnTo", "community-editor");
    return value;
  };

  const first = await postActions.createPost({}, form());
  const retry = await postActions.createPost({}, form());

  assert.equal(first.success, true);
  assert.equal(retry.postId, first.postId);
  const [stored] = await db
    .select({ category: posts.category, boardType: posts.boardType })
    .from(posts)
    .where(eq(posts.id, first.postId!));
  assert.deepEqual(stored, { category: "practice", boardType: "GENERAL" });
});

test("기존 공개 UUIDv4를 operation nonce로 제출해도 그 URL을 재점유하지 않는다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const staleResourceId = "89fb5937-d63f-4055-86cf-018519bf36ea";
  await db.insert(posts).values({
    id: staleResourceId,
    authorId: "student-1",
    category: "feedback",
    boardType: "FEEDBACK",
    title: "삭제 전 게시물",
    contentHtml: "<p>삭제 전 내용</p>",
  });
  await db.delete(posts).where(eq(posts.id, staleResourceId));

  const staleIdAttempt = await postActions.createPost(
    {},
    createPostForm(staleResourceId, "새 게시물", "<p>다른 URL이어야 함</p>"),
  );

  assert.equal(staleIdAttempt.success, true);
  assert.notEqual(staleIdAttempt.postId, staleResourceId);
  assert.equal(
    await db
      .select()
      .from(posts)
      .where(eq(posts.id, staleResourceId))
      .then((rows) => rows.length),
    0,
  );
  const allPosts = await db.select().from(posts);
  assert.equal(allPosts.length, 1);
});

test("같은 Q&A thread 작업의 동시 재전송은 thread와 첫 reply를 하나씩만 만든다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const operationId = crypto.randomUUID();
  const originalBatch = db.batch.bind(db);
  let batchArrivals = 0;
  let releaseBarrier: (() => void) | null = null;
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  const barrierDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "batch") {
        return async (queries: Parameters<typeof originalBatch>[0]) => {
          batchArrivals += 1;
          if (batchArrivals === 2) releaseBarrier?.();
          await barrier;
          return originalBatch(queries);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  activeDbContext = { kind: "d1", db: barrierDb };

  const [first, concurrentRetry] = await Promise.all([
    qnaActions.createQnaThread(
      {},
      createDocumentForm("동시 질문", "<p>질문 본문</p>", operationId),
    ),
    qnaActions.createQnaThread(
      {},
      createDocumentForm("동시 질문", "<p>질문 본문</p>", operationId),
    ),
  ]);

  assert.equal(first.success, true);
  assert.equal(concurrentRetry.success, true);
  assert.equal(batchArrivals, 2);
  assert.equal(concurrentRetry.thread?.id, first.thread?.id);
  const threads = await db
    .select()
    .from(qnaThreads)
    .where(eq(qnaThreads.id, first.thread!.id));
  const replies = await db
    .select()
    .from(qnaReplies)
    .where(eq(qnaReplies.threadId, first.thread!.id));
  assert.equal(threads.length, 1);
  assert.equal(replies.length, 1);
});

test("상태가 바뀐 Q&A thread의 동일 생성 재전송은 현재 상태를 보존하고 payload 충돌은 막는다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const operationId = crypto.randomUUID();
  const first = await qnaActions.createQnaThread(
    {},
    createDocumentForm("상태 보존 질문", "<p>원본 질문</p>", operationId),
  );
  await db
    .update(qnaThreads)
    .set({ status: "CLOSED" })
    .where(eq(qnaThreads.id, first.thread!.id));

  const exactRetry = await qnaActions.createQnaThread(
    {},
    createDocumentForm("상태 보존 질문", "<p>원본 질문</p>", operationId),
  );
  const conflict = await qnaActions.createQnaThread(
    {},
    createDocumentForm("상태 보존 질문", "<p>다른 질문</p>", operationId),
  );

  assert.equal(exactRetry.success, true);
  assert.equal(exactRetry.thread?.id, first.thread?.id);
  assert.equal(conflict.operationConflict, true);
  const [thread] = await db
    .select({ status: qnaThreads.status })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, first.thread!.id));
  const replies = await db
    .select({ contentHtml: qnaReplies.contentHtml })
    .from(qnaReplies)
    .where(eq(qnaReplies.threadId, first.thread!.id));
  assert.equal(thread?.status, "CLOSED");
  assert.deepEqual(replies, [{ contentHtml: "<p>원본 질문</p>" }]);
});

test("같은 operation nonce도 인증 사용자가 다르면 별도 Q&A 리소스로 분리한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  const operationId = crypto.randomUUID();

  activeSession = createSession("student-1", "student");
  const first = await qnaActions.createQnaThread(
    {},
    createDocumentForm("학생 1 질문", "<p>첫 질문</p>", operationId),
  );
  activeSession = createSession("student-2", "student");
  const second = await qnaActions.createQnaThread(
    {},
    createDocumentForm("학생 2 질문", "<p>둘째 질문</p>", operationId),
  );

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.notEqual(first.thread?.id, second.thread?.id);
  assert.equal(await countTableRows(db, qnaThreads), 2);
  assert.equal(await countTableRows(db, qnaReplies), 2);
});

test("저장 후 CLOSED가 된 Q&A reply의 동일 재전송은 성공으로 회수하고 상태를 되감지 않는다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "admin-1", "admin");
  await db.insert(qnaThreads).values({
    id: "thread-closed-replay",
    studentId: "student-1",
    title: "응답 유실",
    status: "OPEN",
  });
  const operationId = crypto.randomUUID();

  const first = await qnaActions.createQnaReply(
    "thread-closed-replay",
    {},
    createReplyForm(operationId, "<p>저장된 관리자 답변</p>"),
  );
  await db
    .update(qnaThreads)
    .set({ status: "CLOSED" })
    .where(eq(qnaThreads.id, "thread-closed-replay"));
  const retry = await qnaActions.createQnaReply(
    "thread-closed-replay",
    {},
    createReplyForm(operationId, "<p>저장된 관리자 답변</p>"),
  );

  assert.equal(first.success, true);
  assert.equal(retry.success, true);
  assert.equal(retry.replyId, first.replyId);
  const [thread] = await db
    .select({ status: qnaThreads.status })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, "thread-closed-replay"));
  assert.equal(thread?.status, "CLOSED");
  assert.equal(await countTableRows(db, qnaReplies), 1);
});

test("과거 관리자 reply 재전송은 후속 학생 질문의 OPEN 상태를 ANSWERED로 되감지 않는다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context, createSession("admin-1", "admin"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "admin-1", "admin");
  await db.insert(qnaThreads).values({
    id: "thread-status-replay",
    studentId: "student-1",
    title: "상태 되감기 방지",
    status: "OPEN",
  });
  const adminOperationId = crypto.randomUUID();
  const adminReply = () =>
    createReplyForm(adminOperationId, "<p>최초 관리자 답변</p>");

  const firstAdminReply = await qnaActions.createQnaReply(
    "thread-status-replay",
    {},
    adminReply(),
  );
  activeSession = createSession("student-1", "student");
  const studentFollowup = await qnaActions.createQnaReply(
    "thread-status-replay",
    {},
    createReplyForm(crypto.randomUUID(), "<p>후속 학생 질문</p>"),
  );
  activeSession = createSession("admin-1", "admin");
  const oldAdminRetry = await qnaActions.createQnaReply(
    "thread-status-replay",
    {},
    adminReply(),
  );

  assert.equal(firstAdminReply.success, true);
  assert.equal(studentFollowup.success, true);
  assert.equal(oldAdminRetry.replyId, firstAdminReply.replyId);
  const [thread] = await db
    .select({ status: qnaThreads.status })
    .from(qnaThreads)
    .where(eq(qnaThreads.id, "thread-status-replay"));
  assert.equal(thread?.status, "OPEN");
  assert.equal(await countTableRows(db, qnaReplies), 2);
});

test("동일 Q&A reply의 동시 재전송도 reply 한 건으로 수렴한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(qnaThreads).values({
    id: "thread-concurrent-reply",
    studentId: "student-1",
    title: "동시 추가 질문",
    status: "ANSWERED",
  });
  const operationId = crypto.randomUUID();

  const [first, concurrentRetry] = await Promise.all([
    qnaActions.createQnaReply(
      "thread-concurrent-reply",
      {},
      createReplyForm(operationId, "<p>동시에 전송</p>"),
    ),
    qnaActions.createQnaReply(
      "thread-concurrent-reply",
      {},
      createReplyForm(operationId, "<p>동시에 전송</p>"),
    ),
  ]);

  assert.equal(first.success, true);
  assert.equal(concurrentRetry.success, true);
  assert.equal(concurrentRetry.replyId, first.replyId);
  assert.equal(await countTableRows(db, qnaReplies), 1);

  const conflict = await qnaActions.createQnaReply(
    "thread-concurrent-reply",
    {},
    createReplyForm(operationId, "<p>다른 답변</p>"),
  );
  assert.equal(conflict.operationConflict, true);
  const [stored] = await db
    .select({ contentHtml: qnaReplies.contentHtml })
    .from(qnaReplies)
    .where(eq(qnaReplies.id, first.replyId!));
  assert.equal(stored?.contentHtml, "<p>동시에 전송</p>");
});

test("operation ID 누락과 비정상 값은 생성 쓰기 전에 거부한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const missing = createDocumentForm("누락", "<p>저장 금지</p>");
  missing.delete(CREATION_OPERATION_FIELD);
  const malformed = createDocumentForm(
    "비정상",
    "<p>저장 금지</p>",
    "not-an-operation-id",
  );
  const invalidDate = createNoteForm(
    crypto.randomUUID(),
    "잘못된 날짜",
    "<p>저장 금지</p>",
    "not-a-date",
  );

  const missingResult = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    missing,
  );
  const malformedResult = await qnaActions.createQnaThread({}, malformed);
  const invalidDateResult = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    invalidDate,
  );

  assert.match(missingResult.error ?? "", /식별자/u);
  assert.match(malformedResult.error ?? "", /식별자/u);
  assert.match(invalidDateResult.error ?? "", /날짜/u);
  assert.equal((await db.select().from(privateNotes)).length, 0);
  assert.equal(await countTableRows(db, qnaThreads), 0);
});
