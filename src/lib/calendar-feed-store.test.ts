import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import { asDocumentReadDb } from "@/lib/document-lifecycle-atomic";
import {
  findCalendarFeedOwnerByDigest,
  findCalendarFeedTokenDigest,
  replaceCalendarFeedTokenDigest,
} from "./calendar-feed-store";

test("calendar v2 digest는 같은 초에도 UPDATE-first로 회전하고 owner를 역조회한다", async (context) => {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  for (const migrationFile of readdirSync(join(process.cwd(), "drizzle"))
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort()) {
    sqlite.exec(readFileSync(join(process.cwd(), "drizzle", migrationFile), "utf8"));
  }
  sqlite
    .prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, 'student')")
    .run("student-calendar", "calendar@example.com");
  const dbContext: Extract<DbContext, { kind: "local" }> = {
    kind: "local",
    db: drizzle(sqlite, { schema }),
  };
  const readDb = asDocumentReadDb(dbContext);
  const now = new Date("2026-01-01T00:00:00.000Z");

  await replaceCalendarFeedTokenDigest(
    "student-calendar",
    "a".repeat(64),
    now,
    dbContext,
  );
  await replaceCalendarFeedTokenDigest(
    "student-calendar",
    "b".repeat(64),
    now,
    dbContext,
  );

  assert.equal(
    await findCalendarFeedTokenDigest("student-calendar", readDb),
    "b".repeat(64),
  );
  assert.equal(
    await findCalendarFeedOwnerByDigest("b".repeat(64), readDb),
    "student-calendar",
  );
  const timestamps = sqlite
    .prepare<[], { created_at: number; updated_at: number }>(
      "SELECT created_at, updated_at FROM calendar_feed_tokens",
    )
    .get();
  assert.ok(timestamps);
  assert.equal(timestamps.created_at, Math.floor(now.getTime() / 1_000));
  assert.equal(timestamps.updated_at, timestamps.created_at + 1);
});
