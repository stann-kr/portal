import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const listQueryIndexesMigrationFile = "0027_list_query_indexes.sql";
const previousMigrationFile = "0026_assignment_reviewed_at.sql";

const addedIndexes = [
  "calendar_events_user_start_idx",
  "curriculums_student_week_idx",
  "digging_tracks_user_created_idx",
  "lessons_student_scheduled_idx",
  "qna_replies_thread_created_idx",
];

/** 학생 한 명의 목록을 읽는 대표 query. index가 없으면 표 전체를 훑는다. */
const listQueries = [
  ["calendar_events_user_start_idx", "SELECT id FROM calendar_events WHERE user_id = 'li-student' AND start_time >= 1793000000 ORDER BY start_time"],
  ["curriculums_student_week_idx", "SELECT id FROM curriculums WHERE student_id = 'li-student' ORDER BY week_num"],
  ["digging_tracks_user_created_idx", "SELECT id FROM digging_tracks WHERE user_id = 'li-student' ORDER BY created_at"],
  ["lessons_student_scheduled_idx", "SELECT id FROM lessons WHERE student_id = 'li-student' AND scheduled_at >= 1793000000 ORDER BY scheduled_at"],
  ["qna_replies_thread_created_idx", "SELECT id FROM qna_replies WHERE thread_id = 'li-thread' ORDER BY created_at"],
];

/**
 * 0026 → 0027: 학생별 목록 query가 쓰는 index 5개만 더한다.
 * table을 재생성하지 않으므로 기존 schema·row·FK가 그대로이고, 대표 query가 새 index를 탄다.
 */
export async function validateListQueryIndexesUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(listQueryIndexesMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0026 → 0027 list query index migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('li-student', 'li-student@example.com', 'Student', 'student'),
        ('li-other', 'li-other@example.com', 'Other', 'student');
      INSERT INTO calendar_events (id, user_id, event_type, title, start_time) VALUES
        ('li-event-1', 'li-student', 'NOTE', '연습', 1793000100),
        ('li-event-2', 'li-other', 'NOTE', '연습', 1793000200);
      INSERT INTO curriculums (id, student_id, week_num, title) VALUES
        ('li-week-2', 'li-student', 2, '2주차'),
        ('li-week-1', 'li-student', 1, '1주차'),
        ('li-week-1-dup', 'li-student', 1, '1주차 보충');
      INSERT INTO lessons (id, student_id, scheduled_at) VALUES
        ('li-lesson-1', 'li-student', 1793000300),
        ('li-lesson-2', 'li-student', 1793000300);
      INSERT INTO digging_tracks (id, user_id, "values", created_at) VALUES
        ('li-track-1', 'li-student', '{}', 1793000400),
        ('li-track-2', 'li-student', '{}', NULL);
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
    assertRowsEqual(
      "0027 적용 전에는 새 index 이름이 없음",
      existingSchema.filter((entry) => addedIndexes.includes(entry.name)),
      [],
    );

    applyMigration(database, listQueryIndexesMigrationFile);

    const isAddedIndex = (entry) => entry.type === "index" && addedIndexes.includes(entry.name);
    assertRowsEqual(
      "0027 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !isAddedIndex(entry)),
      existingSchema,
    );
    assertRowsEqual(
      "0027 새 index 5개",
      readSchema().filter(isAddedIndex).map((entry) => entry.name),
      addedIndexes,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0027 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    // 같은 값이 겹치는 기존 row(같은 주차·같은 시각·NULL 시각)가 있어도 UNIQUE가 아니므로 적용된다.
    assertRowsEqual(
      "0027 겹치는 값 row 보존",
      database.all("SELECT id FROM curriculums WHERE student_id = 'li-student' ORDER BY week_num, id;"),
      [{ id: "li-week-1" }, { id: "li-week-1-dup" }, { id: "li-week-2" }],
    );
    for (const [indexName, query] of listQueries) {
      const plan = database.all(`EXPLAIN QUERY PLAN ${query};`).map((row) => row.detail).join(" / ");
      assert(plan.includes(indexName), `0027 ${indexName}를 대표 query가 쓰지 않습니다: ${plan}`);
      assert(!plan.includes("USE TEMP B-TREE"), `0027 ${indexName} query가 정렬을 따로 합니다: ${plan}`);
    }
    assertRowsEqual("0027 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0027 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
