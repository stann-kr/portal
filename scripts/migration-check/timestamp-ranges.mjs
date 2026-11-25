import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert, assertSqlFails } from "./assertions.mjs";

export const timestampRangesMigrationFile = "0041_timestamp_ranges.sql";
const previousMigrationFile = "0040_guide_collab_lifecycle.sql";

/**
 * 0040 → 0041: 피드백·댓글 시점에 구간 끝(feedbacks.time_marker_end, comments.time_marker_end_seconds)을 더한다.
 * column 추가만이라 다른 table·index·trigger(comments trigger 포함)와 기존 row가 그대로이고(끝은 NULL),
 * 새 column을 모르는 옛 코드의 INSERT·UPDATE도 된다. 끝은 시작이 있을 때만, 시작보다 뒤여야 한다.
 */
export async function validateTimestampRangesUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(timestampRangesMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0040 → 0041 timestamp ranges migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('tr-admin', 'tr-admin@example.com', 'Admin', 'admin'),
        ('tr-student', 'tr-student@example.com', 'Student', 'student');
      INSERT INTO posts (id, author_id, category, title, content_html, board_type)
        VALUES ('tr-post', 'tr-student', 'mixset', 'Mixset', '<p>set</p>', 'community');
      INSERT INTO comments (id, post_id, author_id, content_html, created_at, time_marker_seconds) VALUES
        ('tr-comment-point', 'tr-post', 'tr-admin', '<p>여기</p>', 1800000000, 754),
        ('tr-comment-plain', 'tr-post', 'tr-student', '<p>좋아요</p>', 1800000100, NULL);
      INSERT INTO assignment_recurrences (id, student_id, title, submission_format, start_date, weekdays, due_time)
        VALUES ('tr-rule', 'tr-student', 'Weekly', 'MIX', '2026-11-01', 1, '21:00');
      INSERT INTO assignment_tasks (id, student_id, recurrence_id, occurrence_date, title, submission_format, due_at)
        VALUES ('tr-task', 'tr-student', 'tr-rule', '2026-11-22', 'Weekly', 'MIX', 1795377600);
      INSERT INTO assignments (id, student_id, task_id, media_url) VALUES ('tr-assignment', 'tr-student', 'tr-task', 'https://soundcloud.com/a/b');
      INSERT INTO feedbacks (id, assignment_id, time_marker, content, created_at) VALUES
        ('tr-feedback-point', 'tr-assignment', 80, '킥', 1800000000),
        ('tr-feedback-overall', 'tr-assignment', NULL, '전체', 1800000100);
    `);
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const changedTables = new Set(["comments", "feedbacks"]);
    const endColumn = { comments: "time_marker_end_seconds", feedbacks: "time_marker_end" };
    const existingSchema = readSchema();
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => [entry.name, readRows(entry.name)]));

    applyMigration(database, timestampRangesMigrationFile);

    assertRowsEqual(
      "0041 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !(entry.type === "table" && changedTables.has(entry.name))),
      existingSchema.filter((entry) => !(entry.type === "table" && changedTables.has(entry.name))),
    );
    for (const [tableName, rows] of existingRows) {
      const after = readRows(tableName).map((row) => {
        if (!changedTables.has(tableName)) return row;
        const column = endColumn[tableName];
        assert(row[column] === null, `0041 기존 ${tableName}.${column}은 NULL이어야 합니다.`);
        const rest = { ...row };
        delete rest[column];
        return rest;
      });
      assertRowsEqual(`0041 upgrade 기존 ${tableName} row 보존`, after, rows);
    }

    // 새 column을 모르는 옛 코드의 INSERT·UPDATE가 그대로 된다(롤백 호환).
    database.exec(`
      INSERT INTO comments (id, post_id, author_id, content_html, time_marker_seconds) VALUES ('tr-comment-old', 'tr-post', 'tr-student', '<p>옛</p>', 30);
      UPDATE comments SET content_html = '<p>고침</p>' WHERE id = 'tr-comment-point';
      INSERT INTO feedbacks (id, assignment_id, time_marker, content) VALUES ('tr-feedback-old', 'tr-assignment', 10, '옛');
      UPDATE feedbacks SET content = '킥 고침', time_marker = 81 WHERE id = 'tr-feedback-point';
    `);
    // 구간: 시작보다 뒤인 끝만 받는다.
    database.exec(`
      UPDATE comments SET time_marker_end_seconds = 790 WHERE id = 'tr-comment-point';
      UPDATE feedbacks SET time_marker_end = 105 WHERE id = 'tr-feedback-point';
    `);
    assertSqlFails(database, "UPDATE comments SET time_marker_end_seconds = 20 WHERE id = 'tr-comment-plain';", "0041 시작 없는 댓글 구간 끝");
    assertSqlFails(database, "UPDATE comments SET time_marker_end_seconds = 754 WHERE id = 'tr-comment-point';", "0041 시작과 같은 댓글 구간 끝");
    assertSqlFails(database, "UPDATE comments SET time_marker_end_seconds = 86400 WHERE id = 'tr-comment-point';", "0041 상한 넘는 댓글 구간 끝");
    assertSqlFails(database, "UPDATE comments SET time_marker_end_seconds = 800.5 WHERE id = 'tr-comment-old';", "0041 정수 아닌 댓글 구간 끝");
    assertSqlFails(database, "UPDATE feedbacks SET time_marker_end = 30 WHERE id = 'tr-feedback-overall';", "0041 시작 없는 피드백 구간 끝");
    assertSqlFails(database, "UPDATE feedbacks SET time_marker_end = 70 WHERE id = 'tr-feedback-point';", "0041 시작보다 앞인 피드백 구간 끝");
    // 옛 코드가 구간 피드백의 시작을 끝 뒤로 옮기는 고치기는 CHECK가 막는다(롤백 뒤 드문 경우: 그 화면은 저장 오류를 보인다).
    assertSqlFails(database, "UPDATE feedbacks SET time_marker = 200 WHERE id = 'tr-feedback-point';", "0041 끝 뒤로 옮긴 피드백 시작");
    assertRowsEqual(
      "0041 구간 저장",
      [
        ...database.all("SELECT id, time_marker_seconds AS start, time_marker_end_seconds AS end FROM comments WHERE id IN ('tr-comment-point', 'tr-comment-old') ORDER BY id;"),
        ...database.all("SELECT id, time_marker AS start, time_marker_end AS end FROM feedbacks WHERE id = 'tr-feedback-point';"),
      ],
      [
        { id: "tr-comment-old", start: 30, end: null },
        { id: "tr-comment-point", start: 754, end: 790 },
        { id: "tr-feedback-point", start: 81, end: 105 },
      ],
    );
    assertRowsEqual("0041 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
  } finally {
    database.close();
  }
}
