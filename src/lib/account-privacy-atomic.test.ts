import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import {
  ACCOUNT_CLEANUP_TOKEN_LIMIT,
  deleteStudentAccountAtomically,
  findAccountDeletionByCleanupTokenDigest,
  processDueAccountRawIdErasures,
  registerAccountCleanupTokenAtomically,
} from "./account-privacy-atomic";
import {
  MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
  MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
} from "./media-lifecycle";

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
  role: "student" | "admin" = "student",
): void {
  sqlite
    .prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, ?)")
    .run(id, `${id}@example.com`, role);
}

function digest(character: string): string {
  return character.repeat(64);
}

function operationId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function countRows(
  sqlite: SqliteDatabase,
  query: string,
  ...params: unknown[]
): number {
  return (
    sqlite
      .prepare<unknown[], { value: number }>(query)
      .get(...params)?.value ?? 0
  );
}

test("cleanup token은 무기한 ACTIVE로 등록되고 exact replay와 quota를 지킨다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-token");
  seedProfile(sqlite, "admin-token", "admin");
  const now = new Date("2026-01-01T00:00:00.000Z");

  assert.deepEqual(
    await registerAccountCleanupTokenAtomically(dbContext, {
      ownerId: "student-token",
      tokenDigest: digest("a"),
      now,
    }),
    { ok: true, status: "REGISTERED" },
  );
  assert.deepEqual(
    await registerAccountCleanupTokenAtomically(dbContext, {
      ownerId: "student-token",
      tokenDigest: digest("a"),
      now: new Date("2036-01-01T00:00:00.000Z"),
    }),
    { ok: true, status: "REPLAYED" },
  );
  assert.deepEqual(
    await registerAccountCleanupTokenAtomically(dbContext, {
      ownerId: "admin-token",
      tokenDigest: digest("b"),
      now,
    }),
    { ok: false, reason: "STUDENT_NOT_FOUND" },
  );
  assert.deepEqual(
    await registerAccountCleanupTokenAtomically(dbContext, {
      ownerId: "student-token",
      tokenDigest: "not-a-digest",
      now,
    }),
    { ok: false, reason: "INVALID_TOKEN_DIGEST" },
  );

  const insertToken = sqlite.prepare(`
    INSERT INTO account_cleanup_tokens (
      token_digest, subject_id, status, created_at, updated_at
    ) VALUES (?, 'student-token', 'ACTIVE', 1704067200, 1704067200)
  `);
  for (let index = 1; index < ACCOUNT_CLEANUP_TOKEN_LIMIT; index += 1) {
    insertToken.run(index.toString(16).padStart(64, "0"));
  }
  assert.deepEqual(
    await registerAccountCleanupTokenAtomically(dbContext, {
      ownerId: "student-token",
      tokenDigest: digest("f"),
      now,
    }),
    { ok: false, reason: "TOKEN_QUOTA_EXCEEDED" },
  );
});

