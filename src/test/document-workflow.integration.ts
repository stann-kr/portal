import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { count, eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import {
  categories,
  documentOperationLedger,
  documentServerDraftOperations,
  documentServerDrafts,
  documentTombstones,
  privateNoteRevisions,
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
import {
  createDocumentSnapshotFingerprint,
  DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD,
} from "@/lib/document-snapshot-fingerprint";
import {
  PRIVATE_NOTE_BASE_REVISION_FIELD,
  PRIVATE_NOTE_MAX_CONTENT_BYTES,
  createPrivateNoteRequestHashForVersion,
  createPrivateNoteSnapshotHashForVersion,
  type PrivateNoteCanonicalRequest,
  type PrivateNoteCanonicalSnapshot,
} from "@/lib/private-note-continuity";
import {
  createDocumentDraftKey,
} from "@/lib/form-draft";
import { serializeDocumentServerDraftPayload } from "@/lib/document-server-draft-contract";
import {
  DOCUMENT_SERVER_DRAFT_MAX_PAYLOAD_BYTES,
  DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS,
} from "@/lib/document-server-draft-constants";

type PortalTestDb = IsolatedPortalD1["db"];
type D1TestContext = { kind: "d1"; db: PortalTestDb };

let activeDb: PortalTestDb | null = null;
let activeDbContext: D1TestContext | null = null;
let activeSession: AuthSession = createSession("student-1", "student");
let documentDraftActions: typeof import("@/lib/actions/documentDrafts");
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
  [documentDraftActions, qnaActions, privateNoteActions, postActions] = await Promise.all([
    import("@/lib/actions/documentDrafts"),
    import("@/lib/actions/qna"),
    import("@/lib/actions/privateNotes"),
    import("@/lib/actions/posts"),
  ]);
});

function createServerDraftSaveInput(
  ownerId: string,
  data: Record<string, unknown>,
  options: {
    sourceKey?: string;
    operationId?: string;
    expectedDraftVersion?: number;
    baseResourceVersion?: number | null;
    writerDeviceId?: string;
  } = {},
) {
  return {
    sourceKey:
      options.sourceKey ?? createDocumentDraftKey("note", ownerId, "new:student-1"),
    operationId: options.operationId ?? crypto.randomUUID(),
    expectedDraftVersion: options.expectedDraftVersion ?? 0,
    payloadJson: serializeDocumentServerDraftPayload(data),
    baseResourceVersion: options.baseResourceVersion ?? null,
    writerDeviceId: options.writerDeviceId ?? crypto.randomUUID(),
  };
}

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

type NoteUpdateSnapshot = {
  title: string;
  contentHtml: string;
  noteDate: string | null;
};

function createNoteUpdateForm(
  noteId: string,
  next: NoteUpdateSnapshot,
  base: NoteUpdateSnapshot,
  operationId = crypto.randomUUID(),
  baseRevision = 1,
): FormData {
  const formData = new FormData();
  formData.set(CREATION_OPERATION_FIELD, operationId);
  formData.set(PRIVATE_NOTE_BASE_REVISION_FIELD, String(baseRevision));
  formData.set("title", next.title);
  formData.set("contentHtml", next.contentHtml);
  formData.set("noteDate", next.noteDate ?? "");
  formData.set(
    DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD,
    createDocumentSnapshotFingerprint({
      kind: "private-note",
      id: noteId,
      title: base.title,
      contentHtml: base.contentHtml,
      noteDate: base.noteDate,
    }),
  );
  return formData;
}

type PostUpdateSnapshot = { title: string; contentHtml: string };

function createPostUpdateForm(
  postId: string,
  next: PostUpdateSnapshot,
  base: PostUpdateSnapshot,
): FormData {
  const formData = new FormData();
  formData.set("title", next.title);
  formData.set("contentHtml", next.contentHtml);
  formData.set(
    DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD,
    createDocumentSnapshotFingerprint({
      kind: "community-post",
      id: postId,
      title: base.title,
      contentHtml: base.contentHtml,
      noteDate: null,
    }),
  );
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

test("private note hash v1 verifier는 버전 교체 후에도 고정된 canonical byte를 재현한다", () => {
  const noteDate = new Date("2026-08-04T15:00:00.000Z");
  const request: PrivateNoteCanonicalRequest = {
    operationType: "UPDATE",
    resourceId: "note-1",
    subjectId: "student-1",
    baseRevision: 1,
    title: "제목",
    contentHtml: "<p>본문</p>",
    noteDate,
  };
  const snapshot: PrivateNoteCanonicalSnapshot = {
    title: "제목",
    contentHtml: "<p>본문</p>",
    noteDate,
    deletedAt: null,
  };

  assert.equal(
    createPrivateNoteRequestHashForVersion(request, 1),
    "8cb69fc6cc749e72b8ccdbe4ead4bd50d9eef40ed3776e7c11577cfc7563ee8c",
  );
  assert.equal(
    createPrivateNoteSnapshotHashForVersion(snapshot, 1),
    "0ba8fd0f221c8e70579a2448ae18e4d924a5a2284b19d1da0375d1e3c73802d8",
  );
  assert.equal(createPrivateNoteRequestHashForVersion(request, 999), null);
  assert.equal(createPrivateNoteSnapshotHashForVersion(snapshot, 999), null);
});

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

  const base = {
    title: "기준 제목",
    contentHtml: "<p>기준 본문</p>",
    noteDate: null,
  };

  const first = await privateNoteActions.updatePrivateNote(
    "note-1",
    {},
    createNoteUpdateForm(
      "note-1",
      { title: "먼저 저장", contentHtml: "<p>첫 내용</p>", noteDate: null },
      base,
    ),
  );
  const late = await privateNoteActions.updatePrivateNote(
    "note-1",
    {},
    createNoteUpdateForm(
      "note-1",
      { title: "늦은 저장", contentHtml: "<p>덮어쓰면 안 됨</p>", noteDate: null },
      base,
    ),
  );

  assert.equal(first.success, true);
  assert.match(late.error ?? "", /먼저 변경/u);
  const [note] = await db
    .select({ title: privateNotes.title, contentHtml: privateNotes.contentHtml })
    .from(privateNotes)
    .where(eq(privateNotes.id, "note-1"));
  assert.deepEqual(note, { title: "먼저 저장", contentHtml: "<p>첫 내용</p>" });
});

