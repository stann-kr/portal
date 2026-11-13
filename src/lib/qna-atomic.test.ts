import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import {
  canSetQnaStatus,
  createQnaReplyAtomically,
  createQnaThreadAtomically,
  isQnaStatusTransitionAllowed,
  purgeQnaThreadAtomically,
  restoreTrashedQnaThreadAtomically,
  setQnaStatusAtomically,
  trashQnaThreadAtomically,
} from "./qna-atomic";

type LocalDbContext = Extract<DbContext, { kind: "local" }>;

function setupDatabase(context: TestContext): {
  sqlite: SqliteDatabase;
  dbContext: LocalDbContext;
} {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  const migrationDirectory = join(process.cwd(), "drizzle");
  for (const migrationFile of readdirSync(migrationDirectory)
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort()) {
    sqlite.exec(readFileSync(join(migrationDirectory, migrationFile), "utf8"));
  }

  return {
    sqlite,
    dbContext: { kind: "local", db: drizzle(sqlite, { schema }) },
  };
}

function seedProfile(
  sqlite: SqliteDatabase,
  id: string,
  role: "admin" | "student" = "student",
): void {
  sqlite
    .prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, ?)")
    .run(id, `${id}@example.com`, role);
}

function actor(id: string, isAdmin = false) {
  return { id, isAdmin };
}

function operationId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

let operationSequence = 100;

async function createThread(
  dbContext: LocalDbContext,
  input: {
    studentId: string;
    threadId: string;
    replyId?: string;
    operationId?: string;
    now?: Date;
  },
) {
  return createQnaThreadAtomically(dbContext, {
    actor: actor(input.studentId),
    threadId: input.threadId,
    replyId: input.replyId ?? `${input.threadId}-question`,
    operationId: input.operationId ?? operationId(operationSequence++),
    title: input.threadId,
    contentHtml: "<p>질문</p>",
    attachmentUrl: null,
    attachmentObjectId: null,
    now: input.now ?? new Date("2026-01-01T00:00:00.000Z"),
  });
}

function countRows(
  sqlite: SqliteDatabase,
  table: "document_operation_ledger" | "qna_thread_events" | "qna_threads" | "qna_replies",
  column: "id" | "operation_id" | "thread_id",
  id: string,
): number {
  return sqlite
    .prepare<[string], { value: number }>(
      `SELECT count(*) AS value FROM ${table} WHERE ${column} = ?`,
    )
    .get(id)?.value ?? 0;
}

function getThread(
  sqlite: SqliteDatabase,
  id: string,
): { status: string; version: number; deleted_at: number | null } | undefined {
  return sqlite
    .prepare<[string], { status: string; version: number; deleted_at: number | null }>(
      "SELECT status, version, deleted_at FROM qna_threads WHERE id = ?",
    )
    .get(id);
}

test("첫 reply가 기존 ID와 충돌하면 새 Q&A thread와 receipt를 남기지 않는다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const seeded = await createThread(dbContext, {
    studentId: "student-1",
    threadId: "seed-thread",
    replyId: "duplicate-reply",
  });
  assert.equal(seeded.ok, true);

  const result = await createThread(dbContext, {
    studentId: "student-1",
    threadId: "rolled-back-thread",
    replyId: "duplicate-reply",
    operationId: operationId(2),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "OPERATION_PAYLOAD_CONFLICT");
    assert.equal(result.threadId, "rolled-back-thread");
  }
  assert.equal(countRows(sqlite, "qna_threads", "id", "rolled-back-thread"), 0);
  assert.equal(
    countRows(sqlite, "document_operation_ledger", "operation_id", operationId(2)),
    0,
  );
});

test("reply ID가 다른 thread와 충돌하면 status와 event가 함께 rollback된다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "seed-thread",
      replyId: "duplicate-reply",
    })).ok,
    true,
  );
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "target-thread",
    })).ok,
    true,
  );

  const result = await createQnaReplyAtomically(dbContext, {
    actor: actor("admin-1", true),
    threadId: "target-thread",
    replyId: "duplicate-reply",
    operationId: operationId(2),
    contentHtml: "<p>관리자 답변</p>",
    attachmentUrl: null,
    attachmentObjectId: null,
    now: new Date("2026-01-01T00:01:00.000Z"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "OPERATION_PAYLOAD_CONFLICT");
  assert.deepEqual(getThread(sqlite, "target-thread"), {
    status: "OPEN",
    version: 1,
    deleted_at: null,
  });
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "target-thread"), 1);
});

