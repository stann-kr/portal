import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const assignmentDraftsMigrationFile = "0035_assignment_drafts.sql";
const previousMigrationFile = "0034_post_reads.sql";

/**
 * 0034 → 0035: 과제 글 계정 임시 저장 표 assignment_drafts(계정·key 복합 기본키, 과제 FK, version)와
 * 계정·과제 index만 새로 만든다. 기존 table·trigger·row는 그대로이고, version compare-and-set UPDATE와
 * 과제 삭제 cascade가 예상대로 동작하는지 확인한다.
 */
export async function validateAssignmentDraftsUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(assignmentDraftsMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0034 → 0035 assignment drafts migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('ad-admin', 'ad-admin@example.com', 'Admin', 'admin'),
        ('ad-student-1', 'ad-student-1@example.com', 'One', 'student'),
        ('ad-student-2', 'ad-student-2@example.com', 'Two', 'student');
      INSERT INTO assignment_tasks (id, student_id, title, submission_format) VALUES
        ('ad-task-1', 'ad-student-1', 'Task 1', 'TEXT'),
        ('ad-task-2', 'ad-student-1', 'Task 2', 'MIX');
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

    applyMigration(database, assignmentDraftsMigrationFile);

    assertRowsEqual(
      "0035 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => entry.tbl_name !== "assignment_drafts"),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0035 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual(
      "0035 assignment_drafts columns",
      database.all(`
        SELECT name, lower(type) AS type, "notnull" AS not_null, pk
        FROM pragma_table_info('assignment_drafts') ORDER BY cid;
      `),
      [
        { name: "owner_id", type: "text", not_null: 1, pk: 1 },
        { name: "draft_key", type: "text", not_null: 1, pk: 2 },
        { name: "task_id", type: "text", not_null: 0, pk: 0 },
        { name: "payload_json", type: "text", not_null: 1, pk: 0 },
        { name: "version", type: "integer", not_null: 1, pk: 0 },
        { name: "updated_at", type: "integer", not_null: 1, pk: 0 },
      ],
    );
    assertRowsEqual(
      "0035 assignment_drafts 외래키는 계정·과제 삭제와 함께 지운다",
      database.all(`
        SELECT "table" AS target, "from" AS column_name, on_delete
        FROM pragma_foreign_key_list('assignment_drafts') ORDER BY "from";
      `),
      [
        { target: "profiles", column_name: "owner_id", on_delete: "CASCADE" },
        { target: "assignment_tasks", column_name: "task_id", on_delete: "CASCADE" },
      ],
    );
    const plan = database.all(`
      EXPLAIN QUERY PLAN SELECT task_id, MAX(updated_at) FROM assignment_drafts
      WHERE owner_id = 'ad-student-1' AND task_id IS NOT NULL GROUP BY task_id;
    `);
    assert(
      plan.some((row) => String(row.detail).includes("assignment_drafts_owner_task_idx")),
      `0035 학생별 과제 사본 조회가 assignment_drafts_owner_task_idx를 쓰지 않습니다: ${JSON.stringify(plan)}`,
    );

    database.exec(`
      INSERT INTO assignment_drafts (owner_id, draft_key, task_id, payload_json, version, updated_at) VALUES
        ('ad-student-1', 'task-submission:ad-task-1', 'ad-task-1', '{"text":"a"}', 1, 1800000000),
        ('ad-student-1', 'analysis:ad-task-2', 'ad-task-2', '{"mediaUrl":""}', 1, 1800000000),
        ('ad-student-1', 'free-submission:new', NULL, '{"text":"free"}', 1, 1800000000),
        ('ad-student-2', 'free-submission:new', NULL, '{"text":"other"}', 1, 1800000000);
    `);
    // 같은 계정·key는 한 줄. 두 번째 INSERT는 충돌로 무시된다.
    database.exec(`
      INSERT INTO assignment_drafts (owner_id, draft_key, task_id, payload_json, version, updated_at)
      VALUES ('ad-student-1', 'free-submission:new', NULL, '{"text":"dup"}', 1, 1800000100)
      ON CONFLICT (owner_id, draft_key) DO NOTHING;
    `);
    // compare-and-set: 기준 version이 맞을 때만 바뀌고, 낡은 기준은 0행이다.
    const update = (base) => {
      database.exec(`
        UPDATE assignment_drafts SET payload_json = '{"text":"b"}', version = ${base + 1}, updated_at = 1800000200
        WHERE owner_id = 'ad-student-1' AND draft_key = 'task-submission:ad-task-1' AND version = ${base};
      `);
      return database.all("SELECT changes() AS value;")[0].value;
    };
    assert(update(1) === 1, "0035 맞는 version의 UPDATE가 한 줄을 바꾸지 않았습니다.");
    assert(update(1) === 0, "0035 낡은 version의 UPDATE가 행을 바꿨습니다.");
    assertRowsEqual(
      "0035 compare-and-set 결과와 key별 한 줄",
      database.all("SELECT owner_id, draft_key, payload_json, version FROM assignment_drafts ORDER BY owner_id, draft_key;"),
      [
        { owner_id: "ad-student-1", draft_key: "analysis:ad-task-2", payload_json: '{"mediaUrl":""}', version: 1 },
        { owner_id: "ad-student-1", draft_key: "free-submission:new", payload_json: '{"text":"free"}', version: 1 },
        { owner_id: "ad-student-1", draft_key: "task-submission:ad-task-1", payload_json: '{"text":"b"}', version: 2 },
        { owner_id: "ad-student-2", draft_key: "free-submission:new", payload_json: '{"text":"other"}', version: 1 },
      ],
    );
    // 과제를 지우면 그 과제의 사본도 지워진다. 계정 삭제는 삭제 작업(ERASING) 안에서만 trigger가 허용하므로
    // 여기서는 위 외래키 설정만 보고, 실제 삭제 경로는 account-privacy-atomic.test.ts가 확인한다.
    database.exec("DELETE FROM assignment_tasks WHERE id = 'ad-task-1';");
    assertRowsEqual(
      "0035 과제 삭제 뒤 남은 사본",
      database.all("SELECT owner_id, draft_key FROM assignment_drafts ORDER BY owner_id, draft_key;"),
      [
        { owner_id: "ad-student-1", draft_key: "analysis:ad-task-2" },
        { owner_id: "ad-student-1", draft_key: "free-submission:new" },
        { owner_id: "ad-student-2", draft_key: "free-submission:new" },
      ],
    );
    assertRowsEqual("0035 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0035 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
