import {
  applyMigration,
  applyMigrations,
  assignmentTaskMigrationFile,
  createMemoryDatabase,
  documentImageMigrationFile,
} from "./runtime.mjs";
import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";

export function validateAssignmentTaskSchema(database) {
  const assignmentColumns = database.all("PRAGMA table_info('assignments');");
  const mediaUrl = assignmentColumns.find((column) => column.name === "media_url");
  assert(mediaUrl && mediaUrl.notnull === 0, "assignments.media_url이 nullable이 아닙니다.");
  const feedbackColumns = database.all("PRAGMA table_info('feedbacks');");
  const timeMarker = feedbackColumns.find((column) => column.name === "time_marker");
  assert(timeMarker && timeMarker.notnull === 0, "feedbacks.time_marker가 nullable이 아닙니다.");
  const feedbackForeignKeys = database.all("PRAGMA foreign_key_list('feedbacks');");
  assert(
    feedbackForeignKeys.some((foreignKey) => foreignKey.table === "assignments" && foreignKey.on_delete === "CASCADE"),
    "feedbacks → assignments cascade FK가 없습니다.",
  );
  const taskForeignKeys = database.all("PRAGMA foreign_key_list('assignment_tasks');");
  assert(
    taskForeignKeys.some((foreignKey) => foreignKey.table === "assignment_recurrences" && foreignKey.on_delete === "SET NULL"),
    "assignment_tasks → assignment_recurrences FK가 SET NULL이 아닙니다.",
  );
  const assignmentForeignKeys = database.all("PRAGMA foreign_key_list('assignments');");
  assert(
    assignmentForeignKeys.some((foreignKey) => foreignKey.table === "assignment_tasks" && foreignKey.on_delete === "SET NULL"),
    "assignments → assignment_tasks FK가 SET NULL이 아닙니다.",
  );
}