test("노트 편집 성공 응답이 유실돼도 같은 저장 재전송은 현재 성공으로 회수한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const originalCreatedAt = new Date("2026-07-01T00:00:00.000Z");
  await db.insert(privateNotes).values({
    id: "note-update-retry",
    studentId: "student-1",
    authorId: "student-1",
    title: "저장 전 제목",
    contentHtml: "<p>저장 전 본문</p>",
    noteDate: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: originalCreatedAt,
  });
  const updateOperationId = crypto.randomUUID();
  const retryForm = () => createNoteUpdateForm(
    "note-update-retry",
    {
      title: "저장된 제목",
      contentHtml: "<p>저장된 본문</p>",
      noteDate: "2026-08-05",
    },
    {
      title: "저장 전 제목",
      contentHtml: "<p>저장 전 본문</p>",
      noteDate: "2026-08-01",
    },
    updateOperationId,
  );

  const first = await privateNoteActions.updatePrivateNote(
    "note-update-retry",
    {},
    retryForm(),
  );
  const lostResponseRetry = await privateNoteActions.updatePrivateNote(
    "note-update-retry",
    {},
    retryForm(),
  );

  assert.equal(first.success, true);
  assert.equal(lostResponseRetry.success, true);
  assert.deepEqual(lostResponseRetry.note, first.note);
  const [stored] = await db
    .select({
      title: privateNotes.title,
      contentHtml: privateNotes.contentHtml,
      noteDate: privateNotes.noteDate,
      createdAt: privateNotes.createdAt,
    })
    .from(privateNotes)
    .where(eq(privateNotes.id, "note-update-retry"));
  assert.equal(stored?.title, "저장된 제목");
  assert.equal(stored?.contentHtml, "<p>저장된 본문</p>");
  assert.equal(stored?.noteDate?.toISOString().slice(0, 10), "2026-08-05");
  assert.equal(stored?.createdAt?.getTime(), originalCreatedAt.getTime());
});

test("노트 조건부 쓰기가 무시되면 원장과 본문을 함께 rollback한다", { concurrency: false }, async (context) => {
  const { binding, db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(privateNotes).values({
    id: "note-update-race-converged",
    studentId: "student-1",
    authorId: "student-1",
    title: "경쟁 전 제목",
    contentHtml: "<p>경쟁 전 본문</p>",
  });
  await binding
    .prepare(
      "CREATE TRIGGER integration_converge_note_update " +
        "BEFORE UPDATE ON private_notes WHEN OLD.id = 'note-update-race-converged' " +
        "BEGIN " +
        "UPDATE private_notes SET title = '같은 저장', content_html = '<p>같은 본문</p>' WHERE id = OLD.id; " +
        "SELECT RAISE(IGNORE); END",
    )
    .run();

  const formData = createNoteUpdateForm(
    "note-update-race-converged",
    { title: "같은 저장", contentHtml: "<p>같은 본문</p>", noteDate: null },
    { title: "경쟁 전 제목", contentHtml: "<p>경쟁 전 본문</p>", noteDate: null },
  );
  const result = await privateNoteActions.updatePrivateNote(
    "note-update-race-converged",
    {},
    formData,
  );

  assert.equal(result.success, undefined);
  assert.equal(result.conflictKind, "INTERNAL_INVARIANT_FAILURE");
  const [stored] = await db
    .select({ title: privateNotes.title, contentHtml: privateNotes.contentHtml })
    .from(privateNotes)
    .where(eq(privateNotes.id, "note-update-race-converged"));
  assert.deepEqual(stored, { title: "경쟁 전 제목", contentHtml: "<p>경쟁 전 본문</p>" });
  const [ledgerCount] = await db
    .select({ value: count() })
    .from(documentOperationLedger);
  assert.equal(ledgerCount?.value, 0);
});

test("다른 사용자는 노트가 이미 같은 payload여도 편집 성공을 회수할 수 없다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context, createSession("student-2", "student"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(privateNotes).values({
    id: "note-update-retry-owner-guard",
    studentId: "student-1",
    authorId: "student-1",
    title: "현재 제목",
    contentHtml: "<p>현재 본문</p>",
  });
  const formData = createNoteUpdateForm(
    "note-update-retry-owner-guard",
    { title: "현재 제목", contentHtml: "<p>현재 본문</p>", noteDate: null },
    { title: "이전 제목", contentHtml: "<p>이전 본문</p>", noteDate: null },
  );

  const result = await privateNoteActions.updatePrivateNote(
    "note-update-retry-owner-guard",
    {},
    formData,
  );
  assert.equal(result.success, undefined);
  assert.equal(result.conflictKind, "NOT_FOUND_OR_FORBIDDEN");
  assert.match(result.error ?? "", /권한/u);
});

test("노트 편집은 존재하지 않는 date-only 일자를 보정하지 않고 거부한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(privateNotes).values({
    id: "note-invalid-date",
    studentId: "student-1",
    authorId: "student-1",
    title: "기준 제목",
    contentHtml: "<p>기준 본문</p>",
    noteDate: new Date("2026-02-28T00:00:00.000Z"),
  });

  const result = await privateNoteActions.updatePrivateNote(
    "note-invalid-date",
    {},
    createNoteUpdateForm(
      "note-invalid-date",
      {
        title: "바뀌면 안 됨",
        contentHtml: "<p>바뀌면 안 됨</p>",
        noteDate: "2026-02-30",
      },
      {
        title: "기준 제목",
        contentHtml: "<p>기준 본문</p>",
        noteDate: "2026-02-28",
      },
    ),
  );

  assert.match(result.error ?? "", /올바른 날짜/u);
  const [stored] = await db
    .select({ title: privateNotes.title, noteDate: privateNotes.noteDate })
    .from(privateNotes)
    .where(eq(privateNotes.id, "note-invalid-date"));
  assert.equal(stored?.title, "기준 제목");
  assert.equal(stored?.noteDate?.toISOString(), "2026-02-28T00:00:00.000Z");
});

