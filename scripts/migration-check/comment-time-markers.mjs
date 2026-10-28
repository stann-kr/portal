import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert, assertSqlFails } from "./assertions.mjs";
import { diggingPlaylistMigrationFile } from "./digging-playlists.mjs";

export const commentTimeMarkerMigrationFile = "0020_comment_time_markers.sql";

const originalCommentColumns = ["id", "post_id", "author_id", "content_html", "created_at"];

/** 0019 → 0020: comments에 nullable 시점 column과 index만 더하고 table을 재생성하지 않아 기존 row·trigger를 보존한다. */
export async function validateCommentTimeMarkerUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(commentTimeMarkerMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === diggingPlaylistMigrationFile,
    "0019 → 0020 comment time marker migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('ctm-admin', 'ctm-admin@example.com', 'Admin', 'admin'),
        ('ctm-student', 'ctm-student@example.com', 'Student', 'student');
      INSERT INTO posts (id, author_id, category, title, content_html, board_type)
      VALUES ('ctm-post', 'ctm-student', 'mixset', 'Mixset', '<p>set</p>', 'community');
      INSERT INTO comments (id, post_id, author_id, content_html, created_at) VALUES
        ('ctm-comment-1', 'ctm-post', 'ctm-admin', '<p>좋아요</p>', 1800000000),
        ('ctm-comment-2', 'ctm-post', 'ctm-student', '<p>감사합니다</p>', 1800000100);
      INSERT INTO comments (id, post_id, author_id, content_html)
      VALUES ('ctm-comment-default', 'ctm-post', 'ctm-student', '<p>기본 시각</p>');
    `);
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const readOriginalComments = () => database.all(
      `SELECT ${originalCommentColumns.join(", ")} FROM comments ORDER BY id;`,
    );
    const existingSchema = readSchema();
    const existingComments = readOriginalComments();
    assert(existingComments.length === 3, "0020 fixture 댓글을 준비하지 못했습니다.");
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table" && entry.name !== "comments")
      .map((entry) => [entry.name, readRows(entry.name)]));

    applyMigration(database, commentTimeMarkerMigrationFile);

    // comments table 정의만 바뀌고 다른 table·index·trigger(comments trigger 포함)는 그대로다.
    assertRowsEqual(
      "0020 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) =>
        !(entry.type === "table" && entry.name === "comments") &&
        entry.name !== "comments_post_created_idx"),
      existingSchema.filter((entry) => !(entry.type === "table" && entry.name === "comments")),
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0020 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual("0020 upgrade 기존 댓글 column 보존", readOriginalComments(), existingComments);
    assertRowsEqual(
      "0020 upgrade 기존 댓글 시점 NULL",
      database.all("SELECT id, time_marker_seconds FROM comments ORDER BY id;"),
      existingComments.map((row) => ({ id: row.id, time_marker_seconds: null })),
    );
    assertRowsEqual(
      "0020 time_marker_seconds column",
      database.all(`
        SELECT name, lower(type) AS type, "notnull" AS not_null, dflt_value
        FROM pragma_table_info('comments') WHERE name = 'time_marker_seconds';
      `),
      [{ name: "time_marker_seconds", type: "integer", not_null: 0, dflt_value: null }],
    );
    assertRowsEqual(
      "0020 comments_post_created_idx",
      database.all(`
        SELECT il.name AS index_name, il."unique" AS is_unique, ii.seqno, ii.name AS column_name
        FROM pragma_index_list('comments') AS il
        JOIN pragma_index_info(il.name) AS ii
        WHERE il.origin = 'c'
        ORDER BY il.name, ii.seqno;
      `),
      [
        { index_name: "comments_post_created_idx", is_unique: 0, seqno: 0, column_name: "post_id" },
        { index_name: "comments_post_created_idx", is_unique: 0, seqno: 1, column_name: "created_at" },
      ],
    );

    const insert = (id, seconds) =>
      `INSERT INTO comments (id, post_id, author_id, content_html, time_marker_seconds)
       VALUES ('${id}', 'ctm-post', 'ctm-student', '<p>marker</p>', ${seconds});`;
    for (const [sql, label] of [
      [insert("ctm-negative", -1), "음수 시점"],
      [insert("ctm-day", 86400), "86400초 시점"],
      ["UPDATE comments SET time_marker_seconds = 86400 WHERE id = 'ctm-comment-1';", "86400초로 수정"],
    ]) {
      assertSqlFails(database, sql, `0020 ${label}`, "comments_time_marker_check");
    }
    database.exec(`${insert("ctm-zero", 0)}${insert("ctm-max", 86399)}${insert("ctm-null", "NULL")}`);
    assertRowsEqual(
      "0020 경계 시점 저장",
      database.all(`
        SELECT id, time_marker_seconds FROM comments
        WHERE id IN ('ctm-zero', 'ctm-max', 'ctm-null') ORDER BY id;
      `),
      [
        { id: "ctm-max", time_marker_seconds: 86399 },
        { id: "ctm-null", time_marker_seconds: null },
        { id: "ctm-zero", time_marker_seconds: 0 },
      ],
    );
    assertRowsEqual("0020 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0020 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
