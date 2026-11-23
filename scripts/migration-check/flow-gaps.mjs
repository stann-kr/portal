import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const flowGapsMigrationFile = "0038_flow_gaps.sql";
const previousMigrationFile = "0037_push_notices.sql";

function rejects(database, statement) {
  try {
    database.exec(statement);
    return false;
  } catch {
    return true;
  }
}

/**
 * 0037 → 0038: 과제 완료 시각(assignment_tasks.closed_at), 지운 정기 회차 날짜(assignment_occurrence_skips),
 * 피드백·댓글 고친 시각(feedbacks.updated_at, comments.updated_at), 플레이리스트 디깅한 날(digging_playlists.dug_on, 표 재구성),
 * 디깅 피드백(digging_feedbacks)을 더한다. 기존 row는 그대로이고 dug_on은 올린 시각의 KST 날짜로 채운다.
 */
export async function validateFlowGapsUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(flowGapsMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0037 → 0038 flow gaps migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    // 1795377600 = 2026-11-22 20:00 UTC = 2026-11-23 05:00 KST(UTC 날짜와 KST 날짜가 다른 시각).
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('fg-admin', 'fg-admin@example.com', 'Admin', 'admin'),
        ('fg-student', 'fg-student@example.com', 'Student', 'student');
      INSERT INTO assignment_recurrences (id, student_id, title, submission_format, start_date, weekdays, due_time)
        VALUES ('fg-rule', 'fg-student', 'Weekly', 'TEXT', '2026-11-01', 1, '21:00');
      INSERT INTO assignment_tasks (id, student_id, recurrence_id, occurrence_date, title, submission_format, due_at)
        VALUES ('fg-task', 'fg-student', 'fg-rule', '2026-11-22', 'Weekly', 'TEXT', 1795377600);
      INSERT INTO assignments (id, student_id, task_id, text_html) VALUES ('fg-assignment', 'fg-student', 'fg-task', '<p>a</p>');
      INSERT INTO feedbacks (id, assignment_id, content) VALUES ('fg-feedback', 'fg-assignment', 'good');
      INSERT INTO digging_playlists (id, user_id, provider, url, title, created_at, updated_at) VALUES
        ('fg-playlist', 'fg-student', 'beatport', 'https://www.beatport.com/playlists/share/1', 'Mix', 1795377600, 1795377600);
      INSERT INTO posts (id, author_id, category, title, content_html, board_type) VALUES ('fg-post', 'fg-student', 'general', 'Post', '<p>p</p>', 'GENERAL');
      INSERT INTO comments (id, post_id, author_id, content_html) VALUES ('fg-comment', 'fg-post', 'fg-student', '<p>c</p>');
    `);
    const changedTables = new Set(["assignment_tasks", "feedbacks", "digging_playlists", "comments"]);
    const newTables = new Set(["assignment_occurrence_skips", "digging_feedbacks"]);
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

    applyMigration(database, flowGapsMigrationFile);

    const untouched = (entry) => !changedTables.has(entry.tbl_name) && !newTables.has(entry.tbl_name);
    assertRowsEqual(
      "0038 upgrade 다른 table·index·trigger 보존",
      readSchema().filter(untouched),
      existingSchema.filter(untouched),
    );
    for (const [tableName, rows] of existingRows) {
      if (changedTables.has(tableName)) continue;
      assertRowsEqual(`0038 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    const withoutColumn = (rows, column) => rows.map((row) => {
      const copy = { ...row };
      delete copy[column];
      return copy;
    });
    assertRowsEqual("0038 assignment_tasks row 보존", withoutColumn(readRows("assignment_tasks"), "closed_at"), existingRows.get("assignment_tasks"));
    assertRowsEqual("0038 feedbacks row 보존", withoutColumn(readRows("feedbacks"), "updated_at"), existingRows.get("feedbacks"));
    assertRowsEqual("0038 comments row 보존", withoutColumn(readRows("comments"), "updated_at"), existingRows.get("comments"));
    assertRowsEqual("0038 digging_playlists row 보존", withoutColumn(readRows("digging_playlists"), "dug_on"), existingRows.get("digging_playlists"));
    assertRowsEqual(
      "0038 새 칸 기본값과 dug_on KST 날짜 채우기",
      database.all(`
        SELECT (SELECT closed_at FROM assignment_tasks WHERE id = 'fg-task') AS closed_at,
          (SELECT updated_at FROM feedbacks WHERE id = 'fg-feedback') AS feedback_updated_at,
          (SELECT updated_at FROM comments WHERE id = 'fg-comment') AS comment_updated_at,
          (SELECT dug_on FROM digging_playlists WHERE id = 'fg-playlist') AS dug_on;
      `),
      [{ closed_at: null, feedback_updated_at: null, comment_updated_at: null, dug_on: "2026-11-23" }],
    );
    assert(
      database.all("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'digging_playlists_user_url_unique';").length === 1,
      "0038 재구성 뒤 digging_playlists_user_url_unique index가 없습니다.",
    );
    assert(
      rejects(database, "INSERT INTO digging_playlists (id, user_id, provider, url, dug_on) VALUES ('fg-dup', 'fg-student', 'beatport', 'https://www.beatport.com/playlists/share/1', '2026-11-23');"),
      "0038 같은 학생·같은 링크 플레이리스트를 두 번 받았습니다.",
    );
    assert(
      rejects(database, "INSERT INTO digging_playlists (id, user_id, provider, url, dug_on) VALUES ('fg-bad-date', 'fg-student', 'beatport', 'https://www.beatport.com/playlists/share/2', '11-23');"),
      "0038 dug_on 날짜 형식 제한이 없습니다.",
    );
    assert(
      rejects(database, "INSERT INTO digging_playlists (id, user_id, provider, url) VALUES ('fg-no-date', 'fg-student', 'beatport', 'https://www.beatport.com/playlists/share/3');"),
      "0038 dug_on 없는 플레이리스트를 받았습니다.",
    );

    database.exec(`
      INSERT INTO assignment_occurrence_skips (recurrence_id, occurrence_date) VALUES ('fg-rule', '2026-11-29');
      INSERT INTO digging_feedbacks (student_id, dug_on, body) VALUES ('fg-student', '2026-11-23', '좋아요');
    `);
    assert(
      rejects(database, "INSERT INTO assignment_occurrence_skips (recurrence_id, occurrence_date) VALUES ('fg-rule', '2026-11-29');"),
      "0038 같은 회차 날짜를 두 번 건너뛰기로 받았습니다.",
    );
    assert(
      rejects(database, "INSERT INTO digging_feedbacks (student_id, dug_on, body) VALUES ('fg-student', '2026-11-23', 'again');"),
      "0038 같은 학생·날짜 디깅 피드백을 두 번 받았습니다.",
    );
    for (const body of ["   ", "x".repeat(2001)]) {
      assert(
        rejects(database, `INSERT INTO digging_feedbacks (student_id, dug_on, body) VALUES ('fg-student', '2026-11-24', '${body}');`),
        `0038 디깅 피드백 길이 제한이 ${body.length}자 본문을 받았습니다.`,
      );
    }
    assertRowsEqual(
      "0038 외래키는 규칙·계정 삭제와 함께 지운다",
      database.all(`
        SELECT 'assignment_occurrence_skips' AS owner, "table" AS target, "from" AS column_name, on_delete FROM pragma_foreign_key_list('assignment_occurrence_skips')
        UNION ALL
        SELECT 'digging_feedbacks', "table", "from", on_delete FROM pragma_foreign_key_list('digging_feedbacks')
        UNION ALL
        SELECT 'digging_playlists', "table", "from", on_delete FROM pragma_foreign_key_list('digging_playlists')
        ORDER BY 1, 3;
      `),
      [
        { owner: "assignment_occurrence_skips", target: "assignment_recurrences", column_name: "recurrence_id", on_delete: "CASCADE" },
        { owner: "digging_feedbacks", target: "profiles", column_name: "student_id", on_delete: "CASCADE" },
        { owner: "digging_playlists", target: "profiles", column_name: "user_id", on_delete: "CASCADE" },
      ],
    );
    database.exec("DELETE FROM assignment_recurrences WHERE id = 'fg-rule';");
    assertRowsEqual("0038 규칙 삭제 뒤 건너뛴 회차", database.all("SELECT * FROM assignment_occurrence_skips;"), []);
    assertRowsEqual("0038 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0038 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
