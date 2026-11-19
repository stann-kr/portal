import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const commentRepliesMigrationFile = "0033_comment_replies.sql";
const previousMigrationFile = "0032_student_archive.sql";

/**
 * 0032 → 0033: 댓글 답글을 위해 comments에 parent_id(nullable, 외래키 없음)와 comments_parent_idx만 더한다.
 * table을 재생성하지 않으므로 comments trigger(휴지통 게시물 보호·계정 삭제 예외)와 cascade가 그대로이고
 * 기존 댓글은 모두 원 댓글(parent_id NULL)이다. 원 댓글을 지워도 답글이 남는지(cascade 없음)도 확인한다.
 */
export async function validateCommentRepliesUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(commentRepliesMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0032 → 0033 comment replies migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('cr-admin', 'cr-admin@example.com', 'Admin', 'admin'),
        ('cr-student', 'cr-student@example.com', 'Student', 'student');
      INSERT INTO posts (id, author_id, category, title, content_html, board_type)
      VALUES ('cr-post', 'cr-student', 'free', 'Post', '<p>post</p>', 'community');
      INSERT INTO comments (id, post_id, author_id, content_html, created_at, time_marker_seconds) VALUES
        ('cr-comment-1', 'cr-post', 'cr-admin', '<p>좋아요</p>', 1800000000, NULL),
        ('cr-comment-2', 'cr-post', 'cr-student', '<p>감사합니다</p>', 1800000100, 30);
    `);
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const readForeignKeys = () => database.all(`
      SELECT "table" AS target, "from" AS column_name, "to" AS target_column, on_delete
      FROM pragma_foreign_key_list('comments') ORDER BY "from";
    `);
    const existingSchema = readSchema();
    const existingForeignKeys = readForeignKeys();
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => [entry.name, readRows(entry.name)]));

    applyMigration(database, commentRepliesMigrationFile);

    const isCommentsTable = (entry) => entry.type === "table" && entry.name === "comments";
    assertRowsEqual(
      "0033 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !isCommentsTable(entry) && entry.name !== "comments_parent_idx"),
      existingSchema.filter((entry) => !isCommentsTable(entry)),
    );
    for (const [tableName, rows] of existingRows) {
      const after = readRows(tableName).map((row) => {
        if (tableName !== "comments") return row;
        const rest = { ...row };
        delete rest.parent_id;
        return rest;
      });
      assertRowsEqual(`0033 upgrade 기존 ${tableName} row 보존`, after, rows);
    }
    assertRowsEqual(
      "0033 기존 댓글은 원 댓글",
      database.all("SELECT id, parent_id FROM comments ORDER BY id;"),
      [{ id: "cr-comment-1", parent_id: null }, { id: "cr-comment-2", parent_id: null }],
    );
    assertRowsEqual(
      "0033 parent_id column",
      database.all(`
        SELECT name, lower(type) AS type, "notnull" AS not_null, dflt_value
        FROM pragma_table_info('comments') WHERE name = 'parent_id';
      `),
      [{ name: "parent_id", type: "text", not_null: 0, dflt_value: null }],
    );
    assertRowsEqual("0033 parent_id는 외래키 없음(기존 FK 그대로)", readForeignKeys(), existingForeignKeys);
    assertRowsEqual(
      "0033 comments_parent_idx",
      database.all(`
        SELECT il.name AS index_name, il."unique" AS is_unique, ii.seqno, ii.name AS column_name
        FROM pragma_index_list('comments') AS il
        JOIN pragma_index_info(il.name) AS ii
        WHERE il.name = 'comments_parent_idx';
      `),
      [{ index_name: "comments_parent_idx", is_unique: 0, seqno: 0, column_name: "parent_id" }],
    );
    const plan = database.all("EXPLAIN QUERY PLAN SELECT id FROM comments WHERE parent_id = 'cr-comment-1';");
    assert(
      plan.some((row) => String(row.detail).includes("comments_parent_idx")),
      `0033 답글 조회가 comments_parent_idx를 쓰지 않습니다: ${JSON.stringify(plan)}`,
    );

    // 원 댓글을 지워도 답글은 남는다(화면이 "삭제된 댓글입니다"로 보인다). 외래키가 없어 무결성 검사도 깨끗하다.
    database.exec(`
      INSERT INTO comments (id, post_id, author_id, content_html, created_at, parent_id)
      VALUES ('cr-reply-1', 'cr-post', 'cr-student', '<p>답글</p>', 1800000200, 'cr-comment-1');
      DELETE FROM comments WHERE id = 'cr-comment-1';
    `);
    assertRowsEqual(
      "0033 원 댓글 삭제 뒤 답글 보존",
      database.all("SELECT id, parent_id FROM comments WHERE parent_id IS NOT NULL;"),
      [{ id: "cr-reply-1", parent_id: "cr-comment-1" }],
    );
    assertRowsEqual("0033 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0033 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
