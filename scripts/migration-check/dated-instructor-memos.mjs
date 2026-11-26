import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert, assertSqlFails } from "./assertions.mjs";

export const datedInstructorMemosMigrationFile = "0043_dated_instructor_memos.sql";
const previousMigrationFile = "0042_assignment_no_due.sql";

/**
 * 0042 → 0043: 관리자 수업 메모에 날짜(instructor_memos.memo_date)를 더해 노트 없이 학생·날짜당 메모 하나를 둔다.
 * column 추가와 학생 메모 unique index를 날짜 없는 행으로 좁히는 것뿐이라 다른 table·trigger와 기존 row가 그대로다.
 * 옛 코드의 학생 메모·노트 메모 INSERT·UPDATE도 된다.
 */
export async function validateDatedInstructorMemosUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(datedInstructorMemosMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0042 → 0043 dated instructor memos migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('dm-admin', 'dm-admin@example.com', 'Admin', 'admin'),
        ('dm-student', 'dm-student@example.com', 'Student', 'student'),
        ('dm-other', 'dm-other@example.com', 'Other', 'student');
      INSERT INTO private_notes (id, student_id, author_id, title, content_html)
        VALUES ('dm-note', 'dm-student', 'dm-admin', '1회차', '<p>노트</p>');
      INSERT INTO instructor_memos (id, student_id, note_id, content_html, updated_by_id, created_at, updated_at) VALUES
        ('dm-student-memo', 'dm-student', NULL, '<p>성향</p>', 'dm-admin', 1800000000, 1800000000),
        ('dm-note-memo', 'dm-student', 'dm-note', '<p>수업</p>', 'dm-admin', 1800000000, 1800000000);
      INSERT INTO instructor_memo_revisions (id, memo_id, revision_number, content_html, created_at, updated_at)
        VALUES ('dm-rev', 'dm-student-memo', 1, '<p>성향</p>', 1800000000, 1800000000);
    `);
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const changed = new Set(["instructor_memos", "instructor_memos_student_unique", "instructor_memos_student_date_unique"]);
    const existingSchema = readSchema();
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => [entry.name, readRows(entry.name)]));

    applyMigration(database, datedInstructorMemosMigrationFile);

    assertRowsEqual(
      "0043 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !changed.has(entry.name)),
      existingSchema.filter((entry) => !changed.has(entry.name)),
    );
    for (const [tableName, rows] of existingRows) {
      const after = readRows(tableName).map((row) => {
        if (tableName !== "instructor_memos") return row;
        assert(row.memo_date === null, "0043 기존 메모의 memo_date는 NULL이어야 합니다.");
        const rest = { ...row };
        delete rest.memo_date;
        return rest;
      });
      assertRowsEqual(`0043 upgrade 기존 ${tableName} row 보존`, after, rows);
    }

    // 날짜 메모: 학생·날짜당 하나, 학생 메모와 따로 있고 노트와 함께 쓰지 않는다.
    database.exec(`
      INSERT INTO instructor_memos (id, student_id, memo_date, content_html) VALUES
        ('dm-day-1', 'dm-student', '2026-11-27', '<p>진도</p>'),
        ('dm-day-2', 'dm-student', '2026-11-28', '<p>다음</p>'),
        ('dm-other-day', 'dm-other', '2026-11-27', '<p>다른 학생</p>');
    `);
    assertSqlFails(database, "INSERT INTO instructor_memos (id, student_id, memo_date, content_html) VALUES ('dm-dup', 'dm-student', '2026-11-27', '<p>x</p>');", "0043 같은 학생·날짜 메모 두 개");
    assertSqlFails(database, "INSERT INTO instructor_memos (id, student_id, content_html) VALUES ('dm-dup-student', 'dm-student', '<p>x</p>');", "0043 학생 메모 두 개");
    assertSqlFails(database, "INSERT INTO instructor_memos (id, student_id, note_id, memo_date, content_html) VALUES ('dm-both', 'dm-student', NULL, '2026-1-1', '<p>x</p>');", "0043 날짜 형식");
    assertSqlFails(database, "UPDATE instructor_memos SET memo_date = '2026-11-29' WHERE id = 'dm-note-memo';", "0043 노트 메모에 날짜");
    // 옛 코드의 학생 메모·노트 메모 고치기는 그대로 된다.
    database.exec(`
      UPDATE instructor_memos SET content_html = '<p>성향 고침</p>', version = version + 1 WHERE student_id = 'dm-student' AND note_id IS NULL AND id = 'dm-student-memo';
      UPDATE instructor_memos SET content_html = '<p>수업 고침</p>', version = version + 1 WHERE note_id = 'dm-note';
    `);
    const plan = database.all("EXPLAIN QUERY PLAN SELECT id FROM instructor_memos WHERE student_id = 'dm-student' AND memo_date IS NOT NULL ORDER BY memo_date DESC;");
    assert(plan.some((row) => String(row.detail).includes("instructor_memos_student_date_unique")), "0043 날짜 메모 목록이 학생·날짜 index를 써야 합니다.");
    assertRowsEqual("0043 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
  } finally {
    database.close();
  }
}
