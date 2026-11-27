import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const noteViewsMigrationFile = "0044_note_views.sql";
const previousMigrationFile = "0043_dated_instructor_memos.sql";

/**
 * 0043 → 0044: 노트 열람 기록 표 note_views(노트·학생 복합 기본키, 마지막 연 시각)와 학생 index만 새로 만든다.
 * 기존 table·trigger·row는 그대로이고, 노트 영구 삭제와 계정 삭제가 기록을 함께 지우는지(cascade) 확인한다.
 */
export async function validateNoteViewsUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(noteViewsMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0043 → 0044 note views migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('nv-admin', 'nv-admin@example.com', 'Admin', 'admin'),
        ('nv-student-1', 'nv-student-1@example.com', 'One', 'student'),
        ('nv-student-2', 'nv-student-2@example.com', 'Two', 'student');
      INSERT INTO private_notes (id, student_id, author_id, title, content_html) VALUES
        ('nv-note-1', 'nv-student-1', 'nv-admin', '1회차', '<p>n</p>'),
        ('nv-note-2', 'nv-student-2', 'nv-student-2', '메모', '<p>p</p>');
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

    applyMigration(database, noteViewsMigrationFile);

    assertRowsEqual(
      "0044 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => entry.tbl_name !== "note_views"),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0044 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual(
      "0044 note_views columns",
      database.all(`
        SELECT name, lower(type) AS type, "notnull" AS not_null, pk
        FROM pragma_table_info('note_views') ORDER BY cid;
      `),
      [
        { name: "note_id", type: "text", not_null: 1, pk: 1 },
        { name: "student_id", type: "text", not_null: 1, pk: 2 },
        { name: "last_viewed_at", type: "integer", not_null: 1, pk: 0 },
      ],
    );
    assertRowsEqual(
      "0044 note_views 외래키는 노트·계정 삭제와 함께 지운다",
      database.all(`
        SELECT "table" AS target, "from" AS column_name, on_delete
        FROM pragma_foreign_key_list('note_views') ORDER BY "from";
      `),
      [
        { target: "private_notes", column_name: "note_id", on_delete: "CASCADE" },
        { target: "profiles", column_name: "student_id", on_delete: "CASCADE" },
      ],
    );
    const plan = database.all("EXPLAIN QUERY PLAN SELECT note_id FROM note_views WHERE student_id = 'nv-student-1';");
    assert(
      plan.some((row) => String(row.detail).includes("note_views_student_idx")),
      `0044 학생별 조회가 note_views_student_idx를 쓰지 않습니다: ${JSON.stringify(plan)}`,
    );

    // 같은 학생·노트는 한 줄이고 다시 열면 마지막 시각으로 바뀐다.
    database.exec(`
      INSERT INTO note_views (note_id, student_id, last_viewed_at) VALUES
        ('nv-note-1', 'nv-student-1', 1800000000),
        ('nv-note-2', 'nv-student-2', 1800000200);
      INSERT INTO note_views (note_id, student_id, last_viewed_at) VALUES ('nv-note-1', 'nv-student-1', 1800009999)
        ON CONFLICT (note_id, student_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at;
    `);
    assertRowsEqual(
      "0044 같은 학생·노트는 마지막 시각 한 줄",
      database.all("SELECT last_viewed_at FROM note_views WHERE note_id = 'nv-note-1' AND student_id = 'nv-student-1';"),
      [{ last_viewed_at: 1800009999 }],
    );
    // 노트 영구 삭제는 그 노트의 열람 기록을 함께 지운다. 계정 삭제 경로는 account-privacy-atomic.test.ts가 확인한다.
    database.exec("DELETE FROM private_notes WHERE id = 'nv-note-2';");
    assertRowsEqual(
      "0044 노트 삭제 뒤 남은 기록",
      database.all("SELECT note_id, student_id FROM note_views ORDER BY note_id, student_id;"),
      [{ note_id: "nv-note-1", student_id: "nv-student-1" }],
    );
    assertRowsEqual("0044 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0044 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
