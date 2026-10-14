import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";
import {
  accountPrivacyMigrationFile,
  applyMigration,
  applyMigrations,
  createMemoryDatabase,
  lifecycleExpansionMigrationFile,
  mediaLifecycleMigrationFile,
  migrationsDirectory,
} from "./runtime.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSqlSignature } from "./schema.mjs";

const mediaLifecycleTriggerNames = [
  "media_deletion_outbox_before_insert_existing",
  "media_deletion_outbox_before_insert_match",
  "media_deletion_outbox_guard_delete",
  "media_deletion_outbox_immutable_identity",
  "media_deletion_outbox_transition_guard",
  "media_objects_guard_delete",
  "media_objects_before_insert_existing",
  "media_objects_before_insert_guard",
  "media_objects_deletion_outbox_guard",
  "media_objects_immutable_identity",
  "media_objects_transition_guard",
  "media_objects_transition_payload_guard",
];

export function validateMediaLifecycleTriggers(database) {
  const triggerRows = database.all(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name IN ('media_objects', 'media_deletion_outbox')
    ORDER BY name
  `);
  assertRowsEqual(
    "media lifecycle trigger allowlist",
    triggerRows.map((row) => row.name),
    [...mediaLifecycleTriggerNames].sort(),
  );

  const sourceByName = new Map();
  for (const migrationFile of [
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
      if (mediaLifecycleTriggerNames.includes(match[1])) {
        sourceByName.set(match[1], normalizeSqlSignature(statement));
      }
    }
  }
  assertRowsEqual(
    "0011 media trigger source allowlist",
    [...sourceByName.keys()].sort(),
    [...mediaLifecycleTriggerNames].sort(),
  );
  for (const trigger of triggerRows) {
    assert(
      normalizeSqlSignature(trigger.sql) === sourceByName.get(trigger.name),
      `${trigger.name} trigger SQL이 latest media source와 다릅니다.`,
    );
  }
}

export async function validateMediaLifecycleUpgrade(migrationFiles) {
  const lifecycleIndex = migrationFiles.indexOf(lifecycleExpansionMigrationFile);
  const mediaIndex = migrationFiles.indexOf(mediaLifecycleMigrationFile);
  assert(lifecycleIndex > 0, `${lifecycleExpansionMigrationFile} 순서를 찾지 못했습니다.`);
  assert(mediaIndex > lifecycleIndex, `${mediaLifecycleMigrationFile} 순서를 찾지 못했습니다.`);
  const upgradeDatabase = await createMemoryDatabase();

  try {
    applyMigrations(upgradeDatabase, migrationFiles.slice(0, lifecycleIndex));
    upgradeDatabase.exec(`
      INSERT INTO profiles (id, email, display_name, role)
      VALUES
        ('media-upgrade-student', 'media-upgrade-student@example.com', 'Media Student', 'student'),
        ('media-upgrade-admin', 'media-upgrade-admin@example.com', 'Media Admin', 'admin');
      INSERT INTO posts (
        id, author_id, category, board_type, is_pinned, media_url,
        title, content_html, created_at
      ) VALUES (
        'media-upgrade-post', 'media-upgrade-admin', 'feedback', 'FEEDBACK', 0,
        'https://legacy.example/post.mp3', 'Legacy post', '<p>Legacy post</p>', 1700000000
      );
      INSERT INTO qna_threads (
        id, student_id, title, status, created_at, updated_at
      ) VALUES (
        'media-upgrade-thread', 'media-upgrade-student', 'Legacy Q&A',
        'ANSWERED', 1700000000, 1700000002
      );
      INSERT INTO qna_replies (
        id, thread_id, author_id, content_html, attachment_url, created_at
      ) VALUES
        (
          'media-upgrade-question', 'media-upgrade-thread', 'media-upgrade-student',
          '<p>Question</p>', 'https://legacy.example/question.jpg', 1700000000
        ),
        (
          'media-upgrade-answer', 'media-upgrade-thread', 'media-upgrade-admin',
          '<p>Answer</p>', 'https://legacy.example/answer.mp3', 1700000002
        );
    `);

    for (const migrationFile of migrationFiles.slice(lifecycleIndex, mediaIndex)) {
      applyMigration(upgradeDatabase, migrationFile);
    }

    const revisionHash = "e".repeat(64);
    upgradeDatabase.exec(`
      INSERT INTO document_operation_ledger (
        id, operation_id, actor_id, subject_id, resource_type, operation_type,
        resource_id, request_hash, request_hash_version, result_revision, created_at
      ) VALUES (
        'media-upgrade-post-update-ledger', 'media-upgrade-post-update-operation',
        'media-upgrade-admin', 'media-upgrade-admin', 'COMMUNITY_POST', 'UPDATE',
        'media-upgrade-post', '${revisionHash}', 1, 2, 1700000003
      );
      UPDATE posts
      SET title = 'Legacy post updated', content_html = '<p>Updated</p>',
          version = 2, updated_at = 1700000003
      WHERE id = 'media-upgrade-post';
      INSERT INTO post_revisions (
        id, post_id, revision_number, change_type, category, board_type,
        is_pinned, media_url, title, content_html, snapshot_hash,
        snapshot_hash_version, actor_id, operation_record_id, created_at
      ) VALUES (
        'media-upgrade-post-revision-2', 'media-upgrade-post', 2, 'UPDATE',
        'feedback', 'FEEDBACK', 0, 'https://legacy.example/post.mp3',
        'Legacy post updated', '<p>Updated</p>', '${revisionHash}', 1,
        'media-upgrade-admin', 'media-upgrade-post-update-ledger', 1700000003
      );
    `);

    applyMigration(upgradeDatabase, mediaLifecycleMigrationFile);

    const [post] = upgradeDatabase.all(`
      SELECT media_url, media_object_id
      FROM posts WHERE id = 'media-upgrade-post';
    `);
    assert(
      post?.media_url === "https://legacy.example/post.mp3" &&
        post?.media_object_id === null,
      "0011 upgrade가 legacy post URL을 보존하거나 nullable object ID를 추가하지 못했습니다.",
    );
    const revisions = upgradeDatabase.all(`
      SELECT revision_number, media_url, media_object_id, snapshot_hash,
             snapshot_hash_version
      FROM post_revisions
      WHERE post_id = 'media-upgrade-post'
      ORDER BY revision_number;
    `);
    assert(
      revisions.length === 2 &&
        revisions.every(
          (revision) =>
            revision.media_url === "https://legacy.example/post.mp3" &&
            revision.media_object_id === null,
        ) &&
        revisions[1]?.snapshot_hash === revisionHash &&
        revisions[1]?.snapshot_hash_version === 1,
      "0011 upgrade가 post revision history 또는 v1 hash를 보존하지 못했습니다.",
    );
    const replies = upgradeDatabase.all(`
      SELECT id, attachment_url, attachment_object_id
      FROM qna_replies
      WHERE thread_id = 'media-upgrade-thread'
      ORDER BY id;
    `);
    assert(
      replies.length === 2 &&
        replies.every(
          (reply) => reply.attachment_url !== null && reply.attachment_object_id === null,
        ),
      "0011 upgrade가 Q&A reply attachment history를 보존하지 못했습니다.",
    );
    assert(
      upgradeDatabase.all("SELECT * FROM media_objects;").length === 0 &&
        upgradeDatabase.all("SELECT * FROM media_deletion_outbox;").length === 0,
      "0011 upgrade의 신규 media table이 비어 있지 않습니다.",
    );
    assert(
      upgradeDatabase.all("PRAGMA foreign_key_check;").length === 0,
      "0011 populated upgrade 뒤 foreign key 위반이 있습니다.",
    );
  } finally {
    upgradeDatabase.close();
  }
}

export function validateMediaLifecycleSemantics(database) {
  const mediaId = "30000000-0000-4000-8000-000000000001";
  const objectKey = "media/community-post-audio/31000000-0000-4000-8000-000000000011";
  const uploadObjectKey = `media-upload/community-post-audio/${mediaId}`;
  const replacementMediaId = "30000000-0000-4000-8000-000000000003";
  const replacementObjectKey =
    "media/community-post-audio/31000000-0000-4000-8000-000000000013";
  const replacementUploadObjectKey =
    `media-upload/community-post-audio/${replacementMediaId}`;
  const missingStagingMediaId = "30000000-0000-4000-8000-000000000007";
  const missingStagingObjectKey =
    "media/community-post-audio/31000000-0000-4000-8000-000000000017";
  const missingStagingUploadObjectKey =
    `media-upload/community-post-audio/${missingStagingMediaId}`;
  database.exec(`
    INSERT INTO profiles (id, email, display_name, role)
    VALUES
      ('media-probe-owner', 'media-probe-owner@example.com', 'Media Owner', 'student'),
      ('media-probe-other', 'media-probe-other@example.com', 'Media Other', 'student');
  `);

  assertSqlFails(
    database,
    `INSERT INTO posts (
      id, author_id, category, board_type, is_pinned, media_url,
      title, content_html, created_at, updated_at, version
    ) VALUES (
      'media-probe-url-only-post', 'media-probe-other', 'feedback', 'FEEDBACK', 0,
      '/api/media/30000000-0000-4000-8000-000000000099',
      'Managed URL only', '<p>Managed URL only</p>', 1700000000, 1700000000, 1
    );`,
    "managed post URL without object ID",
    "POST_MEDIA_REFERENCE_INVALID",
  );
  database.exec(`
    INSERT INTO posts (
      id, author_id, category, board_type, is_pinned, media_url,
      title, content_html, created_at, updated_at, version
    ) VALUES (
      'media-probe-legacy-post', 'media-probe-other', 'feedback', 'FEEDBACK', 0,
      'https://legacy.example/post.mp3',
      'Legacy URL', '<p>Legacy URL</p>', 1700000000, 1700000000, 1
    );
  `);

  assertSqlFails(
    database,
    `INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state, expected_content_type,
      expected_size_bytes, draft_operation_id, upload_expires_at,
      created_at, updated_at
    ) VALUES (
      'bad-media-purpose', 'media-probe-owner', 'OTHER', 'media/other/bad-media-purpose',
      'media-upload/other/bad-media-purpose',
      'PENDING_UPLOAD', 'audio/mpeg', 1024, 'bad-operation',
      1700003600, 1700000000, 1700000000
    );`,
    "media purpose/key CHECK",
  );
  for (const [index, purpose, objectKey, uploadPrefix] of [
    [
      1,
      "COMMUNITY_POST_AUDIO",
      "media/community-post-audio/31000000-0000-1000-8000-000000000001",
      "media-upload/community-post-audio/",
    ],
    [
      2,
      "COMMUNITY_POST_AUDIO",
      "media/community-post-audio/31000000-0000-4000-7000-000000000002",
      "media-upload/community-post-audio/",
    ],
    [
      3,
      "COMMUNITY_POST_AUDIO",
      "media/community-post-audio/3100000-00000-4000-8000-000000000003",
      "media-upload/community-post-audio/",
    ],
    [
      4,
      "QNA_ATTACHMENT",
      "media/qna-attachment/31000000-0000-4000-8000-00000000000A",
      "media-upload/qna-attachment/",
    ],
  ]) {
    const mediaId = `bad-media-key-${index}`;
    assertSqlFails(
      database,
      `INSERT INTO media_objects (
        id, owner_id, purpose, object_key, upload_object_key, state,
        expected_content_type, expected_size_bytes, draft_operation_id,
        upload_expires_at, created_at, updated_at
      ) VALUES (
        '${mediaId}', 'media-probe-owner', '${purpose}', '${objectKey}',
        '${uploadPrefix}${mediaId}', 'PENDING_UPLOAD', 'audio/mpeg', 1024,
        'bad-media-key-operation-${index}', 1700003600, 1700000000, 1700000000
      );`,
      `media UUID key negative ${index}`,
      "media_objects_key_check",
    );
  }
  assertSqlFails(
    database,
    `INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state, expected_content_type,
      expected_size_bytes, actual_size_bytes, draft_operation_id,
      upload_expires_at, ready_at, created_at, updated_at
    ) VALUES (
      '30000000-0000-4000-8000-000000000091', 'media-probe-owner',
      'COMMUNITY_POST_AUDIO',
      'media/community-post-audio/31000000-0000-4000-8000-000000000091',
      'media-upload/community-post-audio/30000000-0000-4000-8000-000000000091',
      'READY',
      'audio/mpeg', 1024, 1024, 'bad-ready-operation',
      1700003600, 1700000001, 1700000000, 1700000001
    );`,
    "media initial state guard",
    "MEDIA_OBJECT_INITIAL_STATE_INVALID",
  );
  assertSqlFails(
    database,
    `INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, draft_operation_id,
      upload_expires_at, created_at, updated_at
    ) VALUES (
      '30000000-0000-4000-8000-000000000092', 'media-probe-owner',
      'COMMUNITY_POST_AUDIO',
      'media/community-post-audio/30000000-0000-4000-8000-000000000092',
      'media-upload/community-post-audio/30000000-0000-4000-8000-000000000092',
      'PENDING_UPLOAD', 'audio/mpeg', 1024,
      '30000000-0000-4000-8000-000000000092',
      1700003600, 1700000000, 1700000000
    );`,
    "final object key reuses public media ID",
  );
  assertSqlFails(
    database,
    `INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, draft_operation_id,
      upload_expires_at, created_at, updated_at
    ) VALUES (
      '30000000-0000-4000-8000-000000000093', 'media-probe-owner',
      'COMMUNITY_POST_AUDIO',
      'media/community-post-audio/31000000-0000-4000-8000-000000000093',
      'media-upload/community-post-audio/30000000-0000-4000-8000-000000000094',
      'PENDING_UPLOAD', 'audio/mpeg', 1024,
      '30000000-0000-4000-8000-000000000093',
      1700003600, 1700000000, 1700000000
    );`,
    "staging object key does not match media ID",
  );

  database.exec(`
    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, draft_operation_id,
      upload_expires_at, created_at, updated_at
    ) VALUES (
      '${missingStagingMediaId}', 'media-probe-owner', 'COMMUNITY_POST_AUDIO',
      '${missingStagingObjectKey}', '${missingStagingUploadObjectKey}',
      'PENDING_UPLOAD', 'audio/mpeg', 1024,
      '30000000-0000-4000-8000-000000000008',
      1700003600, 1700000000, 1700000000
    );
    UPDATE media_objects
    SET state = 'SEALING', seal_lease_id = 'expired-cleanup-lease',
        seal_lease_expires_at = 1700000100, updated_at = 1700000001
    WHERE id = '${missingStagingMediaId}';
  `);
  assertSqlFails(
    database,
    `INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'bad-media-unrelated-key', '${missingStagingMediaId}',
      'media/community-post-audio/31000000-0000-4000-8000-000000000099',
      'ADMIN_CLEANUP', 1700000001, 0, 1700000001, 1700000001, 1700000001
    );`,
    "outbox key outside media final/staging pair",
    "MEDIA_DELETION_OUTBOX_INVALID",
  );
  assertSqlFails(
    database,
    `INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'bad-media-final-staging-reason', '${missingStagingMediaId}',
      '${missingStagingObjectKey}', 'UPLOAD_STAGING_EXPIRED',
      1700000001, 0, 1700000001, 1700000001, 1700000001
    );`,
    "final key staging-only reason",
    "MEDIA_DELETION_OUTBOX_INVALID",
  );
  assertSqlFails(
    database,
    `INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'bad-media-active-sealing-final', '${missingStagingMediaId}',
      '${missingStagingObjectKey}', 'ADMIN_CLEANUP',
      1700000050, 0, 1700000050, 1700000050, 1700000050
    );`,
    "active sealing final cleanup outbox",
    "MEDIA_DELETION_OUTBOX_INVALID",
  );
  assertSqlFails(
    database,
    `INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'bad-media-active-sealing-staging', '${missingStagingMediaId}',
      '${missingStagingUploadObjectKey}', 'UPLOAD_STAGING_EXPIRED',
      1700000050, 0, 1700000050, 1700000050, 1700000050
    );`,
    "active sealing staging cleanup scheduled before lease expiry",
    "MEDIA_DELETION_OUTBOX_INVALID",
  );
  database.exec(`
    INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'media-delete:${missingStagingMediaId}:final', '${missingStagingMediaId}',
      '${missingStagingObjectKey}', 'ADMIN_CLEANUP',
      1700000100, 0, 1700000100, 1700000100, 1700000100
    );
  `);
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'PENDING_DELETE', seal_lease_id = NULL,
         seal_lease_expires_at = NULL, delete_requested_at = 1700000100,
         updated_at = 1700000100
     WHERE id = '${missingStagingMediaId}';`,
    "media PENDING_DELETE without staging cleanup row",
    "MEDIA_OBJECT_DELETION_OUTBOX_REQUIRED",
  );
  database.exec(`
    INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'media-delete:${missingStagingMediaId}:staging', '${missingStagingMediaId}',
      '${missingStagingUploadObjectKey}', 'UPLOAD_STAGING_EXPIRED',
      1700000101, 0, 1700000101, 1700000101, 1700000101
    );
  `);
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'PENDING_DELETE', seal_lease_id = NULL,
         seal_lease_expires_at = NULL, delete_requested_at = 1700000050,
         updated_at = 1700000050
     WHERE id = '${missingStagingMediaId}';`,
    "active media sealing lease deletion",
    "MEDIA_OBJECT_STATE_TRANSITION_INVALID",
  );
  database.exec(`
    UPDATE media_objects
    SET state = 'PENDING_DELETE', seal_lease_id = NULL,
        seal_lease_expires_at = NULL, delete_requested_at = 1700000101,
        updated_at = 1700000101
    WHERE id = '${missingStagingMediaId}';
  `);

  database.exec(`
    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, draft_operation_id,
      upload_expires_at, created_at, updated_at
    ) VALUES (
      '30000000-0000-4000-8000-000000000009', 'media-probe-owner',
      'QNA_ATTACHMENT',
      'media/qna-attachment/31000000-0000-4000-8000-000000000019',
      'media-upload/qna-attachment/30000000-0000-4000-8000-000000000009',
      'PENDING_UPLOAD', 'image/jpeg', 2048,
      '30000000-0000-4000-8000-000000000010',
      1700003600, 1700000000, 1700000000
    );
  `);

  database.exec(`
    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state, expected_content_type,
      expected_size_bytes, draft_operation_id, upload_expires_at,
      created_at, updated_at
    ) VALUES (
      '${mediaId}', 'media-probe-owner', 'COMMUNITY_POST_AUDIO', '${objectKey}',
      '${uploadObjectKey}', 'PENDING_UPLOAD', 'audio/mpeg', 1024,
      '30000000-0000-4000-8000-000000000002',
      1700003600, 1700000000, 1700000000
    );
  `);
  for (const recursiveTriggers of ["OFF", "ON"]) {
    database.exec(`PRAGMA recursive_triggers = ${recursiveTriggers};`);
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO media_objects (
        id, owner_id, purpose, object_key, upload_object_key, state,
        expected_content_type, expected_size_bytes, draft_operation_id,
        upload_expires_at, created_at, updated_at
      ) VALUES (
        '${mediaId}', 'media-probe-owner', 'COMMUNITY_POST_AUDIO',
        '${objectKey}', '${uploadObjectKey}', 'PENDING_UPLOAD',
        'audio/mpeg', 1024, '30000000-0000-4000-8000-000000000002',
        1700003600, 1700000000, 1700000000
      );`,
      `media object ID INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "MEDIA_OBJECT_DUPLICATE",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO media_objects (
        id, owner_id, purpose, object_key, upload_object_key, state,
        expected_content_type, expected_size_bytes, draft_operation_id,
        upload_expires_at, created_at, updated_at
      ) VALUES (
        '30000000-0000-4000-8000-000000000021', 'media-probe-owner',
        'COMMUNITY_POST_AUDIO', '${objectKey}',
        'media-upload/community-post-audio/30000000-0000-4000-8000-000000000021',
        'PENDING_UPLOAD', 'audio/mpeg', 1024,
        '30000000-0000-4000-8000-000000000022',
        1700003600, 1700000000, 1700000000
      );`,
      `media object key INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "MEDIA_OBJECT_DUPLICATE",
    );
    assertSqlFails(
      database,
      `UPDATE OR REPLACE media_objects
       SET object_key = '${missingStagingObjectKey}'
       WHERE id = '${mediaId}';`,
      `media object key UPDATE OR REPLACE recursive_triggers=${recursiveTriggers}`,
    );
  }
  database.exec("PRAGMA recursive_triggers = OFF;");
  assert(
    database.all(`
      SELECT id, object_key FROM media_objects WHERE id = '${mediaId}';
    `)[0]?.object_key === objectKey &&
      database.all(`
        SELECT id FROM media_objects WHERE id = '${missingStagingMediaId}';
      `).length === 1,
    "media object INSERT/UPDATE OR REPLACE가 registry identity를 교체했습니다.",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'ATTACHED', actual_size_bytes = 1024, ready_at = 1700000001,
         resource_type = 'COMMUNITY_POST', resource_id = 'media-probe-post',
         attached_at = 1700000002, updated_at = 1700000002
    WHERE id = '${mediaId}';`,
    "media skipped state transition",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects SET owner_id = 'media-probe-other'
     WHERE id = '${mediaId}';`,
    "media owner identity mutation",
  );

  assertSqlFails(
    database,
    `INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'bad-media-staging-reason', '${mediaId}', '${uploadObjectKey}',
      'RESOURCE_PURGED', 1700000001, 0, 1700000001, 1700000001, 1700000001
    );`,
    "staging key deletion reason mismatch",
    "MEDIA_DELETION_OUTBOX_INVALID",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'READY', actual_size_bytes = 1024, etag = 'probe-etag',
         ready_at = 1700000001, updated_at = 1700000001
    WHERE id = '${mediaId}';`,
    "media direct PENDING_UPLOAD to READY transition",
  );

  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'SEALING', seal_lease_id = 'probe-seal-lease-1',
         updated_at = 1700000001
     WHERE id = '${mediaId}';`,
    "media sealing claim without lease expiry",
  );
  database.exec(`
    UPDATE media_objects
    SET state = 'SEALING', seal_lease_id = 'probe-seal-lease-1',
        seal_lease_expires_at = 1700000100, updated_at = 1700000001
    WHERE id = '${mediaId}';
  `);
  assert(
    database.all(`
      SELECT state, seal_lease_id, seal_lease_expires_at
      FROM media_objects WHERE id = '${mediaId}';
    `)[0]?.state === "SEALING" &&
      database.all(`
        SELECT seal_lease_id FROM media_objects WHERE id = '${mediaId}';
      `)[0]?.seal_lease_id === "probe-seal-lease-1",
    "media sealing claim payload가 보존되지 않았습니다.",
  );
  database.exec(`
    UPDATE media_objects
    SET seal_lease_expires_at = 1700000150, updated_at = 1700000002
    WHERE id = '${mediaId}' AND state = 'SEALING'
      AND seal_lease_id = 'probe-seal-lease-1'
      AND seal_lease_expires_at > 1700000002;
  `);
  assert(
    database.all(`
      SELECT state, seal_lease_id, seal_lease_expires_at, updated_at
      FROM media_objects WHERE id = '${mediaId}';
    `)[0]?.state === "SEALING" &&
      database.all(`
        SELECT seal_lease_id, seal_lease_expires_at, updated_at
        FROM media_objects WHERE id = '${mediaId}';
      `)[0]?.seal_lease_id === "probe-seal-lease-1" &&
      database.all(`
        SELECT seal_lease_expires_at FROM media_objects WHERE id = '${mediaId}';
      `)[0]?.seal_lease_expires_at === 1700000150,
    "matching media sealing lease renewal이 만료 시각을 연장하지 못했습니다.",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET updated_at = 1700000003
     WHERE id = '${mediaId}' AND seal_lease_id = 'probe-seal-lease-1';`,
    "media sealing same-state update without renewal",
    "MEDIA_OBJECT_STATE_TRANSITION_INVALID",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET seal_lease_expires_at = 1700000200, updated_at = 1700000001
     WHERE id = '${mediaId}' AND seal_lease_id = 'probe-seal-lease-1';`,
    "media sealing renewal timestamp regression",
    "MEDIA_OBJECT_TRANSITION_PAYLOAD_INVALID",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET seal_lease_id = 'arbitrary-seal-lease',
         seal_lease_expires_at = 1700000200, updated_at = 1700000002
    WHERE id = '${mediaId}';`,
    "media sealing lease arbitrary mutation",
    "MEDIA_OBJECT_TRANSITION_PAYLOAD_INVALID",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET seal_lease_expires_at = 1700000140, updated_at = 1700000003
     WHERE id = '${mediaId}' AND seal_lease_id = 'probe-seal-lease-1';`,
    "media sealing lease expiry shrink",
    "MEDIA_OBJECT_TRANSITION_PAYLOAD_INVALID",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET seal_lease_expires_at = 1700000200, etag = 'renewal-mutation',
         updated_at = 1700000003
     WHERE id = '${mediaId}' AND seal_lease_id = 'probe-seal-lease-1';`,
    "media sealing renewal payload mutation",
    "MEDIA_OBJECT_TRANSITION_PAYLOAD_INVALID",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'PENDING_UPLOAD', seal_lease_id = NULL,
         updated_at = 1700000002
     WHERE id = '${mediaId}' AND seal_lease_id = 'probe-seal-lease-1';`,
    "media sealing release with partial lease clear",
  );
  database.exec(`
    UPDATE media_objects
    SET state = 'PENDING_UPLOAD', seal_lease_id = NULL,
        seal_lease_expires_at = NULL, updated_at = 1700000002
    WHERE id = '${mediaId}' AND state = 'SEALING'
      AND seal_lease_id = 'probe-seal-lease-1';
  `);
  assert(
    database.all(`
      SELECT state, seal_lease_id, seal_lease_expires_at
      FROM media_objects WHERE id = '${mediaId}';
    `)[0]?.state === "PENDING_UPLOAD" &&
      database.all(`
        SELECT seal_lease_id, seal_lease_expires_at
        FROM media_objects WHERE id = '${mediaId}';
      `)[0]?.seal_lease_id === null,
    "matching media sealing release가 lease를 정리하지 못했습니다.",
  );
  database.exec(`
    UPDATE media_objects
    SET state = 'SEALING', seal_lease_id = 'probe-seal-lease-2',
        seal_lease_expires_at = 1700000200, updated_at = 1700000003
    WHERE id = '${mediaId}';
  `);
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'READY', seal_lease_id = NULL, seal_lease_expires_at = NULL,
         actual_size_bytes = 1024, etag = 'probe-etag',
         ready_at = 1700000004, updated_at = 1700000004
     WHERE id = '${mediaId}' AND seal_lease_id = 'probe-seal-lease-2';`,
    "media READY without staging cleanup",
    "MEDIA_OBJECT_DELETION_OUTBOX_REQUIRED",
  );

  database.exec(`
    INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'media-staging-delete:${mediaId}', '${mediaId}', '${uploadObjectKey}',
      'UPLOAD_STAGING_EXPIRED', 1700000200, 0, 1700000200,
      1700000004, 1700000004
    );
    UPDATE media_objects
    SET state = 'READY', seal_lease_id = NULL, seal_lease_expires_at = NULL,
        actual_size_bytes = 1024, etag = 'probe-etag',
        ready_at = 1700000004, updated_at = 1700000004
    WHERE id = '${mediaId}' AND state = 'SEALING'
      AND seal_lease_id = 'probe-seal-lease-2';
  `);
  for (const recursiveTriggers of ["OFF", "ON"]) {
    database.exec(`PRAGMA recursive_triggers = ${recursiveTriggers};`);
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO media_deletion_outbox (
        id, media_object_id, object_key, reason, not_before,
        attempt_count, next_attempt_at, created_at, updated_at
      ) VALUES (
        'media-staging-delete:${mediaId}', '${mediaId}', '${objectKey}',
        'ADMIN_CLEANUP', 1700000201, 0, 1700000201,
        1700000005, 1700000005
      );`,
      `media outbox ID INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "MEDIA_DELETION_OUTBOX_DUPLICATE",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO media_deletion_outbox (
        id, media_object_id, object_key, reason, not_before,
        attempt_count, next_attempt_at, created_at, updated_at
      ) VALUES (
        'replacement-staging-delete:${mediaId}', '${mediaId}', '${uploadObjectKey}',
        'UPLOAD_STAGING_EXPIRED', 1700000250, 0, 1700000250,
        1700000005, 1700000005
      );`,
      `media outbox object INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "MEDIA_DELETION_OUTBOX_DUPLICATE",
    );
  }
  database.exec("PRAGMA recursive_triggers = OFF;");
  assert(
    database.all(`
      SELECT id, not_before FROM media_deletion_outbox
      WHERE media_object_id = '${mediaId}' AND object_key = '${uploadObjectKey}';
    `)[0]?.not_before === 1700000200,
    "media outbox INSERT OR REPLACE가 staging cleanup 일정을 교체했습니다.",
  );
  assertSqlFails(
    database,
    `INSERT INTO posts (
       id, author_id, category, board_type, is_pinned, media_url, media_object_id,
       title, content_html, created_at, updated_at, version
     ) VALUES (
       'media-probe-post', 'media-probe-owner', 'feedback', 'FEEDBACK', 0,
       '/api/media/${mediaId}', '${mediaId}', 'Probe', '<p>Probe</p>',
       1700000002, 1700000002, 1
     );`,
    "post media resource match guard",
    "POST_MEDIA_REFERENCE_INVALID",
  );

  database.exec(`
    UPDATE media_objects
    SET state = 'ATTACHED', resource_type = 'COMMUNITY_POST',
        resource_id = 'media-probe-post', attached_at = 1700000005,
        updated_at = 1700000005
    WHERE id = '${mediaId}';
  `);
  assertSqlFails(
    database,
    `INSERT INTO posts (
      id, author_id, category, board_type, is_pinned, media_url, media_object_id,
      title, content_html, created_at, updated_at, version
    ) VALUES (
      'media-probe-post', 'media-probe-owner', 'feedback', 'FEEDBACK', 0,
      'https://public.example/probe', '${mediaId}', 'Probe', '<p>Probe</p>',
      1700000002, 1700000002, 1
    );`,
    "managed post public URL bypass",
    "POST_MEDIA_REFERENCE_INVALID",
  );
  database.exec(`
    INSERT INTO posts (
      id, author_id, category, board_type, is_pinned, media_url, media_object_id,
      title, content_html, created_at, updated_at, version
    ) VALUES (
      'media-probe-post', 'media-probe-owner', 'feedback', 'FEEDBACK', 0,
      '/api/media/${mediaId}', '${mediaId}', 'Probe', '<p>Probe</p>',
      1700000002, 1700000002, 1
    );
  `);
  assertSqlFails(
    database,
    `UPDATE posts
     SET media_url = NULL, media_object_id = NULL, updated_at = 1700000003
     WHERE id = 'media-probe-post';`,
    "managed post object ID clear",
    "POST_MEDIA_REFERENCE_INVALID",
  );

  database.exec(`
    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state, expected_content_type,
      expected_size_bytes, draft_operation_id, upload_expires_at,
      created_at, updated_at
    ) VALUES (
      '${replacementMediaId}', 'media-probe-owner', 'COMMUNITY_POST_AUDIO',
      '${replacementObjectKey}', '${replacementUploadObjectKey}',
      'PENDING_UPLOAD', 'audio/mpeg', 2048,
      '30000000-0000-4000-8000-000000000004',
      1700003600, 1700000000, 1700000000
    );
    UPDATE media_objects
    SET state = 'SEALING', seal_lease_id = 'replacement-seal-lease',
        seal_lease_expires_at = 1700000100, updated_at = 1700000002
    WHERE id = '${replacementMediaId}';
    INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'media-staging-delete:${replacementMediaId}', '${replacementMediaId}',
      '${replacementUploadObjectKey}', 'UPLOAD_STAGING_EXPIRED',
      1700000100, 0, 1700000100, 1700000003, 1700000003
    );
    UPDATE media_objects
    SET state = 'READY', seal_lease_id = NULL, seal_lease_expires_at = NULL,
        actual_size_bytes = 2048, etag = 'replacement-etag',
        ready_at = 1700000003, updated_at = 1700000003
    WHERE id = '${replacementMediaId}' AND state = 'SEALING'
      AND seal_lease_id = 'replacement-seal-lease';
    UPDATE media_objects
    SET state = 'ATTACHED', resource_type = 'COMMUNITY_POST',
        resource_id = 'media-probe-post', attached_at = 1700000004,
        updated_at = 1700000004
    WHERE id = '${replacementMediaId}';
  `);
  assertSqlFails(
    database,
    `UPDATE posts
     SET media_url = '/api/media/${replacementMediaId}',
         media_object_id = '${replacementMediaId}', updated_at = 1700000004
     WHERE id = 'media-probe-post';`,
    "managed post object ID replacement",
    "POST_MEDIA_REFERENCE_INVALID",
  );
  assert(
    database.all(`
      SELECT media_object_id FROM posts WHERE id = 'media-probe-post';
    `)[0]?.media_object_id === mediaId,
    "거부된 managed post ID 변경이 head에 반영되었습니다.",
  );

  database.exec(`
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'media-probe-post-ledger',
      '30000000-0000-4000-8000-000000000005',
      'media-probe-owner', 'media-probe-owner', 'COMMUNITY_POST', 'CREATE',
      'media-probe-post', '${"c".repeat(64)}', 2, 1, 1700000002
    );
  `);
  assertSqlFails(
    database,
    `INSERT INTO post_revisions (
      id, post_id, revision_number, change_type, category, board_type,
      is_pinned, media_url, media_object_id, title, content_html,
      snapshot_hash, snapshot_hash_version, actor_id,
      operation_record_id, created_at
    ) VALUES (
      'media-probe-managed-url-revision', 'media-probe-post', 1, 'CREATE',
      'feedback', 'FEEDBACK', 0, '/api/media/${mediaId}', NULL,
      'Managed URL only', '<p>Managed URL only</p>', '${"d".repeat(64)}', 2,
      'media-probe-owner', 'media-probe-post-ledger', 1700000002
    );`,
    "managed post revision URL without object ID",
    "POST_REVISION_MEDIA_REFERENCE_INVALID",
  );
  database.exec(`
    INSERT INTO post_revisions (
      id, post_id, revision_number, change_type, category, board_type,
      is_pinned, media_url, media_object_id, title, content_html,
      snapshot_hash, snapshot_hash_version, actor_id,
      operation_record_id, created_at
    ) VALUES (
      'media-probe-legacy-revision', 'media-probe-post', 1, 'CREATE',
      'feedback', 'FEEDBACK', 0, 'https://legacy.example/revision.mp3', NULL,
      'Legacy URL', '<p>Legacy URL</p>', '${"d".repeat(64)}', 2,
      'media-probe-owner', 'media-probe-post-ledger', 1700000002
    );
  `);

  database.exec(`
    INSERT INTO qna_threads (
      id, student_id, title, status, created_at, updated_at, version
    ) VALUES (
      'media-probe-managed-url-thread', 'media-probe-owner',
      'Managed URL Q&A', 'OPEN', 1700000002, 1700000002, 1
    );
    INSERT INTO document_operation_ledger (
      id, operation_id, actor_id, subject_id, resource_type, operation_type,
      resource_id, request_hash, request_hash_version, result_revision, created_at
    ) VALUES (
      'media-probe-qna-ledger',
      '30000000-0000-4000-8000-000000000006',
      'media-probe-owner', 'media-probe-owner', 'QNA_THREAD', 'CREATE',
      'media-probe-managed-url-thread', '${"e".repeat(64)}', 2, 1, 1700000002
    );
  `);
  assertSqlFails(
    database,
    `INSERT INTO qna_replies (
      id, thread_id, author_id, content_html, attachment_url,
      attachment_object_id, created_at
    ) VALUES (
      'media-probe-managed-url-reply', 'media-probe-managed-url-thread',
      'media-probe-owner', '<p>Managed URL only</p>',
      '/api/media/30000000-0000-4000-8000-000000000098', NULL, 1700000002
    );`,
    "managed Q&A reply URL without object ID",
    "QNA_REPLY_MEDIA_REFERENCE_INVALID",
  );
  database.exec(`
    INSERT INTO qna_replies (
      id, thread_id, author_id, content_html, attachment_url,
      attachment_object_id, created_at
    ) VALUES (
      'media-probe-legacy-reply', 'media-probe-managed-url-thread',
      'media-probe-owner', '<p>Legacy URL</p>',
      'https://legacy.example/reply.jpg', NULL, 1700000002
    );
  `);
  assertSqlFails(
    database,
    "DELETE FROM posts WHERE id = 'media-probe-post';",
    "attached post media purge guard",
    "POST_MEDIA_DELETE_NOT_QUEUED",
  );
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'PENDING_DELETE', delete_requested_at = 1700000300,
         updated_at = 1700000300
     WHERE id = '${mediaId}';`,
    "media deletion without durable outbox",
    "MEDIA_OBJECT_DELETION_OUTBOX_REQUIRED",
  );
  assertSqlFails(
    database,
    `INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'bad-media-outbox', '${mediaId}', '${objectKey}', 'RESOURCE_PURGED',
      1700000300, 1, 1700000300, 1700000300, 1700000300
    );`,
    "media outbox initial payload guard",
    "MEDIA_DELETION_OUTBOX_INVALID",
  );

  database.exec(`
    INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'media-delete:${mediaId}', '${mediaId}', '${objectKey}', 'RESOURCE_PURGED',
      1700000300, 0, 1700000300, 1700000300, 1700000300
    );
  `);
  assertSqlFails(
    database,
    `UPDATE media_deletion_outbox
     SET completed_at = 1700000400, updated_at = 1700000400
     WHERE id = 'media-delete:${mediaId}';`,
    "media outbox completion without lease",
    "MEDIA_DELETION_OUTBOX_TRANSITION_INVALID",
  );
  database.exec(`
    UPDATE media_objects
    SET state = 'PENDING_DELETE', delete_requested_at = 1700000300,
        updated_at = 1700000300
    WHERE id = '${mediaId}';
  `);
  database.exec(`
    UPDATE media_deletion_outbox
    SET lease_id = 'probe-lease', lease_expires_at = 1700000500,
        updated_at = 1700000350
    WHERE id = 'media-delete:${mediaId}';
    UPDATE media_deletion_outbox
    SET completed_at = 1700000400, lease_id = NULL, lease_expires_at = NULL,
        last_error_code = NULL, updated_at = 1700000400
    WHERE id = 'media-delete:${mediaId}';
  `);
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'DELETED', deleted_at = 1700000400, updated_at = 1700000400
     WHERE id = '${mediaId}';`,
    "media DELETED while staging cleanup incomplete",
    "MEDIA_OBJECT_DELETION_OUTBOX_REQUIRED",
  );
  database.exec(`
    UPDATE media_deletion_outbox
    SET lease_id = 'probe-staging-lease', lease_expires_at = 1700000495,
        updated_at = 1700000395
    WHERE id = 'media-staging-delete:${mediaId}';
    UPDATE media_deletion_outbox
    SET completed_at = 1700000399, lease_id = NULL, lease_expires_at = NULL,
        last_error_code = NULL, updated_at = 1700000399
    WHERE id = 'media-staging-delete:${mediaId}';
  `);
  assertSqlFails(
    database,
    `UPDATE media_objects
     SET state = 'DELETED', delete_requested_at = 1700000301,
         deleted_at = 1700000400, updated_at = 1700000400
     WHERE id = '${mediaId}';`,
    "media delete request timestamp mutation",
    "MEDIA_OBJECT_TRANSITION_PAYLOAD_INVALID",
  );
  database.exec(`
    INSERT INTO media_deletion_outbox (
      id, media_object_id, object_key, reason, not_before,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'media-delete:${replacementMediaId}', '${replacementMediaId}',
      '${replacementObjectKey}', 'RESOURCE_PURGED',
      1700000390, 0, 1700000390, 1700000390, 1700000390
    );
    UPDATE media_objects
    SET state = 'PENDING_DELETE', delete_requested_at = 1700000390,
        updated_at = 1700000390
    WHERE id = '${replacementMediaId}';
    UPDATE media_objects
    SET state = 'DELETED', deleted_at = 1700000400, updated_at = 1700000400
    WHERE id = '${mediaId}';
    DELETE FROM qna_threads WHERE id = 'media-probe-managed-url-thread';
    DELETE FROM posts WHERE id = 'media-probe-post';
    DELETE FROM posts WHERE id = 'media-probe-legacy-post';
  `);
  assert(
    database.all("SELECT id FROM posts WHERE id = 'media-probe-post';").length === 0 &&
      database.all(`SELECT state FROM media_objects WHERE id = '${mediaId}';`)[0]?.state ===
        "DELETED" &&
      database.all(
        `SELECT completed_at FROM media_deletion_outbox WHERE id = 'media-delete:${mediaId}';`,
      )[0]?.completed_at === 1700000400 &&
      database.all(
        `SELECT completed_at FROM media_deletion_outbox WHERE id = 'media-staging-delete:${mediaId}';`,
      )[0]?.completed_at === 1700000399,
    "media purge/delete completion 상태가 수렴하지 않았습니다.",
  );
  assertSqlFails(
    database,
    `DELETE FROM media_objects WHERE id = '${mediaId}';`,
    "media registry direct delete guard",
    "MEDIA_OBJECT_DELETE_GUARD",
  );
  assertSqlFails(
    database,
    `DELETE FROM media_deletion_outbox WHERE id = 'media-delete:${mediaId}';`,
    "media outbox direct delete guard",
    "MEDIA_DELETION_OUTBOX_DELETE_GUARD",
  );
  assertSqlFails(
    database,
    "DELETE FROM profiles WHERE id = 'media-probe-owner';",
    "media owner profile fail-closed RESTRICT",
  );
  assert(
    database.all("PRAGMA foreign_key_check;").length === 0,
    "media lifecycle semantic probe 뒤 foreign key 위반이 있습니다.",
  );
}
