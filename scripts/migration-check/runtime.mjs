import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = resolve(scriptDirectory, "../..");

export const migrationsDirectory = join(repositoryRoot, "drizzle");

export const metadataDirectory = join(migrationsDirectory, "meta");

export const journalPath = join(metadataDirectory, "_journal.json");

const drizzleKitCli = join(repositoryRoot, "node_modules", "drizzle-kit", "bin.cjs");

export const continuityMigrationFile = "0008_document_continuity.sql";

export const serverDraftMigrationFile = "0009_document_server_drafts.sql";

export const lifecycleExpansionMigrationFile = "0010_post_qna_lifecycle.sql";

export const mediaLifecycleMigrationFile = "0011_media_lifecycle.sql";

export const accountPrivacyMigrationFile = "0012_account_privacy_lifecycle.sql";

export const externalCalendarMigrationFile = "0013_external_calendar_subscriptions.sql";
export const documentImageMigrationFile = "0014_document_images.sql";
export const assignmentTaskMigrationFile = "0015_assignment_tasks.sql";
export const guidePageMigrationFile = "0016_guide_pages.sql";
export const calendarSyncMigrationFile = "0017_calendar_sync.sql";
export const calendarPushChannelMigrationFile = "0018_calendar_push_channels.sql";

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function createMemoryDatabase() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");

    return {
      exec: (sql) => database.exec(sql),
      all: (sql) => database.prepare(sql).all(),
      close: () => database.close(),
    };
  } catch (nodeSqliteError) {
    try {
      const { default: BetterSqlite3 } = await import("better-sqlite3");
      const database = new BetterSqlite3(":memory:");

      return {
        exec: (sql) => database.exec(sql),
        all: (sql) => database.prepare(sql).all(),
        close: () => database.close(),
      };
    } catch (betterSqliteError) {
      throw new AggregateError(
        [nodeSqliteError, betterSqliteError],
        "사용 가능한 in-memory SQLite driver가 없습니다.",
      );
    }
  }
}

export function applyMigration(database, migrationFile) {
  const sql = readFileSync(join(migrationsDirectory, migrationFile), "utf8");
  database.exec("BEGIN;");

  try {
    database.exec(sql);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${migrationFile} 적용 실패: ${message}`);
  }
}

export function applyMigrations(database, migrationFiles) {
  database.exec("PRAGMA foreign_keys = ON;");
  for (const migrationFile of migrationFiles) {
    applyMigration(database, migrationFile);
  }
}

export function runDrizzleKit(args) {
  try {
    return execFileSync(process.execPath, [drizzleKitCli, ...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stdout = error?.stdout?.toString().trim();
    const stderr = error?.stderr?.toString().trim();
    throw new Error(["Drizzle Kit 실행 실패", stdout, stderr].filter(Boolean).join("\n"));
  }
}
