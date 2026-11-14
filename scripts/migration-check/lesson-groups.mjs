import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";
import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";

const previousMigrationFile = "0028_guide_access.sql";
const lessonGroupsMigrationFile = "0029_lesson_groups.sql";

/**
 * 0028 → 0029: 그룹레슨 표 두 개와 private_notes.group_id(nullable, restrict)를 더한다.
 * 기존 표·행은 그대로이고 기존 노트는 group_id가 NULL인 개인 노트로 남는다.
 */
export async function validateLessonGroupsUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(lessonGroupsMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0028 → 0029 lesson groups migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, password_hash, display_name, role) VALUES
        ('lg-admin', 'lg-admin@example.com', '$2b$10$adminhash', 'Admin', 'admin'),
        ('lg-a', 'lg-a@example.com', '$2b$10$ahash', 'A', 'student'),
        ('lg-b', 'lg-b@example.com', '$2b$10$bhash', 'B', 'student');
      INSERT INTO private_notes (id, student_id, author_id, title, content_html)
        VALUES ('lg-note-1', 'lg-a', 'lg-a', '기존 노트', '<p>본문</p>');
    `);
    const readSchema = () => database.all(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `);
    const readRows = (tableName) => database
      .all(`SELECT * FROM "${tableName.replaceAll('"', '""')}";`)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const newTables = new Set(["lesson_groups", "lesson_group_members"]);
    const existingSchema = readSchema();
    const existingRows = new Map(existingSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => [entry.name, readRows(entry.name)]));

    applyMigration(database, lessonGroupsMigrationFile);

    assertRowsEqual(
      "0029 upgrade 기존 table·index·trigger 보존(private_notes 표 정의와 새 index 제외)",
      readSchema().filter((entry) =>
        !newTables.has(entry.tbl_name)
        && !(entry.type === "table" && entry.name === "private_notes")
        && entry.name !== "private_notes_group_deleted_created_idx"),
      existingSchema.filter((entry) => !(entry.type === "table" && entry.name === "private_notes")),
    );
    for (const [tableName, rows] of existingRows) {
      const after = tableName === "private_notes"
        ? readRows(tableName).map(({ group_id: groupId, ...rest }) => {
          assert(groupId === null, "0029 기존 노트의 group_id는 NULL이어야 합니다.");
          return rest;
        })
        : readRows(tableName);
      assertRowsEqual(`0029 upgrade 기존 ${tableName} row 보존`, after, rows);
    }

    database.exec(`
      INSERT INTO lesson_groups (id, name) VALUES ('lg-group', '2:1 화요일');
      INSERT INTO lesson_group_members (student_id, group_id) VALUES ('lg-a', 'lg-group'), ('lg-b', 'lg-group');
      INSERT INTO private_notes (id, student_id, author_id, group_id, title, content_html)
        VALUES ('lg-note-group', 'lg-admin', 'lg-admin', 'lg-group', '그룹 노트', '<p>같이</p>');
    `);
    for (const [sql, label, constraint] of [
      ["INSERT INTO lesson_groups (id, name) VALUES ('lg-empty', '   ');", "빈 그룹 이름", "lesson_groups_payload_check"],
      ["INSERT INTO lesson_groups (id, name) VALUES ('lg-long', printf('%.61c', 'x'));", "61자 그룹 이름", "lesson_groups_payload_check"],
      ["INSERT INTO lesson_group_members (student_id, group_id) VALUES ('lg-a', 'lg-group');", "학생은 그룹 하나에만", "UNIQUE"],
      ["INSERT INTO lesson_group_members (student_id, group_id) VALUES ('lg-admin', 'lg-missing');", "없는 그룹", "FOREIGN KEY"],
      ["INSERT INTO lesson_group_members (student_id, group_id) VALUES ('lg-missing', 'lg-group');", "없는 계정", "FOREIGN KEY"],
      ["UPDATE private_notes SET group_id = 'lg-missing' WHERE id = 'lg-note-1';", "없는 그룹의 노트", "FOREIGN KEY"],
      ["DELETE FROM lesson_groups WHERE id = 'lg-group';", "그룹 노트가 남은 그룹 삭제", "FOREIGN KEY"],
    ]) {
      assertSqlFails(database, sql, `0029 ${label}`, constraint);
    }

    database.exec("DELETE FROM private_notes WHERE id = 'lg-note-group'; DELETE FROM lesson_groups WHERE id = 'lg-group';");
    assertRowsEqual("0029 노트 없는 그룹을 지우면 멤버십도 사라짐", database.all("SELECT * FROM lesson_group_members;"), []);
    assertRowsEqual(
      "0029 멤버십의 계정·그룹 FK는 cascade",
      database
        .all("SELECT \"table\", \"from\", \"to\", on_delete FROM pragma_foreign_key_list('lesson_group_members');")
        .sort((left, right) => left.table.localeCompare(right.table)),
      [
        { table: "lesson_groups", from: "group_id", to: "id", on_delete: "CASCADE" },
        { table: "profiles", from: "student_id", to: "id", on_delete: "CASCADE" },
      ],
    );
    assertRowsEqual(
      "0029 노트의 그룹 FK는 restrict",
      database
        .all("SELECT \"table\", \"from\", on_delete FROM pragma_foreign_key_list('private_notes') WHERE \"table\" = 'lesson_groups';"),
      [{ table: "lesson_groups", from: "group_id", on_delete: "RESTRICT" }],
    );
    assertRowsEqual("0029 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0029 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