test("노트 CAS 중 소유자 변경 시도도 원장과 함께 rollback한다", { concurrency: false }, async (context) => {
  const { binding, db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(privateNotes).values({
    id: "note-owner-race",
    studentId: "student-1",
    authorId: "student-1",
    title: "경쟁 전 제목",
    contentHtml: "<p>경쟁 전 본문</p>",
  });
  await binding
    .prepare(
      "CREATE TRIGGER integration_note_owner_race " +
        "BEFORE UPDATE ON private_notes WHEN OLD.id = 'note-owner-race' " +
        "BEGIN " +
        "UPDATE private_notes SET student_id = 'student-2', author_id = 'student-2', " +
        "title = '같은 저장', content_html = '<p>같은 본문</p>' WHERE id = OLD.id; " +
        "SELECT RAISE(IGNORE); END",
    )
    .run();

  const result = await privateNoteActions.updatePrivateNote(
    "note-owner-race",
    {},
    createNoteUpdateForm(
      "note-owner-race",
      { title: "같은 저장", contentHtml: "<p>같은 본문</p>", noteDate: null },
      { title: "경쟁 전 제목", contentHtml: "<p>경쟁 전 본문</p>", noteDate: null },
    ),
  );
  assert.equal(result.success, undefined);
  assert.equal(result.conflictKind, "INTERNAL_INVARIANT_FAILURE");
  const [stored] = await db
    .select({
      studentId: privateNotes.studentId,
      authorId: privateNotes.authorId,
      title: privateNotes.title,
    })
    .from(privateNotes)
    .where(eq(privateNotes.id, "note-owner-race"));
  assert.deepEqual(stored, {
    studentId: "student-1",
    authorId: "student-1",
    title: "경쟁 전 제목",
  });
});

test("노트 생성·수정 재전송은 immutable revision과 historical receipt를 한 번만 남긴다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const createOperationId = crypto.randomUUID();
  const createForm = () =>
    createNoteForm(createOperationId, "첫 제목", "<p>첫 본문</p>", "2026-08-05");
  const created = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createForm(),
  );
  const noteId = created.note?.id;
  assert.ok(noteId);

  const firstUpdateOperationId = crypto.randomUUID();
  const firstUpdateForm = () =>
    createNoteUpdateForm(
      noteId,
      { title: "둘째 제목", contentHtml: "<p>둘째 본문</p>", noteDate: "2026-08-06" },
      { title: "첫 제목", contentHtml: "<p>첫 본문</p>", noteDate: "2026-08-05" },
      firstUpdateOperationId,
      1,
    );
  const firstUpdate = await privateNoteActions.updatePrivateNote(
    noteId,
    {},
    firstUpdateForm(),
  );
  const updateRetry = await privateNoteActions.updatePrivateNote(
    noteId,
    {},
    firstUpdateForm(),
  );
  const createRetryAfterUpdate = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createForm(),
  );

  assert.equal(firstUpdate.success, true);
  assert.equal(updateRetry.success, true);
  assert.equal(updateRetry.replayed, true);
  assert.equal(createRetryAfterUpdate.success, true);
  assert.equal(createRetryAfterUpdate.replayed, true);
  assert.equal(createRetryAfterUpdate.operationResultRevision, 1);
  assert.equal(createRetryAfterUpdate.currentRevision, 2);
  assert.equal(createRetryAfterUpdate.note?.title, "둘째 제목");

  const revisions = await db
    .select({
      revisionNumber: privateNoteRevisions.revisionNumber,
      changeType: privateNoteRevisions.changeType,
      snapshotHash: privateNoteRevisions.snapshotHash,
    })
    .from(privateNoteRevisions)
    .where(eq(privateNoteRevisions.noteId, noteId));
  assert.deepEqual(
    revisions.map(({ revisionNumber, changeType }) => ({ revisionNumber, changeType })),
    [
      { revisionNumber: 1, changeType: "CREATE" },
      { revisionNumber: 2, changeType: "UPDATE" },
    ],
  );
  assert.ok(revisions.every((revision) => /^[0-9a-f]{64}$/u.test(revision.snapshotHash ?? "")));
  const [ledgerCount] = await db
    .select({ value: count() })
    .from(documentOperationLedger);
  assert.equal(ledgerCount?.value, 2);
});

test("과거 update 재전송은 historical 결과와 현재 head를 분리하고 stale 저장은 거부한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const created = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(crypto.randomUUID(), "v1", "<p>v1</p>"),
  );
  const noteId = created.note?.id;
  assert.ok(noteId);
  const firstOperationId = crypto.randomUUID();
  const firstForm = () =>
    createNoteUpdateForm(
      noteId,
      { title: "v2", contentHtml: "<p>v2</p>", noteDate: null },
      { title: "v1", contentHtml: "<p>v1</p>", noteDate: null },
      firstOperationId,
      1,
    );
  assert.equal(
    (await privateNoteActions.updatePrivateNote(noteId, {}, firstForm())).success,
    true,
  );
  assert.equal(
    (
      await privateNoteActions.updatePrivateNote(
        noteId,
        {},
        createNoteUpdateForm(
          noteId,
          { title: "v3", contentHtml: "<p>v3</p>", noteDate: null },
          { title: "v2", contentHtml: "<p>v2</p>", noteDate: null },
          crypto.randomUUID(),
          2,
        ),
      )
    ).success,
    true,
  );

  const historicalRetry = await privateNoteActions.updatePrivateNote(
    noteId,
    {},
    firstForm(),
  );
  const stale = await privateNoteActions.updatePrivateNote(
    noteId,
    {},
    createNoteUpdateForm(
      noteId,
      { title: "stale", contentHtml: "<p>stale</p>", noteDate: null },
      { title: "v1", contentHtml: "<p>v1</p>", noteDate: null },
      crypto.randomUUID(),
      1,
    ),
  );

  assert.equal(historicalRetry.success, true);
  assert.equal(historicalRetry.replayed, true);
  assert.equal(historicalRetry.operationResultRevision, 2);
  assert.equal(historicalRetry.currentRevision, 3);
  assert.equal(historicalRetry.note?.title, "v3");
  assert.equal(stale.conflictKind, "VERSION_CONFLICT");
  assert.equal(stale.currentRevision, 3);
  assert.equal(stale.conflictNote?.title, "v3");
  assert.equal(stale.conflictNote?.version, 3);
  const [head] = await db
    .select({ title: privateNotes.title, version: privateNotes.version })
    .from(privateNotes)
    .where(eq(privateNotes.id, noteId));
  assert.deepEqual(head, { title: "v3", version: 3 });
  assert.equal(
    (await db.select().from(privateNoteRevisions).where(eq(privateNoteRevisions.noteId, noteId))).length,
    3,
  );
});