test("student-only 삭제는 initiating token을 요구하고 admin/profile을 보존한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-precondition");
  seedProfile(sqlite, "admin-precondition", "admin");
  const now = new Date("2026-01-01T00:00:00.000Z");

  assert.deepEqual(
    await deleteStudentAccountAtomically(dbContext, {
      actorId: "student-precondition",
      operationId: operationId(1),
      initiatingCleanupTokenDigest: digest("a"),
      now,
    }),
    { ok: false, reason: "CLEANUP_TOKEN_NOT_ACTIVE" },
  );
  assert.deepEqual(
    await deleteStudentAccountAtomically(dbContext, {
      actorId: "admin-precondition",
      operationId: operationId(2),
      initiatingCleanupTokenDigest: digest("b"),
      now,
    }),
    { ok: false, reason: "ADMIN_FORBIDDEN" },
  );
  sqlite.exec(`
    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, draft_operation_id,
      upload_expires_at, created_at, updated_at
    ) VALUES (
      '10000000-0000-4000-8000-000000000099', 'student-precondition',
      'COMMUNITY_POST_AUDIO',
      'media/community-post-audio/11000000-0000-4000-8000-000000000099',
      'media-upload/community-post-audio/10000000-0000-4000-8000-000000000099',
      'PENDING_UPLOAD', 'audio/mpeg', 1024,
      '${operationId(99)}', 1767229200, 1767225600, 1767225600
    );
    UPDATE media_objects
    SET state = 'SEALING', seal_lease_id = 'active-account-seal',
        seal_lease_expires_at = 1767226500, updated_at = 1767225601
    WHERE id = '10000000-0000-4000-8000-000000000099';
  `);
  assert.deepEqual(
    await deleteStudentAccountAtomically(dbContext, {
      actorId: "student-precondition",
      operationId: operationId(3),
      initiatingCleanupTokenDigest: digest("c"),
      useEphemeralCleanupDigest: true,
      now: new Date("2026-01-01T00:00:10.000Z"),
    }),
    { ok: false, reason: "ACTIVE_MEDIA_SEAL" },
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM account_cleanup_tokens WHERE token_digest = ?",
      digest("c"),
    ),
    0,
  );
  assert.equal(countRows(sqlite, "SELECT count(*) AS value FROM profiles"), 2);
  assert.throws(
    () => sqlite.prepare("DELETE FROM profiles WHERE id = ?").run("student-precondition"),
    /DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED/u,
  );
});

