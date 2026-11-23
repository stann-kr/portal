import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const noteReadOnlyMigrationFile = "0036_note_read_only.sql";
const previousMigrationFile = "0035_assignment_drafts.sql";

/**
 * 0035 → 0036: 노트 학생 편집 막기(private_notes.student_read_only, 기본 0 = 함께 쓰기)와
 * 공동 편집 버전의 함께 고친 사람(private_note_revisions.contributor_ids, nullable)을 더한다.
 * 기존 table·index·trigger와 row는 그대로이고, 기존 노트는 함께 쓰기(0)로 남는지 확인한다.
 */
export async function validateNoteReadOnlyUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(noteReadOnlyMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0035 → 0036 note read-only migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('ro-admin', 'ro-admin@example.com', 'Admin', 'admin'),
        ('ro-student', 'ro-student@example.com', 'One', 'student');
      INSERT INTO private_notes (id, student_id, author_id, title, content_html, version) VALUES
        ('ro-note-admin', 'ro-student', 'ro-admin', 'Lesson', '<p>a</p>', 1),
        ('ro-note-student', 'ro-student', 'ro-student', 'Mine', '<p>b</p>', 1);
    `);
    // 버전 row는 영수증 trigger가 실제 쓰기 경로만 허용하므로 여기서는 넣지 않고 column만 본다(기존 row는 위 보존 검사가 본다).
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const changedTables = new Set(["private_notes", "private_note_revisions"]);
    const existingSchema = readSchema();
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table" && !changedTables.has(entry.name))
      .map((entry) => [entry.name, readRows(entry.name)]));
    const beforeNotes = database.all("SELECT id, title, version FROM private_notes ORDER BY id;");

    applyMigration(database, noteReadOnlyMigrationFile);

    assertRowsEqual(
      "0036 upgrade 다른 table·index·trigger 보존",
      readSchema().filter((entry) => !(entry.type === "table" && changedTables.has(entry.name))),
      existingSchema.filter((entry) => !(entry.type === "table" && changedTables.has(entry.name))),
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0036 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual(
      "0036 기존 노트는 함께 쓰기(0)로 남는다",
      database.all("SELECT id, title, version, student_read_only FROM private_notes ORDER BY id;"),
      beforeNotes.map((row) => ({ ...row, student_read_only: 0 })),
    );
    assertRowsEqual(
      "0036 contributor_ids column은 nullable text",
      database.all(`
        SELECT name, lower(type) AS type, "notnull" AS not_null, dflt_value
        FROM pragma_table_info('private_note_revisions') WHERE name = 'contributor_ids';
      `),
      [{ name: "contributor_ids", type: "text", not_null: 0, dflt_value: null }],
    );
    assertRowsEqual(
      "0036 student_read_only column",
      database.all(`
        SELECT name, lower(type) AS type, "notnull" AS not_null
        FROM pragma_table_info('private_notes') WHERE name = 'student_read_only';
      `),
      [{ name: "student_read_only", type: "integer", not_null: 1 }],
    );
    database.exec("UPDATE private_notes SET student_read_only = 1 WHERE id = 'ro-note-admin';");
    assertRowsEqual(
      "0036 읽기 전용 표시",
      database.all("SELECT id, student_read_only FROM private_notes ORDER BY id;"),
      [
        { id: "ro-note-admin", student_read_only: 1 },
        { id: "ro-note-student", student_read_only: 0 },
      ],
    );
    assertRowsEqual("0036 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0036 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
