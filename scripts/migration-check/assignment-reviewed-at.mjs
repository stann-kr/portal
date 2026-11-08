import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const assignmentReviewedAtMigrationFile = "0025_assignment_reviewed_at.sql";
const previousMigrationFile = "0024_push_subscriptions.sql";

/**
 * 0024 → 0025: 제출에 Stann "확인함" 시각(reviewed_at, nullable) column만 더한다.
 * table을 재생성하지 않으므로 기존 row·FK·index·feedback이 그대로이고 기존 제출은 모두 미확인(NULL)이다.
 */
export async function validateAssignmentReviewedAtUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(assignmentReviewedAtMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0024 → 0025 assignment reviewed_at migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('ra-admin', 'ra-admin@example.com', 'Admin', 'admin'),
        ('ra-student', 'ra-student@example.com', 'Student', 'student');
      INSERT INTO assignment_tasks (id, student_id, title, submission_format, due_at)
      VALUES ('ra-task', 'ra-student', '연습 기록', 'TEXT', NULL);
      INSERT INTO assignments (id, student_id, task_id, media_url, text_html, submitted_at) VALUES
        ('ra-sub-task', 'ra-student', 'ra-task', NULL, '<p>기록</p>', 1793000100),
        ('ra-sub-free', 'ra-student', NULL, 'https://youtu.be/abcdefghijk', NULL, 1793000200);
      INSERT INTO feedbacks (id, assignment_id, time_marker, content, created_at)
      VALUES ('ra-feedback', 'ra-sub-free', 90, '좋아요', 1793000300);
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

    applyMigration(database, assignmentReviewedAtMigrationFile);

    const isAssignmentsTable = (entry) => entry.type === "table" && entry.name === "assignments";
    assertRowsEqual(
      "0025 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !isAssignmentsTable(entry)),
      existingSchema.filter((entry) => !isAssignmentsTable(entry)),
    );
    for (const [tableName, rows] of existingRows) {
      const after = readRows(tableName).map((row) => {
        if (tableName !== "assignments") return row;
        const rest = { ...row };
        delete rest.reviewed_at;
        return rest;
      });
      assertRowsEqual(`0025 upgrade 기존 ${tableName} row 보존`, after, rows);
    }
    assertRowsEqual(
      "0025 기존 제출 확인 시각 NULL",
      database.all("SELECT id, reviewed_at FROM assignments ORDER BY id;"),
      [{ id: "ra-sub-free", reviewed_at: null }, { id: "ra-sub-task", reviewed_at: null }],
    );
    database.exec("UPDATE assignments SET reviewed_at = 1793000400 WHERE id = 'ra-sub-task';");
    assertRowsEqual(
      "0025 확인 시각 저장·해제",
      database.all("SELECT id, reviewed_at FROM assignments WHERE id = 'ra-sub-task';"),
      [{ id: "ra-sub-task", reviewed_at: 1793000400 }],
    );
    database.exec("UPDATE assignments SET reviewed_at = NULL WHERE id = 'ra-sub-task';");
    assertRowsEqual("0025 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0025 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
