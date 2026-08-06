/**
 * @file src/scripts/setup-admin.ts
 * @description 명시적으로 허용된 개발 환경에서만 로컬 관리자 계정을 생성한다.
 *
 * `.env.local`에 DEV_ADMIN_* 값을 설정한 뒤 아래 명령으로 실행한다.
 *
 *   npm run dev:seed-admin
 *
 * 비밀번호를 명령행 인자로 받거나 SQL·해시를 출력하지 않으며 remote D1에는 접근하지 않는다.
 */

import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { selectLocalD1SqliteFile } from "@/db/local-connection-cache";

const LOCAL_D1_DIRECTORY = join(
  process.cwd(),
  ".wrangler",
  "state",
  "v3",
  "d1",
  "miniflare-D1DatabaseObject",
);

const UPSERT_ADMIN_SQL = `
  INSERT INTO profiles (id, email, password_hash, display_name, role)
  VALUES (?, ?, ?, ?, 'admin')
  ON CONFLICT(email) DO UPDATE SET
    role = 'admin',
    password_hash = excluded.password_hash
`;

export type AdminSeedConfig = {
  email: string;
  password: string;
  displayName: string;
};

type SeedDatabase = {
  prepare: (query: string) => {
    run: (...parameters: string[]) => unknown;
  };
};

/**
 * 관리자 seed는 개발 환경과 명시적인 opt-in이 모두 있을 때만 허용한다.
 */
export function readAdminSeedConfig(
  environment: NodeJS.ProcessEnv,
): AdminSeedConfig {
  if (environment.NODE_ENV !== "development") {
    throw new Error("관리자 seed는 development 환경에서만 실행할 수 있습니다.");
  }

  if (environment.DEV_ADMIN_SEED_ENABLED !== "true") {
    throw new Error(
      "DEV_ADMIN_SEED_ENABLED=true로 명시적으로 허용해야 합니다.",
    );
  }

  const email = environment.DEV_ADMIN_EMAIL?.trim();
  const password = environment.DEV_ADMIN_PASSWORD;
  const displayName = environment.DEV_ADMIN_DISPLAY_NAME?.trim();

  if (!email || !password || !displayName) {
    throw new Error(
      "DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD, DEV_ADMIN_DISPLAY_NAME을 모두 설정해야 합니다.",
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("DEV_ADMIN_EMAIL 형식이 올바르지 않습니다.");
  }

  if (password.length < 12) {
    throw new Error("DEV_ADMIN_PASSWORD는 12자 이상이어야 합니다.");
  }

  return { email, password, displayName };
}

/**
 * 민감한 값이 process 목록이나 shell history에 남지 않도록 CLI 인자를 거부한다.
 */
export function assertNoCommandLineArguments(args: readonly string[]): void {
  if (args.length > 0) {
    throw new Error(
      "명령행 인자는 지원하지 않습니다. 관리자 정보는 .env.local의 DEV_ADMIN_* 변수로 설정하세요.",
    );
  }
}

/**
 * prepared statement로 관리자 계정을 생성하거나 기존 계정의 role/password만 갱신한다.
 */
export async function seedAdmin(
  database: SeedDatabase,
  seed: AdminSeedConfig,
  id: string = randomUUID(),
): Promise<void> {
  const passwordHash = await bcrypt.hash(seed.password, 10);

  database
    .prepare(UPSERT_ADMIN_SQL)
    .run(id, seed.email, passwordHash, seed.displayName);
}

function findLocalD1Database(): string {
  if (!existsSync(LOCAL_D1_DIRECTORY)) {
    throw new Error(
      `Wrangler 로컬 D1을 찾을 수 없습니다. 먼저 npm run db:migrate를 실행하세요. (${LOCAL_D1_DIRECTORY})`,
    );
  }

  const sqliteFile = selectLocalD1SqliteFile(readdirSync(LOCAL_D1_DIRECTORY));
  return join(LOCAL_D1_DIRECTORY, sqliteFile);
}

async function run(): Promise<void> {
  assertNoCommandLineArguments(process.argv.slice(2));
  loadEnv({ path: ".env.local", quiet: true });

  const seed = readAdminSeedConfig(process.env);
  const sqlitePath = findLocalD1Database();
  const Database = (await import("better-sqlite3")).default;
  const database = new Database(sqlitePath);

  try {
    await seedAdmin(database, seed);
    console.log("로컬 개발용 관리자 계정을 준비했습니다.");
    console.log(`이메일: ${seed.email}`);
    console.log(`이름: ${seed.displayName}`);
    console.log("역할: admin");
  } finally {
    database.close();
  }
}

const entryPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (entryPath === import.meta.url) {
  run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    console.error(`관리자 seed 실패: ${message}`);
    process.exitCode = 1;
  });
}