test("노트 휴지통 이동과 복원은 기본 조회를 분리하고 각각 새 revision을 만든다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const created = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(crypto.randomUUID(), "휴지통 노트", "<p>보존할 본문</p>"),
  );
  const noteId = created.note?.id;
  assert.ok(noteId);
  const trashOperationId = crypto.randomUUID();

  const trashed = await privateNoteActions.trashPrivateNote(
    noteId,
    trashOperationId,
    1,
  );
  const trashRetry = await privateNoteActions.trashPrivateNote(
    noteId,
    trashOperationId,
    1,
  );
  assert.equal(trashed.success, true);
  assert.equal(trashed.resourceState, "TRASHED");
  assert.equal(trashRetry.replayed, true);
  assert.equal((await privateNoteActions.getPrivateNotes("student-1")).length, 0);
  assert.equal((await privateNoteActions.getTrashedPrivateNotes("student-1")).length, 1);

  const restored = await privateNoteActions.restorePrivateNote(
    noteId,
    crypto.randomUUID(),
    2,
  );
  assert.equal(restored.success, true);
  assert.equal(restored.resourceState, "ACTIVE");
  assert.equal(restored.currentRevision, 3);
  assert.equal((await privateNoteActions.getPrivateNotes("student-1")).length, 1);
  assert.equal((await privateNoteActions.getTrashedPrivateNotes("student-1")).length, 0);

  const history = await privateNoteActions.getPrivateNoteRevisions(noteId);
  assert.deepEqual(
    history.map((revision) => revision.changeType),
    ["RESTORE_TRASH", "TRASH", "CREATE"],
  );
  const [head] = await db
    .select({ version: privateNotes.version, deletedAt: privateNotes.deletedAt })
    .from(privateNotes)
    .where(eq(privateNotes.id, noteId));
  assert.equal(head?.version, 3);
  assert.equal(head?.deletedAt, null);
});

test("과거 revision 복원은 기존 이력을 바꾸지 않고 새 head revision을 추가한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const created = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(crypto.randomUUID(), "원본", "<p>원본 본문</p>", "2026-08-01"),
  );
  const noteId = created.note?.id;
  assert.ok(noteId);
  await privateNoteActions.updatePrivateNote(
    noteId,
    {},
    createNoteUpdateForm(
      noteId,
      { title: "수정본", contentHtml: "<p>수정 본문</p>", noteDate: "2026-08-02" },
      { title: "원본", contentHtml: "<p>원본 본문</p>", noteDate: "2026-08-01" },
      crypto.randomUUID(),
      1,
    ),
  );
  const [revisionOneBefore] = await db
    .select()
    .from(privateNoteRevisions)
    .where(eq(privateNoteRevisions.revisionNumber, 1));

  const restored = await privateNoteActions.restorePrivateNoteRevision(
    noteId,
    crypto.randomUUID(),
    2,
    1,
  );
  assert.equal(restored.success, true);
  assert.equal(restored.currentRevision, 3);
  const [head] = await db
    .select({ title: privateNotes.title, contentHtml: privateNotes.contentHtml, version: privateNotes.version })
    .from(privateNotes)
    .where(eq(privateNotes.id, noteId));
  assert.deepEqual(head, { title: "원본", contentHtml: "<p>원본 본문</p>", version: 3 });
  const revisions = await db
    .select()
    .from(privateNoteRevisions)
    .where(eq(privateNoteRevisions.noteId, noteId));
  assert.equal(revisions.length, 3);
  assert.deepEqual(revisions.find((revision) => revision.revisionNumber === 1), revisionOneBefore);
  assert.equal(revisions.find((revision) => revision.revisionNumber === 3)?.changeType, "RESTORE_REVISION");
  assert.equal(revisions.find((revision) => revision.revisionNumber === 3)?.restoredFromRevision, 1);
});

