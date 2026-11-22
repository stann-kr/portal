import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const postReadsMigrationFile = "0034_post_reads.sql";
const previousMigrationFile = "0033_comment_replies.sql";

/**
 * 0033 → 0034: 게시물 읽음 기록 표 post_reads(게시물·학생 복합 기본키, 처음 연 시각)와 학생 index만 새로 만든다.
 * 기존 table·trigger·row는 그대로이고, 게시물 영구 삭제와 계정 삭제가 기록을 함께 지우는지(cascade) 확인한다.
 */
export async function validatePostReadsUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(postReadsMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0033 → 0034 post reads migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('pr-admin', 'pr-admin@example.com', 'Admin', 'admin'),
        ('pr-student-1', 'pr-student-1@example.com', 'One', 'student'),
        ('pr-student-2', 'pr-student-2@example.com', 'Two', 'student');
      INSERT INTO posts (id, author_id, category, title, content_html, board_type) VALUES
        ('pr-post-1', 'pr-admin', 'free', 'Notice', '<p>n</p>', 'ANNOUNCEMENT'),
        ('pr-post-2', 'pr-student-2', 'free', 'Post', '<p>p</p>', 'GENERAL');
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

    applyMigration(database, postReadsMigrationFile);

    assertRowsEqual(
      "0034 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => entry.tbl_name !== "post_reads"),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0034 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual(
      "0034 post_reads columns",
      database.all(`
        SELECT name, lower(type) AS type, "notnull" AS not_null, pk
        FROM pragma_table_info('post_reads') ORDER BY cid;
      `),
      [
        { name: "post_id", type: "text", not_null: 1, pk: 1 },
        { name: "student_id", type: "text", not_null: 1, pk: 2 },
        { name: "first_read_at", type: "integer", not_null: 1, pk: 0 },
      ],
    );
    assertRowsEqual(
      "0034 post_reads 외래키는 게시물·계정 삭제와 함께 지운다",
      database.all(`
        SELECT "table" AS target, "from" AS column_name, on_delete
        FROM pragma_foreign_key_list('post_reads') ORDER BY "from";
      `),
      [
        { target: "posts", column_name: "post_id", on_delete: "CASCADE" },
        { target: "profiles", column_name: "student_id", on_delete: "CASCADE" },
      ],
    );
    const plan = database.all("EXPLAIN QUERY PLAN SELECT post_id FROM post_reads WHERE student_id = 'pr-student-1';");
    assert(
      plan.some((row) => String(row.detail).includes("post_reads_student_idx")),
      `0034 학생별 조회가 post_reads_student_idx를 쓰지 않습니다: ${JSON.stringify(plan)}`,
    );

    // 같은 학생·게시물은 한 줄(처음 시각 유지).
    database.exec(`
      INSERT INTO post_reads (post_id, student_id, first_read_at) VALUES
        ('pr-post-1', 'pr-student-1', 1800000000),
        ('pr-post-1', 'pr-student-2', 1800000100),
        ('pr-post-2', 'pr-student-1', 1800000200);
      INSERT OR IGNORE INTO post_reads (post_id, student_id, first_read_at) VALUES ('pr-post-1', 'pr-student-1', 1800009999);
    `);
    assertRowsEqual(
      "0034 같은 학생·게시물은 처음 시각 한 줄",
      database.all("SELECT first_read_at FROM post_reads WHERE post_id = 'pr-post-1' AND student_id = 'pr-student-1';"),
      [{ first_read_at: 1800000000 }],
    );
    // 게시물 영구 삭제는 그 게시물의 읽음 기록을 함께 지운다. 학생 계정 삭제는 삭제 작업(ERASING) 안에서만
    // trigger가 허용하므로 여기서는 위 외래키 설정만 보고, 실제 삭제 경로는 account-privacy-atomic.test.ts가 확인한다.
    database.exec("DELETE FROM posts WHERE id = 'pr-post-2';");
    assertRowsEqual(
      "0034 게시물 삭제 뒤 남은 기록",
      database.all("SELECT post_id, student_id FROM post_reads ORDER BY post_id, student_id;"),
      [
        { post_id: "pr-post-1", student_id: "pr-student-1" },
        { post_id: "pr-post-1", student_id: "pr-student-2" },
      ],
    );
    assertRowsEqual("0034 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0034 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
