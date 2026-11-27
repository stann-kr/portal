import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert, assertSqlFails } from "./assertions.mjs";

export const assignmentNoDueMigrationFile = "0042_assignment_no_due.sql";
const previousMigrationFile = "0041_timestamp_ranges.sql";

/**
 * 0041 → 0042: 정기 과제 규칙에 마감 여부(assignment_recurrences.has_due, 기본 1)를 더한다.
 * column 추가만이라 다른 table·index·trigger와 기존 row가 그대로이고(has_due = 1), 새 column을 모르는 옛 코드의
 * INSERT·UPDATE도 된다. 마감 없는 규칙(0)은 due_time을 회차 생성 경계 23:59로 둔다.
 */
export async function validateAssignmentNoDueUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(assignmentNoDueMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0041 → 0042 assignment no-due migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('nd-admin', 'nd-admin@example.com', 'Admin', 'admin'),
        ('nd-student', 'nd-student@example.com', 'Student', 'student');
      INSERT INTO assignment_recurrences (id, student_id, title, submission_format, start_date, weekdays, due_time)
        VALUES ('nd-rule', 'nd-student', 'Weekly', 'MIX', '2026-11-01', 1, '21:00');
      INSERT INTO assignment_tasks (id, student_id, recurrence_id, occurrence_date, title, submission_format, due_at)
        VALUES ('nd-task', 'nd-student', 'nd-rule', '2026-11-22', 'Weekly', 'MIX', 1795377600);
      INSERT INTO assignment_occurrence_skips (recurrence_id, occurrence_date) VALUES ('nd-rule', '2026-11-29');
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

    applyMigration(database, assignmentNoDueMigrationFile);

    assertRowsEqual(
      "0042 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !(entry.type === "table" && entry.name === "assignment_recurrences")),
      existingSchema.filter((entry) => !(entry.type === "table" && entry.name === "assignment_recurrences")),
    );
    for (const [tableName, rows] of existingRows) {
      const after = readRows(tableName).map((row) => {
        if (tableName !== "assignment_recurrences") return row;
        assert(row.has_due === 1, "0042 기존 규칙의 has_due는 1이어야 합니다.");
        const rest = { ...row };
        delete rest.has_due;
        return rest;
      });
      assertRowsEqual(`0042 upgrade 기존 ${tableName} row 보존`, after, rows);
    }

    // 새 column을 모르는 옛 코드의 INSERT·UPDATE가 그대로 된다(롤백 호환: 마감 있는 규칙으로 남는다).
    database.exec(`
      INSERT INTO assignment_recurrences (id, student_id, title, submission_format, start_date, weekdays, due_time)
        VALUES ('nd-old', 'nd-student', 'Old', 'TEXT', '2026-11-01', 2, '20:00');
      UPDATE assignment_recurrences SET due_time = '22:00', version = version + 1 WHERE id = 'nd-rule';
    `);
    // 마감 없는 규칙은 due_time을 23:59로만 둔다.
    database.exec(`
      INSERT INTO assignment_recurrences (id, student_id, title, submission_format, start_date, weekdays, due_time, has_due)
        VALUES ('nd-free', 'nd-student', 'Free', 'TEXT', '2026-11-01', 4, '23:59', 0);
      INSERT INTO assignment_tasks (id, student_id, recurrence_id, occurrence_date, title, submission_format, due_at)
        VALUES ('nd-free-task', 'nd-student', 'nd-free', '2026-11-25', 'Free', 'TEXT', NULL);
    `);
    assertSqlFails(database, "UPDATE assignment_recurrences SET has_due = 0 WHERE id = 'nd-rule';", "0042 마감 없는 규칙의 23:59 아닌 due_time");
    assertSqlFails(database, "UPDATE assignment_recurrences SET has_due = 2 WHERE id = 'nd-free';", "0042 0·1 아닌 has_due");
    // 옛 코드가 마감 없는 규칙의 시각을 바꾸는 고치기는 CHECK가 막는다(롤백 뒤 드문 경우: 저장 오류).
    assertSqlFails(database, "UPDATE assignment_recurrences SET due_time = '21:00' WHERE id = 'nd-free';", "0042 마감 없는 규칙의 시각 변경");
    assertRowsEqual(
      "0042 마감 여부 저장",
      database.all("SELECT id, due_time, has_due FROM assignment_recurrences ORDER BY id;"),
      [
        { id: "nd-free", due_time: "23:59", has_due: 0 },
        { id: "nd-old", due_time: "20:00", has_due: 1 },
        { id: "nd-rule", due_time: "22:00", has_due: 1 },
      ],
    );
    assertRowsEqual("0042 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
  } finally {
    database.close();
  }
}