test("과거 revision 복원은 저장된 hash version으로 snapshot 무결성을 확인한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const noteId = "note-corrupt-snapshot";
  const operationRecordId = "receipt-corrupt-snapshot";
  const now = new Date("2026-08-05T00:00:00.000Z");
  await db.insert(privateNotes).values({
    id: noteId,
    studentId: "student-1",
    authorId: "student-1",
    title: "원본",
    contentHtml: "<p>원본</p>",
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  await db.insert(documentOperationLedger).values({
    id: operationRecordId,
    operationId: crypto.randomUUID(),
    actorId: "student-1",
    subjectId: "student-1",
    resourceType: "PRIVATE_NOTE",
    operationType: "CREATE",
    resourceId: noteId,
    requestHash: "a".repeat(64),
    requestHashVersion: 1,
    resultRevision: 1,
    createdAt: now,
  });
  await db.insert(privateNoteRevisions).values({
    id: "revision-corrupt-snapshot",
    noteId,
    revisionNumber: 1,
    changeType: "CREATE",
    title: "원본",
    contentHtml: "<p>원본</p>",
    snapshotHash: "b".repeat(64),
    snapshotHashVersion: 1,
    actorId: "student-1",
    operationRecordId,
    createdAt: now,
  });

  const restored = await privateNoteActions.restorePrivateNoteRevision(
    noteId,
    crypto.randomUUID(),
    1,
    1,
  );
  assert.equal(restored.success, undefined);
  assert.equal(restored.conflictKind, "INTERNAL_INVARIANT_FAILURE");
  const [head] = await db
    .select({ version: privateNotes.version, title: privateNotes.title })
    .from(privateNotes)
    .where(eq(privateNotes.id, noteId));
  assert.deepEqual(head, { version: 1, title: "원본" });
  const [revisionCount] = await db
    .select({ value: count() })
    .from(privateNoteRevisions)
    .where(eq(privateNoteRevisions.noteId, noteId));
  assert.equal(revisionCount?.value, 1);
});

test("영구 삭제는 30일·admin 조건을 지키고 tombstone으로 과거 create 부활을 막는다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await seedProfile(db, "admin-1", "admin");
  const createOperationId = crypto.randomUUID();
  const createForm = () =>
    createNoteForm(createOperationId, "삭제할 노트", "<p>삭제할 본문</p>");
  const created = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createForm(),
  );
  const noteId = created.note?.id;
  assert.ok(noteId);
  assert.equal(
    (await privateNoteActions.trashPrivateNote(noteId, crypto.randomUUID(), 1)).success,
    true,
  );

  activeSession = createSession("admin-1", "admin");
  const purgeOperationId = crypto.randomUUID();
  const earlyPurge = await privateNoteActions.purgePrivateNote(
    noteId,
    purgeOperationId,
    2,
  );
  assert.equal(earlyPurge.conflictKind, "RETENTION_NOT_EXPIRED");
  assert.equal((await db.select().from(documentTombstones)).length, 0);

  await db
    .update(privateNotes)
    .set({ deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
    .where(eq(privateNotes.id, noteId));
  activeSession = createSession("student-1", "student");
  const forbidden = await privateNoteActions.purgePrivateNote(
    noteId,
    purgeOperationId,
    2,
  );
  assert.equal(forbidden.conflictKind, "NOT_FOUND_OR_FORBIDDEN");

  activeSession = createSession("admin-1", "admin");
  const purged = await privateNoteActions.purgePrivateNote(
    noteId,
    purgeOperationId,
    2,
  );
  const purgeRetry = await privateNoteActions.purgePrivateNote(
    noteId,
    purgeOperationId,
    2,
  );
  assert.equal(purged.success, true);
  assert.equal(purged.resourceState, "PURGED");
  assert.equal(purgeRetry.success, true);
  assert.equal(purgeRetry.replayed, true);
  assert.equal((await db.select().from(privateNotes).where(eq(privateNotes.id, noteId))).length, 0);
  assert.equal((await db.select().from(privateNoteRevisions).where(eq(privateNoteRevisions.noteId, noteId))).length, 0);
  const [tombstone] = await db
    .select()
    .from(documentTombstones)
    .where(eq(documentTombstones.resourceId, noteId));
  assert.equal(tombstone?.sourceVersion, 2);
  assert.equal(tombstone?.purgedById, "admin-1");

  activeSession = createSession("student-1", "student");
  const lateCreateRetry = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createForm(),
  );
  assert.equal(lateCreateRetry.conflictKind, "PURGED");
  assert.equal(lateCreateRetry.resourceState, "PURGED");
  assert.equal((await db.select().from(privateNotes)).length, 0);
});

test("동일 base의 수정과 휴지통 경쟁은 한 작업만 commit한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const created = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(crypto.randomUUID(), "경쟁 기준", "<p>경쟁 기준</p>"),
  );
  const noteId = created.note?.id;
  assert.ok(noteId);

  const [updated, trashed] = await Promise.all([
    privateNoteActions.updatePrivateNote(
      noteId,
      {},
      createNoteUpdateForm(
        noteId,
        { title: "수정 승자 후보", contentHtml: "<p>수정</p>", noteDate: null },
        { title: "경쟁 기준", contentHtml: "<p>경쟁 기준</p>", noteDate: null },
        crypto.randomUUID(),
        1,
      ),
    ),
    privateNoteActions.trashPrivateNote(noteId, crypto.randomUUID(), 1),
  ]);
  assert.equal([updated.success, trashed.success].filter(Boolean).length, 1);
  assert.ok(
    [updated.conflictKind, trashed.conflictKind].includes("VERSION_CONFLICT") ||
      [updated.conflictKind, trashed.conflictKind].includes("TRASHED"),
  );
  const [head] = await db
    .select({ version: privateNotes.version })
    .from(privateNotes)
    .where(eq(privateNotes.id, noteId));
  assert.equal(head?.version, 2);
  assert.equal(
    (await db.select().from(privateNoteRevisions).where(eq(privateNoteRevisions.noteId, noteId))).length,
    2,
  );
  assert.equal((await db.select().from(documentOperationLedger)).length, 2);
});

test("문서 상한 초과 본문과 canonical no-op은 각각 쓰기 없음과 receipt-only로 처리한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const oversized = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(
      crypto.randomUUID(),
      "대형 노트",
      `<p>${"x".repeat(PRIVATE_NOTE_MAX_CONTENT_BYTES)}</p>`,
    ),
  );
  assert.equal(oversized.conflictKind, "DOCUMENT_TOO_LARGE");
  assert.equal((await db.select().from(documentOperationLedger)).length, 0);
  assert.equal((await db.select().from(privateNotes)).length, 0);

  const created = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(crypto.randomUUID(), "같은 내용", "<p>같은 내용</p>"),
  );
  const noteId = created.note?.id;
  assert.ok(noteId);
  const noOpOperationId = crypto.randomUUID();
  const noOpForm = () =>
    createNoteUpdateForm(
      noteId,
      { title: "같은 내용", contentHtml: "<p>같은 내용</p>", noteDate: null },
      { title: "같은 내용", contentHtml: "<p>같은 내용</p>", noteDate: null },
      noOpOperationId,
      1,
    );
  const noOp = await privateNoteActions.updatePrivateNote(noteId, {}, noOpForm());
  const noOpRetry = await privateNoteActions.updatePrivateNote(noteId, {}, noOpForm());
  assert.equal(noOp.success, true);
  assert.equal(noOp.currentRevision, 1);
  assert.equal(noOpRetry.replayed, true);
  assert.equal((await db.select().from(privateNoteRevisions)).length, 1);
  assert.equal((await db.select().from(documentOperationLedger)).length, 2);
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

  const base = { title: "기준 제목", contentHtml: "<p>기준 본문</p>" };

  const first = await postActions.updatePostContent(
    "post-1",
    {},
    createPostUpdateForm(
      "post-1",
      { title: "먼저 저장", contentHtml: "<p>첫 내용</p>" },
      base,
    ),
  );
  const late = await postActions.updatePostContent(
    "post-1",
    {},
    createPostUpdateForm(
      "post-1",
      { title: "늦은 저장", contentHtml: "<p>덮어쓰면 안 됨</p>" },
      base,
    ),
  );

  assert.equal(first.success, true);
  assert.match(late.error ?? "", /먼저 변경/u);
  const [post] = await db
    .select({ title: posts.title, contentHtml: posts.contentHtml })
    .from(posts)
    .where(eq(posts.id, "post-1"));
  assert.deepEqual(post, { title: "먼저 저장", contentHtml: "<p>첫 내용</p>" });
});

