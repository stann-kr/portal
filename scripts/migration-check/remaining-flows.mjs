import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const remainingFlowsMigrationFile = "0039_remaining_flows.sql";
const previousMigrationFile = "0038_flow_gaps.sql";

function rejects(database, statement) {
  try {
    database.exec(statement);
    return false;
  } catch {
    return true;
  }
}

/**
 * 0038 → 0039: 그룹 해제 표시(lesson_groups.dissolved_at), 가이드 휴지통(guide_pages.deleted_at·deleted_by_id),
 * 가이드 이력(guide_page_revisions), Q&A 답글 고치기(qna_reply_revisions, qna_replies 행과 trigger는 그대로)를 더한다.
 * column 추가·새 table만이라 기존 table·trigger·row가 그대로이고, 새 column을 모르는 옛 코드의 INSERT도 그대로 된다.
 */
export async function validateRemainingFlowsUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(remainingFlowsMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0038 → 0039 remaining flows migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('rf-admin', 'rf-admin@example.com', 'Admin', 'admin'),
        ('rf-editor', 'rf-editor@example.com', 'Editor', 'admin'),
        ('rf-student', 'rf-student@example.com', 'Student', 'student');
      INSERT INTO lesson_groups (id, name, created_at, updated_at) VALUES ('rf-group', '그룹', 1795000000, 1795000000);
      INSERT INTO guide_pages (id, title, sort_order, content_html, created_at, updated_at) VALUES ('rf-page', '가이드', 0, '<p>a</p>', 1795000000, 1795000000);
      INSERT INTO qna_threads (id, student_id, title, status, created_at, updated_at, version) VALUES ('rf-thread', 'rf-student', '질문', 'OPEN', 1795000000, 1795000000, 1);
      INSERT INTO document_operation_ledger (
        id, operation_id, actor_id, subject_id, resource_type, operation_type,
        resource_id, request_hash, request_hash_version, result_revision, created_at
      ) VALUES (
        'rf-ledger', '00000000-0000-4000-8000-000000003901', 'rf-student', 'rf-student',
        'QNA_THREAD', 'CREATE', 'rf-thread', '${"c".repeat(64)}', 1, 1, 1795000000
      );
      INSERT INTO qna_replies (id, thread_id, author_id, content_html, created_at) VALUES ('rf-reply', 'rf-thread', 'rf-student', '<p>q</p>', 1795000000);
    `);
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const altered = new Set(["lesson_groups", "guide_pages"]);
    const added = new Set(["guide_page_revisions", "qna_reply_revisions", "guide_page_revisions_page_created_idx", "qna_reply_revisions_reply_number_unique"]);
    const existingSchema = readSchema();
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => [entry.name, readRows(entry.name)]));

    applyMigration(database, remainingFlowsMigrationFile);

    assertRowsEqual(
      "0039 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !(entry.type === "table" && altered.has(entry.name)) && !added.has(entry.name)),
      existingSchema.filter((entry) => !(entry.type === "table" && altered.has(entry.name))),
    );
    const newColumns = { lesson_groups: ["dissolved_at"], guide_pages: ["deleted_at", "deleted_by_id"] };
    for (const [tableName, rows] of existingRows) {
      const after = readRows(tableName).map((row) => {
        const rest = { ...row };
        for (const column of newColumns[tableName] ?? []) {
          assert(rest[column] === null, `0039 기존 ${tableName}.${column}는 NULL이어야 합니다.`);
          delete rest[column];
        }
        return rest;
      });
      assertRowsEqual(`0039 upgrade 기존 ${tableName} row 보존`, after, rows);
    }

    // 새 column을 모르는 옛 코드의 INSERT가 그대로 된다(롤백 호환).
    database.exec(`
      INSERT INTO lesson_groups (id, name, created_at, updated_at) VALUES ('rf-group-old', '옛', 1795000100, 1795000100);
      INSERT INTO guide_pages (id, title, sort_order, created_at, updated_at) VALUES ('rf-page-old', '옛 가이드', 1, 1795000100, 1795000100);
    `);

    // 이력: 가이드 이력은 EDIT·RESTORE만, 페이지·답글을 지우면 함께 지워진다. 고친 사람·지운 사람 계정을 지우면 NULL.
    database.exec(`
      INSERT INTO guide_page_revisions (id, page_id, page_version, title, content_html, reason, actor_id, created_at)
        VALUES ('rf-grev', 'rf-page', 1, '가이드', '<p>a</p>', 'EDIT', 'rf-editor', 1795000200);
      INSERT INTO qna_reply_revisions (id, reply_id, edit_number, content_html, editor_id, created_at)
        VALUES ('rf-qrev', 'rf-reply', 1, '<p>q2</p>', 'rf-student', 1795000200);
      UPDATE guide_pages SET deleted_at = 1795000300, deleted_by_id = 'rf-editor' WHERE id = 'rf-page';
    `);
    assert(
      rejects(database, "INSERT INTO guide_page_revisions (id, page_id, page_version, title, content_html, reason, created_at) VALUES ('rf-bad', 'rf-page', 1, 't', '', 'TRASH', 1);"),
      "0039 guide_page_revisions reason CHECK가 EDIT·RESTORE 밖을 막아야 합니다.",
    );
    assert(
      rejects(database, "INSERT INTO qna_reply_revisions (id, reply_id, edit_number, content_html, created_at) VALUES ('rf-dup', 'rf-reply', 1, '<p>x</p>', 1);"),
      "0039 qna_reply_revisions는 답글마다 고친 번호가 하나여야 합니다.",
    );
    assert(
      rejects(database, "INSERT INTO qna_reply_revisions (id, reply_id, edit_number, content_html, created_at) VALUES ('rf-empty', 'rf-reply', 2, '', 1);"),
      "0039 qna_reply_revisions 빈 본문을 막아야 합니다.",
    );
    // 원래 답글 행은 여전히 바꿀 수 없다(고친 본문은 이력 표에만 쌓인다).
    assert(rejects(database, "UPDATE qna_replies SET content_html = '<p>x</p>' WHERE id = 'rf-reply';"), "0039 뒤에도 qna_replies는 고칠 수 없어야 합니다.");
    const foreignKeys = (tableName) => database
      .all(`SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('${tableName}');`)
      .sort((left, right) => left.from.localeCompare(right.from));
    assertRowsEqual("0039 guide_pages 지운 사람 FK", foreignKeys("guide_pages").filter((row) => row.from === "deleted_by_id"), [
      { table: "profiles", from: "deleted_by_id", to: "id", on_delete: "SET NULL" },
    ]);
    assertRowsEqual("0039 guide_page_revisions FK", foreignKeys("guide_page_revisions"), [
      { table: "profiles", from: "actor_id", to: "id", on_delete: "SET NULL" },
      { table: "guide_pages", from: "page_id", to: "id", on_delete: "CASCADE" },
    ]);
    assertRowsEqual("0039 qna_reply_revisions FK", foreignKeys("qna_reply_revisions"), [
      { table: "profiles", from: "editor_id", to: "id", on_delete: "SET NULL" },
      { table: "qna_replies", from: "reply_id", to: "id", on_delete: "CASCADE" },
    ]);
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec("DELETE FROM guide_pages WHERE id = 'rf-page';");
    assertRowsEqual("0039 페이지 영구 삭제 시 이력 cascade", database.all("SELECT count(*) AS n FROM guide_page_revisions;"), [{ n: 0 }]);
    assertRowsEqual("0039 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
  } finally {
    database.close();
  }
}