test("계정 삭제는 owned/cross-resource payload와 media를 한 transaction에서 정리한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "delete-student");
  seedProfile(sqlite, "other-student");
  seedProfile(sqlite, "admin-owner", "admin");
  const now = new Date("2026-01-01T00:00:00.000Z");
  const deletionNow = new Date("2026-01-01T00:00:10.000Z");
  const hash = digest("c");
  const snapshotHash = digest("d");
  const mediaId = "10000000-0000-4000-8000-000000000001";
  const expiredSealingMediaId = "10000000-0000-4000-8000-000000000002";
  const crossOwnerMediaId = "10000000-0000-4000-8000-000000000003";

  assert.equal(
    (
      await registerAccountCleanupTokenAtomically(dbContext, {
        ownerId: "delete-student",
        tokenDigest: digest("a"),
        now,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await registerAccountCleanupTokenAtomically(dbContext, {
        ownerId: "delete-student",
        tokenDigest: digest("b"),
        now,
      })
    ).ok,
    true,
  );

  sqlite.exec(`
    INSERT INTO calendar_feed_tokens (owner_id, token_digest, created_at, updated_at)
    VALUES ('delete-student', '${digest("e")}', 1767225600, 1767225600);
    INSERT INTO curriculums (id, student_id, week_num, title)
    VALUES ('delete-curriculum', 'delete-student', 1, 'Delete');
    INSERT INTO lessons (id, student_id, scheduled_at)
    VALUES ('delete-lesson', 'delete-student', 1767225600);
    INSERT INTO assignments (id, student_id, media_url)
    VALUES ('delete-assignment', 'delete-student', 'https://legacy.example/a.mp3');
    INSERT INTO feedbacks (id, assignment_id, time_marker, content)
    VALUES ('delete-feedback', 'delete-assignment', 1, 'feedback');
    INSERT INTO digging_columns (id, user_id, name, column_type)
    VALUES ('delete-column', 'delete-student', 'Title', 'text');
    INSERT INTO digging_tracks (id, user_id, "values")
    VALUES ('delete-track', 'delete-student', '{}');
    INSERT INTO calendar_events (id, user_id, title, start_time)
    VALUES ('delete-event', 'delete-student', 'Delete', 1767225600);

    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'delete-note-ledger', '${operationId(10)}', 'delete-student', 'delete-student',
      'PRIVATE_NOTE', 'CREATE', 'delete-note', '${hash}', 1, 1, 1767225600
    );
    INSERT INTO private_notes (
      id, student_id, author_id, title, content_html, created_at, updated_at, version
    ) VALUES (
      'delete-note', 'delete-student', 'delete-student', 'Delete', '<p>Delete</p>',
      1767225600, 1767225600, 1
    );
    INSERT INTO private_note_revisions (
      id, note_id, revision_number, change_type, title, content_html,
      snapshot_hash, snapshot_hash_version, actor_id, operation_record_id, created_at
    ) VALUES (
      'delete-note-revision', 'delete-note', 1, 'CREATE', 'Delete', '<p>Delete</p>',
      '${snapshotHash}', 1, 'delete-student', 'delete-note-ledger', 1767225600
    );
    INSERT INTO document_tombstones (
      resource_type, resource_id, subject_id, owner_id,
      source_version, purged_at, purged_by_id
    ) VALUES (
      'PRIVATE_NOTE', 'delete-standalone-tombstone', 'delete-student',
      'delete-student', 1, 1767225600, 'delete-student'
    );

    INSERT INTO posts (
      id, author_id, category, board_type, title, content_html,
      created_at, updated_at, version
    ) VALUES
      ('delete-own-post', 'delete-student', 'general', 'GENERAL', 'Own', '<p>Own</p>', 1767225600, 1767225600, 1),
      ('delete-other-post', 'other-student', 'general', 'GENERAL', 'Other', '<p>Other</p>', 1767225600, 1767225600, 1);
    INSERT INTO comments (id, post_id, author_id, content_html, created_at)
    VALUES
      ('delete-own-comment', 'delete-other-post', 'delete-student', '<p>Mine</p>', 1767225600),
      ('delete-other-comment', 'delete-own-post', 'other-student', '<p>Other</p>', 1767225600);
    UPDATE posts SET deleted_at = 1767225601, deleted_by_id = 'other-student'
    WHERE id = 'delete-other-post';

    INSERT INTO qna_threads (
      id, student_id, title, status, created_at, updated_at, version
    ) VALUES
      ('delete-own-thread', 'delete-student', 'Own', 'OPEN', 1767225600, 1767225600, 1),
      ('delete-other-thread', 'other-student', 'Other', 'OPEN', 1767225600, 1767225600, 1);
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'delete-cross-reply-ledger', '${operationId(11)}', 'delete-student', 'other-student',
      'QNA_THREAD', 'CREATE', 'delete-other-thread', '${hash}', 1, 1, 1767225600
    );
    INSERT INTO qna_replies (id, thread_id, author_id, content_html, created_at)
    VALUES ('delete-cross-reply', 'delete-other-thread', 'delete-student', '<p>Mine</p>', 1767225600);
    INSERT INTO qna_thread_events (
      id, thread_id, event_number, event_type, title, status, reply_id,
      event_hash, event_hash_version, actor_id, operation_record_id, created_at
    ) VALUES (
      'delete-cross-event', 'delete-other-thread', 1, 'CREATE', 'Other', 'OPEN',
      'delete-cross-reply', '${snapshotHash}', 1, 'delete-student',
      'delete-cross-reply-ledger', 1767225600
    );

    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, draft_operation_id,
      upload_expires_at, created_at, updated_at
    ) VALUES (
      '${crossOwnerMediaId}', 'admin-owner', 'QNA_ATTACHMENT',
      'media/qna-attachment/11000000-0000-4000-8000-000000000003',
      'media-upload/qna-attachment/${crossOwnerMediaId}', 'PENDING_UPLOAD',
      'image/jpeg', 1024, '${operationId(13)}',
      1767229200, 1767225600, 1767225600
    );
    UPDATE media_objects
    SET state = 'SEALING', seal_lease_id = 'cross-owner-seal',
        seal_lease_expires_at = 1767225700, updated_at = 1767225601
    WHERE id = '${crossOwnerMediaId}';
    INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'cross-owner-staging', '${crossOwnerMediaId}',
      'media-upload/qna-attachment/${crossOwnerMediaId}',
      'UPLOAD_STAGING_EXPIRED', 1767225700, 0, 1767225700,
      1767225602, 1767225602
    );
    UPDATE media_objects
    SET state = 'READY', seal_lease_id = NULL, seal_lease_expires_at = NULL,
        actual_size_bytes = 1024, etag = 'cross-owner-etag',
        ready_at = 1767225602, updated_at = 1767225602
    WHERE id = '${crossOwnerMediaId}';
    UPDATE media_objects
    SET state = 'ATTACHED', resource_type = 'QNA_REPLY',
        resource_id = 'delete-admin-reply', attached_at = 1767225603,
        updated_at = 1767225603
    WHERE id = '${crossOwnerMediaId}';
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'delete-admin-reply-ledger', '${operationId(14)}', 'admin-owner',
      'delete-student', 'QNA_THREAD', 'CREATE', 'delete-own-thread',
      '${hash}', 2, 1, 1767225603
    );
    INSERT INTO qna_replies (
      id, thread_id, author_id, content_html, attachment_url,
      attachment_object_id, created_at
    ) VALUES (
      'delete-admin-reply', 'delete-own-thread', 'admin-owner', '<p>Admin</p>',
      '/api/media/${crossOwnerMediaId}', '${crossOwnerMediaId}', 1767225603
    );
    INSERT INTO qna_thread_events (
      id, thread_id, event_number, event_type, title, status, reply_id,
      event_hash, event_hash_version, actor_id, operation_record_id, created_at
    ) VALUES (
      'delete-admin-event', 'delete-own-thread', 1, 'CREATE', 'Own', 'OPEN',
      'delete-admin-reply', '${snapshotHash}', 2, 'admin-owner',
      'delete-admin-reply-ledger', 1767225603
    );

    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, draft_operation_id,
      upload_expires_at, created_at, updated_at
    ) VALUES (
      '${mediaId}', 'delete-student', 'COMMUNITY_POST_AUDIO',
      'media/community-post-audio/11000000-0000-4000-8000-000000000001',
      'media-upload/community-post-audio/${mediaId}', 'PENDING_UPLOAD',
      'audio/mpeg', 1024, '${operationId(12)}', 1767229200, 1767225600, 1767225600
    );
    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, draft_operation_id,
      upload_expires_at, created_at, updated_at
    ) VALUES (
      '${expiredSealingMediaId}', 'delete-student', 'COMMUNITY_POST_AUDIO',
      'media/community-post-audio/11000000-0000-4000-8000-000000000002',
      'media-upload/community-post-audio/${expiredSealingMediaId}', 'PENDING_UPLOAD',
      'audio/mpeg', 1024, '${operationId(15)}', 1767229200, 1767225600, 1767225600
    );
    UPDATE media_objects
    SET state = 'SEALING', seal_lease_id = 'expired-account-seal',
        seal_lease_expires_at = 1767225605, updated_at = 1767225601
    WHERE id = '${expiredSealingMediaId}';
  `);

  const result = await deleteStudentAccountAtomically(dbContext, {
    actorId: "delete-student",
    operationId: operationId(20),
    initiatingCleanupTokenDigest: digest("a"),
    now: deletionNow,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.status, "DELETED");

  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM profiles WHERE id = 'delete-student'",
    ),
    0,
  );
  for (const table of [
    "curriculums",
    "lessons",
    "assignments",
    "feedbacks",
    "digging_columns",
    "digging_tracks",
    "calendar_events",
    "private_notes",
  ]) {
    assert.equal(
      countRows(
        sqlite,
        `SELECT count(*) AS value FROM ${table} WHERE id LIKE 'delete-%'`,
      ),
      0,
      table,
    );
  }
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM calendar_feed_tokens WHERE owner_id = 'delete-student'",
    ),
    0,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM comments WHERE author_id = 'delete-student'",
    ),
    0,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM qna_replies WHERE author_id = 'delete-student'",
    ),
    0,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM posts WHERE id = 'delete-other-post'",
    ),
    1,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM qna_threads WHERE id = 'delete-other-thread'",
    ),
    1,
  );
  assert.deepEqual(
    sqlite
      .prepare<[string], { owner_id: string | null; state: string }>(
        "SELECT owner_id, state FROM media_objects WHERE id = ?",
      )
      .get(mediaId),
    { owner_id: null, state: "PENDING_DELETE" },
  );
  assert.deepEqual(
    sqlite
      .prepare<[string], { owner_id: string | null; state: string }>(
        "SELECT owner_id, state FROM media_objects WHERE id = ?",
      )
      .get(crossOwnerMediaId),
    { owner_id: "admin-owner", state: "PENDING_DELETE" },
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM media_deletion_outbox WHERE media_object_id = ?",
      mediaId,
    ),
    2,
  );
  assert.deepEqual(
    sqlite
      .prepare<
        [string],
        { reason: string; not_before: number; next_attempt_at: number }
      >(`
        SELECT reason, not_before, next_attempt_at
        FROM media_deletion_outbox
        WHERE media_object_id = ? AND object_key LIKE 'media-upload/%'
      `)
      .get(mediaId),
    {
      reason: "UPLOAD_STAGING_EXPIRED",
      not_before: 1767229200 + MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
      next_attempt_at: 1767229200 + MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
    },
  );
  assert.deepEqual(
    sqlite
      .prepare<
        [string],
        { reason: string; not_before: number; next_attempt_at: number }
      >(`
        SELECT reason, not_before, next_attempt_at
        FROM media_deletion_outbox
        WHERE media_object_id = ? AND object_key LIKE 'media/%'
      `)
      .get(expiredSealingMediaId),
    {
      reason: "ACCOUNT_DELETION",
      not_before: 1767225605 + MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
      next_attempt_at: 1767225605 + MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
    },
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM media_deletion_outbox WHERE media_object_id = ?",
      crossOwnerMediaId,
    ),
    2,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM account_cleanup_tokens WHERE status = 'BOUND'",
    ),
    2,
  );
  assert.equal(
    sqlite
      .prepare<[string], { status: string }>(
        "SELECT status FROM account_deletion_jobs WHERE id = ?",
      )
      .get(result.deletionJobId)?.status,
    "ERASED",
  );
  assert.deepEqual(
    await findAccountDeletionByCleanupTokenDigest(dbContext, digest("a")),
    {
      tokenStatus: "BOUND",
      deletionStatus: "ERASED",
      requestedAt: deletionNow,
      erasedAt: deletionNow,
      aliasedAt: null,
    },
  );

  const replay = await deleteStudentAccountAtomically(dbContext, {
    actorId: "delete-student",
    operationId: operationId(20),
    initiatingCleanupTokenDigest: digest("a"),
    now: new Date(deletionNow.getTime() + 10_000),
  });
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.status, "REPLAYED");
  assert.deepEqual(
    await deleteStudentAccountAtomically(dbContext, {
      actorId: "delete-student",
      operationId: operationId(20),
      initiatingCleanupTokenDigest: digest("b"),
      now,
    }),
    { ok: false, reason: "OPERATION_PAYLOAD_CONFLICT" },
  );

  assert.deepEqual(
    await processDueAccountRawIdErasures(dbContext, {
      now: new Date("2026-01-30T00:00:00.000Z"),
      limit: 10,
    }),
    { processed: 0, skipped: 0 },
  );
  assert.deepEqual(
    await processDueAccountRawIdErasures(dbContext, {
      now: new Date("2026-02-01T00:00:01.000Z"),
      limit: 10,
    }),
    { processed: 1, skipped: 0 },
  );

  const aliasedJob = sqlite
    .prepare<
      [string],
      { subject_id: string | null; erasure_alias: string; status: string }
    >(
      "SELECT subject_id, erasure_alias, status FROM account_deletion_jobs WHERE id = ?",
    )
    .get(result.deletionJobId);
  assert.ok(aliasedJob);
  assert.equal(aliasedJob.subject_id, null);
  assert.equal(aliasedJob.status, "ALIASED");
  assert.match(aliasedJob.erasure_alias, /^erased:[0-9a-f-]{36}$/u);
  assert.deepEqual(
    sqlite
      .prepare<
        [],
        { subject_id: string; owner_id: string; purged_by_id: string }
      >(`
        SELECT subject_id, owner_id, purged_by_id
        FROM document_tombstones
        WHERE resource_id = 'delete-standalone-tombstone'
      `)
      .get(),
    {
      subject_id: aliasedJob.erasure_alias,
      owner_id: aliasedJob.erasure_alias,
      purged_by_id: aliasedJob.erasure_alias,
    },
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM document_operation_ledger WHERE actor_id = 'delete-student' OR subject_id = 'delete-student'",
    ),
    0,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM document_tombstones WHERE subject_id = 'delete-student' OR owner_id = 'delete-student' OR purged_by_id = 'delete-student'",
    ),
    0,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM account_cleanup_tokens WHERE subject_id IS NOT NULL OR status <> 'ERASED'",
    ),
    0,
  );
  assert.equal(
    countRows(sqlite, "SELECT count(*) AS value FROM pragma_foreign_key_check"),
    0,
  );
});

