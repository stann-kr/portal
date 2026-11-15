import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";
import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";

const previousMigrationFile = "0029_lesson_groups.sql";
const retentionMigrationFile = "0030_group_note_retention.sql";
const changedTriggers = new Set([
  "media_objects_immutable_identity",
  "media_objects_transition_guard",
  "media_objects_transition_payload_guard",
  "media_objects_deletion_outbox_guard",
]);

function attachedImageSql(id, ownerId, noteId, uuidSuffix) {
  const objectUuid = `30000000-0000-4000-8000-${uuidSuffix}`;
  const operationUuid = `31000000-0000-4000-8000-${uuidSuffix}`;
  return `
    INSERT INTO media_objects (
      id, owner_id, purpose, object_key, upload_object_key, state,
      expected_content_type, expected_size_bytes, actual_size_bytes, etag, draft_operation_id,
      resource_type, resource_id, upload_expires_at, ready_at, attached_at, created_at, updated_at
    ) VALUES (
      '${id}', '${ownerId}', 'DOCUMENT_IMAGE', 'media/document-image/${objectUuid}', 'media-upload/document-image/${id}', 'ATTACHED',
      'image/png', 10, 10, 'etag', '${operationUuid}',
      'PRIVATE_NOTE', '${noteId}', 1700003600, 1700000000, 1700000000, 1700000000, 1700000000
    );`;
}

/**
 * 0029 → 0030: document_tombstones.group_id(nullable, FK 없음)를 더하고, 계정 삭제(ERASING) 중인 계정이
 * 남의 그룹 노트에 올린 ATTACHED 이미지의 owner를 그 노트의 주인에게 넘기는 전이만 연다. 나머지 media 규칙은 그대로다.
 */
export async function validateGroupNoteRetentionUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(retentionMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0029 → 0030 group note retention migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    // 첨부 완료 행을 바로 넣으려고 insert guard만 잠시 뺀다(0030은 이 trigger를 건드리지 않는다).
    database.exec("DROP TRIGGER `media_objects_before_insert_guard`;");
    database.exec(`
      INSERT INTO profiles (id, email, password_hash, display_name, role) VALUES
        ('gr-a', 'gr-a@example.com', '$2b$10$ahash', 'A', 'student'),
        ('gr-b', 'gr-b@example.com', '$2b$10$bhash', 'B', 'student');
      INSERT INTO lesson_groups (id, name) VALUES ('gr-group', '화요일반');
      INSERT INTO lesson_group_members (student_id, group_id) VALUES ('gr-a', 'gr-group'), ('gr-b', 'gr-group');
      INSERT INTO private_notes (id, student_id, author_id, group_id, title, content_html)
        VALUES ('gr-group-note', 'gr-a', 'gr-a', 'gr-group', '그룹 노트', '<p>같이</p>'),
               ('gr-own-note', 'gr-b', 'gr-b', NULL, '개인', '<p>B</p>');
      INSERT INTO document_tombstones (resource_type, resource_id, subject_id, owner_id, source_version, purged_at)
        VALUES ('PRIVATE_NOTE', 'gr-old-note', 'gr-a', 'gr-a', 1, 1700000000);
      ${attachedImageSql("gr-kept", "gr-b", "gr-group-note", "000000000001")}
      ${attachedImageSql("gr-own", "gr-b", "gr-own-note", "000000000002")}
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

    applyMigration(database, retentionMigrationFile);

    const unchanged = (entry) => !changedTriggers.has(entry.name) && !(entry.type === "table" && entry.name === "document_tombstones");
    assertRowsEqual(
      "0030 upgrade 기존 table·index·trigger 보존(document_tombstones 표 정의와 다시 만든 media trigger 넷 제외)",
      readSchema().filter(unchanged),
      existingSchema.filter(unchanged),
    );
    const recreated = (entry) => changedTriggers.has(entry.name);
    assertRowsEqual(
      "0030 다시 만든 media UPDATE trigger 넷(payload·outbox guard는 SQL 그대로)",
      readSchema().filter(recreated).map(({ name, sql }) => ({ name, same: sql === existingSchema.find((entry) => entry.name === name)?.sql })),
      [
        { name: "media_objects_deletion_outbox_guard", same: true },
        { name: "media_objects_immutable_identity", same: false },
        { name: "media_objects_transition_guard", same: false },
        { name: "media_objects_transition_payload_guard", same: true },
      ],
    );
    for (const [tableName, rows] of existingRows) {
      const after = tableName === "document_tombstones"
        ? readRows(tableName).map(({ group_id: groupId, ...rest }) => {
          assert(groupId === null, "0030 기존 tombstone의 group_id는 NULL이어야 합니다.");
          return rest;
        })
        : readRows(tableName);
      assertRowsEqual(`0030 upgrade 기존 ${tableName} row 보존`, after, rows);
    }

    // 삭제 중인 계정이 없으면 owner를 바꿀 수 없다.
    assertSqlFails(
      database,
      "UPDATE media_objects SET owner_id = 'gr-a' WHERE id = 'gr-kept';",
      "0030 삭제 작업 없이 owner 이전",
      "MEDIA_OBJECT",
    );
    database.exec(`
      INSERT INTO account_deletion_jobs (
        id, operation_id, subject_id, erasure_alias,
        initiating_token_digest, initiating_token_mode, request_hash,
        request_hash_version, status, requested_at, alias_after, updated_at
      ) VALUES (
        'gr-job', '50000000-0000-4000-8000-000000000030', 'gr-b',
        'erased:51000000-0000-4000-8000-000000000030',
        '${"c".repeat(64)}', 'EPHEMERAL', '${"c".repeat(64)}', 1,
        'ERASING', 1700000000, 1702592000, 1700000000
      );
    `);
    for (const [sql, label] of [
      ["UPDATE media_objects SET owner_id = 'gr-b' WHERE id = 'gr-kept';", "아무 변화 없는 ATTACHED 갱신은 여전히 막힘"],
      ["UPDATE media_objects SET owner_id = NULL WHERE id = 'gr-kept';", "ATTACHED owner를 비우기"],
      ["UPDATE media_objects SET owner_id = 'gr-a' WHERE id = 'gr-own';", "본인 개인 노트 이미지를 남에게 넘기기"],
    ]) {
      assertSqlFails(database, sql, `0030 ${label}`, label.includes("비우기") ? "" : "MEDIA_OBJECT");
    }
    database.exec("UPDATE media_objects SET owner_id = 'gr-a' WHERE id = 'gr-kept';");
    assertRowsEqual(
      "0030 남의 그룹 노트 이미지는 노트 주인에게 넘어감",
      database.all("SELECT id, owner_id, state FROM media_objects ORDER BY id;"),
      [
        { id: "gr-kept", owner_id: "gr-a", state: "ATTACHED" },
        { id: "gr-own", owner_id: "gr-b", state: "ATTACHED" },
      ],
    );
    database.exec(`
      INSERT INTO document_tombstones (resource_type, resource_id, subject_id, owner_id, group_id, source_version, purged_at)
        VALUES ('PRIVATE_NOTE', 'gr-purged-group-note', 'gr-a', 'gr-a', 'gr-gone-group', 1, 1700000000);
    `);
    assertRowsEqual(
      "0030 tombstone group_id는 FK 없이 해제된 그룹도 기록",
      database.all("SELECT group_id FROM document_tombstones WHERE resource_id = 'gr-purged-group-note';"),
      [{ group_id: "gr-gone-group" }],
    );
    assertRowsEqual("0030 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0030 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
