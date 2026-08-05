import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { count, eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import {
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

function createDocumentForm(title: string, contentHtml: string): FormData {
  const formData = new FormData();
  formData.set("title", title);
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