test("quota가 가득 차도 ephemeral job digest로 삭제·상태 조회·exact replay가 수렴한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "ephemeral-student");
  const insertToken = sqlite.prepare(`
    INSERT INTO account_cleanup_tokens (
      token_digest, subject_id, status, created_at, updated_at
    ) VALUES (?, 'ephemeral-student', 'ACTIVE', 1767225600, 1767225600)
  `);
  const registeredDigests: string[] = [];
  for (let index = 0; index < ACCOUNT_CLEANUP_TOKEN_LIMIT; index += 1) {
    const tokenDigest = index.toString(16).padStart(64, "0");
    registeredDigests.push(tokenDigest);
    insertToken.run(tokenDigest);
  }
  const deletionNow = new Date("2026-01-01T00:00:00.000Z");
  const result = await deleteStudentAccountAtomically(dbContext, {
    actorId: "ephemeral-student",
    operationId: operationId(30),
    initiatingCleanupTokenDigest: digest("e"),
    useEphemeralCleanupDigest: true,
    now: deletionNow,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.status, "DELETED");
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM profiles WHERE id = 'ephemeral-student'",
    ),
    0,
  );
  assert.deepEqual(
    sqlite
      .prepare<
        [string],
        {
          initiating_token_digest: string;
          initiating_token_mode: string;
          status: string;
        }
      >(`
        SELECT initiating_token_digest, initiating_token_mode, status
        FROM account_deletion_jobs WHERE id = ?
      `)
      .get(result.deletionJobId),
    {
      initiating_token_digest: digest("e"),
      initiating_token_mode: "EPHEMERAL",
      status: "ERASED",
    },
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM account_cleanup_tokens WHERE token_digest = ?",
      digest("e"),
    ),
    0,
  );
  assert.equal(
    countRows(
      sqlite,
      `SELECT count(*) AS value FROM account_cleanup_tokens
       WHERE deletion_job_id = ? AND status = 'BOUND'`,
      result.deletionJobId,
    ),
    ACCOUNT_CLEANUP_TOKEN_LIMIT,
  );
  assert.deepEqual(
    await findAccountDeletionByCleanupTokenDigest(dbContext, digest("e")),
    {
      tokenStatus: null,
      deletionStatus: "ERASED",
      requestedAt: deletionNow,
      erasedAt: deletionNow,
      aliasedAt: null,
    },
  );
  assert.equal(
    (await findAccountDeletionByCleanupTokenDigest(
      dbContext,
      registeredDigests[0]!,
    ))?.tokenStatus,
    "BOUND",
  );
  const replay = await deleteStudentAccountAtomically(dbContext, {
    actorId: "ephemeral-student",
    operationId: operationId(30),
    initiatingCleanupTokenDigest: digest("e"),
    useEphemeralCleanupDigest: true,
    now: new Date("2026-01-01T00:00:01.000Z"),
  });
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.status, "REPLAYED");

  for (const recursiveTriggers of ["OFF", "ON"] as const) {
    sqlite.pragma(`recursive_triggers = ${recursiveTriggers}`);
    assert.throws(
      () => sqlite.exec(`
        INSERT OR REPLACE INTO profiles (id, email, role)
        VALUES ('ephemeral-student', 'ephemeral-student@example.com', 'student');
      `),
      /PROFILE_ERASED_ID_REUSE_BLOCKED/u,
    );
  }
  sqlite.pragma("recursive_triggers = OFF");
  assert.deepEqual(
    await processDueAccountRawIdErasures(dbContext, {
      now: new Date("2026-02-01T00:00:01.000Z"),
      limit: 10,
    }),
    { processed: 1, skipped: 0 },
  );
  seedProfile(sqlite, "ephemeral-student");
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM profiles WHERE id = 'ephemeral-student'",
    ),
    1,
  );
  const aliasedReplay = await deleteStudentAccountAtomically(dbContext, {
    actorId: "ephemeral-student",
    operationId: operationId(30),
    initiatingCleanupTokenDigest: digest("e"),
    useEphemeralCleanupDigest: true,
    now: new Date("2026-02-01T00:00:02.000Z"),
  });
  assert.equal(aliasedReplay.ok, true);
  if (aliasedReplay.ok) assert.equal(aliasedReplay.status, "REPLAYED");
  assert.deepEqual(
    await registerAccountCleanupTokenAtomically(dbContext, {
      ownerId: "ephemeral-student",
      tokenDigest: digest("e"),
      now: new Date("2026-02-01T00:00:03.000Z"),
    }),
    { ok: false, reason: "TOKEN_DIGEST_CONFLICT" },
  );
});

