import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert } from "./assertions.mjs";

export const studentArchiveMigrationFile = "0032_student_archive.sql";
const previousMigrationFile = "0031_group_calendar.sql";

/**
 * 0031 → 0032: 학생 수강 종료(보관)를 위해 profiles에 account_status(NOT NULL DEFAULT 'ACTIVE')와
 * archived_at(nullable) column만 더한다. table을 재생성하지 않으므로 profiles를 참조하는 FK·trigger·cascade가 그대로이고
 * 기존 계정은 모두 ACTIVE다. 보관·복원 UPDATE가 profiles identity trigger에 막히지 않는지도 확인한다.
 */
export async function validateStudentArchiveUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(studentArchiveMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0031 → 0032 student archive migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('sa-admin', 'sa-admin@example.com', 'Admin', 'admin'),
        ('sa-student', 'sa-student@example.com', 'Student', 'student'),
        ('sa-peer', 'sa-peer@example.com', 'Peer', 'student');
      INSERT INTO lessons (id, student_id, scheduled_at) VALUES ('sa-lesson', 'sa-student', 1793000100);
      INSERT INTO lesson_groups (id, name, created_at, updated_at) VALUES ('sa-group', '그룹', 1793000000, 1793000000);
      INSERT INTO lesson_group_members (student_id, group_id, joined_at) VALUES
        ('sa-student', 'sa-group', 1793000000),
        ('sa-peer', 'sa-group', 1793000000);
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

    applyMigration(database, studentArchiveMigrationFile);

    const isProfilesTable = (entry) => entry.type === "table" && entry.name === "profiles";
    assertRowsEqual(
      "0032 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => !isProfilesTable(entry)),
      existingSchema.filter((entry) => !isProfilesTable(entry)),
    );
    for (const [tableName, rows] of existingRows) {
      const after = readRows(tableName).map((row) => {
        if (tableName !== "profiles") return row;
        const rest = { ...row };
        delete rest.account_status;
        delete rest.archived_at;
        return rest;
      });
      assertRowsEqual(`0032 upgrade 기존 ${tableName} row 보존`, after, rows);
    }
    assertRowsEqual(
      "0032 기존 계정 ACTIVE·보관 시각 NULL",
      database.all("SELECT id, account_status, archived_at FROM profiles ORDER BY id;"),
      [
        { id: "sa-admin", account_status: "ACTIVE", archived_at: null },
        { id: "sa-peer", account_status: "ACTIVE", archived_at: null },
        { id: "sa-student", account_status: "ACTIVE", archived_at: null },
      ],
    );
    database.exec("INSERT INTO profiles (id, email, display_name, role) VALUES ('sa-new', 'sa-new@example.com', 'New', 'student');");
    assertRowsEqual(
      "0032 새 계정 기본값 ACTIVE",
      database.all("SELECT account_status, archived_at FROM profiles WHERE id = 'sa-new';"),
      [{ account_status: "ACTIVE", archived_at: null }],
    );

    // 보관·복원은 앱과 같은 조건부 UPDATE다. identity trigger(id·email 변경 감시)가 막지 않아야 한다.
    database.exec(`
      UPDATE profiles SET account_status = 'ARCHIVED', archived_at = 1793000500
      WHERE id = 'sa-student' AND role = 'student' AND account_status = 'ACTIVE';
    `);
    assertRowsEqual(
      "0032 보관 UPDATE 반영, 기록·그룹 멤버 유지",
      [
        ...database.all("SELECT id, account_status, archived_at FROM profiles WHERE id = 'sa-student';"),
        ...database.all("SELECT count(*) AS lessons FROM lessons WHERE student_id = 'sa-student';"),
        ...database.all("SELECT count(*) AS members FROM lesson_group_members WHERE group_id = 'sa-group';"),
      ],
      [{ id: "sa-student", account_status: "ARCHIVED", archived_at: 1793000500 }, { lessons: 1 }, { members: 2 }],
    );
    database.exec(`
      UPDATE profiles SET account_status = 'ACTIVE', archived_at = NULL
      WHERE id = 'sa-student' AND role = 'student' AND account_status = 'ARCHIVED';
    `);
    assertRowsEqual(
      "0032 복원 UPDATE 반영",
      database.all("SELECT id, account_status, archived_at FROM profiles WHERE id = 'sa-student';"),
      [{ id: "sa-student", account_status: "ACTIVE", archived_at: null }],
    );
    let notNullRejected = false;
    try {
      database.exec("UPDATE profiles SET account_status = NULL WHERE id = 'sa-peer';");
    } catch {
      notNullRejected = true;
    }
    assert(notNullRejected, "0032 account_status NOT NULL이 지켜지지 않았습니다.");
    assertRowsEqual("0032 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0032 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