test("게시물 편집 성공 응답이 유실돼도 같은 저장 재전송은 현재 성공으로 회수한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const originalCreatedAt = new Date("2026-07-01T00:00:00.000Z");
  await db.insert(posts).values({
    id: "post-update-retry",
    authorId: "student-1",
    category: "general",
    title: "저장 전 제목",
    contentHtml: "<p>저장 전 본문</p>",
    boardType: "GENERAL",
    createdAt: originalCreatedAt,
  });
  const retryForm = () => createPostUpdateForm(
    "post-update-retry",
    { title: "저장된 제목", contentHtml: "<p>저장된 본문</p>" },
    { title: "저장 전 제목", contentHtml: "<p>저장 전 본문</p>" },
  );

  const first = await postActions.updatePostContent(
    "post-update-retry",
    {},
    retryForm(),
  );
  const lostResponseRetry = await postActions.updatePostContent(
    "post-update-retry",
    {},
    retryForm(),
  );

  assert.equal(first.success, true);
  assert.equal(lostResponseRetry.success, true);
  assert.deepEqual(lostResponseRetry.post, first.post);
  const [stored] = await db
    .select({
      title: posts.title,
      contentHtml: posts.contentHtml,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(eq(posts.id, "post-update-retry"));
  assert.equal(stored?.title, "저장된 제목");
  assert.equal(stored?.contentHtml, "<p>저장된 본문</p>");
  assert.equal(stored?.createdAt?.getTime(), originalCreatedAt.getTime());
});

test("게시물 CAS 직전 같은 내용이 반영돼도 후속 조회로 성공에 수렴한다", { concurrency: false }, async (context) => {
  const { binding, db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(posts).values({
    id: "post-update-race-converged",
    authorId: "student-1",
    category: "general",
    title: "경쟁 전 제목",
    contentHtml: "<p>경쟁 전 본문</p>",
    boardType: "GENERAL",
  });
  await binding
    .prepare(
      "CREATE TRIGGER integration_converge_post_update " +
        "BEFORE UPDATE ON posts WHEN OLD.id = 'post-update-race-converged' " +
        "BEGIN " +
        "UPDATE posts SET title = '같은 저장', content_html = '<p>같은 본문</p>' WHERE id = OLD.id; " +
        "SELECT RAISE(IGNORE); END",
    )
    .run();

  const formData = createPostUpdateForm(
    "post-update-race-converged",
    { title: "같은 저장", contentHtml: "<p>같은 본문</p>" },
    { title: "경쟁 전 제목", contentHtml: "<p>경쟁 전 본문</p>" },
  );
  const result = await postActions.updatePostContent(
    "post-update-race-converged",
    {},
    formData,
  );

  assert.equal(result.success, true);
  assert.equal(result.post?.title, "같은 저장");
  const [stored] = await db
    .select({ title: posts.title, contentHtml: posts.contentHtml })
    .from(posts)
    .where(eq(posts.id, "post-update-race-converged"));
  assert.deepEqual(stored, { title: "같은 저장", contentHtml: "<p>같은 본문</p>" });
});

test("다른 사용자는 게시물이 이미 같은 payload여도 편집 성공을 회수할 수 없다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context, createSession("student-2", "student"));
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  await db.insert(posts).values({
    id: "post-update-retry-owner-guard",
    authorId: "student-1",
    category: "general",
    title: "현재 제목",
    contentHtml: "<p>현재 본문</p>",
    boardType: "GENERAL",
  });
  const formData = createPostUpdateForm(
    "post-update-retry-owner-guard",
    { title: "현재 제목", contentHtml: "<p>현재 본문</p>" },
    { title: "이전 제목", contentHtml: "<p>이전 본문</p>" },
  );

  await assert.rejects(
    postActions.updatePostContent(
      "post-update-retry-owner-guard",
      {},
      formData,
    ),
    /Unauthorized/u,
  );
});

test("편집 액션은 legacy full-base 필드만 있는 요청과 malformed fingerprint를 exact-current보다 먼저 거부한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(privateNotes).values({
    id: "note-legacy-base",
    studentId: "student-1",
    authorId: "student-1",
    title: "현재 노트",
    contentHtml: "<p>현재 노트 본문</p>",
  });
  await db.insert(posts).values({
    id: "post-malformed-fingerprint",
    authorId: "student-1",
    category: "general",
    title: "현재 게시물",
    contentHtml: "<p>현재 게시물 본문</p>",
    boardType: "GENERAL",
  });

  const legacyNoteForm = new FormData();
  legacyNoteForm.set("title", "현재 노트");
  legacyNoteForm.set("contentHtml", "<p>현재 노트 본문</p>");
  legacyNoteForm.set("noteDate", "");
  legacyNoteForm.set("baseTitle", "현재 노트");
  legacyNoteForm.set("baseContentHtml", "<p>현재 노트 본문</p>");
  legacyNoteForm.set("baseNoteDate", "");
  const malformedPostForm = createPostUpdateForm(
    "post-malformed-fingerprint",
    { title: "현재 게시물", contentHtml: "<p>현재 게시물 본문</p>" },
    { title: "현재 게시물", contentHtml: "<p>현재 게시물 본문</p>" },
  );
  malformedPostForm.set(DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD, "sha256:INVALID");

  const noteResult = await privateNoteActions.updatePrivateNote(
    "note-legacy-base",
    {},
    legacyNoteForm,
  );
  const postResult = await postActions.updatePostContent(
    "post-malformed-fingerprint",
    {},
    malformedPostForm,
  );

  assert.match(noteResult.error ?? "", /기준/u);
  assert.match(postResult.error ?? "", /편집 기준 정보/u);
  assert.equal(noteResult.success, undefined);
  assert.equal(postResult.success, undefined);
});

