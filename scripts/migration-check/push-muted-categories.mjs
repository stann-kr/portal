import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert, assertSqlFails } from "./assertions.mjs";

export const pushMutedCategoriesMigrationFile = "0025_push_muted_categories.sql";
const previousMigrationFile = "0024_push_subscriptions.sql";

/**
 * 0024 → 0025: 계정이 끈 알림 종류 table만 더한다. 기존 table·row는 그대로이고,
 * 종류는 정해진 값만, 계정·종류 쌍은 하나만, 계정 FK는 cascade다.
 */
export async function validatePushMutedCategoriesUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(pushMutedCategoriesMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0024 → 0025 push muted categories migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES ('pm-student', 'pm-student@example.com', 'Student', 'student');
      INSERT INTO push_subscriptions (id, profile_id, endpoint, p256dh, auth)
      VALUES ('pm-sub', 'pm-student', 'https://push.example.com/send/pm', '${"B".repeat(87)}', '${"a".repeat(22)}');
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

    applyMigration(database, pushMutedCategoriesMigrationFile);

    assertRowsEqual(
      "0025 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => entry.tbl_name !== "push_muted_categories"),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0025 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }

    database.exec("INSERT INTO push_muted_categories (profile_id, category) VALUES ('pm-student', 'community_post');");
    for (const [sql, label, constraint] of [
      ["INSERT INTO push_muted_categories (profile_id, category) VALUES ('pm-student', 'community_post');", "같은 종류 두 번", "UNIQUE"],
      ["INSERT INTO push_muted_categories (profile_id, category) VALUES ('pm-student', 'test');", "정해지지 않은 종류", "push_muted_categories_category_check"],
      ["INSERT INTO push_muted_categories (profile_id, category) VALUES ('pm-missing', 'qna');", "없는 계정", "FOREIGN KEY"],
    ]) {
      assertSqlFails(database, sql, `0025 ${label}`, constraint);
    }
    assertRowsEqual(
      "0025 계정 FK는 cascade",
      database.all("SELECT \"table\", \"from\", \"to\", on_delete FROM pragma_foreign_key_list('push_muted_categories');"),
      [{ table: "profiles", from: "profile_id", to: "id", on_delete: "CASCADE" }],
    );
    assertRowsEqual("0025 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0025 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