test("CLOSED thread에는 reply와 새 event를 남기지 않는다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "closed-thread",
    })).ok,
    true,
  );
  const closed = await setQnaStatusAtomically(dbContext, {
    actor: actor("admin-1", true),
    threadId: "closed-thread",
    operationId: operationId(2),
    baseRevision: 1,
    status: "CLOSED",
    now: new Date("2026-01-01T00:01:00.000Z"),
  });
  assert.equal(closed.ok, true);

  const result = await createQnaReplyAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "closed-thread",
    replyId: "closed-reply",
    operationId: operationId(3),
    contentHtml: "<p>추가 질문</p>",
    attachmentUrl: null,
    attachmentObjectId: null,
    now: new Date("2026-01-01T00:02:00.000Z"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "CLOSED");
  assert.deepEqual(getThread(sqlite, "closed-thread"), {
    status: "CLOSED",
    version: 2,
    deleted_at: null,
  });
  assert.equal(countRows(sqlite, "qna_replies", "id", "closed-reply"), 0);
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "closed-thread"), 2);
});

test("다른 학생은 OPEN thread에도 reply를 남길 수 없다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "student-2");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "owned-thread",
    })).ok,
    true,
  );

  const result = await createQnaReplyAtomically(dbContext, {
    actor: actor("student-2"),
    threadId: "owned-thread",
    replyId: "other-student-reply",
    operationId: operationId(2),
    contentHtml: "<p>권한 없는 답변</p>",
    attachmentUrl: null,
    attachmentObjectId: null,
    now: new Date("2026-01-01T00:01:00.000Z"),
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "NOT_FOUND_OR_FORBIDDEN");
  assert.deepEqual(getThread(sqlite, "owned-thread"), {
    status: "OPEN",
    version: 1,
    deleted_at: null,
  });
  assert.equal(countRows(sqlite, "qna_replies", "id", "other-student-reply"), 0);
});

test("정상 관리자 답변은 reply, ANSWERED status, event, receipt를 함께 반영한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "answered-thread",
    })).ok,
    true,
  );

  const result = await createQnaReplyAtomically(dbContext, {
    actor: actor("admin-1", true),
    threadId: "answered-thread",
    replyId: "admin-reply",
    operationId: operationId(2),
    contentHtml: "<p>관리자 답변</p>",
    attachmentUrl: "https://example.com/attachment",
    attachmentObjectId: null,
    now: new Date("2026-01-01T00:01:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(getThread(sqlite, "answered-thread"), {
    status: "ANSWERED",
    version: 2,
    deleted_at: null,
  });
  assert.equal(countRows(sqlite, "qna_replies", "id", "admin-reply"), 1);
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "answered-thread"), 2);
  assert.equal(
    sqlite
      .prepare<[], { value: number }>(
        `SELECT count(*) AS value FROM document_operation_ledger WHERE operation_id = '${operationId(2)}'`,
      )
      .get()?.value,
    1,
  );
});

test("Q&A trash/restore/만료 purge는 답변과 event를 보존한 뒤 tombstone과 함께 정리한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal(
    (await createThread(dbContext, {
      studentId: "student-1",
      threadId: "lifecycle-thread",
    })).ok,
    true,
  );

  const trashed = await trashQnaThreadAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "lifecycle-thread",
    operationId: operationId(2),
    baseRevision: 1,
    now: new Date("2026-01-02T00:00:00.000Z"),
  });
  assert.equal(trashed.ok, true);
  assert.equal(countRows(sqlite, "qna_replies", "thread_id", "lifecycle-thread"), 1);
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "lifecycle-thread"), 2);

  const restored = await restoreTrashedQnaThreadAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "lifecycle-thread",
    operationId: operationId(3),
    baseRevision: 2,
    now: new Date("2026-01-03T00:00:00.000Z"),
  });
  assert.equal(restored.ok, true);

  const trashedAgain = await trashQnaThreadAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "lifecycle-thread",
    operationId: operationId(4),
    baseRevision: 3,
    now: new Date("2026-01-04T00:00:00.000Z"),
  });
  assert.equal(trashedAgain.ok, true);

  const purged = await purgeQnaThreadAtomically(dbContext, {
    actor: actor("admin-1", true),
    threadId: "lifecycle-thread",
    operationId: operationId(5),
    baseRevision: 4,
    now: new Date("2026-02-04T00:00:01.000Z"),
  });
  assert.equal(purged.ok, true);
  assert.equal(countRows(sqlite, "qna_threads", "id", "lifecycle-thread"), 0);
  assert.equal(countRows(sqlite, "qna_replies", "thread_id", "lifecycle-thread"), 0);
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "lifecycle-thread"), 0);
  assert.equal(
    sqlite
      .prepare<[], { value: number }>(
        "SELECT count(*) AS value FROM document_tombstones WHERE resource_type = 'QNA_THREAD' AND resource_id = 'lifecycle-thread'",
      )
      .get()?.value,
    1,
  );
});