/** 0014 → 0015: 기존 제출·피드백을 그대로 옮기고 새 제약을 확인한다. */
export async function validateAssignmentTaskUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(assignmentTaskMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === documentImageMigrationFile,
    "0014 → 0015 assignment task migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('task-admin', 'task-admin@example.com', 'Admin', 'admin'),
        ('task-student', 'task-student@example.com', 'Student', 'student'),
        ('task-deleting-student', 'task-deleting@example.com', 'Deleting', 'student');
      INSERT INTO assignments (id, student_id, media_url, submitted_at) VALUES
        ('existing-assignment-1', 'task-student', 'https://youtu.be/abcdefghijk', 1800000000),
        ('existing-assignment-2', 'task-student', 'https://soundcloud.com/a/b', 1800000100),
        ('existing-assignment-3', 'task-deleting-student', 'https://youtu.be/zzzzzzzzzzz', 1800000200);
      INSERT INTO feedbacks (id, assignment_id, time_marker, content, created_at) VALUES
        ('existing-feedback-1', 'existing-assignment-1', 0, '처음', 1800000300),
        ('existing-feedback-2', 'existing-assignment-1', 95, '중간', 1800000400),
        ('existing-feedback-3', 'existing-assignment-2', 12, '다른 과제', 1800000500);
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
        AND tbl_name NOT IN ('assignments', 'feedbacks', 'assignment_tasks', 'assignment_recurrences')
        AND name <> 'profiles_before_delete_document_history'
      ORDER BY type, name
    `);
    const existingSchema = readSchema();
    const preservedTables = existingSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => entry.name);
    const existingRows = new Map(preservedTables.map((name) => [name, readRows(name)]));
    const existingAssignments = readRows("assignments");
    const existingFeedbacks = readRows("feedbacks");

    applyMigration(database, assignmentTaskMigrationFile);

    assertRowsEqual("0015 upgrade 다른 table·index·trigger 보존", readSchema(), existingSchema);
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0015 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual(
      "0015 upgrade 기존 제출 보존",
      readRows("assignments"),
      existingAssignments.map((row) => ({
        id: row.id,
        student_id: row.student_id,
        task_id: null,
        media_url: row.media_url,
        text_html: null,
        submitted_at: row.submitted_at,
        updated_at: null,
      })),
    );
    // 옛 assignments를 지울 때 cascade로 피드백이 사라지지 않아야 한다.
    assertRowsEqual("0015 upgrade 기존 피드백 보존", readRows("feedbacks"), existingFeedbacks);
    assertRowsEqual(
      "0015 임시 table 제거",
      database.all("SELECT name FROM sqlite_master WHERE name LIKE '\\_\\_%' ESCAPE '\\';"),
      [],
    );
    validateAssignmentTaskSchema(database);

    database.exec(`
      INSERT INTO assignment_recurrences (
        id, student_id, title, submission_format, start_date, interval_weeks, weekdays, due_time, created_by_id
      ) VALUES ('recurrence-1', 'task-student', '주간 믹스', 'BOTH', '2026-11-02', 1, 2, '21:00', 'task-admin');
      INSERT INTO assignment_tasks (id, student_id, recurrence_id, occurrence_date, title, submission_format, due_at, created_by_id)
      VALUES ('task-occurrence-1', 'task-student', 'recurrence-1', '2026-11-02', '주간 믹스', 'BOTH', 1793700000, 'task-admin');
      INSERT OR IGNORE INTO assignment_tasks (id, student_id, recurrence_id, occurrence_date, title, submission_format, due_at)
      VALUES ('task-occurrence-dup', 'task-student', 'recurrence-1', '2026-11-02', '주간 믹스', 'BOTH', 1793700000);
      INSERT INTO assignment_tasks (id, student_id, title, submission_format) VALUES ('task-one-off', 'task-student', '글 과제', 'TEXT');
      INSERT INTO assignments (id, student_id, task_id, text_html) VALUES ('text-submission', 'task-student', 'task-one-off', '<p>글</p>');
      INSERT INTO assignments (id, student_id, task_id, media_url, text_html)
      VALUES ('occurrence-submission', 'task-student', 'task-occurrence-1', 'https://youtu.be/abcdefghijk', '<p>메모</p>');
      INSERT INTO feedbacks (id, assignment_id, time_marker, content) VALUES ('text-feedback', 'text-submission', NULL, '글 피드백');
    `);
    assertRowsEqual(
      "0015 회차 중복 생성 방지",
      database.all("SELECT id FROM assignment_tasks WHERE recurrence_id = 'recurrence-1';"),
      [{ id: "task-occurrence-1" }],
    );
    for (const [sql, label, expected] of [
      ["INSERT INTO assignments (id, student_id) VALUES ('empty-submission', 'task-student');", "제출 내용 없음", "assignments_content_check"],
      ["INSERT INTO assignments (id, student_id, media_url, text_html) VALUES ('blank-submission', 'task-student', '', '');", "빈 제출", "assignments_content_check"],
      ["INSERT INTO assignments (id, student_id, task_id, text_html) VALUES ('second-submission', 'task-student', 'task-one-off', '<p>두 번째</p>');", "과제당 한 제출", "UNIQUE constraint failed"],
      ["INSERT INTO assignment_tasks (id, student_id, title, submission_format) VALUES ('bad-format', 'task-student', 'x', 'AUDIO');", "제출 형식", "assignment_tasks_format_check"],
      ["INSERT INTO assignment_tasks (id, student_id, title, submission_format) VALUES ('blank-title', 'task-student', '', 'MIX');", "빈 제목", "assignment_tasks_payload_check"],
      ["UPDATE assignment_recurrences SET weekdays = 0 WHERE id = 'recurrence-1';", "요일 없음", "assignment_recurrences_schedule_check"],
      ["UPDATE assignment_recurrences SET end_date = '2026-11-01' WHERE id = 'recurrence-1';", "종료일이 시작일 전", "assignment_recurrences_schedule_check"],
      ["UPDATE assignment_recurrences SET interval_weeks = 13 WHERE id = 'recurrence-1';", "주기 범위", "assignment_recurrences_schedule_check"],
      ["UPDATE assignment_recurrences SET submission_format = 'X' WHERE id = 'recurrence-1';", "정기 과제 형식", "assignment_recurrences_format_check"],
      ["INSERT INTO feedbacks (id, assignment_id, time_marker, content) VALUES ('negative-marker', 'text-submission', -1, 'x');", "음수 시간", "feedbacks_time_marker_check"],
      ["INSERT INTO assignment_tasks (id, student_id, title, submission_format) VALUES ('orphan-task', 'missing-student', 'x', 'MIX');", "없는 학생", "FOREIGN KEY constraint failed"],
    ]) {
      assertSqlFails(database, sql, `0015 ${label}`, expected);
    }

    // 정기 과제 규칙을 지워도 이미 만든 회차와 제출은 남는다.
    database.exec("DELETE FROM assignment_recurrences WHERE id = 'recurrence-1';");
    assertRowsEqual(
      "0015 규칙 삭제 뒤 회차 보존",
      database.all("SELECT id, recurrence_id FROM assignment_tasks WHERE id = 'task-occurrence-1';"),
      [{ id: "task-occurrence-1", recurrence_id: null }],
    );
    // 과제를 지워도 제출과 피드백은 자유 제출로 남는다.
    database.exec("DELETE FROM assignment_tasks WHERE id = 'task-one-off';");
    assertRowsEqual(
      "0015 과제 삭제 뒤 제출 보존",
      database.all("SELECT a.id, a.task_id, f.id AS feedback_id FROM assignments a JOIN feedbacks f ON f.assignment_id = a.id WHERE a.id = 'text-submission';"),
      [{ id: "text-submission", task_id: null, feedback_id: "text-feedback" }],
    );

    database.exec(`
      INSERT INTO assignment_tasks (id, student_id, title, submission_format) VALUES ('deleting-task', 'task-deleting-student', 'x', 'MIX');
      DELETE FROM assignments WHERE student_id = 'task-deleting-student';
      INSERT INTO account_deletion_jobs (
        id, operation_id, subject_id, erasure_alias, initiating_token_digest,
        initiating_token_mode, request_hash, request_hash_version,
        status, requested_at, alias_after, updated_at
      ) VALUES (
        'task-deletion-job', '52000000-0000-4000-8000-000000000001',
        'task-deleting-student', 'erased:52000000-0000-4000-8000-000000000002',
        '${"d".repeat(64)}', 'EPHEMERAL', '${"e".repeat(64)}', 1,
        'ERASING', 1800000000, 1802592000, 1800000000
      );
    `);
    // 삭제 절차를 밟아도 과제가 남아 있으면 지우지 않는다(atomic erase가 먼저 지워야 한다).
    assertSqlFails(
      database,
      "DELETE FROM profiles WHERE id = 'task-deleting-student';",
      "0015 과제가 남은 학생 계정 삭제 guard",
      "DOCUMENT_HISTORY_ACCOUNT_DELETE_RESTRICTED",
    );
    database.exec(`
      DELETE FROM assignment_tasks WHERE student_id = 'task-deleting-student';
      DELETE FROM profiles WHERE id = 'task-deleting-student';
    `);
    assertRowsEqual(
      "0015 과제를 지운 뒤 계정 삭제",
      database.all("SELECT id FROM profiles WHERE id = 'task-deleting-student';"),
      [],
    );
    assertRowsEqual("0015 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0015 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
