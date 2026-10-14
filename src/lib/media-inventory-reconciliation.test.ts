import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import {
  createMediaUploadIntent,
  queueOwnedMediaDeletion,
} from "@/lib/media-lifecycle-atomic";
import {
  createMediaObjectKey,
  createMediaUploadObjectKey,
} from "@/lib/media-lifecycle";
import {
  reconcileManagedFinalMediaObjects,
  type RuntimeR2InventoryBucket,
} from "./media-inventory-reconciliation";

type LocalDbContext = Extract<DbContext, { kind: "local" }>;

function setupDatabase(context: TestContext): {
  sqlite: Database.Database;
  dbContext: LocalDbContext;
} {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  for (const migrationFile of readdirSync(join(process.cwd(), "drizzle"))
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort()) {
    sqlite.exec(readFileSync(join(process.cwd(), "drizzle", migrationFile), "utf8"));
  }
  sqlite.prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, ?)").run(
    "inventory-student",
    "inventory-student@example.com",
    "student",
  );
  return { sqlite, dbContext: { kind: "local", db: drizzle(sqlite, { schema }) } };
}

function inventoryBucket(initialKeys: string[]) {
  const values = new Map(initialKeys.map((key) => [key, "object"]));
  const bucket: RuntimeR2InventoryBucket = {
    async list({ prefix, limit, startAfter }) {
      const keys = [...values.keys()]
        .filter((key) => key.startsWith(prefix) && (!startAfter || key > startAfter))
        .sort();
      return {
        objects: keys.slice(0, limit).map((key) => ({ key })),
        truncated: keys.length > limit,
      };
    },
    async get(key) {
      const value = values.get(key);
      return value === undefined ? null : { async text() { return value; } };
    },
    async put(key, value) {
      values.set(key, value);
      return undefined;
    },
    async delete(key) {
      for (const item of Array.isArray(key) ? key : [key]) values.delete(item);
    },
  };
  return { bucket, values };
}

async function createPendingMedia(
  dbContext: LocalDbContext,
  id: string,
  finalId: string,
  operationId: string,
): Promise<string> {
  const objectKey = createMediaObjectKey("COMMUNITY_POST_AUDIO", finalId);
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id,
      ownerId: "inventory-student",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey,
      uploadObjectKey: createMediaUploadObjectKey("COMMUNITY_POST_AUDIO", id),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: operationId,
      uploadExpiresAt: new Date("2026-08-11T12:00:00.000Z"),
      now: new Date("2026-08-11T10:00:00.000Z"),
    }),
    true,
  );
  return objectKey;
}

test("inventory cursor는 active를 보존하고 orphan을 bounded page로 수렴한다", async (context) => {
  const { dbContext } = setupDatabase(context);
  const activeKey = await createPendingMedia(
    dbContext,
    "80000000-0000-4000-8000-000000000001",
    "80000000-0000-4000-8000-000000000002",
    "80000000-0000-4000-8000-000000000003",
  );
  const orphanOne = createMediaObjectKey(
    "COMMUNITY_POST_AUDIO",
    "81000000-0000-4000-8000-000000000001",
  );
  const orphanTwo = createMediaObjectKey(
    "QNA_ATTACHMENT",
    "82000000-0000-4000-8000-000000000001",
  );
  const invalid = "media/legacy-object.bin";
  const { bucket, values } = inventoryBucket([
    activeKey,
    orphanOne,
    orphanTwo,
    invalid,
  ]);

  let sawCycleCompletion = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await reconcileManagedFinalMediaObjects(dbContext, bucket, {
      limit: 2,
    });
    sawCycleCompletion ||= result.cycleCompleted;
  }
  assert.equal(values.has(activeKey), true);
  assert.equal(values.has(orphanOne), false);
  assert.equal(values.has(orphanTwo), false);
  assert.equal(values.has(invalid), true);
  assert.equal(sawCycleCompletion, true);
});

test("PENDING_DELETE final은 completed outbox 뒤 부활해도 inventory가 재삭제한다", async (context) => {
  const { dbContext } = setupDatabase(context);
  const mediaId = "83000000-0000-4000-8000-000000000001";
  const finalKey = await createPendingMedia(
    dbContext,
    mediaId,
    "83000000-0000-4000-8000-000000000002",
    "83000000-0000-4000-8000-000000000003",
  );
  assert.equal(
    await queueOwnedMediaDeletion(dbContext, {
      ownerId: "inventory-student",
      mediaObjectId: mediaId,
      reason: "ABANDONED_UPLOAD",
      now: new Date("2026-08-11T10:01:00.000Z"),
    }),
    true,
  );
  const { bucket, values } = inventoryBucket([finalKey]);
  const result = await reconcileManagedFinalMediaObjects(dbContext, bucket);
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 0);
  assert.equal(values.has(finalKey), false);
});

test("soft budget 종료 전에는 R2 list와 cursor를 변경하지 않는다", async (context) => {
  const { dbContext } = setupDatabase(context);
  let listCalls = 0;
  const { bucket } = inventoryBucket([]);
  const originalList = bucket.list;
  bucket.list = async (input) => {
    listCalls += 1;
    return originalList(input);
  };
  const result = await reconcileManagedFinalMediaObjects(dbContext, bucket, {
    shouldContinue: () => false,
  });
  assert.equal(result.budgetExhausted, true);
  assert.equal(listCalls, 0);
});
