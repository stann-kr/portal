import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert, assertSqlFails } from "./assertions.mjs";

export const mixAnalysisMigrationFile = "0023_mix_analysis.sql";
const previousMigrationFile = "0022_instructor_memos.sql";

const changedTables = ["assignment_recurrences", "assignment_tasks", "assignments"];

/**
 * 0022 → 0023: 과제·정기 과제에 분석 양식 표시, 제출에 분석 JSON column만 더한다.
 * table을 재생성하지 않으므로 기존 row·FK·index·feedback이 그대로이고, 새 CHECK는 새 값에만 걸린다.
 */
export async function validateMixAnalysisUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(mixAnalysisMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0022 → 0023 mix analysis migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('ma-admin', 'ma-admin@example.com', 'Admin', 'admin'),
        ('ma-student', 'ma-student@example.com', 'Student', 'student');
      INSERT INTO assignment_recurrences (id, student_id, title, submission_format, start_date, weekdays, due_time)
      VALUES ('ma-rule', 'ma-student', '주간 믹스', 'MIX', '2026-11-02', 2, '21:00');
      INSERT INTO assignment_tasks (id, student_id, recurrence_id, occurrence_date, title, submission_format, due_at)
      VALUES
        ('ma-task-mix', 'ma-student', 'ma-rule', '2026-11-02', '주간 믹스', 'MIX', 1793000000),
        ('ma-task-text', 'ma-student', NULL, NULL, '연습 기록', 'TEXT', NULL);
      INSERT INTO assignments (id, student_id, task_id, media_url, text_html, submitted_at) VALUES
        ('ma-sub-mix', 'ma-student', 'ma-task-mix', 'https://youtu.be/abcdefghijk', NULL, 1793000100),
        ('ma-sub-text', 'ma-student', 'ma-task-text', NULL, '<p>기록</p>', 1793000200);
      INSERT INTO feedbacks (id, assignment_id, time_marker, content, created_at)
      VALUES ('ma-feedback', 'ma-sub-mix', 90, '좋아요', 1793000300);
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

    applyMigration(database, mixAnalysisMigrationFile);

    assertRowsEqual(
      "0023 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !(entry.type === "table" && changedTables.includes(entry.name))),
      existingSchema.filter((entry) => !(entry.type === "table" && changedTables.includes(entry.name))),
    );
    for (const [tableName, rows] of existingRows) {
      const after = readRows(tableName).map((row) => {
        if (!changedTables.includes(tableName)) return row;
        const rest = { ...row };
        delete rest.analysis_form;
        delete rest.analysis_json;
        return rest;
      });
      assertRowsEqual(`0023 upgrade 기존 ${tableName} row 보존`, after, rows);
    }
    assertRowsEqual(
      "0023 기존 과제 분석 양식 0",
      database.all("SELECT id, analysis_form FROM assignment_tasks UNION ALL SELECT id, analysis_form FROM assignment_recurrences ORDER BY id;"),
      [
        { id: "ma-rule", analysis_form: 0 },
        { id: "ma-task-mix", analysis_form: 0 },
        { id: "ma-task-text", analysis_form: 0 },
      ],
    );
    assertRowsEqual(
      "0023 기존 제출 분석 NULL",
      database.all("SELECT id, analysis_json FROM assignments ORDER BY id;"),
      [{ id: "ma-sub-mix", analysis_json: null }, { id: "ma-sub-text", analysis_json: null }],
    );

    for (const [sql, label, constraint] of [
      ["UPDATE assignment_tasks SET analysis_form = 1 WHERE id = 'ma-task-text';", "글 과제를 분석 양식으로", "assignment_tasks_analysis_form_check"],
      ["UPDATE assignment_tasks SET analysis_form = 2 WHERE id = 'ma-task-mix';", "분석 양식 2", "assignment_tasks_analysis_form_check"],
      ["UPDATE assignment_recurrences SET submission_format = 'BOTH', analysis_form = 1 WHERE id = 'ma-rule';", "링크와 글 정기 과제를 분석 양식으로", "assignment_recurrences_analysis_form_check"],
      ["UPDATE assignments SET analysis_json = '{bad' WHERE id = 'ma-sub-mix';", "JSON이 아닌 분석", "assignments_analysis_json_check"],
      [`UPDATE assignments SET analysis_json = '"' || printf('%.100000c', 'a') || '"' WHERE id = 'ma-sub-mix';`, "100,000자 넘는 분석", "assignments_analysis_json_check"],
    ]) {
      assertSqlFails(database, sql, `0023 ${label}`, constraint);
    }
    database.exec(`
      UPDATE assignment_recurrences SET analysis_form = 1 WHERE id = 'ma-rule';
      UPDATE assignment_tasks SET analysis_form = 1 WHERE id = 'ma-task-mix';
      UPDATE assignments SET analysis_json = '{"rating":4,"recommended":false,"oneLiner":"","entries":[]}' WHERE id = 'ma-sub-mix';
    `);
    assertRowsEqual(
      "0023 분석 양식 저장",
      database.all(`
        SELECT t.analysis_form AS task_form, r.analysis_form AS rule_form, json_extract(a.analysis_json, '$.rating') AS rating
        FROM assignments a JOIN assignment_tasks t ON t.id = a.task_id JOIN assignment_recurrences r ON r.id = t.recurrence_id
        WHERE a.id = 'ma-sub-mix';
      `),
      [{ task_form: 1, rule_form: 1, rating: 4 }],
    );
    assertRowsEqual("0023 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0023 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
