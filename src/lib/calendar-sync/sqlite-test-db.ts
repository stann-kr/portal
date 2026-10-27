/**
 * 테스트 전용: 모든 migration을 적용한 메모리 SQLite와 DbContext. 실제 코드에서 import하지 않는다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TestContext } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";

export type SqliteTestDb = {
  sqlite: Database.Database;
  ctx: Extract<DbContext, { kind: "local" }>;
  rows: <T>(query: string, ...params: unknown[]) => T[];
  run: (query: string, ...params: unknown[]) => void;
};

export function createSqliteTestDb(context: TestContext): SqliteTestDb {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync(join(process.cwd(), "drizzle")).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
    sqlite.exec(readFileSync(join(process.cwd(), "drizzle", file), "utf8"));
  }
  return {
    sqlite,
    ctx: { kind: "local", db: drizzle(sqlite, { schema }) },
    rows: <T,>(query: string, ...params: unknown[]) => sqlite.prepare(query).all(...params) as T[],
    run: (query: string, ...params: unknown[]) => {
      sqlite.prepare(query).run(...params);
    },
  };
}

const PAST = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1_000);

export function insertProfile(db: SqliteTestDb, id: string, role: "admin" | "student"): void {
  db.run("INSERT INTO profiles (id, email, display_name, role) VALUES (?, ?, ?, ?)", id, `${id}@example.com`, id, role);
}

export function insertConnection(db: SqliteTestDb, id: string, provider: "GOOGLE" | "ICLOUD", ownerId = "admin-1"): void {
  db.run(
    "INSERT INTO calendar_connections (id, owner_id, provider, account_label, encrypted_credentials, credentials_iv, created_at, updated_at) VALUES (?, ?, ?, 'teacher@example.com', 'x', 'y', ?, ?)",
    id,
    ownerId,
    provider,
    PAST,
    PAST,
  );
}

export function insertMapping(db: SqliteTestDb, id: string, connectionId: string, studentId: string, calendarId: string): void {
  db.run(
    "INSERT INTO calendar_mappings (id, connection_id, student_id, remote_calendar_id, remote_calendar_name, created_at, updated_at) VALUES (?, ?, ?, ?, '학생 캘린더', ?, ?)",
    id,
    connectionId,
    studentId,
    calendarId,
    PAST,
    PAST,
  );
}