test("가이드 구간 질문은 같은 batch에서 위치를 남기고 다른 위치의 재전송을 거부한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  sqlite
    .prepare("INSERT INTO guide_pages (id, title, content_html) VALUES (?, ?, ?)")
    .run("guide-1", "장비 소개", '<p data-block-id="b1">CDJ</p>');
  const write = {
    actor: actor("student-1"),
    threadId: "guide-thread",
    replyId: "guide-thread-question",
    operationId: operationId(9001),
    title: "CDJ 질문",
    contentHtml: "<p>질문</p>",
    attachmentUrl: null,
    attachmentObjectId: null,
    guideAnchor: { guidePageId: "guide-1", pageTitle: "장비 소개", blockId: "b1", quote: "CDJ" },
    now: new Date("2026-01-01T00:00:00.000Z"),
  };

  const created = await createQnaThreadAtomically(dbContext, write);
  assert.equal(created.ok, true);
  assert.deepEqual(
    sqlite.prepare("SELECT guide_page_id, page_title, anchor_block_id, anchor_quote FROM qna_guide_anchors").all(),
    [{ guide_page_id: "guide-1", page_title: "장비 소개", anchor_block_id: "b1", anchor_quote: "CDJ" }],
  );

  const replayed = await createQnaThreadAtomically(dbContext, write);
  assert.equal(replayed.ok && replayed.replayed, true);

  const moved = await createQnaThreadAtomically(dbContext, {
    ...write,
    guideAnchor: { ...write.guideAnchor, blockId: "b2" },
  });
  assert.deepEqual(moved.ok ? null : moved.reason, "OPERATION_PAYLOAD_CONFLICT");

  const withoutAnchor = await createQnaThreadAtomically(dbContext, { ...write, guideAnchor: null });
  assert.deepEqual(withoutAnchor.ok ? null : withoutAnchor.reason, "OPERATION_PAYLOAD_CONFLICT");
});

test("질문 작성 중 가이드 페이지가 지워져도 질문과 인용은 남는다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const created = await createQnaThreadAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "orphan-thread",
    replyId: "orphan-thread-question",
    operationId: operationId(9002),
    title: "지워진 페이지 질문",
    contentHtml: "<p>질문</p>",
    attachmentUrl: null,
    attachmentObjectId: null,
    guideAnchor: { guidePageId: "deleted-page", pageTitle: "음원 관리", blockId: null, quote: "폴더 정리" },
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(created.ok, true);
  assert.deepEqual(
    sqlite.prepare("SELECT guide_page_id, page_title, anchor_quote FROM qna_guide_anchors").all(),
    [{ guide_page_id: null, page_title: "음원 관리", anchor_quote: "폴더 정리" }],
  );
});

async function seedAnsweredThread(
  sqlite: SqliteDatabase,
  dbContext: LocalDbContext,
  threadId: string,
) {
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "student-2");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal((await createThread(dbContext, { studentId: "student-1", threadId })).ok, true);
  const answered = await createQnaReplyAtomically(dbContext, {
    actor: actor("admin-1", true),
    threadId,
    replyId: `${threadId}-answer`,
    operationId: operationId(operationSequence++),
    contentHtml: "<p>답변</p>",
    attachmentUrl: null,
    attachmentObjectId: null,
    now: new Date("2026-01-01T00:01:00.000Z"),
  });
  assert.equal(answered.ok, true);
}

test("질문 작성 학생은 답변받은(ANSWERED) 자기 질문을 해결됨으로 닫고 재전송은 replay된다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  await seedAnsweredThread(sqlite, dbContext, "author-close");
  const write = {
    actor: actor("student-1"),
    threadId: "author-close",
    operationId: operationId(900),
    baseRevision: 2,
    status: "CLOSED" as const,
    now: new Date("2026-01-01T00:02:00.000Z"),
  };
  const result = await setQnaStatusAtomically(dbContext, write);
  assert.equal(result.ok, true);
  assert.deepEqual(getThread(sqlite, "author-close"), { status: "CLOSED", version: 3, deleted_at: null });
  assert.equal(countRows(sqlite, "qna_thread_events", "thread_id", "author-close"), 3);

  const replay = await setQnaStatusAtomically(dbContext, write);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.replayed, true);
  assert.equal(getThread(sqlite, "author-close")?.version, 3);
});