test("ephemeral receipt의 job batch 실패는 profile과 digest namespace를 보존한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "ephemeral-rollback");
  sqlite.exec(`
    CREATE TRIGGER force_ephemeral_job_abort
    BEFORE INSERT ON account_deletion_jobs
    BEGIN
      SELECT RAISE(ABORT, 'FORCED_EPHEMERAL_JOB_ABORT');
    END;
  `);
  await assert.rejects(
    () => deleteStudentAccountAtomically(dbContext, {
      actorId: "ephemeral-rollback",
      operationId: operationId(31),
      initiatingCleanupTokenDigest: digest("f"),
      useEphemeralCleanupDigest: true,
      now: new Date("2026-01-01T00:00:00.000Z"),
    }),
    /FORCED_EPHEMERAL_JOB_ABORT/u,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM account_cleanup_tokens WHERE token_digest = ?",
      digest("f"),
    ),
    0,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM account_deletion_jobs WHERE operation_id = ?",
      operationId(31),
    ),
    0,
  );
  assert.equal(
    countRows(
      sqlite,
      "SELECT count(*) AS value FROM profiles WHERE id = 'ephemeral-rollback'",
    ),
    1,
  );
});

test("privacy receipt의 early mutation과 INSERT OR REPLACE는 recursive trigger 설정과 무관하게 막힌다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "guard-student");
  const now = new Date("2026-01-01T00:00:00.000Z");
  await registerAccountCleanupTokenAtomically(dbContext, {
    ownerId: "guard-student",
    tokenDigest: digest("a"),
    now,
  });

  for (const recursiveTriggers of ["OFF", "ON"] as const) {
    sqlite.pragma(`recursive_triggers = ${recursiveTriggers}`);
    assert.throws(
      () =>
        sqlite.exec(`
          INSERT OR REPLACE INTO account_cleanup_tokens (
            token_digest, subject_id, status, created_at, updated_at
          ) VALUES (
            '${digest("a")}', 'guard-student', 'ACTIVE', 1767225600, 1767225600
          );
        `),
      /ACCOUNT_CLEANUP_TOKEN_DUPLICATE/u,
    );
  }
  sqlite.pragma("recursive_triggers = OFF");
  assert.throws(
    () =>
      sqlite.exec(`
        UPDATE account_cleanup_tokens
        SET status = 'ERASED', subject_id = NULL,
            erased_at = 1767225601, updated_at = 1767225601
        WHERE token_digest = '${digest("a")}';
      `),
    /ACCOUNT_CLEANUP_TOKEN_TRANSITION_INVALID/u,
  );
});
