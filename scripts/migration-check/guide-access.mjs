import { assert, assertRowsEqual, assertSqlFails } from "./assertions.mjs";
import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";

const previousMigrationFile = "0027_list_query_indexes.sql";
const guideAccessMigrationFile = "0028_guide_access.sql";

/**
 * 0027 → 0028: 학생별 가이드 열람 표 두 개를 더하고, 이미 가입을 마친 학생만 '전체'로 채운다.
 * 기존 표·행은 그대로이고 가입 링크만 받은 계정과 관리자는 닫힘(행 없음)으로 남는다.
 */
export async function validateGuideAccessUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(guideAccessMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0027 → 0028 guide access migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, password_hash, display_name, role) VALUES
        ('ga-admin', 'ga-admin@example.com', '$2b$10$adminhash', 'Admin', 'admin'),
        ('ga-active', 'ga-active@example.com', '$2b$10$activehash', 'Active', 'student'),
        ('ga-temporary', 'ga-temporary@example.com', 'temporary:$2b$10$temporaryhash', 'Temporary', 'student'),
        ('ga-invite', 'ga-invite@example.com', 'invite:1900000000:$2b$10$invitehash', 'Invite', 'student'),
        ('ga-no-password', 'ga-no-password@example.com', NULL, 'NoPassword', 'student');
      INSERT INTO guide_pages (id, title, sort_order) VALUES ('ga-page-1', '첫 페이지', 0), ('ga-page-2', '둘째 페이지', 1);
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

    applyMigration(database, guideAccessMigrationFile);

    assertRowsEqual(
      "0028 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => entry.tbl_name !== "guide_access" && entry.tbl_name !== "guide_access_pages"),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0028 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }

    assertRowsEqual(
      "0028 backfill: 가입을 마친 학생만 전체",
      database.all("SELECT student_id, mode FROM guide_access ORDER BY student_id;"),
      [
        { student_id: "ga-active", mode: "ALL" },
        { student_id: "ga-temporary", mode: "ALL" },
      ],
    );
    assertRowsEqual("0028 backfill: 열어 준 페이지 행은 만들지 않음", database.all("SELECT * FROM guide_access_pages;"), []);

    database.exec(`
      INSERT INTO guide_access (student_id, mode) VALUES ('ga-invite', 'SELECTED');
      INSERT INTO guide_access_pages (student_id, guide_page_id) VALUES ('ga-invite', 'ga-page-1'), ('ga-active', 'ga-page-1'), ('ga-active', 'ga-page-2');
    `);
    for (const [sql, label, constraint] of [
      ["INSERT INTO guide_access (student_id, mode) VALUES ('ga-no-password', 'CLOSED');", "정해지지 않은 상태", "guide_access_mode_check"],
      ["INSERT INTO guide_access (student_id, mode) VALUES ('ga-active', 'SELECTED');", "학생당 한 행", "UNIQUE"],
      ["INSERT INTO guide_access (student_id, mode) VALUES ('ga-missing', 'ALL');", "없는 계정", "FOREIGN KEY"],
      ["INSERT INTO guide_access_pages (student_id, guide_page_id) VALUES ('ga-invite', 'ga-page-1');", "같은 페이지 두 번", "UNIQUE"],
      ["INSERT INTO guide_access_pages (student_id, guide_page_id) VALUES ('ga-invite', 'ga-missing');", "없는 페이지", "FOREIGN KEY"],
      ["INSERT INTO guide_access_pages (student_id, guide_page_id) VALUES ('ga-missing', 'ga-page-1');", "없는 계정의 페이지", "FOREIGN KEY"],
    ]) {
      assertSqlFails(database, sql, `0028 ${label}`, constraint);
    }

    database.exec("DELETE FROM guide_pages WHERE id = 'ga-page-2';");
    assertRowsEqual(
      "0028 페이지를 지우면 그 페이지의 열람 행만 사라짐",
      database.all("SELECT student_id, guide_page_id FROM guide_access_pages ORDER BY student_id;"),
      [
        { student_id: "ga-active", guide_page_id: "ga-page-1" },
        { student_id: "ga-invite", guide_page_id: "ga-page-1" },
      ],
    );
    // 계정 삭제는 계정 삭제 절차의 trigger가 막으므로 FK 정의로 cascade를 확인한다.
    assertRowsEqual(
      "0028 열람 상태의 계정 FK는 cascade",
      database.all("SELECT \"table\", \"from\", \"to\", on_delete FROM pragma_foreign_key_list('guide_access');"),
      [{ table: "profiles", from: "student_id", to: "id", on_delete: "CASCADE" }],
    );
    assertRowsEqual(
      "0028 열어 준 페이지의 계정·페이지 FK는 cascade",
      database
        .all("SELECT \"table\", \"from\", \"to\", on_delete FROM pragma_foreign_key_list('guide_access_pages');")
        .sort((left, right) => left.table.localeCompare(right.table)),
      [
        { table: "guide_pages", from: "guide_page_id", to: "id", on_delete: "CASCADE" },
        { table: "profiles", from: "student_id", to: "id", on_delete: "CASCADE" },
      ],
    );
    assertRowsEqual("0028 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0028 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
