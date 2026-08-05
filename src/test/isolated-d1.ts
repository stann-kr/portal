import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle, type AnyD1Database } from "drizzle-orm/d1";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import * as schema from "@/db/schema";
import type { D1DrizzleDb } from "@/db/client";

const MIGRATION_FILE_PATTERN = /^\d{4}_.+\.sql$/u;
const MIGRATION_BREAKPOINT = "--> statement-breakpoint";

type TestBindings = {
  DB: AnyD1Database;
};

export type IsolatedPortalD1 = {
  binding: AnyD1Database;
  db: D1DrizzleDb;
  dispose: () => Promise<void>;
};

async function applyPortalMigrations(binding: AnyD1Database): Promise<void> {
  const migrationDirectory = join(process.cwd(), "drizzle");
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((fileName) => MIGRATION_FILE_PATTERN.test(fileName))
    .sort();

  for (const migrationFile of migrationFiles) {
    const migrationSql = await readFile(join(migrationDirectory, migrationFile), "utf8");
    const statements = migrationSql
      .split(MIGRATION_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter(Boolean);

    await binding.batch(statements.map((statement) => binding.prepare(statement)));
  }
}

/**
 * production Wrangler 설정과 `.wrangler` persistence를 읽지 않는 일회성 D1을 만든다.
 * 설정과 Worker entrypoint도 OS temp 아래에 만들며 dispose 시 함께 제거한다.
 */
export async function createIsolatedPortalD1(): Promise<IsolatedPortalD1> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "portal-d1-integration-"));
  const configPath = join(temporaryDirectory, "wrangler.test.jsonc");
  const workerPath = join(temporaryDirectory, "worker.mjs");
  let proxy: PlatformProxy<TestBindings> | null = null;

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        name: "portal-integration-test",
        main: "worker.mjs",
        compatibility_date: "2024-11-18",
        compatibility_flags: ["nodejs_compat"],
        d1_databases: [
          {
            binding: "DB",
            database_name: "portal-integration-test",
            database_id: "00000000-0000-0000-0000-000000000000",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      workerPath,
      'export default { fetch() { return new Response("integration test") } };\n',
      "utf8",
    );

    proxy = await getPlatformProxy<TestBindings>({
      configPath,
      envFiles: [],
      persist: false,
      remoteBindings: false,
    });
    await applyPortalMigrations(proxy.env.DB);

    return {
      binding: proxy.env.DB,
      db: drizzle(proxy.env.DB, { schema }),
      dispose: async () => {
        await proxy?.dispose();
        proxy = null;
        await rm(temporaryDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await proxy?.dispose();
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}