test("다른 리소스의 올바른 fingerprint를 이식해도 게시물을 변경할 수 없다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await db.insert(posts).values({
    id: "post-fingerprint-target",
    authorId: "student-1",
    category: "general",
    title: "기준 제목",
    contentHtml: "<p>기준 본문</p>",
    boardType: "GENERAL",
  });
  const formData = createPostUpdateForm(
    "post-fingerprint-source",
    { title: "변조 제목", contentHtml: "<p>변조 본문</p>" },
    { title: "기준 제목", contentHtml: "<p>기준 본문</p>" },
  );

  const result = await postActions.updatePostContent(
    "post-fingerprint-target",
    {},
    formData,
  );

  assert.match(result.error ?? "", /먼저 변경/u);
  const [stored] = await db
    .select({ title: posts.title, contentHtml: posts.contentHtml })
    .from(posts)
    .where(eq(posts.id, "post-fingerprint-target"));
  assert.deepEqual(stored, { title: "기준 제목", contentHtml: "<p>기준 본문</p>" });
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

test("노트 생성도 존재하지 않는 date-only 일자를 보정하지 않고 거부한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");

  const result = await privateNoteActions.createPrivateNote(
    "student-1",
    {},
    createNoteForm(
      crypto.randomUUID(),
      "잘못된 날짜",
      "<p>저장되면 안 됨</p>",
      "2026-02-30",
    ),
  );

  assert.match(result.error ?? "", /올바른 날짜/u);
  assert.equal(result.success, undefined);
  const stored = await db
    .select({ id: privateNotes.id })
    .from(privateNotes);
  assert.equal(stored.length, 0);
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

test("서버 초안은 exact replay와 draft version CAS로 다중 기기 쓰기를 직렬화한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const sourceKey = createDocumentDraftKey("note", "student-1", "new:student-1");
  const firstOperationId = crypto.randomUUID();
  const firstDeviceId = crypto.randomUUID();
  const firstInput = createServerDraftSaveInput(
    "student-1",
    { operationId: "draft-create", title: "첫 기기", contentHtml: "<p>첫 초안</p>" },
    { sourceKey, operationId: firstOperationId, writerDeviceId: firstDeviceId },
  );

  const first = await documentDraftActions.saveDocumentServerDraft(firstInput);
  assert.equal(first.ok, true, JSON.stringify(first));
  if (!first.ok) return;
  assert.equal(first.replayed, false);
  assert.equal(first.operationResultVersion, 1);
  assert.equal(first.current?.draftVersion, 1);

  const exactReplay = await documentDraftActions.saveDocumentServerDraft(firstInput);
  assert.equal(exactReplay.ok, true);
  if (!exactReplay.ok) return;
  assert.equal(exactReplay.replayed, true);
  assert.equal(exactReplay.operationResultVersion, 1);

  const operationConflict = await documentDraftActions.saveDocumentServerDraft({
    ...firstInput,
    payloadJson: serializeDocumentServerDraftPayload({
      operationId: "draft-create",
      title: "같은 operation의 다른 내용",
      contentHtml: "<p>충돌</p>",
    }),
  });
  assert.equal(operationConflict.ok, false);
  if (operationConflict.ok) return;
  assert.equal(operationConflict.reason, "OPERATION_PAYLOAD_CONFLICT");

  const staleDevice = await documentDraftActions.saveDocumentServerDraft(
    createServerDraftSaveInput(
      "student-1",
      { operationId: "draft-create", title: "두 번째 기기", contentHtml: "<p>경쟁</p>" },
      { sourceKey, expectedDraftVersion: 0 },
    ),
  );
  assert.equal(staleDevice.ok, false);
  if (staleDevice.ok) return;
  assert.equal(staleDevice.reason, "VERSION_CONFLICT");
  assert.equal(staleDevice.current?.draftVersion, 1);

  const secondDeviceId = crypto.randomUUID();
  const second = await documentDraftActions.saveDocumentServerDraft(
    createServerDraftSaveInput(
      "student-1",
      { operationId: "draft-create", title: "두 번째 기기", contentHtml: "<p>최신 초안</p>" },
      {
        sourceKey,
        expectedDraftVersion: 1,
        writerDeviceId: secondDeviceId,
      },
    ),
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.operationResultVersion, 2);
  assert.equal(second.current?.writerDeviceId, secondDeviceId);

  const oldReplayAfterAdvance = await documentDraftActions.saveDocumentServerDraft(firstInput);
  assert.equal(oldReplayAfterAdvance.ok, true);
  if (!oldReplayAfterAdvance.ok) return;
  assert.equal(oldReplayAfterAdvance.operationResultVersion, 1);
  assert.equal(oldReplayAfterAdvance.current?.draftVersion, 2);

  const read = await documentDraftActions.readDocumentServerDraft(sourceKey);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.draft?.draftVersion, 2);
  assert.match(read.draft?.payloadJson ?? "", /최신 초안/u);
  assert.equal((await db.select().from(documentServerDrafts)).length, 1);
  assert.equal((await db.select().from(documentServerDraftOperations)).length, 2);
});

test("같은 서버 초안 payload 저장은 version을 늘리지 않고 재시도 receipt만 남긴다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const sourceKey = createDocumentDraftKey("qna-reply", "student-1", "thread-1");
  const data = {
    operationId: "reply-create",
    contentHtml: "<p>같은 답변 초안</p>",
    attachmentUrl: "",
  };
  const first = await documentDraftActions.saveDocumentServerDraft(
    createServerDraftSaveInput("student-1", data, { sourceKey }),
  );
  assert.equal(first.ok, true);

  const noOp = await documentDraftActions.saveDocumentServerDraft(
    createServerDraftSaveInput("student-1", data, {
      sourceKey,
      expectedDraftVersion: 1,
      writerDeviceId: crypto.randomUUID(),
    }),
  );
  assert.equal(noOp.ok, true);
  if (!noOp.ok) return;
  assert.equal(noOp.operationResultVersion, 1);
  assert.equal(noOp.current?.draftVersion, 1);
  assert.equal((await db.select().from(documentServerDraftOperations)).length, 2);
});

