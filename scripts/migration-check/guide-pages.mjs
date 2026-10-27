import {
  applyMigration,
  applyMigrations,
  assignmentTaskMigrationFile,
  createMemoryDatabase,
  guidePageMigrationFile,
} from "./runtime.mjs";
import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";

const SERVER_DRAFT_TRIGGERS = [
  "document_server_drafts_before_insert_existing",
  "document_server_drafts_cas_update_guard",
];

export function validateGuidePageSchema(database) {
  const triggers = database
    .all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'document_server_drafts' ORDER BY name;")
    .map((row) => row.name);
  assertRowsEqual("0016 server draft trigger 재생성", triggers, [...SERVER_DRAFT_TRIGGERS].sort());
  const anchorForeignKeys = database.all("PRAGMA foreign_key_list('qna_guide_anchors');");
  assert(
    anchorForeignKeys.some((foreignKey) => foreignKey.table === "qna_threads" && foreignKey.on_delete === "CASCADE"),
    "qna_guide_anchors → qna_threads cascade FK가 없습니다.",
  );
  assert(
    anchorForeignKeys.some((foreignKey) => foreignKey.table === "guide_pages" && foreignKey.on_delete === "SET NULL"),
    "qna_guide_anchors → guide_pages SET NULL FK가 없습니다.",
  );
}

/** 0015 → 0016: 서버 초안을 보존하고 guide-page 초안·가이드·질문 위치 제약을 확인한다. */
export async function validateGuidePageUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(guidePageMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === assignmentTaskMigrationFile,
    "0015 → 0016 guide page migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('guide-admin', 'guide-admin@example.com', 'Admin', 'admin'),
        ('guide-student', 'guide-student@example.com', 'Student', 'student');
      INSERT INTO document_server_drafts (
        owner_id, source_key, document_kind, context_id, payload_json, payload_hash,
        draft_version, writer_device_id, created_at, updated_at, expires_at
      ) VALUES (
        'guide-student', 'draft:document:note:guide-student:new',
        'note', 'new', '{"title":"Preserved draft"}', '${"c".repeat(64)}',
        1, 'guide-fixture-device', 1800000000, 1800000000, 1802592000
      );
      INSERT INTO qna_threads (id, student_id, title, status, version)
      VALUES ('guide-thread', 'guide-student', '질문', 'OPEN', 1);
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
        AND tbl_name NOT IN ('document_server_drafts', 'guide_pages', 'guide_assets', 'qna_guide_anchors')
      ORDER BY type, name
    `);
    const existingSchema = readSchema();
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => [entry.name, readRows(entry.name)]));
    const existingDrafts = readRows("document_server_drafts");

    applyMigration(database, guidePageMigrationFile);

    assertRowsEqual("0016 upgrade 다른 table·index·trigger 보존", readSchema(), existingSchema);
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0016 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual("0016 upgrade 서버 초안 보존", readRows("document_server_drafts"), existingDrafts);
    validateGuidePageSchema(database);

    database.exec(`
      INSERT INTO document_server_drafts (
        owner_id, source_key, document_kind, context_id, payload_json, payload_hash,
        draft_version, writer_device_id, created_at, updated_at, expires_at
      ) VALUES (
        'guide-admin', 'draft:document:guide-page:guide-admin:guide-1',
        'guide-page', 'guide-1', '{"title":"가이드"}', '${"d".repeat(64)}',
        1, 'guide-fixture-device', 1800000000, 1800000000, 1802592000
      );
      INSERT INTO guide_pages (id, title, sort_order, content_html, created_by_id, updated_by_id)
      VALUES ('guide-1', '개요', 0, '<p data-block-id="b1">내용</p>', 'guide-admin', 'guide-admin');
      INSERT INTO guide_assets (id, object_key, content_type, size_bytes, guide_page_id, uploaded_by_id)
      VALUES ('asset-1', 'guide/asset-1', 'image/jpeg', 1024, 'guide-1', 'guide-admin');
      INSERT INTO qna_guide_anchors (thread_id, guide_page_id, page_title, anchor_block_id, anchor_quote)
      VALUES ('guide-thread', 'guide-1', '개요', 'b1', '내용');
    `);
    for (const [sql, label, expected] of [
      [
        `INSERT INTO document_server_drafts (owner_id, source_key, document_kind, context_id, payload_json, payload_hash, draft_version, writer_device_id, created_at, updated_at, expires_at)
         VALUES ('guide-admin', 'draft:document:other:guide-admin:x', 'other', 'x', '{}', '${"e".repeat(64)}', 1, 'd', 1800000000, 1800000000, 1802592000);`,
        "초안 종류 allowlist",
        "document_server_drafts_kind_check",
      ],
      ["INSERT INTO guide_pages (id, title) VALUES ('guide-blank', '');", "빈 가이드 제목", "guide_pages_payload_check"],
      ["INSERT INTO guide_assets (id, object_key, content_type, size_bytes) VALUES ('asset-2', 'media/asset-2', 'image/png', 10);", "가이드 이미지 key prefix", "guide_assets_payload_check"],
      ["INSERT INTO guide_assets (id, object_key, content_type, size_bytes) VALUES ('asset-3', 'guide/asset-3', 'image/svg+xml', 10);", "가이드 이미지 형식", "guide_assets_payload_check"],
      ["INSERT INTO qna_guide_anchors (thread_id, page_title, anchor_quote) VALUES ('missing-thread', '개요', 'x');", "없는 질문", "FOREIGN KEY constraint failed"],
      ["UPDATE qna_guide_anchors SET anchor_quote = '' WHERE thread_id = 'guide-thread';", "빈 인용", "qna_guide_anchors_payload_check"],
    ]) {
      assertSqlFails(database, sql, `0016 ${label}`, expected);
    }

    // 가이드 페이지를 지워도 질문과 위치 인용은 남는다.
    database.exec("DELETE FROM guide_pages WHERE id = 'guide-1';");
    assertRowsEqual(
      "0016 가이드 삭제 뒤 질문 위치 보존",
      database.all("SELECT thread_id, guide_page_id, page_title, anchor_quote FROM qna_guide_anchors;"),
      [{ thread_id: "guide-thread", guide_page_id: null, page_title: "개요", anchor_quote: "내용" }],
    );
    assertRowsEqual(
      "0016 가이드 삭제 뒤 이미지 기록 분리",
      database.all("SELECT id, guide_page_id FROM guide_assets;"),
      [{ id: "asset-1", guide_page_id: null }],
    );
    assertRowsEqual("0016 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0016 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
