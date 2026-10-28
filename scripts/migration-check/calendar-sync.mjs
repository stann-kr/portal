import {
  applyMigration,
  applyMigrations,
  calendarSyncMigrationFile,
  createMemoryDatabase,
  guidePageMigrationFile,
} from "./runtime.mjs";
import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";

/** 0016 → 0017: 추가만 하는 migration이라 기존 schema·row를 그대로 두고 새 제약·cascade를 확인한다. */
export async function validateCalendarSyncUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(calendarSyncMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === guidePageMigrationFile,
    "0016 → 0017 calendar sync migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('sync-admin', 'sync-admin@example.com', 'Admin', 'admin'),
        ('sync-student', 'sync-student@example.com', 'Student', 'student'),
        ('sync-other', 'sync-other@example.com', 'Other', 'student');
      INSERT INTO lessons (id, student_id, scheduled_at) VALUES ('sync-lesson', 'sync-student', 1800000000);
      INSERT INTO calendar_events (id, user_id, event_type, title, start_time, end_time)
      VALUES ('sync-event', 'sync-student', 'NOTE', '연습', 1800000000, 1800003600);
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

    applyMigration(database, calendarSyncMigrationFile);

    const newTables = ["calendar_connections", "calendar_mappings", "calendar_sync_links", "calendar_remote_series"];
    assertRowsEqual(
      "0017 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !newTables.includes(entry.tbl_name)),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0017 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }

    database.exec(`
      INSERT INTO calendar_connections (id, owner_id, provider, account_label, encrypted_credentials, credentials_iv)
      VALUES ('conn-google', 'sync-admin', 'GOOGLE', 'teacher@example.com', 'cipher', 'iv');
      INSERT INTO calendar_mappings (id, connection_id, student_id, remote_calendar_id, remote_calendar_name)
      VALUES ('map-1', 'conn-google', 'sync-student', 'cal-1', '레슨');
      INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, remote_id, etag, local_fingerprint)
      VALUES ('link-1', 'map-1', 'LESSON', 'sync-lesson', 'remote-1', '"1"', 'fp');
      INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, local_fingerprint)
      VALUES ('link-2', 'map-1', 'EVENT', 'sync-event', 'fp');
      INSERT INTO calendar_remote_series (mapping_id, remote_id, series_key, ics_text)
      VALUES ('map-1', 'series-1', 'uid-1', 'BEGIN:VCALENDAR');
    `);
    for (const [sql, label, expected] of [
      ["INSERT INTO calendar_connections (id, owner_id, provider, account_label, encrypted_credentials, credentials_iv) VALUES ('conn-dup', 'sync-admin', 'GOOGLE', 'x', 'c', 'i');", "계정별 provider 하나", "UNIQUE constraint failed"],
      ["INSERT INTO calendar_connections (id, owner_id, provider, account_label, encrypted_credentials, credentials_iv) VALUES ('conn-bad', 'sync-admin', 'OUTLOOK', 'x', 'c', 'i');", "provider allowlist", "calendar_connections_provider_check"],
      ["UPDATE calendar_connections SET status = 'OTHER' WHERE id = 'conn-google';", "연결 상태", "calendar_connections_status_check"],
      ["UPDATE calendar_connections SET encrypted_credentials = '' WHERE id = 'conn-google';", "빈 자격 증명", "calendar_connections_payload_check"],
      ["INSERT INTO calendar_mappings (id, connection_id, student_id, remote_calendar_id, remote_calendar_name) VALUES ('map-dup', 'conn-google', 'sync-other', 'cal-1', 'x');", "캘린더 하나에 학생 하나", "UNIQUE constraint failed"],
      ["INSERT INTO calendar_mappings (id, connection_id, student_id, remote_calendar_id, remote_calendar_name) VALUES ('map-dup2', 'conn-google', 'sync-student', 'cal-2', 'x');", "학생당 연결별 캘린더 하나", "UNIQUE constraint failed"],
      ["INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, remote_id, local_fingerprint) VALUES ('link-dup', 'map-1', 'EVENT', 'other-event', 'remote-1', 'fp');", "원격 일정 하나에 연결 하나", "UNIQUE constraint failed"],
      ["INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, local_fingerprint) VALUES ('link-kind', 'map-1', 'NOTE', 'x', 'fp');", "연결 종류", "calendar_sync_links_kind_check"],
      ["INSERT INTO calendar_remote_series (mapping_id, remote_id, series_key, ics_text) VALUES ('map-1', 'series-2', 'uid-2', '');", "빈 ICS", "calendar_remote_series_payload_check"],
    ]) {
      assertSqlFails(database, sql, `0017 ${label}`, expected);
    }
    // 연결을 끊으면 학생 매핑·연결 기록·반복 일정 사본만 지우고 포털 레슨·일정은 남긴다.
    database.exec("DELETE FROM calendar_connections WHERE id = 'conn-google';");
    for (const tableName of ["calendar_mappings", "calendar_sync_links", "calendar_remote_series"]) {
      assertRowsEqual(`0017 연결 삭제 cascade ${tableName}`, readRows(tableName), []);
    }
    assertRowsEqual("0017 연결 삭제 뒤 레슨 보존", readRows("lessons"), existingRows.get("lessons"));
    assertRowsEqual("0017 연결 삭제 뒤 일정 보존", readRows("calendar_events"), existingRows.get("calendar_events"));
    assertRowsEqual("0017 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0017 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
