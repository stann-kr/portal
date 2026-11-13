import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import { createPostAtomically, restoreTrashedPostAtomically, trashPostAtomically } from "./post-atomic";

type LocalDbContext = Extract<DbContext, { kind: "local" }>;

function setupDatabase(context: TestContext): { sqlite: SqliteDatabase; dbContext: LocalDbContext } {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  const migrationDirectory = join(process.cwd(), "drizzle");
  for (const migrationFile of readdirSync(migrationDirectory)
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort()) {
    sqlite.exec(readFileSync(join(migrationDirectory, migrationFile), "utf8"));
  }
  return { sqlite, dbContext: { kind: "local", db: drizzle(sqlite, { schema }) } };
}

function seedProfile(sqlite: SqliteDatabase, id: string, role: "admin" | "student" = "student"): void {
  sqlite.prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, ?)").run(id, `${id}@example.com`, role);
}

function actor(id: string, isAdmin = false) {
  return { id, isAdmin };
}

function operationId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function getPost(sqlite: SqliteDatabase, id: string) {
  return sqlite
    .prepare<[string], { version: number; deleted_at: number | null; deleted_by_id: string | null }>(
      "SELECT version, deleted_at, deleted_by_id FROM posts WHERE id = ?",
    )
    .get(id);
}

test("관리자가 휴지통으로 보낸 게시물은 관리자만 되살리고, 작성자가 지운 게시물은 작성자가 되살린다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  let sequence = 100;
  for (const postId of ["admin-trashed", "self-trashed"]) {
    const created = await createPostAtomically(dbContext, {
      actor: actor("student-1"),
      postId,
      operationId: operationId(sequence++),
      snapshot: {
        category: "feedback",
        boardType: "FEEDBACK",
        isPinned: false,
        mediaUrl: null,
        mediaObjectId: null,
        title: postId,
        contentHtml: "<p>본문</p>",
      },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    assert.equal(created.ok, true);
  }
  const trashedAt = new Date("2026-01-02T00:00:00.000Z");
  assert.equal(
    (await trashPostAtomically(dbContext, {
      actor: actor("admin-1", true), postId: "admin-trashed", operationId: operationId(200), baseRevision: 1, now: trashedAt,
    })).ok,
    true,
  );
  assert.equal(
    (await trashPostAtomically(dbContext, {
      actor: actor("student-1"), postId: "self-trashed", operationId: operationId(201), baseRevision: 1, now: trashedAt,
    })).ok,
    true,
  );
  const at = new Date("2026-01-03T00:00:00.000Z");

  const blocked = await restoreTrashedPostAtomically(dbContext, {
    actor: actor("student-1"), postId: "admin-trashed", operationId: operationId(202), baseRevision: 2, now: at,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, "NOT_FOUND_OR_FORBIDDEN");
  assert.deepEqual(getPost(sqlite, "admin-trashed"), {
    version: 2,
    deleted_at: Math.floor(trashedAt.getTime() / 1000),
    deleted_by_id: "admin-1",
  });
  assert.equal(
    sqlite
      .prepare<[string], { value: number }>("SELECT count(*) AS value FROM document_operation_ledger WHERE operation_id = ?")
      .get(operationId(202))?.value,
    0,
  );

  const self = await restoreTrashedPostAtomically(dbContext, {
    actor: actor("student-1"), postId: "self-trashed", operationId: operationId(203), baseRevision: 2, now: at,
  });
  assert.equal(self.ok, true);
  assert.deepEqual(getPost(sqlite, "self-trashed"), { version: 3, deleted_at: null, deleted_by_id: null });

  const byAdmin = await restoreTrashedPostAtomically(dbContext, {
    actor: actor("admin-1", true), postId: "admin-trashed", operationId: operationId(204), baseRevision: 2, now: at,
  });
  assert.equal(byAdmin.ok, true);
  assert.deepEqual(getPost(sqlite, "admin-trashed"), { version: 3, deleted_at: null, deleted_by_id: null });
});
