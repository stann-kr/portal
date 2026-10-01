import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountPrivacyMigrationFile,
  applyMigration,
  applyMigrations,
  createMemoryDatabase,
  externalCalendarMigrationFile,
  migrationsDirectory,
} from "./runtime.mjs";
import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";

export function validateExternalCalendarSubscriptionSchema(database) {
  const migrationSource = readFileSync(
    join(migrationsDirectory, externalCalendarMigrationFile),
    "utf8",
  );
  assert(
    /CREATE TABLE [`"]?external_calendar_subscriptions/u.test(migrationSource),
    "0013 external calendar table 생성이 없습니다.",
  );
  const foreignKeys = database.all("PRAGMA foreign_key_list('external_calendar_subscriptions');");
  assert(
    foreignKeys.some((foreignKey) => foreignKey.table === "profiles" && foreignKey.from === "student_id" && foreignKey.on_delete === "CASCADE"),
    "external calendar subscription profile cascade FK가 없습니다.",
  );
  const indexes = database.all("PRAGMA index_list('external_calendar_subscriptions');");
  assert(
    indexes.some((index) => index.name === "external_calendar_subscriptions_student_unique" && index.unique === 1),
    "external calendar subscription 학생별 unique index가 없습니다.",
  );
}

export async function validateExternalCalendarSubscriptionUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(externalCalendarMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === accountPrivacyMigrationFile,
    "0012 → 0013 external calendar migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('calendar-existing-student', 'calendar-existing@example.com', 'Existing Student', 'student'),
        ('calendar-deleting-student', 'calendar-deleting@example.com', 'Deleting Student', 'student');
      INSERT INTO calendar_events (id, user_id, event_type, title, start_time, end_time)
      VALUES ('calendar-existing-event', 'calendar-existing-student', 'NOTE', 'Preserved event', 1800000000, 1800003600);
      INSERT INTO posts (id, author_id, category, board_type, title, content_html, version)
      VALUES ('calendar-existing-post', 'calendar-existing-student', 'general', 'GENERAL', 'Preserved post', '<p>Preserved</p>', 1);
      INSERT INTO calendar_feed_tokens (owner_id, token_digest, created_at, updated_at)
      VALUES ('calendar-existing-student', '${"a".repeat(64)}', 1800000000, 1800000000);
      INSERT INTO account_cleanup_tokens (token_digest, subject_id, status, created_at, updated_at)
      VALUES ('${"b".repeat(64)}', 'calendar-existing-student', 'ACTIVE', 1800000000, 1800000000);
      INSERT INTO document_server_drafts (
        owner_id, source_key, document_kind, context_id, payload_json, payload_hash,
        draft_version, writer_device_id, created_at, updated_at, expires_at
      ) VALUES (
        'calendar-existing-student', 'draft:document:note:calendar-existing-student:new',
        'note', 'new', '{"title":"Preserved draft"}', '${"c".repeat(64)}',
        1, 'calendar-fixture-device', 1800000000, 1800000000, 1802592000
      );
    `);

    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const existingSchema = readSchema();
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => [entry.name, readRows(entry.name)]));

    applyMigration(database, externalCalendarMigrationFile);

    assertRowsEqual(
      "0013 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => entry.tbl_name !== "external_calendar_subscriptions"),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0013 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual("0013 신규 subscription table", readRows("external_calendar_subscriptions"), []);
    validateExternalCalendarSubscriptionSchema(database);

    database.exec(`
      INSERT INTO external_calendar_subscriptions (
        id, student_id, provider, label, encrypted_url, url_iv, created_at, updated_at
      ) VALUES
        ('calendar-subscription-existing', 'calendar-existing-student', 'GOOGLE', 'Google lesson', 'ciphertext-google', 'iv-google', 1800000000, 1800000000),
        ('calendar-subscription-deleting', 'calendar-deleting-student', 'ICLOUD', 'iCloud lesson', 'ciphertext-icloud', 'iv-icloud', 1800000000, 1800000000);
    `);
    const subscriptions = readRows("external_calendar_subscriptions");
    for (const [assignment, constraint] of [
      ["provider = 'OTHER'", "external_calendar_subscriptions_provider_check"],
      ["encrypted_url = ''", "external_calendar_subscriptions_payload_check"],
      ["updated_at = created_at - 1", "external_calendar_subscriptions_timestamp_check"],
    ]) {
      assertSqlFails(
        database,
        `UPDATE external_calendar_subscriptions SET ${assignment} WHERE id = 'calendar-subscription-existing';`,
        `0013 ${constraint}`,
        constraint,
      );
    }
    assertSqlFails(
      database,
      `INSERT INTO external_calendar_subscriptions (
          id, student_id, provider, label, encrypted_url, url_iv, created_at, updated_at
        )
        SELECT 'calendar-subscription-duplicate', student_id, 'ICLOUD', label, encrypted_url, url_iv, created_at, updated_at
        FROM external_calendar_subscriptions WHERE id = 'calendar-subscription-existing';`,
      "0013 학생별 단일 subscription",
      "UNIQUE constraint failed",
    );
    assertSqlFails(
      database,
      "UPDATE external_calendar_subscriptions SET student_id = 'missing-student' WHERE id = 'calendar-subscription-existing';",
      "0013 존재하지 않는 subscription owner",
      "FOREIGN KEY constraint failed",
    );
    assertSqlFails(
      database,
      "DELETE FROM profiles WHERE id = 'calendar-deleting-student';",
      "0013 upgrade 뒤 기존 개인정보 삭제 guard",
      "DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED",
    );
    assertRowsEqual("0013 거부된 mutation의 subscription 보존", readRows("external_calendar_subscriptions"), subscriptions);

    // 기존 계정 삭제 프로토콜을 통과한 owner만 지워 새 FK의 cascade를 확인한다.
    database.exec(`
      INSERT INTO account_deletion_jobs (
        id, operation_id, subject_id, erasure_alias, initiating_token_digest,
        initiating_token_mode, request_hash, request_hash_version,
        status, requested_at, alias_after, updated_at
      ) VALUES (
        'calendar-deletion-job', '51000000-0000-4000-8000-000000000001',
        'calendar-deleting-student', 'erased:51000000-0000-4000-8000-000000000002',
        '${"d".repeat(64)}', 'EPHEMERAL', '${"e".repeat(64)}', 1,
        'ERASING', 1800000000, 1802592000, 1800000000
      );
      DELETE FROM profiles WHERE id = 'calendar-deleting-student';
    `);
    assertRowsEqual(
      "0013 owner 삭제 cascade와 다른 학생 subscription 보존",
      readRows("external_calendar_subscriptions"),
      subscriptions.filter((row) => row.student_id === "calendar-existing-student"),
    );
    assertRowsEqual("0013 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0013 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
