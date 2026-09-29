import { readFileSync } from "node:fs";
import { join } from "node:path";
import { externalCalendarMigrationFile, migrationsDirectory } from "./runtime.mjs";
import { assert } from "./assertions.mjs";

export function validateExternalCalendarSubscriptionSchema(database) {
  const migrationSource = readFileSync(
    join(migrationsDirectory, externalCalendarMigrationFile),
    "utf8",
  );
  assert(
    /CREATE TABLE [`"]?external_calendar_subscriptions/u.test(migrationSource),
    "0013 external calendar table 생성이 없습니다.",
  );
  const foreignKeys = database.all("PRAGMA foreign_key_list('external_calendar_subscriptions');");
  assert(
    foreignKeys.some((foreignKey) => foreignKey.table === "profiles" && foreignKey.from === "student_id" && foreignKey.on_delete === "CASCADE"),
    "external calendar subscription profile cascade FK가 없습니다.",
  );
  const indexes = database.all("PRAGMA index_list('external_calendar_subscriptions');");
  assert(
    indexes.some((index) => index.name === "external_calendar_subscriptions_student_unique" && index.unique === 1),
    "external calendar subscription 학생별 unique index가 없습니다.",
  );
}
