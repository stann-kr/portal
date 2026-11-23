import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const pushNoticesMigrationFile = "0037_push_notices.sql";
const previousMigrationFile = "0036_note_read_only.sql";

/**
 * 0036 → 0037: 글 없이 보내는 알림(push_notices), 받은 학생·읽은 시각(push_notice_recipients),
 * 공지 게시물 다시 알림 시각(post_reminders) 세 표만 새로 만든다. 기존 table·trigger·row는 그대로이고,
 * 알림·게시물 삭제가 딸린 기록을 함께 지우는지(cascade), 같은 요청은 한 번만 들어가는지, 본문 길이 제한을 확인한다.
 */
export async function validatePushNoticesUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(pushNoticesMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0036 → 0037 push notices migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('pn-admin', 'pn-admin@example.com', 'Admin', 'admin'),
        ('pn-student-1', 'pn-student-1@example.com', 'One', 'student'),
        ('pn-student-2', 'pn-student-2@example.com', 'Two', 'student');
      INSERT INTO posts (id, author_id, category, title, content_html, board_type) VALUES
        ('pn-post-1', 'pn-admin', 'free', 'Notice', '<p>n</p>', 'ANNOUNCEMENT');
    `);
    const newTables = new Set(["push_notices", "push_notice_recipients", "post_reminders"]);
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

    applyMigration(database, pushNoticesMigrationFile);

    assertRowsEqual(
      "0037 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !newTables.has(entry.tbl_name)),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0037 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }
    assertRowsEqual(
      "0037 외래키는 알림·게시물·계정 삭제와 함께 지운다",
      database.all(`
        SELECT 'push_notices' AS owner, "table" AS target, "from" AS column_name, on_delete FROM pragma_foreign_key_list('push_notices')
        UNION ALL
        SELECT 'push_notice_recipients', "table", "from", on_delete FROM pragma_foreign_key_list('push_notice_recipients')
        UNION ALL
        SELECT 'post_reminders', "table", "from", on_delete FROM pragma_foreign_key_list('post_reminders')
        ORDER BY 1, 3;
      `),
      [
        { owner: "post_reminders", target: "posts", column_name: "post_id", on_delete: "CASCADE" },
        { owner: "push_notice_recipients", target: "push_notices", column_name: "notice_id", on_delete: "CASCADE" },
        { owner: "push_notice_recipients", target: "profiles", column_name: "student_id", on_delete: "CASCADE" },
        { owner: "push_notices", target: "profiles", column_name: "author_id", on_delete: "CASCADE" },
      ],
    );
    const plan = database.all("EXPLAIN QUERY PLAN SELECT notice_id FROM push_notice_recipients WHERE student_id = 'pn-student-1';");
    assert(
      plan.some((row) => String(row.detail).includes("push_notice_recipients_student_idx")),
      `0037 학생별 조회가 push_notice_recipients_student_idx를 쓰지 않습니다: ${JSON.stringify(plan)}`,
    );

    database.exec(`
      INSERT INTO push_notices (id, author_id, request_id, body, created_at) VALUES ('pn-1', 'pn-admin', 'req-1', '내일 레슨은 30분 늦게 시작해요.', 1800000000);
      INSERT OR IGNORE INTO push_notices (id, author_id, request_id, body, created_at) VALUES ('pn-dup', 'pn-admin', 'req-1', 'again', 1800000001);
      INSERT INTO push_notice_recipients (notice_id, student_id) VALUES ('pn-1', 'pn-student-1'), ('pn-1', 'pn-student-2');
      INSERT INTO post_reminders (post_id, last_reminded_at) VALUES ('pn-post-1', 1800000000);
    `);
    assertRowsEqual("0037 같은 요청은 알림 한 개", database.all("SELECT id FROM push_notices;"), [{ id: "pn-1" }]);
    for (const body of ["   ", "x".repeat(121)]) {
      let rejected = false;
      try {
        database.exec(`INSERT INTO push_notices (id, author_id, request_id, body, created_at) VALUES ('pn-bad', 'pn-admin', 'req-bad', '${body}', 1800000000);`);
      } catch {
        rejected = true;
      }
      assert(rejected, `0037 본문 길이 제한이 ${body.length}자 본문을 받았습니다.`);
    }
    assert(
      (() => {
        try {
          database.exec(`INSERT INTO push_notices (id, author_id, request_id, body, created_at) VALUES ('pn-max', 'pn-admin', 'req-max', '${"가".repeat(120)}', 1800000000);`);
          return true;
        } catch {
          return false;
        }
      })(),
      "0037 120자 본문을 받지 않습니다.",
    );
    database.exec("DELETE FROM push_notices WHERE id = 'pn-1'; DELETE FROM posts WHERE id = 'pn-post-1';");
    assertRowsEqual("0037 알림 삭제 뒤 받은 학생 기록", database.all("SELECT * FROM push_notice_recipients;"), []);
    assertRowsEqual("0037 게시물 삭제 뒤 다시 알림 기록", database.all("SELECT * FROM post_reminders;"), []);
    assertRowsEqual("0037 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0037 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
