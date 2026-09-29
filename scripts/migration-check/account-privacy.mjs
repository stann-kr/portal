import {
  accountPrivacyMigrationFile,
  applyMigration,
  applyMigrations,
  createMemoryDatabase,
  migrationsDirectory,
  repositoryRoot,
} from "./runtime.mjs";
import { assert, assertSqlFails } from "./assertions.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function validateAccountPrivacyUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(accountPrivacyMigrationFile);
  assert(migrationIndex > 0, `${accountPrivacyMigrationFile} 순서를 찾지 못했습니다.`);
  const priorMigrations = migrationFiles.slice(0, migrationIndex);
  const upgradeDatabase = await createMemoryDatabase();

  try {
    applyMigrations(upgradeDatabase, priorMigrations);
    upgradeDatabase.exec(`
      INSERT INTO profiles (id, email, display_name, role)
      VALUES
        ('privacy-upgrade-student', 'privacy-upgrade-student@example.com', 'Privacy Student', 'student'),
        ('privacy-upgrade-admin', 'privacy-upgrade-admin@example.com', 'Privacy Admin', 'admin');
      INSERT INTO media_objects (
        id, owner_id, purpose, object_key, upload_object_key, state,
        expected_content_type, expected_size_bytes, draft_operation_id,
        upload_expires_at, created_at, updated_at
      ) VALUES (
        '40000000-0000-4000-8000-000000000001', 'privacy-upgrade-student',
        'COMMUNITY_POST_AUDIO',
        'media/community-post-audio/41000000-0000-4000-8000-000000000001',
        'media-upload/community-post-audio/40000000-0000-4000-8000-000000000001',
        'PENDING_UPLOAD', 'audio/mpeg', 1024,
        '40000000-0000-4000-8000-000000000002',
        1800003600, 1800000000, 1800000000
      );
      INSERT INTO posts (
        id, author_id, category, board_type, title, content_html,
        created_at, updated_at, version
      ) VALUES (
        'privacy-upgrade-post', 'privacy-upgrade-student', 'general', 'GENERAL',
        'Preserved', '<p>Preserved</p>', 1800000000, 1800000000, 1
      );
    `);

    applyMigration(upgradeDatabase, accountPrivacyMigrationFile);

    assert(
      upgradeDatabase.all(`
        SELECT id FROM profiles
        WHERE id IN ('privacy-upgrade-student', 'privacy-upgrade-admin')
      `).length === 2,
      "0012 upgrade가 기존 profile을 보존하지 못했습니다.",
    );
    const [media] = upgradeDatabase.all(`
      SELECT owner_id, state, object_key
      FROM media_objects
      WHERE id = '40000000-0000-4000-8000-000000000001'
    `);
    assert(
      media?.owner_id === "privacy-upgrade-student" &&
        media?.state === "PENDING_UPLOAD" &&
        media?.object_key ===
          "media/community-post-audio/41000000-0000-4000-8000-000000000001",
      "0012 media FK rebuild가 populated registry를 보존하지 못했습니다.",
    );
    assert(
      upgradeDatabase.all("SELECT * FROM account_deletion_jobs;").length === 0 &&
        upgradeDatabase.all("SELECT * FROM account_cleanup_tokens;").length === 0 &&
        upgradeDatabase.all("SELECT * FROM calendar_feed_tokens;").length === 0,
      "0012 신규 privacy table이 비어 있지 않습니다.",
    );
    const [ownerForeignKey] = upgradeDatabase.all(`
      SELECT lower(on_delete) AS on_delete
      FROM pragma_foreign_key_list('media_objects')
      WHERE "from" = 'owner_id' AND "table" = 'profiles'
    `);
    assert(
      ownerForeignKey?.on_delete === "set null",
      "0012 media owner FK가 ON DELETE SET NULL로 전환되지 않았습니다.",
    );
    assertSqlFails(
      upgradeDatabase,
      "DELETE FROM profiles WHERE id = 'privacy-upgrade-student';",
      "0012 direct student profile delete",
      "DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED",
    );
    assert(
      upgradeDatabase.all("PRAGMA foreign_key_check;").length === 0,
      "0012 populated upgrade 뒤 foreign key 위반이 있습니다.",
    );
  } finally {
    upgradeDatabase.close();
  }

  const rollbackDatabase = await createMemoryDatabase();
  try {
    applyMigrations(rollbackDatabase, priorMigrations);
    rollbackDatabase.exec(`
      INSERT INTO profiles (id, email, role)
      VALUES ('privacy-rollback-student', 'privacy-rollback@example.com', 'student');
      INSERT INTO media_objects (
        id, owner_id, purpose, object_key, upload_object_key, state,
        expected_content_type, expected_size_bytes, draft_operation_id,
        upload_expires_at, created_at, updated_at
      ) VALUES (
        '42000000-0000-4000-8000-000000000001', 'privacy-rollback-student',
        'COMMUNITY_POST_AUDIO',
        'media/community-post-audio/43000000-0000-4000-8000-000000000001',
        'media-upload/community-post-audio/42000000-0000-4000-8000-000000000001',
        'PENDING_UPLOAD', 'audio/mpeg', 1024,
        '42000000-0000-4000-8000-000000000002',
        1800003600, 1800000000, 1800000000
      );
      CREATE TABLE privacy_extension_probe (id TEXT PRIMARY KEY NOT NULL);
      CREATE TRIGGER privacy_extension_probe_media_guard
      BEFORE INSERT ON privacy_extension_probe
      WHEN EXISTS (SELECT 1 FROM media_objects)
      BEGIN
        SELECT RAISE(ABORT, 'PRIVACY_EXTENSION_MEDIA_PRESENT');
      END;
    `);
    let migrationFailure = null;
    try {
      applyMigration(rollbackDatabase, accountPrivacyMigrationFile);
    } catch (error) {
      migrationFailure = error;
    }
    assert(
      migrationFailure,
      "0012가 알 수 없는 cross-table media trigger를 둔 채 rebuild를 진행했습니다.",
    );
    assert(
      rollbackDatabase.all(`
        SELECT id FROM media_objects
        WHERE id = '42000000-0000-4000-8000-000000000001'
      `).length === 1,
      "0012 실패 rollback이 populated media row를 변경했습니다.",
    );
    assert(
      rollbackDatabase.all(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'account_deletion_jobs'
      `).length === 0,
      "0012 실패 rollback이 신규 privacy table 일부를 남겼습니다.",
    );
    const [ownerForeignKey] = rollbackDatabase.all(`
      SELECT lower(on_delete) AS on_delete
      FROM pragma_foreign_key_list('media_objects')
      WHERE "from" = 'owner_id' AND "table" = 'profiles'
    `);
    assert(
      ownerForeignKey?.on_delete === "restrict",
      "0012 실패 rollback이 기존 media owner FK를 변경했습니다.",
    );
  } finally {
    rollbackDatabase.close();
  }
}

export function validateAccountPrivacySemantics(database) {
  const hash = "a".repeat(64);
  const otherHash = "b".repeat(64);
  const aliasProbeHash = "d".repeat(64);
  const reuseHash = "e".repeat(64);
  const ephemeralHash = "f".repeat(64);
  database.exec(`
    INSERT INTO profiles (id, email, role)
    VALUES
      ('privacy-probe-student', 'privacy-probe-student@example.com', 'student'),
      ('privacy-probe-admin', 'privacy-probe-admin@example.com', 'admin'),
      ('privacy-probe-alias', 'privacy-probe-alias@example.com', 'student'),
      ('privacy-probe-reuse', 'privacy-probe-reuse@example.com', 'student'),
      ('privacy-probe-ephemeral', 'privacy-probe-ephemeral@example.com', 'student');
    INSERT INTO account_cleanup_tokens (
      token_digest, subject_id, status, created_at, updated_at
    ) VALUES
      ('${hash}', 'privacy-probe-student', 'ACTIVE', 1700000000, 1700000000),
      ('${aliasProbeHash}', 'privacy-probe-alias', 'ACTIVE', 1700000000, 1700000000),
      ('${reuseHash}', 'privacy-probe-reuse', 'ACTIVE', 1700000000, 1700000000);
    INSERT INTO calendar_feed_tokens (
      owner_id, token_digest, created_at, updated_at
    ) VALUES
      ('privacy-probe-student', '${otherHash}', 1700000000, 1700000000),
      ('privacy-probe-alias', '${aliasProbeHash}', 1700000000, 1700000000);
    INSERT INTO account_deletion_jobs (
      id, operation_id, subject_id, erasure_alias,
      initiating_token_digest, initiating_token_mode, request_hash,
      request_hash_version, status, requested_at, alias_after, updated_at
    ) VALUES (
      'privacy-probe-job', '50000000-0000-4000-8000-000000000001',
      'privacy-probe-student',
      'erased:51000000-0000-4000-8000-000000000001',
      '${hash}', 'PERSISTENT', '${hash}', 1,
      'ERASING', 1700000000, 1702592000, 1700000000
    );
  `);

  for (const [label, invalidAlias] of [
    ["길이 초과", "erased:51000000-0000-4000-8000-000000000001x"],
    ["대문자 hex", "erased:51000000-0000-4000-8000-00000000000A"],
    ["hyphen 위치", "erased:5100000-00000-4000-8000-000000000001"],
    ["UUID version", "erased:51000000-0000-1000-8000-000000000001"],
    ["UUID variant", "erased:51000000-0000-4000-7000-000000000001"],
  ]) {
    assertSqlFails(
      database,
      `INSERT INTO account_deletion_jobs (
        id, operation_id, subject_id, erasure_alias,
        initiating_token_digest, initiating_token_mode, request_hash,
        request_hash_version, status, requested_at, alias_after, updated_at
      ) VALUES (
        'privacy-alias-negative-job',
        '52000000-0000-4000-8000-000000000001',
        'privacy-probe-alias', '${invalidAlias}',
        '${aliasProbeHash}', 'PERSISTENT', '${hash}', 1,
        'ERASING', 1700000000, 1702592000, 1700000000
      );`,
      `account erasure alias ${label}`,
      "account_deletion_jobs_identity_check",
    );
  }

  assertSqlFails(
    database,
    `UPDATE account_deletion_jobs
     SET status = 'ERASED', erased_at = 1700000001, updated_at = 1700000001
     WHERE id = 'privacy-probe-job';`,
    "profile 존재 중 account deletion completion",
    "ACCOUNT_DELETION_JOB_TRANSITION_INVALID",
  );
  assertSqlFails(
    database,
    `UPDATE account_cleanup_tokens
     SET subject_id = NULL, deletion_job_id = 'privacy-probe-job',
         status = 'ERASED', erased_at = 1700000001, updated_at = 1700000001
     WHERE token_digest = '${hash}';`,
    "ACTIVE cleanup token early erasure",
    "ACCOUNT_CLEANUP_TOKEN_TRANSITION_INVALID",
  );
  database.exec(`
    INSERT INTO account_deletion_jobs (
      id, operation_id, subject_id, erasure_alias,
      initiating_token_digest, initiating_token_mode, request_hash,
      request_hash_version, status, requested_at, alias_after, updated_at
    ) VALUES (
      'privacy-probe-alias-job',
      '53000000-0000-4000-8000-000000000001',
      'privacy-probe-alias',
      'erased:54000000-0000-4000-8000-000000000001',
      '${aliasProbeHash}', 'PERSISTENT', '${hash}', 1,
      'ERASING', 1700000000, 1702592000, 1700000000
    );

    INSERT INTO account_deletion_jobs (
      id, operation_id, subject_id, erasure_alias,
      initiating_token_digest, initiating_token_mode, request_hash,
      request_hash_version, status, requested_at, alias_after, updated_at
    ) VALUES (
      'privacy-probe-reuse-job',
      '55000000-0000-4000-8000-000000000001',
      'privacy-probe-reuse',
      'erased:56000000-0000-4000-8000-000000000001',
      '${reuseHash}', 'PERSISTENT', '${hash}', 1,
      'ERASING', 1700000000, 1702592000, 1700000000
    );
    UPDATE account_cleanup_tokens
    SET deletion_job_id = 'privacy-probe-reuse-job', status = 'BOUND',
        bound_at = 1700000001, updated_at = 1700000001
    WHERE token_digest = '${reuseHash}';
    DELETE FROM profiles WHERE id = 'privacy-probe-reuse';
    UPDATE account_deletion_jobs
    SET status = 'ERASED', erased_at = 1700000002, updated_at = 1700000002
    WHERE id = 'privacy-probe-reuse-job';

    INSERT INTO account_deletion_jobs (
      id, operation_id, subject_id, erasure_alias,
      initiating_token_digest, initiating_token_mode, request_hash,
      request_hash_version, status, requested_at, alias_after, updated_at
    ) VALUES (
      'privacy-probe-ephemeral-job',
      '57000000-0000-4000-8000-000000000001',
      'privacy-probe-ephemeral',
      'erased:58000000-0000-4000-8000-000000000001',
      '${ephemeralHash}', 'EPHEMERAL', '${hash}', 1,
      'ERASING', 1700000000, 1702592000, 1700000000
    );
    DELETE FROM profiles WHERE id = 'privacy-probe-ephemeral';
    UPDATE account_deletion_jobs
    SET status = 'ERASED', erased_at = 1700000002, updated_at = 1700000002
    WHERE id = 'privacy-probe-ephemeral-job';
  `);
  for (const recursiveTriggers of ["OFF", "ON"]) {
    database.exec(`PRAGMA recursive_triggers = ${recursiveTriggers};`);
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO profiles (id, email, role)
       VALUES (
         'privacy-probe-student',
         'privacy-probe-student@example.com',
         'student'
       );`,
      `profile ID INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "PROFILE_DUPLICATE",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO profiles (id, email, role)
       VALUES (
         'privacy-probe-reuse',
         'privacy-probe-reuse@example.com',
         'student'
       );`,
      `erased profile ID reuse recursive_triggers=${recursiveTriggers}`,
      "PROFILE_ERASED_ID_REUSE_BLOCKED",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO profiles (id, email, role)
       VALUES (
         'privacy-probe-shadow',
         'privacy-probe-student@example.com',
         'student'
       );`,
      `profile email INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "PROFILE_DUPLICATE",
    );
    assertSqlFails(
      database,
      `UPDATE OR REPLACE profiles
       SET id = 'privacy-probe-renamed'
       WHERE id = 'privacy-probe-student';`,
      `profile ID UPDATE OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "PROFILE_IDENTITY_UPDATE_INVALID",
    );
    assertSqlFails(
      database,
      `UPDATE OR REPLACE profiles
       SET email = 'privacy-probe-admin@example.com'
       WHERE id = 'privacy-probe-student';`,
      `profile email UPDATE OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "PROFILE_IDENTITY_UPDATE_INVALID",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO account_cleanup_tokens (
        token_digest, subject_id, status, created_at, updated_at
      ) VALUES (
        '${hash}', 'privacy-probe-student', 'ACTIVE', 1700000000, 1700000000
      );`,
      `cleanup token INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "ACCOUNT_CLEANUP_TOKEN_DUPLICATE",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO account_deletion_jobs (
        id, operation_id, subject_id, erasure_alias,
        initiating_token_digest, initiating_token_mode, request_hash,
        request_hash_version, status, requested_at, alias_after, updated_at
      ) VALUES (
        'privacy-probe-job', '50000000-0000-4000-8000-000000000001',
        'privacy-probe-student',
        'erased:51000000-0000-4000-8000-000000000001',
        '${hash}', 'PERSISTENT', '${hash}', 1,
        'ERASING', 1700000000, 1702592000, 1700000000
      );`,
      `deletion job INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "ACCOUNT_DELETION_JOB_DUPLICATE",
    );
    assertSqlFails(
      database,
      `UPDATE OR REPLACE account_cleanup_tokens
       SET token_digest = '${aliasProbeHash}'
       WHERE token_digest = '${hash}';`,
      `cleanup token UPDATE OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "ACCOUNT_CLEANUP_TOKEN_TRANSITION_INVALID",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO account_cleanup_tokens (
        token_digest, subject_id, status, created_at, updated_at
      ) VALUES (
        '${ephemeralHash}', 'privacy-probe-student', 'ACTIVE',
        1700000000, 1700000000
      );`,
      `ephemeral job digest token collision recursive_triggers=${recursiveTriggers}`,
      "ACCOUNT_CLEANUP_TOKEN_DUPLICATE",
    );
    assertSqlFails(
      database,
      `UPDATE OR REPLACE account_deletion_jobs
       SET operation_id = '53000000-0000-4000-8000-000000000001'
       WHERE id = 'privacy-probe-job';`,
      `deletion job UPDATE OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "ACCOUNT_DELETION_JOB_TRANSITION_INVALID",
    );
    assertSqlFails(
      database,
      `UPDATE OR REPLACE account_deletion_jobs
       SET initiating_token_digest = '${aliasProbeHash}'
       WHERE id = 'privacy-probe-job';`,
      `deletion initiator UPDATE OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "ACCOUNT_DELETION_JOB_TRANSITION_INVALID",
    );
    assertSqlFails(
      database,
      `INSERT OR REPLACE INTO calendar_feed_tokens (
        owner_id, token_digest, created_at, updated_at
      ) VALUES (
        'privacy-probe-student', '${otherHash}', 1700000000, 1700000000
      );`,
      `calendar token INSERT OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "CALENDAR_FEED_TOKEN_DUPLICATE",
    );
    assertSqlFails(
      database,
      `UPDATE OR REPLACE calendar_feed_tokens
       SET token_digest = '${aliasProbeHash}', updated_at = 1700000001
       WHERE owner_id = 'privacy-probe-student';`,
      `calendar token UPDATE OR REPLACE recursive_triggers=${recursiveTriggers}`,
      "CALENDAR_FEED_TOKEN_ROTATION_INVALID",
    );
  }
  database.exec("PRAGMA recursive_triggers = OFF;");
  assert(
    database.all(`
      SELECT owner_id FROM calendar_feed_tokens
      WHERE owner_id = 'privacy-probe-alias'
        AND token_digest = '${aliasProbeHash}'
    `).length === 1,
    "calendar UPDATE OR REPLACE 충돌이 다른 owner token을 삭제했습니다.",
  );
  assert(
    database.all(`
      SELECT token_digest FROM account_cleanup_tokens
      WHERE token_digest = '${aliasProbeHash}'
        AND subject_id = 'privacy-probe-alias'
    `).length === 1 &&
      database.all(`
        SELECT id FROM account_deletion_jobs
        WHERE id = 'privacy-probe-alias-job'
          AND operation_id = '53000000-0000-4000-8000-000000000001'
      `).length === 1,
    "account privacy UPDATE OR REPLACE 충돌이 다른 receipt를 삭제했습니다.",
  );
  assert(
    database.all(`
      SELECT id FROM account_deletion_jobs
      WHERE id = 'privacy-probe-ephemeral-job'
        AND initiating_token_digest = '${ephemeralHash}'
        AND initiating_token_mode = 'EPHEMERAL'
        AND status = 'ERASED'
    `).length === 1 &&
      database.all(`
        SELECT token_digest FROM account_cleanup_tokens
        WHERE token_digest = '${ephemeralHash}'
      `).length === 0,
    "ephemeral job digest receipt가 token quota namespace와 분리되지 않았습니다.",
  );

  database.exec(`
    UPDATE account_cleanup_tokens
    SET subject_id = NULL, status = 'ERASED', erased_at = 1702592000,
        updated_at = 1702592000
    WHERE token_digest = '${reuseHash}';
    UPDATE account_deletion_jobs
    SET subject_id = NULL, status = 'ALIASED', aliased_at = 1702592000,
        updated_at = 1702592000
    WHERE id = 'privacy-probe-reuse-job';
    INSERT INTO profiles (id, email, role)
    VALUES (
      'privacy-probe-reuse', 'privacy-probe-reuse@example.com', 'student'
    );
  `);
  assert(
    database.all(`
      SELECT id FROM profiles WHERE id = 'privacy-probe-reuse'
    `).length === 1,
    "raw ID alias 완료 뒤 profile ID 재사용이 허용되지 않았습니다.",
  );

  database.exec(`
    INSERT INTO profiles (id, email, display_name, role)
    VALUES (
      'privacy-probe-normal-insert',
      'privacy-probe-normal-insert@example.com',
      'Before update',
      'student'
    );
    UPDATE profiles
    SET email = 'privacy-probe-normal-updated@example.com',
        display_name = 'After update'
    WHERE id = 'privacy-probe-normal-insert';
  `);
  assert(
    database.all(`
      SELECT id FROM profiles
      WHERE id = 'privacy-probe-normal-insert'
        AND email = 'privacy-probe-normal-updated@example.com'
        AND display_name = 'After update'
    `).length === 1,
    "profile 정상 insert/update 경로가 identity guard에 막혔습니다.",
  );

  database.exec("PRAGMA foreign_keys = OFF;");
  assertSqlFails(
    database,
    "DELETE FROM profiles WHERE id = 'privacy-probe-student';",
    "foreign_keys OFF student profile delete",
    "DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED",
  );
  database.exec("PRAGMA foreign_keys = ON;");
  assertSqlFails(
    database,
    "DELETE FROM profiles WHERE id = 'privacy-probe-admin';",
    "admin profile delete",
    "DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED",
  );

  database.exec(`
    UPDATE calendar_feed_tokens
    SET token_digest = '${"c".repeat(64)}', updated_at = 1700000001
    WHERE owner_id = 'privacy-probe-student';
  `);
  assert(
    database.all(`
      SELECT token_digest FROM calendar_feed_tokens
      WHERE owner_id = 'privacy-probe-student'
    `)[0]?.token_digest === "c".repeat(64),
    "calendar v2 token 정상 rotation이 반영되지 않았습니다.",
  );
}

export function validateAccountPrivacyAtomicSource() {
  const source = readFileSync(
    join(repositoryRoot, "src/lib/account-privacy-atomic.ts"),
    "utf8",
  );
  const migration = readFileSync(
    join(migrationsDirectory, accountPrivacyMigrationFile),
    "utf8",
  );
  assert(
    source.includes("executeDocumentStatementsAtomically") &&
      source.includes("initiating_token_mode") &&
      source.includes('"EPHEMERAL"') &&
      source.includes("ACCOUNT_DELETION_JOB_CREATE") &&
      source.includes("ACCOUNT_DELETION_INITIATOR_RECEIPT_INVALID") &&
      source.includes("ACCOUNT_PROFILE_DELETE") &&
      source.includes("ACCOUNT_DELETION_COMPLETE") &&
      source.includes("ACCOUNT_RAW_ID_ERASURE"),
    "0012 atomic layer에 D1 batch rollback sentinel 계약이 누락되었습니다.",
  );
  assert(
    !/INSERT\s+OR\s+REPLACE/iu.test(source) &&
      !/INSERT\s+OR\s+REPLACE/iu.test(migration),
    "0012 privacy write path에 INSERT OR REPLACE가 있습니다.",
  );
  assert(
    !/PRAGMA\s+foreign_keys\s*=\s*OFF/iu.test(migration),
    "0012 migration이 transaction 내부 foreign_keys OFF에 의존합니다.",
  );
  assert(
    !/GLOB\s+'(?:erased:|media\/)[^']{100,}'/iu.test(migration),
    "0012 migration이 D1 한도를 넘는 긴 UUID GLOB에 의존합니다.",
  );
}
