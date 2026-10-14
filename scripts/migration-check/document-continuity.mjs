import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";
import {
  accountPrivacyMigrationFile,
  applyMigration,
  applyMigrations,
  continuityMigrationFile,
  createMemoryDatabase,
  lifecycleExpansionMigrationFile,
  mediaLifecycleMigrationFile,
  migrationsDirectory,
} from "./runtime.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSqlSignature } from "./schema.mjs";

const continuityTriggerNames = [
  "account_cleanup_tokens_before_insert_existing",
  "account_cleanup_tokens_before_insert_guard",
  "account_cleanup_tokens_guard_delete",
  "account_cleanup_tokens_transition_guard",
  "account_deletion_jobs_before_insert_existing",
  "account_deletion_jobs_before_insert_guard",
  "account_deletion_jobs_guard_delete",
  "account_deletion_jobs_transition_guard",
  "calendar_feed_tokens_before_insert_existing",
  "calendar_feed_tokens_before_insert_guard",
  "calendar_feed_tokens_rotation_guard",
  "document_batch_abort_guard_reject_insert",
  "document_operation_ledger_before_insert_existing",
  "document_operation_ledger_immutable_delete",
  "document_operation_ledger_immutable_update",
  "document_tombstones_before_insert_existing",
  "document_tombstones_immutable_delete",
  "document_tombstones_immutable_update",
  "private_note_revisions_before_insert_baseline",
  "private_note_revisions_before_insert_existing",
  "private_note_revisions_before_insert_receipt_match",
  "private_note_revisions_guard_delete",
  "private_note_revisions_immutable_update",
  "private_notes_before_delete_tombstone",
  "private_notes_before_insert_tombstone",
  "post_revisions_before_insert_baseline",
  "post_revisions_before_insert_existing",
  "post_revisions_before_insert_receipt_match",
  "post_revisions_guard_delete",
  "post_revisions_immutable_update",
  "post_revisions_media_guard_insert",
  "posts_before_delete_media_pending",
  "posts_before_delete_tombstone",
  "posts_before_insert_tombstone",
  "posts_deleted_actor_guard_insert",
  "posts_deleted_actor_guard_update",
  "posts_media_guard_insert",
  "posts_media_guard_update",
  "qna_replies_before_insert_existing",
  "qna_replies_before_insert_receipt_match",
  "qna_replies_guard_delete",
  "qna_replies_immutable_update",
  "qna_replies_media_guard_insert",
  "qna_thread_events_before_insert_baseline",
  "qna_thread_events_before_insert_existing",
  "qna_thread_events_before_insert_receipt_match",
  "qna_thread_events_guard_delete",
  "qna_thread_events_immutable_update",
  "qna_threads_before_delete_tombstone",
  "qna_threads_before_insert_tombstone",
  "qna_threads_deleted_actor_guard_insert",
  "qna_threads_deleted_actor_guard_update",
  "qna_threads_before_delete_media_pending",
  "comments_before_delete_trashed_post",
  "comments_before_insert_active_post",
  "comments_before_update_trashed_post",
  "profiles_before_delete_document_history",
  "profiles_before_insert_erased_identity",
  "profiles_before_insert_existing",
  "profiles_update_identity_guard",
];

