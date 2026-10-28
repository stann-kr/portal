import {
  applyMigration,
  applyMigrations,
  calendarPushChannelMigrationFile,
  createMemoryDatabase,
} from "./runtime.mjs";
import { assertRowsEqual, assert, assertSqlFails } from "./assertions.mjs";

export const diggingPlaylistMigrationFile = "0019_digging_playlists.sql";

const BEATPORT_URL = "https://www.beatport.com/playlists/share/11018932";
const SOUNDCLOUD_URL = "https://soundcloud.com/stann/sets/warmup";

/** 0018 → 0019: 디깅 플레이리스트 table만 추가하고 기존 schema·row를 보존하며 학생 삭제를 따라 지워진다. */
export async function validateDiggingPlaylistUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(diggingPlaylistMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === calendarPushChannelMigrationFile,
    "0018 → 0019 digging playlist migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('dig-admin', 'dig-admin@example.com', 'Admin', 'admin'),
        ('dig-student', 'dig-student@example.com', 'Student', 'student'),
        ('dig-other', 'dig-other@example.com', 'Other', 'student');
      INSERT INTO digging_columns (id, user_id, name, column_type, sort_order, is_default)
      VALUES ('dig-col', 'dig-student', '트랙명', 'text', 0, 1);
      INSERT INTO digging_tracks (id, user_id, link_url, "values")
      VALUES ('dig-track', 'dig-student', 'https://soundcloud.com/a/b', '{"dig-col":"Track"}');
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

    applyMigration(database, diggingPlaylistMigrationFile);

    assertRowsEqual(
      "0019 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => entry.tbl_name !== "digging_playlists"),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0019 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual(
      "0019 unique index",
      database.all("SELECT name, \"unique\" FROM pragma_index_list('digging_playlists') WHERE origin = 'c' ORDER BY name;"),
      [{ name: "digging_playlists_user_url_unique", unique: 1 }],
    );

    database.exec(`
      INSERT INTO digging_playlists (id, user_id, provider, url, title, note) VALUES
        ('pl-beatport', 'dig-student', 'beatport', '${BEATPORT_URL}', NULL, NULL),
        ('pl-soundcloud', 'dig-student', 'soundcloud', '${SOUNDCLOUD_URL}', 'Warmup', '오프닝용'),
        ('pl-private', 'dig-student', 'soundcloud', '${SOUNDCLOUD_URL}/s-AbC123', NULL, NULL),
        ('pl-other', 'dig-other', 'beatport', '${BEATPORT_URL}', NULL, NULL);
    `);
    const insert = (values) =>
      `INSERT INTO digging_playlists (id, user_id, provider, url, title, note) VALUES (${values});`;
    for (const [sql, label, expected] of [
      [insert(`'dup', 'dig-student', 'beatport', '${BEATPORT_URL}', NULL, NULL`), "학생별 같은 링크", "UNIQUE constraint failed"],
      [insert(`'ghost', 'missing', 'beatport', '${BEATPORT_URL}', NULL, NULL`), "없는 학생", "FOREIGN KEY constraint failed"],
      [insert(`'bad-provider', 'dig-student', 'spotify', 'https://open.spotify.com/playlist/1', NULL, NULL`), "허용 밖 provider", "digging_playlists_payload_check"],
      [insert(`'mismatch', 'dig-student', 'beatport', '${SOUNDCLOUD_URL}', NULL, NULL`), "provider·링크 불일치", "digging_playlists_payload_check"],
      [insert(`'sc-track', 'dig-student', 'soundcloud', 'https://soundcloud.com/stann/track', NULL, NULL`), "SoundCloud 세트 아님", "digging_playlists_payload_check"],
      [insert(`'http', 'dig-student', 'beatport', 'http://www.beatport.com/playlists/share/1', NULL, NULL`), "http 링크", "digging_playlists_payload_check"],
      [insert(`'empty-title', 'dig-student', 'beatport', '${BEATPORT_URL}9', '', NULL`), "빈 제목", "digging_playlists_payload_check"],
      [insert(`'long-title', 'dig-student', 'beatport', '${BEATPORT_URL}9', '${"가".repeat(201)}', NULL`), "201자 제목", "digging_playlists_payload_check"],
      [insert(`'long-note', 'dig-student', 'beatport', '${BEATPORT_URL}9', NULL, '${"a".repeat(2001)}'`), "2001자 메모", "digging_playlists_payload_check"],
      [insert(`'long-url', 'dig-student', 'beatport', '${BEATPORT_URL}${"1".repeat(2048)}', NULL, NULL`), "2048자 초과 링크", "digging_playlists_payload_check"],
      ["UPDATE digging_playlists SET updated_at = created_at - 1 WHERE id = 'pl-beatport';", "수정 시각 역전", "digging_playlists_payload_check"],
      ["UPDATE digging_playlists SET provider = NULL WHERE id = 'pl-beatport';", "provider 필수", "NOT NULL constraint failed"],
    ]) {
      assertSqlFails(database, sql, `0019 ${label}`, expected);
    }

    // 삭제 작업 없이 profile을 지우는 시도는 기존 계정 삭제 guard가 막고 플레이리스트도 남는다.
    const playlistsBeforeDelete = readRows("digging_playlists");
    assertSqlFails(
      database,
      "DELETE FROM profiles WHERE id = 'dig-other';",
      "0019 upgrade 뒤 기존 개인정보 삭제 guard",
      "DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED",
    );
    assertRowsEqual("0019 거부된 삭제의 플레이리스트 보존", readRows("digging_playlists"), playlistsBeforeDelete);

    // 기존 계정 삭제 프로토콜을 통과한 학생만 지워 새 FK의 cascade를 확인한다.
    // guard 목록에 없는 digging_playlists는 계정 삭제를 막지 않고 profile 삭제를 따라 지워진다.
    database.exec(`
      INSERT INTO account_deletion_jobs (
        id, operation_id, subject_id, erasure_alias, initiating_token_digest,
        initiating_token_mode, request_hash, request_hash_version,
        status, requested_at, alias_after, updated_at
      ) VALUES (
        'dig-deletion-job', '52000000-0000-4000-8000-000000000001',
        'dig-other', 'erased:52000000-0000-4000-8000-000000000002',
        '${"d".repeat(64)}', 'EPHEMERAL', '${"e".repeat(64)}', 1,
        'ERASING', 1800000000, 1802592000, 1800000000
      );
      DELETE FROM profiles WHERE id = 'dig-other';
    `);
    assertRowsEqual(
      "0019 학생 삭제 cascade와 다른 학생 플레이리스트 보존",
      readRows("digging_playlists"),
      playlistsBeforeDelete.filter((row) => row.user_id === "dig-student"),
    );
    assertRowsEqual("0019 학생 삭제 뒤 디깅 트랙 보존", readRows("digging_tracks"), existingRows.get("digging_tracks"));
    assertRowsEqual("0019 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0019 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