test("서버 초안 명시 폐기는 CAS 충돌 시 최신본을 보존하고 exact replay에 수렴한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const sourceKey = createDocumentDraftKey("community-post", "student-1");
  const saved = await documentDraftActions.saveDocumentServerDraft(
    createServerDraftSaveInput(
      "student-1",
      { operationId: "post-create", title: "서버 초안", contentHtml: "<p>본문</p>" },
      { sourceKey },
    ),
  );
  assert.equal(saved.ok, true);

  const staleDiscard = await documentDraftActions.discardDocumentServerDraft({
    sourceKey,
    operationId: crypto.randomUUID(),
    expectedDraftVersion: 0,
  });
  assert.equal(staleDiscard.ok, false);
  if (staleDiscard.ok) return;
  assert.equal(staleDiscard.reason, "VERSION_CONFLICT");
  assert.equal(staleDiscard.current?.draftVersion, 1);

  const discardInput = {
    sourceKey,
    operationId: crypto.randomUUID(),
    expectedDraftVersion: 1,
  };
  const discarded = await documentDraftActions.discardDocumentServerDraft(discardInput);
  assert.equal(discarded.ok, true);
  if (!discarded.ok) return;
  assert.equal(discarded.current, null);
  assert.equal((await db.select().from(documentServerDrafts)).length, 0);

  const replay = await documentDraftActions.discardDocumentServerDraft(discardInput);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.replayed, true);
  assert.equal(replay.operationResultVersion, 1);
  assert.equal(replay.current, null);
});

test("만료 서버 초안은 30일 경계에서 읽기 전에 제거되고 stale queue가 자동 부활시키지 않는다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const sourceKey = createDocumentDraftKey("note", "student-1", "expired-note");
  const updatedAtSeconds = Math.floor(Date.now() / 1000) -
    DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS - 10;
  await db.insert(documentServerDrafts).values({
    ownerId: "student-1",
    sourceKey,
    documentKind: "note",
    contextId: "expired-note",
    payloadJson: serializeDocumentServerDraftPayload({ title: "만료", contentHtml: "<p>만료</p>" }),
    payloadHash: "a".repeat(64),
    draftVersion: 3,
    baseResourceVersion: 2,
    writerDeviceId: crypto.randomUUID(),
    createdAt: new Date((updatedAtSeconds - 30) * 1000),
    updatedAt: new Date(updatedAtSeconds * 1000),
    expiresAt: new Date(
      (updatedAtSeconds + DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS) * 1000,
    ),
  });

  const read = await documentDraftActions.readDocumentServerDraft(sourceKey);
  assert.deepEqual(read, { ok: true, draft: null });
  assert.equal((await db.select().from(documentServerDrafts)).length, 0);

  const staleSave = await documentDraftActions.saveDocumentServerDraft(
    createServerDraftSaveInput(
      "student-1",
      { title: "오래된 queue", contentHtml: "<p>자동 부활 금지</p>" },
      { sourceKey, expectedDraftVersion: 3 },
    ),
  );
  assert.equal(staleSave.ok, false);
  if (staleSave.ok) return;
  assert.equal(staleSave.reason, "VERSION_CONFLICT");
  assert.equal(staleSave.current, null);
});

test("서버 초안은 owner 경계를 거부하고 profile 삭제 시 payload와 receipt를 cascade한다", { concurrency: false }, async (context) => {
  const { db } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  await seedProfile(db, "student-2");
  const foreignSourceKey = createDocumentDraftKey("note", "student-2", "new:student-2");
  const denied = await documentDraftActions.saveDocumentServerDraft(
    createServerDraftSaveInput(
      "student-1",
      { title: "다른 계정", contentHtml: "<p>금지</p>" },
      { sourceKey: foreignSourceKey },
    ),
  );
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.reason, "INVALID_INPUT");

  const ownSourceKey = createDocumentDraftKey("note", "student-1", "new:student-1");
  const saved = await documentDraftActions.saveDocumentServerDraft(
    createServerDraftSaveInput(
      "student-1",
      { title: "삭제 대상", contentHtml: "<p>계정 삭제</p>" },
      { sourceKey: ownSourceKey },
    ),
  );
  assert.equal(saved.ok, true);
  await db.delete(profiles).where(eq(profiles.id, "student-1"));
  assert.equal((await db.select().from(documentServerDrafts)).length, 0);
  assert.equal((await db.select().from(documentServerDraftOperations)).length, 0);
});

test("서버 초안 payload 상한과 원자 실패는 원문·receipt 부분 commit을 남기지 않는다", { concurrency: false }, async (context) => {
  const { db, binding } = await setupDatabase(context);
  await seedProfile(db, "student-1");
  const sourceKey = createDocumentDraftKey("note", "student-1", "failure-note");
  const oversized = await documentDraftActions.saveDocumentServerDraft({
    ...createServerDraftSaveInput(
      "student-1",
      { title: "대형", contentHtml: "x".repeat(DOCUMENT_SERVER_DRAFT_MAX_PAYLOAD_BYTES) },
      { sourceKey },
    ),
  });
  assert.equal(oversized.ok, false);
  if (oversized.ok) return;
  assert.equal(oversized.reason, "PAYLOAD_TOO_LARGE");

  const futurePayload = await documentDraftActions.saveDocumentServerDraft({
    ...createServerDraftSaveInput(
      "student-1",
      { title: "미래 형식", contentHtml: "<p>보존</p>" },
      { sourceKey },
    ),
    payloadJson: JSON.stringify({
      data: { title: "미래 형식", contentHtml: "<p>보존</p>" },
      version: 2,
    }),
  });
  assert.equal(futurePayload.ok, false);
  if (futurePayload.ok) return;
  assert.equal(futurePayload.reason, "INVALID_INPUT");

  await binding
    .prepare(
      "CREATE TRIGGER document_server_draft_test_failure " +
        "BEFORE INSERT ON document_server_drafts " +
        `WHEN NEW.source_key = '${sourceKey}' ` +
        "BEGIN SELECT RAISE(ABORT, 'FORCED_SERVER_DRAFT_FAILURE'); END",
    )
    .run();
  const failed = await documentDraftActions.saveDocumentServerDraft(
    createServerDraftSaveInput(
      "student-1",
      { title: "실패", contentHtml: "<p>원자 실패</p>" },
      { sourceKey },
    ),
  );
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.reason, "INTERNAL_INVARIANT_FAILURE");
  assert.equal((await db.select().from(documentServerDrafts)).length, 0);
  assert.equal((await db.select().from(documentServerDraftOperations)).length, 0);
});