test("학생은 OPEN 질문을 닫거나 CLOSED 외 상태를 정할 수 없다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  assert.equal((await createThread(dbContext, { studentId: "student-1", threadId: "open-close" })).ok, true);

  const closeOpen = await setQnaStatusAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "open-close",
    operationId: operationId(910),
    baseRevision: 1,
    status: "CLOSED",
    now: new Date("2026-01-01T00:02:00.000Z"),
  });
  assert.equal(closeOpen.ok, false);
  if (!closeOpen.ok) assert.equal(closeOpen.reason, "STATUS_TRANSITION_FORBIDDEN");

  const setAnswered = await setQnaStatusAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "open-close",
    operationId: operationId(911),
    baseRevision: 1,
    status: "ANSWERED",
    now: new Date("2026-01-01T00:02:00.000Z"),
  });
  assert.equal(setAnswered.ok, false);
  if (!setAnswered.ok) assert.equal(setAnswered.reason, "NOT_FOUND_OR_FORBIDDEN");
  assert.deepEqual(getThread(sqlite, "open-close"), { status: "OPEN", version: 1, deleted_at: null });
  assert.equal(countRows(sqlite, "document_operation_ledger", "operation_id", operationId(910)), 0);
});

test("다른 학생은 답변받은 남의 질문을 닫을 수 없다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  await seedAnsweredThread(sqlite, dbContext, "other-close");
  const result = await setQnaStatusAtomically(dbContext, {
    actor: actor("student-2"),
    threadId: "other-close",
    operationId: operationId(920),
    baseRevision: 2,
    status: "CLOSED",
    now: new Date("2026-01-01T00:02:00.000Z"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "NOT_FOUND_OR_FORBIDDEN");
  assert.deepEqual(getThread(sqlite, "other-close"), { status: "ANSWERED", version: 2, deleted_at: null });
});

test("관리자 상태 변경은 그대로 OPEN·ANSWERED·CLOSED 어디로든 가능하다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  assert.equal((await createThread(dbContext, { studentId: "student-1", threadId: "admin-status" })).ok, true);
  const steps = ["CLOSED", "OPEN", "ANSWERED"] as const;
  for (const [index, status] of steps.entries()) {
    const result = await setQnaStatusAtomically(dbContext, {
      actor: actor("admin-1", true),
      threadId: "admin-status",
      operationId: operationId(930 + index),
      baseRevision: index + 1,
      status,
      now: new Date("2026-01-01T00:02:00.000Z"),
    });
    assert.equal(result.ok, true);
    assert.equal(getThread(sqlite, "admin-status")?.status, status);
  }
});

test("학생이 닫은 질문의 SET_STATUS replay는 다른 학생 actor로 통과하지 않는다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  await seedAnsweredThread(sqlite, dbContext, "closed-by-author");
  assert.equal(
    (await setQnaStatusAtomically(dbContext, {
      actor: actor("student-1"),
      threadId: "closed-by-author",
      operationId: operationId(940),
      baseRevision: 2,
      status: "CLOSED",
      now: new Date("2026-01-01T00:02:00.000Z"),
    })).ok,
    true,
  );
  // 학생 SET_STATUS replay가 다른 학생 actor로는 통과하지 않는다.
  const foreignReplay = await setQnaStatusAtomically(dbContext, {
    actor: actor("student-2"),
    threadId: "closed-by-author",
    operationId: operationId(940),
    baseRevision: 2,
    status: "CLOSED",
    now: new Date("2026-01-01T00:02:00.000Z"),
  });
  assert.equal(foreignReplay.ok, false);
});

test("질문 작성 학생은 닫은 자기 질문을 다시 열고 다른 학생은 열 수 없다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  await seedAnsweredThread(sqlite, dbContext, "author-reopen");
  const at = new Date("2026-01-01T00:02:00.000Z");
  const close = await setQnaStatusAtomically(dbContext, {
    actor: actor("student-1"), threadId: "author-reopen", operationId: operationId(950), baseRevision: 2, status: "CLOSED", now: at,
  });
  assert.equal(close.ok, true);

  const foreign = await setQnaStatusAtomically(dbContext, {
    actor: actor("student-2"), threadId: "author-reopen", operationId: operationId(951), baseRevision: 3, status: "OPEN", now: at,
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.reason, "NOT_FOUND_OR_FORBIDDEN");
  assert.deepEqual(getThread(sqlite, "author-reopen"), { status: "CLOSED", version: 3, deleted_at: null });

  const reopenWrite = {
    actor: actor("student-1"), threadId: "author-reopen", operationId: operationId(952), baseRevision: 3, status: "OPEN" as const, now: at,
  };
  const reopen = await setQnaStatusAtomically(dbContext, reopenWrite);
  assert.equal(reopen.ok, true);
  assert.deepEqual(getThread(sqlite, "author-reopen"), { status: "OPEN", version: 4, deleted_at: null });
  const replay = await setQnaStatusAtomically(dbContext, reopenWrite);
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.replayed, true);
  assert.equal(getThread(sqlite, "author-reopen")?.version, 4);

  // 다시 연 질문에는 추가 질문을 쓸 수 있다.
  const followUp = await createQnaReplyAtomically(dbContext, {
    actor: actor("student-1"),
    threadId: "author-reopen",
    replyId: "author-reopen-follow-up",
    operationId: operationId(953),
    contentHtml: "<p>추가 질문</p>",
    attachmentUrl: null,
    attachmentObjectId: null,
    now: at,
  });
  assert.equal(followUp.ok, true);
});

