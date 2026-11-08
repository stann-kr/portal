import { applyMigration, applyMigrations, createMemoryDatabase } from "./runtime.mjs";
import { assertRowsEqual, assert, assertSqlFails } from "./assertions.mjs";

export const pushSubscriptionsMigrationFile = "0024_push_subscriptions.sql";
const previousMigrationFile = "0023_mix_analysis.sql";

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);

/**
 * 0023 → 0024: 웹 푸시 구독 table만 더한다. 기존 table·index·trigger와 row는 그대로이고,
 * endpoint는 https·기기당 하나, 계정을 지우면 구독도 함께 지워진다.
 */
export async function validatePushSubscriptionsUpgrade(migrationFiles) {
  const migrationIndex = migrationFiles.indexOf(pushSubscriptionsMigrationFile);
  assert(
    migrationIndex > 0 && migrationFiles[migrationIndex - 1] === previousMigrationFile,
    "0023 → 0024 push subscriptions migration 순서를 찾지 못했습니다.",
  );
  const database = await createMemoryDatabase();
  try {
    applyMigrations(database, migrationFiles.slice(0, migrationIndex));
    database.exec(`
      INSERT INTO profiles (id, email, display_name, role) VALUES
        ('ps-admin', 'ps-admin@example.com', 'Admin', 'admin'),
        ('ps-student', 'ps-student@example.com', 'Student', 'student');
      INSERT INTO lessons (id, student_id, scheduled_at) VALUES ('ps-lesson', 'ps-student', 1793000000);
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

    applyMigration(database, pushSubscriptionsMigrationFile);

    assertRowsEqual(
      "0024 upgrade 기존 table·index·trigger 보존",
      readSchema().filter((entry) => entry.tbl_name !== "push_subscriptions"),
      existingSchema,
    );
    for (const [tableName, rows] of existingRows) {
      assertRowsEqual(`0024 upgrade 기존 ${tableName} row 보존`, readRows(tableName), rows);
    }

    database.exec(`
      INSERT INTO push_subscriptions (id, profile_id, endpoint, p256dh, auth)
      VALUES ('ps-1', 'ps-student', 'https://push.example.com/send/1', '${P256DH}', '${AUTH}');
    `);
    for (const [sql, label, constraint] of [
      [`INSERT INTO push_subscriptions (id, profile_id, endpoint, p256dh, auth) VALUES ('ps-2', 'ps-admin', 'https://push.example.com/send/1', '${P256DH}', '${AUTH}');`, "같은 endpoint 두 번", "UNIQUE"],
      [`INSERT INTO push_subscriptions (id, profile_id, endpoint, p256dh, auth) VALUES ('ps-3', 'ps-admin', 'http://push.example.com/send/3', '${P256DH}', '${AUTH}');`, "https가 아닌 endpoint", "push_subscriptions_payload_check"],
      [`INSERT INTO push_subscriptions (id, profile_id, endpoint, p256dh, auth) VALUES ('ps-4', 'ps-admin', 'https://push.example.com/send/4', 'short', '${AUTH}');`, "짧은 p256dh", "push_subscriptions_payload_check"],
      [`INSERT INTO push_subscriptions (id, profile_id, endpoint, p256dh, auth) VALUES ('ps-5', 'ps-missing', 'https://push.example.com/send/5', '${P256DH}', '${AUTH}');`, "없는 계정", "FOREIGN KEY"],
    ]) {
      assertSqlFails(database, sql, `0024 ${label}`, constraint);
    }
    // 계정 삭제는 trigger 보호 아래 별도 경로(account-privacy-atomic)가 명시적으로 지운다. 여기서는 FK cascade 선언만 확인한다.
    assertRowsEqual(
      "0024 계정 FK는 cascade",
      database.all("SELECT \"table\", \"from\", \"to\", on_delete FROM pragma_foreign_key_list('push_subscriptions');"),
      [{ table: "profiles", from: "profile_id", to: "id", on_delete: "CASCADE" }],
    );
    assertRowsEqual("0024 populated upgrade FK 무결성", database.all("PRAGMA foreign_key_check;"), []);
    assertRowsEqual("0024 populated upgrade SQLite 무결성", database.all("PRAGMA integrity_check;"), [{ integrity_check: "ok" }]);
  } finally {
    database.close();
  }
}
