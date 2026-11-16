import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";
import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";

const previousMigrationFile = "0030_group_note_retention.sql";
const groupCalendarMigrationFile = "0031_group_calendar.sql";
const tokenHash = "a".repeat(64);

/**
 * 0030 → 0031: calendar_mappings를 다시 만들어 student_id를 nullable로, group_id를 더한다. 다시 만들 때 DROP이 자식
 * 표를 ON DELETE CASCADE로 지우므로 migration이 자식 행을 백업·복원한다. 자식 세 표의 행이 그대로 남는지, 대상 CHECK·
 * 그룹 unique·그룹 cascade, calendar_group_events와 calendar_events.group_event_id(SET NULL)를 확인한다.
 */
export async function validateGroupCalendarUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(groupCalendarMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0030 → 0031 group calendar migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, password_hash, display_name, role) VALUES
        ('gc-admin', 'gc-admin@example.com', '$2b$10$hash', 'Admin', 'admin'),
        ('gc-a', 'gc-a@example.com', '$2b$10$ahash', 'A', 'student'),
        ('gc-b', 'gc-b@example.com', '$2b$10$bhash', 'B', 'student');
      INSERT INTO lesson_groups (id, name) VALUES ('gc-group', '화요일반');
      INSERT INTO lesson_group_members (student_id, group_id) VALUES ('gc-a', 'gc-group'), ('gc-b', 'gc-group');
      INSERT INTO calendar_connections (id, owner_id, provider, account_label, encrypted_credentials, credentials_iv, created_at, updated_at)
        VALUES ('gc-conn', 'gc-admin', 'GOOGLE', 'stann@example.com', 'cipher', 'iv', 1700000000, 1700000000);
      INSERT INTO calendar_mappings (id, connection_id, student_id, remote_calendar_id, remote_calendar_name, cursor, last_synced_at, last_error, sync_lease_until, created_at, updated_at)
        VALUES ('gc-map-a', 'gc-conn', 'gc-a', 'cal-a', 'A 레슨', 'cursor-a', 1700000100, '동기화 오류', 1700000160, 1700000000, 1700000100),
               ('gc-map-b', 'gc-conn', 'gc-b', 'cal-b', 'B 레슨', NULL, NULL, NULL, NULL, 1700000000, 1700000000);
      INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, remote_id, etag, local_fingerprint, last_error, created_at, updated_at)
        VALUES ('gc-link-1', 'gc-map-a', 'LESSON', 'lesson-1', 'remote-1', 'etag-1', 'fp-1', NULL, 1700000000, 1700000001),
               ('gc-link-2', 'gc-map-a', 'EVENT', 'event-1', NULL, NULL, 'DELETED', '오류', 1700000000, 1700000002),
               ('gc-link-3', 'gc-map-b', 'LESSON', 'lesson-2', 'remote-2', 'etag-2', 'fp-2', NULL, 1700000000, 1700000003);
      INSERT INTO calendar_remote_series (mapping_id, remote_id, series_key, etag, ics_text, updated_at)
        VALUES ('gc-map-a', 'series-1', 'key-1', 'etag-s', 'BEGIN:VCALENDAR', 1700000004);
      INSERT INTO calendar_push_channels (mapping_id, channel_id, resource_id, token_hash, expires_at, created_at, updated_at)
        VALUES ('gc-map-a', 'channel-1', 'resource-1', '${tokenHash}', 1800000000, 1700000000, 1700000005);
      INSERT INTO calendar_events (id, user_id, event_type, title, start_time, end_time, description, created_at)
        VALUES ('gc-event', 'gc-a', 'NOTE', '개인 일정', 1700003600, NULL, NULL, 1700000000);
    `);
    const snapshot = () => ({
      mappings: database.all(`
        SELECT id, connection_id, student_id, remote_calendar_id, remote_calendar_name, cursor, last_synced_at, last_error, sync_lease_until, created_at, updated_at
        FROM calendar_mappings ORDER BY id`),
      links: database.all("SELECT * FROM calendar_sync_links ORDER BY id"),
      series: database.all("SELECT * FROM calendar_remote_series ORDER BY mapping_id, remote_id"),
      channels: database.all("SELECT * FROM calendar_push_channels ORDER BY mapping_id"),
      events: database.all("SELECT id, user_id, event_type, title, start_time, end_time, description, created_at FROM calendar_events ORDER BY id"),
    });
    const before = snapshot();
    assert(before.links.length === 3 && before.series.length === 1 && before.channels.length === 1, "0030 fixture 자식 행을 넣지 못했습니다.");

    applyMigration(database, groupCalendarMigrationFile);

    const after = snapshot();
    for (const key of Object.keys(before)) assertRowsEqual(`0031 ${key} 보존`, after[key], before[key]);
    assertRowsEqual(
      "0031 기존 매핑 group_id NULL",
      database.all("SELECT id, group_id FROM calendar_mappings ORDER BY id"),
      [{ id: "gc-map-a", group_id: null }, { id: "gc-map-b", group_id: null }],
    );
    assertRowsEqual("0031 foreign key check", database.all("PRAGMA foreign_key_check"), []);
    assertRowsEqual(
      "0031 백업 표 정리",
      database.all("SELECT name FROM sqlite_master WHERE name LIKE '__calendar_%_backup'"),
      [],
    );

    // 대상은 학생 또는 그룹 하나만.
    assertSqlFails(
      database,
      "INSERT INTO calendar_mappings (id, connection_id, student_id, group_id, remote_calendar_id, remote_calendar_name) VALUES ('gc-both', 'gc-conn', 'gc-a', 'gc-group', 'cal-x', 'X');",
      "학생·그룹을 함께 가진 매핑",
      "calendar_mappings_target_check",
    );
    assertSqlFails(
      database,
      "INSERT INTO calendar_mappings (id, connection_id, student_id, group_id, remote_calendar_id, remote_calendar_name) VALUES ('gc-none', 'gc-conn', NULL, NULL, 'cal-x', 'X');",
      "대상 없는 매핑",
      "calendar_mappings_target_check",
    );
    database.exec(`
      INSERT INTO calendar_mappings (id, connection_id, student_id, group_id, remote_calendar_id, remote_calendar_name)
        VALUES ('gc-map-group', 'gc-conn', NULL, 'gc-group', 'cal-group', '그룹레슨');
    `);
    assertSqlFails(
      database,
      "INSERT INTO calendar_mappings (id, connection_id, student_id, group_id, remote_calendar_id, remote_calendar_name) VALUES ('gc-group-2', 'gc-conn', NULL, 'gc-group', 'cal-y', 'Y');",
      "같은 연결의 두 번째 그룹 캘린더",
      "UNIQUE",
    );
    assertSqlFails(
      database,
      "INSERT INTO calendar_mappings (id, connection_id, student_id, group_id, remote_calendar_id, remote_calendar_name) VALUES ('gc-same-cal', 'gc-conn', 'gc-admin', NULL, 'cal-group', 'Z');",
      "같은 원격 캘린더를 다른 대상에",
      "UNIQUE",
    );
    // 자식 FK는 다시 만든 calendar_mappings를 가리킨다(매핑을 지우면 link·series·channel도 지워진다).
    database.exec("DELETE FROM calendar_mappings WHERE id = 'gc-map-b';");
    assert(database.all("SELECT id FROM calendar_sync_links WHERE mapping_id = 'gc-map-b'").length === 0, "매핑 삭제가 link를 지우지 않았습니다.");

    // 그룹 일정 원본·사본.
    database.exec(`
      INSERT INTO calendar_group_events (id, group_id, title, description, start_time, end_time, created_at, updated_at)
        VALUES ('gc-gevent', 'gc-group', '합주', NULL, 1700007200, 1700010800, 1700000000, 1700000000);
      INSERT INTO calendar_events (id, user_id, event_type, title, start_time, end_time, description, group_event_id, created_at)
        VALUES ('gc-copy-a', 'gc-a', 'NOTE', '합주', 1700007200, 1700010800, NULL, 'gc-gevent', 1700000000),
               ('gc-copy-b', 'gc-b', 'NOTE', '합주', 1700007200, 1700010800, NULL, 'gc-gevent', 1700000000);
      INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, remote_id, etag, local_fingerprint)
        VALUES ('gc-link-group', 'gc-map-group', 'EVENT', 'gc-gevent', 'remote-g', 'etag-g', 'fp-g');
    `);
    assertSqlFails(
      database,
      "INSERT INTO calendar_group_events (id, group_id, title, start_time, end_time) VALUES ('gc-bad', 'gc-group', '거꾸로', 1700007200, 1700007200);",
      "끝이 시작보다 이른 그룹 일정",
      "calendar_group_events_payload_check",
    );
    assertSqlFails(
      database,
      "INSERT INTO calendar_events (id, user_id, title, start_time, group_event_id) VALUES ('gc-orphan', 'gc-a', 'x', 1700007200, 'missing');",
      "없는 그룹 일정을 가리키는 사본",
      "FOREIGN KEY",
    );
    // 그룹을 지우면 그룹 매핑(과 link)·그룹 일정 원본이 지워지고 멤버 사본은 개인 일정으로 남는다.
    database.exec("DELETE FROM lesson_groups WHERE id = 'gc-group';");
    assertRowsEqual("그룹 삭제 → 그룹 매핑 삭제", database.all("SELECT id FROM calendar_mappings WHERE group_id IS NOT NULL"), []);
    assertRowsEqual("그룹 삭제 → 그룹 link 삭제", database.all("SELECT id FROM calendar_sync_links WHERE id = 'gc-link-group'"), []);
    assertRowsEqual("그룹 삭제 → 그룹 일정 원본 삭제", database.all("SELECT id FROM calendar_group_events"), []);
    assertRowsEqual(
      "그룹 삭제 → 멤버 사본은 group_event_id만 비움",
      database.all("SELECT id, group_event_id FROM calendar_events WHERE id LIKE 'gc-copy-%' ORDER BY id"),
      [{ id: "gc-copy-a", group_event_id: null }, { id: "gc-copy-b", group_event_id: null }],
    );
    assertRowsEqual(
      "학생 매핑은 그대로",
      database.all("SELECT id FROM calendar_mappings ORDER BY id"),
      [{ id: "gc-map-a" }],
    );
  } finally {
    database.close();
  }
}