test("학생은 답변받은(ANSWERED) 질문을 OPEN으로 되돌릴 수 없고 관리자 상태 변경은 그대로다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  await seedAnsweredThread(sqlite, dbContext, "answered-reopen");
  const at = new Date("2026-01-01T00:02:00.000Z");
  const reopen = await setQnaStatusAtomically(dbContext, {
    actor: actor("student-1"), threadId: "answered-reopen", operationId: operationId(960), baseRevision: 2, status: "OPEN", now: at,
  });
  assert.equal(reopen.ok, false);
  if (!reopen.ok) assert.equal(reopen.reason, "STATUS_TRANSITION_FORBIDDEN");
  assert.deepEqual(getThread(sqlite, "answered-reopen"), { status: "ANSWERED", version: 2, deleted_at: null });

  assert.equal(isQnaStatusTransitionAllowed({ isAdmin: true, from: "ANSWERED", to: "OPEN" }), true);
  assert.equal(isQnaStatusTransitionAllowed({ isAdmin: false, from: "CLOSED", to: "OPEN" }), true);
  assert.equal(isQnaStatusTransitionAllowed({ isAdmin: false, from: "OPEN", to: "OPEN" }), false);
  assert.equal(canSetQnaStatus(actor("student-1"), "student-1", "OPEN"), true);
  assert.equal(canSetQnaStatus(actor("student-2"), "student-1", "OPEN"), false);
  assert.equal(canSetQnaStatus(actor("student-1"), "student-1", "ANSWERED"), false);
  assert.equal(canSetQnaStatus(actor("admin-1", true), "student-1", "ANSWERED"), true);
});

test("관리자가 휴지통으로 보낸 질문은 관리자만 되살리고, 학생이 지운 질문은 학생이 되살린다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  for (const threadId of ["admin-trashed", "self-trashed"]) {
    assert.equal((await createThread(dbContext, { studentId: "student-1", threadId })).ok, true);
  }
  assert.equal(
    (await trashQnaThreadAtomically(dbContext, {
      actor: actor("admin-1", true), threadId: "admin-trashed", operationId: operationId(980), baseRevision: 1, now: new Date("2026-01-02T00:00:00.000Z"),
    })).ok,
    true,
  );
  assert.equal(
    (await trashQnaThreadAtomically(dbContext, {
      actor: actor("student-1"), threadId: "self-trashed", operationId: operationId(981), baseRevision: 1, now: new Date("2026-01-02T00:00:00.000Z"),
    })).ok,
    true,
  );
  const at = new Date("2026-01-03T00:00:00.000Z");

  const blocked = await restoreTrashedQnaThreadAtomically(dbContext, {
    actor: actor("student-1"), threadId: "admin-trashed", operationId: operationId(982), baseRevision: 2, now: at,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, "NOT_FOUND_OR_FORBIDDEN");
  assert.equal(getThread(sqlite, "admin-trashed")?.version, 2);
  assert.notEqual(getThread(sqlite, "admin-trashed")?.deleted_at, null);
  assert.equal(countRows(sqlite, "document_operation_ledger", "operation_id", operationId(982)), 0);

  const self = await restoreTrashedQnaThreadAtomically(dbContext, {
    actor: actor("student-1"), threadId: "self-trashed", operationId: operationId(983), baseRevision: 2, now: at,
  });
  assert.equal(self.ok, true);

  const byAdmin = await restoreTrashedQnaThreadAtomically(dbContext, {
    actor: actor("admin-1", true), threadId: "admin-trashed", operationId: operationId(984), baseRevision: 2, now: at,
  });
  assert.equal(byAdmin.ok, true);
  assert.deepEqual(getThread(sqlite, "admin-trashed"), { status: "OPEN", version: 3, deleted_at: null });
});
