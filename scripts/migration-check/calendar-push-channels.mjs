import {
  applyMigration,
  applyMigrations,
  calendarPushChannelMigrationFile,
  calendarSyncMigrationFile,
  createMemoryDatabase,
} from "./runtime.mjs";
import { assertRowsEqual, assert, assertSqlFails } from "./assertions.mjs";

const HASH = "a".repeat(64);

/** 0017 → 0018: Google 변경 알림 channel table만 추가하고 기존 schema·row를 보존하며 매핑 삭제를 따라 지워진다. */
export async function validateCalendarPushChannelUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(calendarPushChannelMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === calendarSyncMigrationFile,
    "0017 → 0018 calendar push channel migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('push-admin', 'push-admin@example.com', 'Admin', 'admin'),
        ('push-student', 'push-student@example.com', 'Student', 'student'),
        ('push-other', 'push-other@example.com', 'Other', 'student');
      INSERT INTO lessons (id, student_id, scheduled_at) VALUES ('push-lesson', 'push-student', 1800000000);
      INSERT INTO calendar_connections (id, owner_id, provider, account_label, encrypted_credentials, credentials_iv)
      VALUES ('conn-google', 'push-admin', 'GOOGLE', 'teacher@example.com', 'cipher', 'iv');
      INSERT INTO calendar_mappings (id, connection_id, student_id, remote_calendar_id, remote_calendar_name) VALUES
        ('map-1', 'conn-google', 'push-student', 'cal-1', '레슨'),
        ('map-2', 'conn-google', 'push-other', 'cal-2', '레슨');
      INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, remote_id, etag, local_fingerprint)
      VALUES ('link-1', 'map-1', 'LESSON', 'push-lesson', 'remote-1', '"1"', 'fp');
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

    applyMigration(database, calendarPushChannelMigrationFile);

    assertRowsEqual(
      "0018 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => entry.tbl_name !== "calendar_push_channels"),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0018 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }

    database.exec(`
      INSERT INTO calendar_push_channels (mapping_id, channel_id, resource_id, token_hash, expires_at)
      VALUES ('map-1', 'channel-1', 'resource-1', '${HASH}', 1800000000),
             ('map-2', 'channel-2', 'resource-2', '${HASH}', 1800000000);
    `);
    for (const [sql, label, expected] of [
      [`INSERT INTO calendar_push_channels (mapping_id, channel_id, resource_id, token_hash, expires_at) VALUES ('map-1', 'channel-3', 'r', '${HASH}', 1);`, "매핑당 channel 하나", "UNIQUE constraint failed"],
      [`UPDATE calendar_push_channels SET channel_id = 'channel-1' WHERE mapping_id = 'map-2';`, "channel id 중복", "UNIQUE constraint failed"],
      [`INSERT INTO calendar_push_channels (mapping_id, channel_id, resource_id, token_hash, expires_at) VALUES ('missing', 'channel-4', 'r', '${HASH}', 1);`, "없는 매핑", "FOREIGN KEY constraint failed"],
      ["UPDATE calendar_push_channels SET token_hash = 'plain-token' WHERE mapping_id = 'map-1';", "token hash 길이", "calendar_push_channels_payload_check"],
      ["UPDATE calendar_push_channels SET channel_id = '' WHERE mapping_id = 'map-1';", "빈 channel id", "calendar_push_channels_payload_check"],
      ["UPDATE calendar_push_channels SET resource_id = '' WHERE mapping_id = 'map-1';", "빈 resource id", "calendar_push_channels_payload_check"],
      ["UPDATE calendar_push_channels SET token_hash = NULL WHERE mapping_id = 'map-1';", "token hash 필수", "NOT NULL constraint failed"],
    ]) {
      assertSqlFails(database, sql, `0018 ${label}`, expected);
    }

    // 매핑을 지우면 그 매핑 channel만, 연결을 지우면 남은 channel도 지운다. 포털 레슨은 남는다.
    database.exec("DELETE FROM calendar_mappings WHERE id = 'map-1';");
    assertRowsEqual(
      "0018 매핑 삭제 cascade",
      database.all("SELECT mapping_id FROM calendar_push_channels ORDER BY mapping_id;"),
      [{ mapping_id: "map-2" }],
    );
    database.exec("DELETE FROM calendar_connections WHERE id = 'conn-google';");
    assertRowsEqual("0018 연결 삭제 cascade", readRows("calendar_push_channels"), []);
    assertRowsEqual("0018 연결 삭제 뒤 레슨 보존", readRows("lessons"), existingRows.get("lessons"));
    assertRowsEqual("0018 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0018 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
