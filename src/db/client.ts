/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * @file db/client.ts
 * @description Drizzle ORM 클라이언트 팩토리.
 *
 * 런타임 환경에 따라 두 가지 DB 드라이버를 사용:
 * - 프로덕션 (Cloudflare Workers): getCloudflareContext().env.DB → drizzle-orm/d1
 * - 로컬 개발 (Next.js dev): Wrangler가 저장한 로컬 SQLite 파일 → drizzle-orm/better-sqlite3
 *
 * ⚠️ OpenNext에서 D1 바인딩은 process.env.DB로 접근 불가.
 *    반드시 getCloudflareContext()를 통해 접근해야 합니다.
 */
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { AnyD1Database, DrizzleD1Database } from "drizzle-orm/d1";
import {
  getOrCreateOpenConnection,
  selectLocalD1SqliteFile,
  type CachedOpenConnection,
} from "./local-connection-cache";
import * as schema from "./schema";

const LOCAL_SQLITE_CONNECTIONS_KEY = "__portalLocalSqliteConnections" as const;

type PortalRuntimeGlobal = typeof globalThis & {
  [LOCAL_SQLITE_CONNECTIONS_KEY]?: Map<
    string,
    CachedOpenConnection<BetterSqliteDatabase>
  >;
};

export type LocalDrizzleDb = BetterSQLite3Database<typeof schema> & {
  $client: BetterSqliteDatabase;
};

export type D1DrizzleDb = DrizzleD1Database<typeof schema> & {
  $client: AnyD1Database;
};

/**
 * 일반 조회/단일 쓰기 호출부가 공유하는 비동기 SQLite ORM 표면.
 * transaction/batch는 드라이버별 계약이 달라 의도적으로 제외한다.
 */
export type DrizzleDb = Omit<
  D1DrizzleDb,
  "transaction" | "batch" | "$client"
>;

export type DbContext =
  | { kind: "local"; db: LocalDrizzleDb }
  | { kind: "d1"; db: D1DrizzleDb };

/**
 * D1 바인딩을 직접 받아 Drizzle 인스턴스 생성 (Workers 프로덕션용).
 * @param d1 - Cloudflare D1Database 바인딩
 */
function createD1Db(d1: AnyD1Database): D1DrizzleDb {
  const { drizzle }: typeof import("drizzle-orm/d1") = require("drizzle-orm/d1");
  return drizzle(d1, { schema });
}

/**
 * 환경에 따라 적절한 Drizzle DB 인스턴스를 반환하는 팩토리 함수.
 *
 * - Cloudflare Workers(프로덕션): getCloudflareContext().env.DB 를 통해 D1 접근
 * - 로컬 개발(Next.js dev server): Wrangler SQLite 파일 직접 접근
 *
 * @throws DB 바인딩 미발견 시 에러
 */
export function createDbContext(): DbContext {
  // 프로덕션: OpenNext 환경에서 Cloudflare 바인딩 획득
  if (process.env.NODE_ENV !== "development") {
    try {
      const { getCloudflareContext } = require("@opennextjs/cloudflare");
      const ctx = getCloudflareContext();
      const d1 = ctx?.env?.DB as AnyD1Database | undefined;

      if (d1) {
        return { kind: "d1", db: createD1Db(d1) };
      }
    } catch {
      // Cloudflare 컨텍스트 획득 실패 시 로컬 환경으로 폴백
    }
  }

  // 로컬 개발: Wrangler가 저장한 SQLite 파일에 직접 접근
  if (process.env.NODE_ENV === "development") {
    return { kind: "local", db: createLocalDb() };
  }

  throw new Error(
    "[db] D1 Database binding 'DB' not found.\n" +
      "1. Ensure 'DB' binding exists in wrangler.toml\n" +
      "2. Ensure you are running in a Cloudflare Workers environment."
  );
}

/**
 * 기존 호출부용 ORM 인스턴스 팩토리.
 * 원자 쓰기처럼 드라이버별 실행 계약이 필요한 경우 createDbContext()를 사용한다.
 */
export function createDb(): DrizzleDb {
  return createDbContext().db as unknown as DrizzleDb;
}

/**
 * 개발 환경 전용: Wrangler 로컬 D1 SQLite 파일을 better-sqlite3로 직접 접근.
 * Wrangler는 로컬 D1을 `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`에 저장.
 */
function createLocalDb(): LocalDrizzleDb {
  const path = require(/* webpackIgnore: true */ "pa" + "th");
  const fs = require(/* webpackIgnore: true */ "f" + "s");
  const Database: typeof import("better-sqlite3") = require(
    /* webpackIgnore: true */ "better-sqlite" + "3",
  );
  const { drizzle }: typeof import("drizzle-orm/better-sqlite3") = require(
    /* webpackIgnore: true */ "drizzle-orm/better-sqlite" + "3",
  );

  const wranglerD1Dir = path.join(
    process.cwd(),
    ".wrangler",
    "state",
    "v3",
    "d1",
    "miniflare-D1DatabaseObject",
  );

  let sqlitePath: string | null = null;

  if (fs.existsSync(wranglerD1Dir)) {
    const sqliteFile = selectLocalD1SqliteFile(fs.readdirSync(wranglerD1Dir));
    sqlitePath = path.join(wranglerD1Dir, sqliteFile);
  }

  if (!sqlitePath) {
    throw new Error(
      `[dev] Wrangler local D1 SQLite not found at ${wranglerD1Dir}. ` +
        "Run: ./dev.sh migrate",
    );
  }

  const runtimeGlobal = globalThis as PortalRuntimeGlobal;
  const connections =
    runtimeGlobal[LOCAL_SQLITE_CONNECTIONS_KEY] ??
    (runtimeGlobal[LOCAL_SQLITE_CONNECTIONS_KEY] = new Map());
  const sqliteStat = fs.statSync(sqlitePath);
  const fileIdentity = `${sqliteStat.dev}:${sqliteStat.ino}:${sqliteStat.birthtimeMs}`;
  const sqlite = getOrCreateOpenConnection(
    connections,
    sqlitePath,
    fileIdentity,
    () => new Database(sqlitePath),
  );

  return drizzle(sqlite, { schema });
}