export function validateContinuityTriggers(database) {
  const triggerRows = database.all(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name IN (
        'account_cleanup_tokens',
        'account_deletion_jobs',
        'calendar_feed_tokens',
        'comments',
        'document_batch_abort_guard',
        'document_operation_ledger',
        'document_tombstones',
        'post_revisions',
        'posts',
        'profiles',
        'private_notes',
        'private_note_revisions',
        'qna_replies',
        'qna_thread_events',
        'qna_threads'
      )
    ORDER BY name
  `);
  assertRowsEqual(
    "continuity trigger allowlist",
    triggerRows.map((row) => row.name),
    [...continuityTriggerNames].sort(),
  );

  const sourceByName = new Map();
  for (const migrationFile of [
    continuityMigrationFile,
    lifecycleExpansionMigrationFile,
    mediaLifecycleMigrationFile,
    accountPrivacyMigrationFile,
  ]) {
    const migrationStatements = readFileSync(
      join(migrationsDirectory, migrationFile),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => /^CREATE TRIGGER\b/iu.test(statement));
    for (const statement of migrationStatements) {
      const match = statement.match(/^CREATE TRIGGER\s+[`"]?([^`"\s]+)[`"]?/iu);
      assert(match, `${migrationFile} trigger 이름을 해석하지 못했습니다.`);
      if (continuityTriggerNames.includes(match[1])) {
        sourceByName.set(match[1], normalizeSqlSignature(statement));
      }
    }
  }
  assertRowsEqual(
    "document lifecycle trigger source allowlist",
    [...sourceByName.keys()].sort(),
    [...continuityTriggerNames].sort(),
  );
  for (const trigger of triggerRows) {
    assert(
      normalizeSqlSignature(trigger.sql) === sourceByName.get(trigger.name),
      `${trigger.name} trigger SQL이 migration source와 다릅니다.`,
    );
  }
}

export async function validateContinuityUpgrade(migrationFiles) {
  const continuityIndex = migrationFiles.indexOf(continuityMigrationFile);
  assert(continuityIndex > 0, `${continuityMigrationFile} 순서를 찾지 못했습니다.`);
  const priorMigrations = migrationFiles.slice(0, continuityIndex);
  const upgradeDatabase = await createMemoryDatabase();

  try {
    applyMigrations(upgradeDatabase, priorMigrations);
    upgradeDatabase.exec(`
      INSERT INTO profiles (id, email, display_name, role)
      VALUES
        ('upgrade-student', 'upgrade-student@example.com', 'Upgrade Student', 'student'),
        ('upgrade-admin', 'upgrade-admin@example.com', 'Upgrade Admin', 'admin');
      INSERT INTO private_notes (
        id, student_id, author_id, title, content_html, created_at, note_date
      ) VALUES
        ('upgrade-known-date', 'upgrade-student', 'upgrade-admin', 'Known', '<p>Known</p>', 1700000000, 1700000100),
        ('upgrade-null-date', 'upgrade-student', 'upgrade-student', 'Null', '<p>Null</p>', NULL, NULL);
    `);
    applyMigration(upgradeDatabase, continuityMigrationFile);

    const heads = upgradeDatabase.all(`
      SELECT id, version, deleted_at, created_at, updated_at
      FROM private_notes
      ORDER BY id
    `);
    assert(heads.length === 2, "0007 fixture head 개수가 보존되지 않았습니다.");
    assert(
      heads.every(
        (head) =>
          head.version === 1 &&
          head.deleted_at === null &&
          head.created_at !== null &&
          head.created_at === head.updated_at,
      ),
      "0007 fixture의 version/timestamp/active backfill이 올바르지 않습니다.",
    );
    const baselines = upgradeDatabase.all(`
      SELECT note_id, revision_number, change_type, snapshot_hash,
             snapshot_hash_version, actor_id, operation_record_id
      FROM private_note_revisions
      ORDER BY note_id
    `);
    assert(
      baselines.length === 2 &&
        baselines.every(
          (revision) =>
            revision.revision_number === 1 &&
            revision.change_type === "BASELINE" &&
            revision.snapshot_hash === null &&
            revision.snapshot_hash_version === null &&
            revision.actor_id === null &&
            revision.operation_record_id === null,
        ),
      "0007 fixture마다 BASELINE revision이 정확히 생성되지 않았습니다.",
    );
    assertSqlFails(
      upgradeDatabase,
      "DELETE FROM profiles WHERE id = 'upgrade-student';",
      "private note 보유 profile RESTRICT",
    );
    assert(
      upgradeDatabase.all("PRAGMA foreign_key_check;").length === 0,
      "0007 upgrade 뒤 foreign key 위반이 있습니다.",
    );
  } finally {
    upgradeDatabase.close();
  }

  const inboundDatabase = await createMemoryDatabase();
  try {
    applyMigrations(inboundDatabase, priorMigrations);
    inboundDatabase.exec(`
      INSERT INTO profiles (id, email, role)
      VALUES ('inbound-student', 'inbound-student@example.com', 'student');
      INSERT INTO private_notes (id, student_id, author_id, title, content_html)
      VALUES ('inbound-note', 'inbound-student', 'inbound-student', 'Inbound', '<p>Inbound</p>');
      CREATE TABLE private_note_children (
        id TEXT PRIMARY KEY NOT NULL,
        note_id TEXT NOT NULL REFERENCES private_notes(id) ON DELETE RESTRICT
      );
      INSERT INTO private_note_children (id, note_id)
      VALUES ('inbound-child', 'inbound-note');
    `);
    let migrationFailure = null;
    try {
      applyMigration(inboundDatabase, continuityMigrationFile);
    } catch (error) {
      migrationFailure = error;
    }
    assert(migrationFailure, "private_notes inbound FK preflight가 migration을 중단하지 않았습니다.");
    const failureMessage =
      migrationFailure instanceof Error
        ? migrationFailure.message
        : String(migrationFailure);
    assert(
      failureMessage.includes("DOCUMENT_BATCH_ABORT"),
      `inbound FK preflight 오류가 예상과 다릅니다: ${failureMessage}`,
    );
    const columns = inboundDatabase.all("PRAGMA table_info('private_notes');");
    assert(
      !columns.some((column) => column.name === "version"),
      "inbound FK preflight 실패 뒤 private_notes rebuild가 일부 반영되었습니다.",
    );
    assert(
      inboundDatabase.all("SELECT id FROM private_note_children;").length === 1,
      "inbound FK preflight 실패가 child fixture를 변경했습니다.",
    );
  } finally {
    inboundDatabase.close();
  }
}

export async function validateLifecycleExpansionUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(lifecycleExpansionMigrationFile);
  assert(migrationIndex > 0, `${lifecycleExpansionMigrationFile} 순서를 찾지 못했습니다.`);
  const priorMigrations = migrationFiles.slice(0, migrationIndex);
  const upgradeDatabase = await createMemoryDatabase();

  try {
    applyMigrations(upgradeDatabase, priorMigrations);
    upgradeDatabase.exec(`
      INSERT INTO profiles (id, email, display_name, role)
      VALUES
        ('lifecycle-student', 'lifecycle-student@example.com', 'Lifecycle Student', 'student'),
        ('lifecycle-admin', 'lifecycle-admin@example.com', 'Lifecycle Admin', 'admin');
      INSERT INTO posts (
        id, author_id, category, board_type, is_pinned, media_url,
        title, content_html, created_at
      ) VALUES (
        'lifecycle-post', 'lifecycle-admin', 'general', 'ANNOUNCEMENT', 1,
        'https://example.com/post-media', 'Lifecycle Post', '<p>Post</p>', 1700000000
      );
      INSERT INTO comments (id, post_id, author_id, content_html, created_at)
      VALUES (
        'lifecycle-comment', 'lifecycle-post', 'lifecycle-student',
        '<p>Comment</p>', 1700000001
      );
      INSERT INTO qna_threads (
        id, student_id, title, status, created_at, updated_at
      ) VALUES (
        'lifecycle-thread', 'lifecycle-student', 'Lifecycle Q&A',
        'ANSWERED', 1700000000, 1700000002
      );
      INSERT INTO qna_replies (
        id, thread_id, author_id, content_html, attachment_url, created_at
      ) VALUES
        ('lifecycle-question', 'lifecycle-thread', 'lifecycle-student', '<p>Question</p>', NULL, 1700000000),
        ('lifecycle-answer', 'lifecycle-thread', 'lifecycle-admin', '<p>Answer</p>', NULL, 1700000002);
    `);

    applyMigration(upgradeDatabase, lifecycleExpansionMigrationFile);

    const [post] = upgradeDatabase.all(`
      SELECT version, deleted_at, updated_at FROM posts WHERE id = 'lifecycle-post';
    `);
    assert(
      post?.version === 1 && post?.deleted_at === null && post?.updated_at === 1700000000,
      "0010 upgrade가 기존 post head를 active version 1로 backfill하지 못했습니다.",
    );
    const [postBaseline] = upgradeDatabase.all(`
      SELECT revision_number, change_type, board_type, category, is_pinned, media_url,
             actor_id, operation_record_id
      FROM post_revisions WHERE post_id = 'lifecycle-post';
    `);
    assert(
      postBaseline?.revision_number === 1 &&
        postBaseline?.change_type === "BASELINE" &&
        postBaseline?.board_type === "ANNOUNCEMENT" &&
        postBaseline?.category === "general" &&
        postBaseline?.is_pinned === 1 &&
        postBaseline?.media_url === "https://example.com/post-media" &&
        postBaseline?.actor_id === null &&
        postBaseline?.operation_record_id === null,
      "0010 upgrade가 기존 post의 완전한 BASELINE snapshot을 만들지 못했습니다.",
    );
    assert(
      upgradeDatabase.all("SELECT id FROM comments WHERE id = 'lifecycle-comment';").length === 1,
      "0010 upgrade가 기존 post comment를 보존하지 못했습니다.",
    );

    const [thread] = upgradeDatabase.all(`
      SELECT version, deleted_at, status FROM qna_threads WHERE id = 'lifecycle-thread';
    `);
    const [threadBaseline] = upgradeDatabase.all(`
      SELECT event_number, event_type, title, status, actor_id, operation_record_id
      FROM qna_thread_events WHERE thread_id = 'lifecycle-thread';
    `);
    assert(
      thread?.version === 1 && thread?.deleted_at === null && thread?.status === "ANSWERED",
      "0010 upgrade가 기존 Q&A head를 active version 1로 backfill하지 못했습니다.",
    );
    assert(
      threadBaseline?.event_number === 1 &&
        threadBaseline?.event_type === "BASELINE" &&
        threadBaseline?.title === "Lifecycle Q&A" &&
        threadBaseline?.status === "ANSWERED" &&
        threadBaseline?.actor_id === null &&
        threadBaseline?.operation_record_id === null,
      "0010 upgrade가 기존 Q&A BASELINE event를 만들지 못했습니다.",
    );
    assert(
      upgradeDatabase.all("SELECT id FROM qna_replies WHERE thread_id = 'lifecycle-thread';").length === 2,
      "0010 upgrade가 기존 Q&A reply를 보존하지 못했습니다.",
    );
    assertSqlFails(
      upgradeDatabase,
      "DELETE FROM profiles WHERE id = 'lifecycle-student';",
      "post comment/Q&A history 보유 profile RESTRICT",
      "DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED",
    );
    assert(
      upgradeDatabase.all("PRAGMA foreign_key_check;").length === 0,
      "0010 upgrade 뒤 foreign key 위반이 있습니다.",
    );
  } finally {
    upgradeDatabase.close();
  }
}

export function validateContinuitySemantics(database) {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  database.exec(`
    INSERT INTO profiles (id, email, display_name, role)
    VALUES ('probe-user', 'probe-user@example.com', 'Probe User', 'student');
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'probe-receipt', 'probe-operation', 'probe-user', 'probe-user',
      'PRIVATE_NOTE', 'CREATE', 'probe-note', '${hashA}', 1, 1, 1700000000
    );
    INSERT INTO private_notes (
      id, student_id, author_id, title, content_html, created_at, updated_at, version
    ) VALUES (
      'probe-note', 'probe-user', 'probe-user', 'Probe', '<p>Probe</p>',
      1700000000, 1700000000, 1
    );
    INSERT INTO private_note_revisions (
      id, note_id, revision_number, change_type, title, content_html,
      snapshot_hash, snapshot_hash_version, actor_id, operation_record_id, created_at
    ) VALUES (
      'probe-revision', 'probe-note', 1, 'CREATE', 'Probe', '<p>Probe</p>',
      '${hashB}', 1, 'probe-user', 'probe-receipt', 1700000000
    );
    INSERT INTO document_tombstones (
      resource_type, resource_id, subject_id, owner_id,
      source_version, purged_at, purged_by_id
    ) VALUES (
      'PRIVATE_NOTE', 'standalone-tombstone', 'probe-user', 'probe-user',
      1, 1700000000, 'probe-user'
    );
  `);

  assertSqlFails(
    database,
    "INSERT INTO document_batch_abort_guard (reason) VALUES ('probe');",
    "batch abort sentinel",
    "DOCUMENT_BATCH_ABORT",
  );
  assert(
    database.all("SELECT * FROM document_batch_abort_guard;").length === 0,
    "batch abort guard에 row가 남았습니다.",
  );
  assertSqlFails(
    database,
    "UPDATE private_notes SET version = 0 WHERE id = 'probe-note';",
    "private note version CHECK",
  );
  assertSqlFails(
    database,
    "UPDATE document_operation_ledger SET result_revision = 2 WHERE id = 'probe-receipt';",
    "ledger immutable update",
    "DOCUMENT_LEDGER_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "DELETE FROM document_operation_ledger WHERE id = 'probe-receipt';",
    "ledger immutable delete",
    "DOCUMENT_LEDGER_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "UPDATE document_tombstones SET source_version = 2 WHERE resource_id = 'standalone-tombstone';",
    "tombstone immutable update",
    "DOCUMENT_TOMBSTONE_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "DELETE FROM document_tombstones WHERE resource_id = 'standalone-tombstone';",
    "tombstone immutable delete",
    "DOCUMENT_TOMBSTONE_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "UPDATE private_note_revisions SET title = 'Changed' WHERE id = 'probe-revision';",
    "revision immutable update",
    "PRIVATE_NOTE_REVISION_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "DELETE FROM private_note_revisions WHERE id = 'probe-revision';",
    "active revision delete guard",
    "PRIVATE_NOTE_REVISION_DELETE_GUARD",
  );
  assertSqlFails(
    database,
    `INSERT INTO private_note_revisions (
      id, note_id, revision_number, change_type, title, content_html, created_at
    ) VALUES ('late-baseline', 'probe-note', 1, 'BASELINE', 'Probe', '<p>Probe</p>', 1700000001);`,
    "rollout 뒤 BASELINE insert",
    "PRIVATE_NOTE_BASELINE_CLOSED",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES ('bad-ledger-type', 'bad-operation', 'probe-user', 'probe-user',
      'OTHER', 'CREATE', 'bad-note', '${hashA}', 1, 1, 1700000000);`,
    "ledger resource type CHECK",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES ('bad-ledger-version', 'bad-version-operation', 'probe-user', 'probe-user',
      'PRIVATE_NOTE', 'UPDATE', 'bad-note', '${hashA}', 1, 0, 1700000000);`,
    "ledger result revision CHECK",
  );
  assertSqlFails(
    database,
    `INSERT INTO document_tombstones (
      resource_type, resource_id, subject_id, owner_id, source_version, purged_at
    ) VALUES ('PRIVATE_NOTE', 'bad-tombstone', 'probe-user', 'probe-user', 0, 1700000000);`,
    "tombstone source version CHECK",
  );

  for (const recursiveTriggers of ["OFF", "ON"]) {
    database.exec(`PRAGMA recursive_triggers = ${recursiveTriggers};`);
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO document_operation_ledger (
        id, operation_id, actor_id, subject_id, resource_type, operation_type,
        resource_id, request_hash, request_hash_version, result_revision, created_at
      ) VALUES ('probe-receipt', 'probe-operation', 'probe-user', 'probe-user',
        'PRIVATE_NOTE', 'CREATE', 'probe-note', '${hashA}', 1, 1, 1700000000);`,
      `ledger INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "DOCUMENT_LEDGER_DUPLICATE",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO document_tombstones (
        resource_type, resource_id, subject_id, owner_id, source_version, purged_at
      ) VALUES ('PRIVATE_NOTE', 'standalone-tombstone', 'probe-user', 'probe-user', 1, 1700000000);`,
      `tombstone INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "DOCUMENT_TOMBSTONE_DUPLICATE",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO private_note_revisions (
        id, note_id, revision_number, change_type, title, content_html,
        snapshot_hash, snapshot_hash_version, actor_id, operation_record_id, created_at
      ) VALUES ('probe-revision', 'probe-note', 1, 'CREATE', 'Probe', '<p>Probe</p>',
        '${hashB}', 1, 'probe-user', 'probe-receipt', 1700000000);`,
      `revision INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "PRIVATE_NOTE_REVISION_DUPLICATE",
    );
  }
  database.exec("PRAGMA recursive_triggers = OFF;");

  database.exec(`
    INSERT INTO document_tombstones (
      resource_type, resource_id, subject_id, owner_id, source_version, purged_at
    ) VALUES ('PRIVATE_NOTE', 'probe-note', 'probe-user', 'probe-user', 1, 1700000000);
  `);
  assertSqlFails(
    database,
    "DELETE FROM private_note_revisions WHERE id = 'probe-revision';",
    "live head와 tombstone 공존 시 revision delete guard",
    "PRIVATE_NOTE_REVISION_DELETE_GUARD",
  );

  database.exec(`
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'hard-delete-receipt', 'hard-delete-operation', 'probe-user', 'probe-user',
      'PRIVATE_NOTE', 'CREATE', 'hard-delete-note', '${hashA}', 1, 1, 1700000000
    );
    INSERT INTO private_notes (
      id, student_id, author_id, title, content_html, created_at, updated_at, version
    ) VALUES (
      'hard-delete-note', 'probe-user', 'probe-user', 'Hard delete', '<p>Hard delete</p>',
      1700000000, 1700000000, 1
    );
    INSERT INTO private_note_revisions (
      id, note_id, revision_number, change_type, title, content_html,
      snapshot_hash, snapshot_hash_version, actor_id, operation_record_id, created_at
    ) VALUES (
      'hard-delete-revision', 'hard-delete-note', 1, 'CREATE', 'Hard delete', '<p>Hard delete</p>',
      '${hashB}', 1, 'probe-user', 'hard-delete-receipt', 1700000000
    );
    DELETE FROM private_notes WHERE id = 'hard-delete-note';
  `);
  assert(
    database.all(
      "SELECT * FROM document_tombstones WHERE resource_id = 'hard-delete-note';",
    ).length === 1,
    "private note 직접 hard delete가 tombstone을 만들지 않았습니다.",
  );
  assert(
    database.all(
      "SELECT * FROM private_note_revisions WHERE note_id = 'hard-delete-note';",
    ).length === 0,
    "private note hard delete 뒤 revision cascade가 완료되지 않았습니다.",
  );
  assertSqlFails(
    database,
    `INSERT INTO private_notes (
      id, student_id, author_id, title, content_html, created_at, updated_at, version
    ) VALUES ('hard-delete-note', 'probe-user', 'probe-user', 'Resurrect', '<p>Resurrect</p>',
      1700000001, 1700000001, 1);`,
    "tombstone resource resurrection",
    "PRIVATE_NOTE_RESURRECTION_BLOCKED",
  );

  database.exec(`
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'mismatch-receipt', 'mismatch-operation', 'probe-user', 'probe-user',
      'PRIVATE_NOTE', 'UPDATE', 'another-note', '${hashA}', 1, 2, 1700000001
    );
  `);
  assertSqlFails(
    database,
    `INSERT INTO private_note_revisions (
      id, note_id, revision_number, change_type, title, content_html,
      snapshot_hash, snapshot_hash_version, actor_id, operation_record_id, created_at
    ) VALUES ('mismatch-revision', 'probe-note', 2, 'UPDATE', 'Mismatch', '<p>Mismatch</p>',
      '${hashB}', 1, 'probe-user', 'mismatch-receipt', 1700000001);`,
    "revision receipt resource mismatch",
    "PRIVATE_NOTE_REVISION_RECEIPT_MISMATCH",
  );

  const headRevisionMismatches = database.all(`
    SELECT note.id
    FROM private_notes AS note
    LEFT JOIN private_note_revisions AS revision ON revision.note_id = note.id
    GROUP BY note.id, note.version
    HAVING max(revision.revision_number) <> note.version
  `);
  assert(
    headRevisionMismatches.length === 0,
    `semantic probe 뒤 head/revision 불변식이 깨졌습니다: ${JSON.stringify(headRevisionMismatches)}`,
  );
  assert(
    database.all("PRAGMA foreign_key_check;").length === 0,
    "semantic probe 뒤 foreign key 위반이 있습니다.",
  );
}

export function validateLifecycleExpansionSemantics(database) {
  const hashA = "c".repeat(64);
  const hashB = "d".repeat(64);
  database.exec(`
    INSERT INTO profiles (id, email, display_name, role)
    VALUES
      ('lifecycle-probe-student', 'lifecycle-probe-student@example.com', 'Probe Student', 'student'),
      ('lifecycle-probe-admin', 'lifecycle-probe-admin@example.com', 'Probe Admin', 'admin');
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'post-probe-receipt', 'post-probe-operation',
      'lifecycle-probe-admin', 'lifecycle-probe-admin',
      'COMMUNITY_POST', 'CREATE', 'post-probe', '${hashA}', 1, 1, 1700000000
    );
    INSERT INTO posts (
      id, author_id, category, board_type, is_pinned, title, content_html,
      created_at, updated_at, version
    ) VALUES (
      'post-probe', 'lifecycle-probe-admin', 'general', 'GENERAL', 0,
      'Post probe', '<p>Post probe</p>', 1700000000, 1700000000, 1
    );
    INSERT INTO post_revisions (
      id, post_id, revision_number, change_type, category, board_type,
      is_pinned, title, content_html, snapshot_hash, snapshot_hash_version,
      actor_id, operation_record_id, created_at
    ) VALUES (
      'post-probe-revision', 'post-probe', 1, 'CREATE', 'general', 'GENERAL',
      0, 'Post probe', '<p>Post probe</p>', '${hashB}', 1,
      'lifecycle-probe-admin', 'post-probe-receipt', 1700000000
    );
    INSERT INTO comments (id, post_id, author_id, content_html, created_at)
    VALUES (
      'post-probe-comment', 'post-probe', 'lifecycle-probe-student',
      '<p>Comment</p>', 1700000001
    );

    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'qna-probe-receipt', 'qna-probe-operation',
      'lifecycle-probe-student', 'lifecycle-probe-student',
      'QNA_THREAD', 'CREATE', 'qna-probe', '${hashA}', 1, 1, 1700000000
    );
    INSERT INTO qna_threads (
      id, student_id, title, status, created_at, updated_at, version
    ) VALUES (
      'qna-probe', 'lifecycle-probe-student', 'Q&A probe', 'OPEN',
      1700000000, 1700000000, 1
    );
    INSERT INTO qna_replies (
      id, thread_id, author_id, content_html, created_at
    ) VALUES (
      'qna-probe-reply', 'qna-probe', 'lifecycle-probe-student',
      '<p>Question</p>', 1700000000
    );
    INSERT INTO qna_thread_events (
      id, thread_id, event_number, event_type, title, status, reply_id,
      event_hash, event_hash_version, actor_id, operation_record_id, created_at
    ) VALUES (
      'qna-probe-event', 'qna-probe', 1, 'CREATE', 'Q&A probe', 'OPEN',
      'qna-probe-reply', '${hashB}', 1, 'lifecycle-probe-student',
      'qna-probe-receipt', 1700000000
    );
  `);

  assertSqlFails(
    database,
    `INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'bad-resource-operation', 'bad-resource-operation',
      'lifecycle-probe-student', 'lifecycle-probe-student',
      'PRIVATE_NOTE', 'APPEND_REPLY', 'bad-note', '${hashA}', 1, 1, 1700000000
    );`,
    "ledger resource/operation compatibility CHECK",
  );
  assertSqlFails(
    database,
    "UPDATE post_revisions SET title = 'Changed' WHERE id = 'post-probe-revision';",
    "post revision immutable update",
    "POST_REVISION_IMMUTABLE",
  );
  assertSqlFails(
    database,
    `INSERT INTO post_revisions (
      id, post_id, revision_number, change_type, category, board_type,
      is_pinned, title, content_html, created_at
    ) VALUES (
      'post-late-baseline', 'post-probe', 1, 'BASELINE', 'general', 'GENERAL',
      0, 'Late', '<p>Late</p>', 1700000001
    );`,
    "post rollout 뒤 BASELINE insert",
    "POST_BASELINE_CLOSED",
  );
  assertSqlFails(
    database,
    `INSERT INTO comments (id, post_id, author_id, content_html)
     VALUES ('missing-post-comment', 'missing-post', 'lifecycle-probe-student', '<p>Missing</p>');`,
    "missing/trashed post comment insert",
    "COMMENT_ACTIVE_POST_REQUIRED",
  );
  assertSqlFails(
    database,
    "UPDATE qna_replies SET content_html = '<p>Changed</p>' WHERE id = 'qna-probe-reply';",
    "Q&A reply immutable update",
    "QNA_REPLY_IMMUTABLE",
  );
  assertSqlFails(
    database,
    `INSERT INTO qna_replies (id, thread_id, author_id, content_html)
     VALUES ('qna-unreceipted-reply', 'qna-probe', 'lifecycle-probe-student', '<p>Extra</p>');`,
    "Q&A unreceipted reply insert",
    "QNA_REPLY_RECEIPT_MISMATCH",
  );
  assertSqlFails(
    database,
    "UPDATE qna_thread_events SET title = 'Changed' WHERE id = 'qna-probe-event';",
    "Q&A event immutable update",
    "QNA_THREAD_EVENT_IMMUTABLE",
  );
  assertSqlFails(
    database,
    `INSERT INTO qna_threads (
      id, student_id, title, status, created_at, updated_at, version
    ) VALUES (
      'qna-invalid-status', 'lifecycle-probe-student', 'Invalid', 'OTHER',
      1700000000, 1700000000, 1
    );`,
    "Q&A status insert guard",
    "QNA_THREAD_STATE_INVALID",
  );

  database.exec(`
    UPDATE posts
    SET deleted_at = 1700000002, deleted_by_id = 'lifecycle-probe-admin'
    WHERE id = 'post-probe';
    UPDATE qna_threads
    SET deleted_at = 1700000002, deleted_by_id = 'lifecycle-probe-student'
    WHERE id = 'qna-probe';
  `);
  assertSqlFails(
    database,
    "DELETE FROM comments WHERE id = 'post-probe-comment';",
    "trashed post comment delete guard",
    "COMMENT_TRASHED_POST_IMMUTABLE",
  );
  assertSqlFails(
    database,
    "DELETE FROM qna_replies WHERE id = 'qna-probe-reply';",
    "active Q&A reply delete guard",
    "QNA_REPLY_DELETE_GUARD",
  );

  database.exec(`
    DELETE FROM posts WHERE id = 'post-probe';
    DELETE FROM qna_threads WHERE id = 'qna-probe';
  `);
  assert(
    database.all(`
      SELECT resource_id FROM document_tombstones
      WHERE (resource_type = 'COMMUNITY_POST' AND resource_id = 'post-probe')
         OR (resource_type = 'QNA_THREAD' AND resource_id = 'qna-probe');
    `).length === 2,
    "post/Q&A hard delete가 tombstone을 남기지 않았습니다.",
  );
  assert(
    database.all("SELECT id FROM comments WHERE post_id = 'post-probe';").length === 0 &&
      database.all("SELECT id FROM qna_replies WHERE thread_id = 'qna-probe';").length === 0 &&
      database.all("SELECT id FROM qna_thread_events WHERE thread_id = 'qna-probe';").length === 0,
    "post/Q&A purge cascade가 child history를 정리하지 못했습니다.",
  );
  assertSqlFails(
    database,
    `INSERT INTO posts (
      id, author_id, category, board_type, is_pinned, title, content_html,
      created_at, updated_at, version
    ) VALUES (
      'post-probe', 'lifecycle-probe-admin', 'general', 'GENERAL', 0,
      'Resurrect', '<p>Resurrect</p>', 1700000003, 1700000003, 1
    );`,
    "post tombstone resurrection",
    "POST_RESURRECTION_BLOCKED",
  );
  assertSqlFails(
    database,
    `INSERT INTO qna_threads (
      id, student_id, title, status, created_at, updated_at, version
    ) VALUES (
      'qna-probe', 'lifecycle-probe-student', 'Resurrect', 'OPEN',
      1700000003, 1700000003, 1
    );`,
    "Q&A tombstone resurrection",
    "QNA_THREAD_RESURRECTION_BLOCKED",
  );
  assert(
    database.all("PRAGMA foreign_key_check;").length === 0,
    "post/Q&A lifecycle semantic probe 뒤 foreign key 위반이 있습니다.",
  );
}
