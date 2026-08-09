import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import {
  completeMediaUpload,
  createMediaUploadIntent,
  enqueueExpiredUnattachedMedia,
  processMediaDeletionOutbox,
  queueOwnedMediaDeletion,
} from "./media-lifecycle-atomic";
import {
  MEDIA_SEAL_RECOVERY_GRACE_SECONDS,
  MEDIA_UPLOAD_STAGING_GRACE_SECONDS,
  createMediaObjectKey,
  createMediaUploadObjectKey,
} from "./media-lifecycle";
import {
  createPostAtomically,
  purgePostAtomically,
  trashPostAtomically,
} from "./post-atomic";
import {
  createQnaReplyAtomically,
  createQnaThreadAtomically,
  purgeQnaThreadAtomically,
  trashQnaThreadAtomically,
} from "./qna-atomic";
import type { MediaObjectStorage } from "./r2";

type LocalDbContext = Extract<DbContext, { kind: "local" }>;

const STUDENT_MEDIA_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_MEDIA_ID = "10000000-0000-4000-8000-000000000002";
const OPERATION_ONE = "20000000-0000-4000-8000-000000000001";
const OPERATION_TWO = "20000000-0000-4000-8000-000000000002";
const OPERATION_THREE = "20000000-0000-4000-8000-000000000003";

function setupDatabase(context: TestContext): {
  sqlite: SqliteDatabase;
  dbContext: LocalDbContext;
} {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  const migrationDirectory = join(process.cwd(), "drizzle");
  for (const migrationFile of readdirSync(migrationDirectory)
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort()) {
    sqlite.exec(readFileSync(join(migrationDirectory, migrationFile), "utf8"));
  }
  return {
    sqlite,
    dbContext: { kind: "local", db: drizzle(sqlite, { schema }) },
  };
}

function seedProfile(
  sqlite: SqliteDatabase,
  id: string,
  role: "student" | "admin" = "student",
): void {
  sqlite
    .prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, ?)")
    .run(id, `${id}@example.com`, role);
}

function verifiedStorage(
  overrides: Partial<MediaObjectStorage> = {},
): MediaObjectStorage {
  return {
    async head() {
      return { size: 1_024, contentType: "audio/mpeg", etag: "etag-1" };
    },
    async seal(_uploadObjectKey, _finalObjectKey, source) {
      return source;
    },
    async delete() {},
    ...overrides,
  };
}

function storageIdFor(mediaObjectId: string): string {
  return `${mediaObjectId[0]}f${mediaObjectId.slice(2)}`;
}

async function createReadyMedia(
  dbContext: LocalDbContext,
  input: {
    id: string;
    ownerId: string;
    operationId: string;
    purpose?: "COMMUNITY_POST_AUDIO" | "QNA_ATTACHMENT";
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date("2026-01-01T00:00:00.000Z");
  const purpose = input.purpose ?? "COMMUNITY_POST_AUDIO";
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: input.id,
      ownerId: input.ownerId,
      purpose,
      objectKey: createMediaObjectKey(purpose, storageIdFor(input.id)),
      uploadObjectKey: createMediaUploadObjectKey(purpose, input.id),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: input.operationId,
      uploadExpiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
      now,
    }),
    true,
  );
  const completed = await completeMediaUpload(dbContext, verifiedStorage(), {
    ownerId: input.ownerId,
    mediaObjectId: input.id,
    now: new Date(now.getTime() + 1_000),
  });
  assert.equal(completed.ok, true);
}

function readMedia(sqlite: SqliteDatabase, id: string) {
  return sqlite
    .prepare<
      [string],
      {
        state: string;
        resource_type: string | null;
        resource_id: string | null;
        deleted_at: number | null;
      }
    >(
      "SELECT state, resource_type, resource_id, deleted_at FROM media_objects WHERE id = ?",
    )
    .get(id);
}

function readSealLeaseExpiresAt(sqlite: SqliteDatabase, id: string): Date {
  const row = sqlite
    .prepare<[string], { seal_lease_expires_at: number | null }>(
      "SELECT seal_lease_expires_at FROM media_objects WHERE id = ?",
    )
    .get(id);
  assert.ok(row?.seal_lease_expires_at);
  return new Date(row.seal_lease_expires_at * 1_000);
}

function scalarCount(sqlite: SqliteDatabase, query: string): number {
  return sqlite.prepare<[], { count: number }>(query).get()?.count ?? 0;
}

test("HEAD 검증 성공만 READY로 전이하고 metadata mismatch는 durable 삭제로 수렴한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: STUDENT_MEDIA_ID,
      ownerId: "student-1",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey: createMediaObjectKey(
        "COMMUNITY_POST_AUDIO",
        storageIdFor(STUDENT_MEDIA_ID),
      ),
      uploadObjectKey: createMediaUploadObjectKey(
        "COMMUNITY_POST_AUDIO",
        STUDENT_MEDIA_ID,
      ),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: OPERATION_ONE,
      uploadExpiresAt: new Date(now.getTime() + 3_600_000),
      now,
    }),
    true,
  );

  const mismatch = await completeMediaUpload(
    dbContext,
    verifiedStorage({
      async head() {
        return { size: 2_048, contentType: "audio/mpeg", etag: "wrong" };
      },
    }),
    {
      ownerId: "student-1",
      mediaObjectId: STUDENT_MEDIA_ID,
      now: new Date(now.getTime() + 1_000),
    },
  );
  assert.deepEqual(mismatch, { ok: false, reason: "METADATA_MISMATCH" });
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "PENDING_UPLOAD");

  assert.equal(
    await queueOwnedMediaDeletion(dbContext, {
      ownerId: "student-1",
      mediaObjectId: STUDENT_MEDIA_ID,
      reason: "UPLOAD_VERIFICATION_FAILED",
      now: new Date(now.getTime() + 2_000),
    }),
    true,
  );
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "PENDING_DELETE");
  assert.equal(
    scalarCount(sqlite, "SELECT count(*) AS count FROM media_deletion_outbox"),
    2,
  );
});

test("일시적인 HEAD 오류는 object 부재로 오인하지 않고 completion 재시도를 허용한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: STUDENT_MEDIA_ID,
      ownerId: "student-1",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey: createMediaObjectKey(
        "COMMUNITY_POST_AUDIO",
        storageIdFor(STUDENT_MEDIA_ID),
      ),
      uploadObjectKey: createMediaUploadObjectKey(
        "COMMUNITY_POST_AUDIO",
        STUDENT_MEDIA_ID,
      ),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: OPERATION_ONE,
      uploadExpiresAt: new Date(now.getTime() + 3_600_000),
      now,
    }),
    true,
  );

  assert.deepEqual(
    await completeMediaUpload(
      dbContext,
      verifiedStorage({
        async head() {
          throw new Error("transient R2 HEAD failure");
        },
      }),
      {
        ownerId: "student-1",
        mediaObjectId: STUDENT_MEDIA_ID,
        now: new Date(now.getTime() + 1_000),
      },
    ),
    { ok: false, reason: "OBJECT_HEAD_FAILED" },
  );
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "PENDING_UPLOAD");
  assert.equal(
    scalarCount(sqlite, "SELECT count(*) AS count FROM media_deletion_outbox"),
    0,
  );

  const retried = await completeMediaUpload(dbContext, verifiedStorage(), {
    ownerId: "student-1",
    mediaObjectId: STUDENT_MEDIA_ID,
    now: new Date(now.getTime() + 2_000),
  });
  assert.equal(retried.ok, true);
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "READY");
});

test("업로드 완료는 presigned staging을 검증한 뒤 비공개 final key로 seal한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const now = new Date("2026-01-01T00:00:00.000Z");
  const finalObjectKey = createMediaObjectKey(
    "COMMUNITY_POST_AUDIO",
    storageIdFor(STUDENT_MEDIA_ID),
  );
  const uploadObjectKey = createMediaUploadObjectKey(
    "COMMUNITY_POST_AUDIO",
    STUDENT_MEDIA_ID,
  );
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: STUDENT_MEDIA_ID,
      ownerId: "student-1",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey: finalObjectKey,
      uploadObjectKey,
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: OPERATION_ONE,
      uploadExpiresAt: new Date(now.getTime() + 3_600_000),
      now,
    }),
    true,
  );

  const observed: string[] = [];
  const completed = await completeMediaUpload(
    dbContext,
    verifiedStorage({
      async head(objectKey) {
        observed.push(`head:${objectKey}`);
        return { size: 1_024, contentType: "audio/mpeg", etag: "upload-etag" };
      },
      async seal(sourceKey, destinationKey, source) {
        observed.push(`seal:${sourceKey}->${destinationKey}`);
        assert.equal(source.etag, "upload-etag");
        return { size: 1_024, contentType: "audio/mpeg", etag: "final-etag" };
      },
    }),
    {
      ownerId: "student-1",
      mediaObjectId: STUDENT_MEDIA_ID,
      now: new Date(now.getTime() + 1_000),
    },
  );
  assert.equal(completed.ok, true);
  assert.deepEqual(observed, [
    `head:${uploadObjectKey}`,
    `seal:${uploadObjectKey}->${finalObjectKey}`,
  ]);
  assert.deepEqual(
    sqlite
      .prepare<[], { state: string; etag: string | null }>(
        "SELECT state, etag FROM media_objects WHERE id = '10000000-0000-4000-8000-000000000001'",
      )
      .get(),
    { state: "READY", etag: "final-etag" },
  );
  assert.equal(
    scalarCount(
      sqlite,
      "SELECT count(*) AS count FROM media_deletion_outbox WHERE object_key LIKE 'media-upload/%'",
    ),
    1,
  );
});

test("만료 직전 시작한 completion은 HEAD와 seal 중 URL 시각이 지나도 READY가 된다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const now = new Date("2026-01-01T00:00:00.000Z");
  const completionStartedAt = new Date(now.getTime() + 3_600_000);
  let wallClockMs = 1_000;
  context.mock.method(Date, "now", () => wallClockMs);
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: STUDENT_MEDIA_ID,
      ownerId: "student-1",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey: createMediaObjectKey(
        "COMMUNITY_POST_AUDIO",
        storageIdFor(STUDENT_MEDIA_ID),
      ),
      uploadObjectKey: createMediaUploadObjectKey(
        "COMMUNITY_POST_AUDIO",
        STUDENT_MEDIA_ID,
      ),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: OPERATION_ONE,
      uploadExpiresAt: completionStartedAt,
      now,
    }),
    true,
  );

  const completed = await completeMediaUpload(
    dbContext,
    verifiedStorage({
      async head() {
        wallClockMs += 2_000;
        return { size: 1_024, contentType: "audio/mpeg", etag: "upload-etag" };
      },
      async seal(_sourceKey, _destinationKey, source) {
        return { ...source, etag: "final-etag" };
      },
    }),
    {
      ownerId: "student-1",
      mediaObjectId: STUDENT_MEDIA_ID,
      now: completionStartedAt,
    },
  );

  assert.equal(completed.ok, true);
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "READY");
});

test("SEALING lease 동안 동시 abandon은 final 삭제를 선점하지 못한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: STUDENT_MEDIA_ID,
      ownerId: "student-1",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey: createMediaObjectKey(
        "COMMUNITY_POST_AUDIO",
        storageIdFor(STUDENT_MEDIA_ID),
      ),
      uploadObjectKey: createMediaUploadObjectKey(
        "COMMUNITY_POST_AUDIO",
        STUDENT_MEDIA_ID,
      ),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: OPERATION_ONE,
      uploadExpiresAt: new Date(now.getTime() + 3_600_000),
      now,
    }),
    true,
  );

  let concurrentAbandon: boolean | null = null;
  const completed = await completeMediaUpload(
    dbContext,
    verifiedStorage({
      async head() {
        assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "SEALING");
        concurrentAbandon = await queueOwnedMediaDeletion(dbContext, {
          ownerId: "student-1",
          mediaObjectId: STUDENT_MEDIA_ID,
          reason: "ABANDONED_UPLOAD",
          now: new Date(now.getTime() + 1_000),
        });
        return { size: 1_024, contentType: "audio/mpeg", etag: "upload-etag" };
      },
      async seal(_sourceKey, _destinationKey, source) {
        assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "SEALING");
        return { ...source, etag: "final-etag" };
      },
    }),
    {
      ownerId: "student-1",
      mediaObjectId: STUDENT_MEDIA_ID,
      now: new Date(now.getTime() + 1_000),
    },
  );

  assert.equal(concurrentAbandon, false);
  assert.equal(completed.ok, true);
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "READY");
  assert.equal(
    scalarCount(
      sqlite,
      "SELECT count(*) AS count FROM media_deletion_outbox WHERE object_key LIKE 'media/%'",
    ),
    0,
  );
});

test("만료 SEALING의 late copy는 grace와 durable 재삭제로 수렴한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const now = new Date("2026-01-01T00:00:00.000Z");
  const completionStartedAt = new Date(now.getTime() + 1_000);
  const finalObjectKey = createMediaObjectKey(
    "COMMUNITY_POST_AUDIO",
    storageIdFor(STUDENT_MEDIA_ID),
  );
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: STUDENT_MEDIA_ID,
      ownerId: "student-1",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey: finalObjectKey,
      uploadObjectKey: createMediaUploadObjectKey(
        "COMMUNITY_POST_AUDIO",
        STUDENT_MEDIA_ID,
      ),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: OPERATION_ONE,
      uploadExpiresAt: new Date(now.getTime() + 3_600_000),
      now,
    }),
    true,
  );

  let resumeSeal: (() => void) | undefined;
  const sealBlocked = new Promise<void>((resolve) => {
    resumeSeal = resolve;
  });
  let markSealStarted: (() => void) | undefined;
  const sealStarted = new Promise<void>((resolve) => {
    markSealStarted = resolve;
  });
  let finalExists = false;
  let finalDeleteAttempts = 0;
  const storage = verifiedStorage({
    async seal(_sourceKey, _destinationKey, source) {
      markSealStarted?.();
      await sealBlocked;
      finalExists = true;
      return { ...source, etag: "late-final-etag" };
    },
    async delete(objectKey) {
      if (objectKey !== finalObjectKey) return;
      finalDeleteAttempts += 1;
      if (finalDeleteAttempts === 1) throw new Error("transient compensation");
      finalExists = false;
    },
  });
  const completing = completeMediaUpload(dbContext, storage, {
    ownerId: "student-1",
    mediaObjectId: STUDENT_MEDIA_ID,
    now: completionStartedAt,
  });
  await sealStarted;

  const leaseExpiresAt = readSealLeaseExpiresAt(sqlite, STUDENT_MEDIA_ID);
  const sweptAt = new Date(leaseExpiresAt.getTime() + 1_000);
  await enqueueExpiredUnattachedMedia(dbContext, sweptAt);
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "PENDING_DELETE");
  assert.deepEqual(
    await processMediaDeletionOutbox(dbContext, storage, {
      now: sweptAt,
      limit: 2,
    }),
    { completed: 0, failed: 0 },
  );

  resumeSeal?.();
  assert.deepEqual(await completing, {
    ok: false,
    reason: "INTERNAL_INVARIANT_FAILURE",
  });
  assert.equal(finalExists, true);
  assert.equal(finalDeleteAttempts, 1);

  const recoveryAt = new Date(
    leaseExpiresAt.getTime() + MEDIA_SEAL_RECOVERY_GRACE_SECONDS * 1_000,
  );
  assert.deepEqual(
    await processMediaDeletionOutbox(dbContext, storage, {
      now: recoveryAt,
      limit: 2,
    }),
    { completed: 1, failed: 0 },
  );
  assert.equal(finalExists, false);
  assert.equal(finalDeleteAttempts, 2);

  assert.deepEqual(
    await processMediaDeletionOutbox(dbContext, storage, {
      now: new Date(now.getTime() + 2 * 3_600_000),
      limit: 2,
    }),
    { completed: 1, failed: 0 },
  );
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "DELETED");
});

test("Copy 결과가 unknown으로 끝난 뒤 생긴 final도 lease recovery job이 삭제한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  const now = new Date("2026-01-01T00:00:00.000Z");
  const completionStartedAt = new Date(now.getTime() + 1_000);
  const finalObjectKey = createMediaObjectKey(
    "COMMUNITY_POST_AUDIO",
    storageIdFor(STUDENT_MEDIA_ID),
  );
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: STUDENT_MEDIA_ID,
      ownerId: "student-1",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey: finalObjectKey,
      uploadObjectKey: createMediaUploadObjectKey(
        "COMMUNITY_POST_AUDIO",
        STUDENT_MEDIA_ID,
      ),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: OPERATION_ONE,
      uploadExpiresAt: new Date(now.getTime() + 3_600_000),
      now,
    }),
    true,
  );

  let finalExists = false;
  const storage = verifiedStorage({
    async seal() {
      queueMicrotask(() => {
        finalExists = true;
      });
      throw new Error("copy response lost");
    },
    async delete(objectKey) {
      if (objectKey === finalObjectKey) finalExists = false;
    },
  });
  assert.deepEqual(
    await completeMediaUpload(dbContext, storage, {
      ownerId: "student-1",
      mediaObjectId: STUDENT_MEDIA_ID,
      now: completionStartedAt,
    }),
    { ok: false, reason: "OBJECT_SEAL_FAILED" },
  );
  await Promise.resolve();
  assert.equal(finalExists, true);
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "SEALING");

  const leaseExpiresAt = readSealLeaseExpiresAt(sqlite, STUDENT_MEDIA_ID);
  const recoveryAt = new Date(
    leaseExpiresAt.getTime() + MEDIA_SEAL_RECOVERY_GRACE_SECONDS * 1_000,
  );
  await enqueueExpiredUnattachedMedia(
    dbContext,
    leaseExpiresAt,
  );
  assert.deepEqual(
    await processMediaDeletionOutbox(dbContext, storage, {
      now: new Date(recoveryAt.getTime() - 1_000),
      limit: 2,
    }),
    { completed: 0, failed: 0 },
  );
  assert.deepEqual(
    await processMediaDeletionOutbox(dbContext, storage, {
      now: recoveryAt,
      limit: 2,
    }),
    { completed: 1, failed: 0 },
  );
  assert.equal(finalExists, false);
});

test("게시물 생성은 READY asset을 같은 transaction에서 claim하고 cross-owner 실패를 전부 rollback한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "student-2");
  await createReadyMedia(dbContext, {
    id: STUDENT_MEDIA_ID,
    ownerId: "student-1",
    operationId: OPERATION_ONE,
  });

  const forbidden = await createPostAtomically(dbContext, {
    actor: { id: "student-2", isAdmin: false },
    postId: "forbidden-post",
    operationId: OPERATION_ONE,
    snapshot: {
      category: "feedback",
      boardType: "FEEDBACK",
      isPinned: false,
      mediaUrl: `/api/media/${STUDENT_MEDIA_ID}`,
      mediaObjectId: STUDENT_MEDIA_ID,
      title: "권한 없는 게시물",
      contentHtml: "<p>본문</p>",
    },
    now: new Date("2026-01-01T00:01:00.000Z"),
  });
  assert.equal(forbidden.ok, false);
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "READY");
  assert.equal(
    scalarCount(sqlite, "SELECT count(*) AS count FROM posts"),
    0,
  );
  assert.equal(
    scalarCount(sqlite, "SELECT count(*) AS count FROM document_operation_ledger"),
    0,
  );

  const created = await createPostAtomically(dbContext, {
    actor: { id: "student-1", isAdmin: false },
    postId: "managed-post",
    operationId: OPERATION_ONE,
    snapshot: {
      category: "feedback",
      boardType: "FEEDBACK",
      isPinned: false,
      mediaUrl: `/api/media/${STUDENT_MEDIA_ID}`,
      mediaObjectId: STUDENT_MEDIA_ID,
      title: "관리 게시물",
      contentHtml: "<p>본문</p>",
    },
    now: new Date("2026-01-01T00:02:00.000Z"),
  });
  assert.equal(created.ok, true);
  assert.deepEqual(readMedia(sqlite, STUDENT_MEDIA_ID), {
    state: "ATTACHED",
    resource_type: "COMMUNITY_POST",
    resource_id: "managed-post",
    deleted_at: null,
  });
  const postReference = sqlite
    .prepare<[], { media_object_id: string | null }>(
      "SELECT media_object_id FROM posts WHERE id = 'managed-post'",
    )
    .get();
  const revisionReference = sqlite
    .prepare<[], { media_object_id: string | null }>(
      "SELECT media_object_id FROM post_revisions WHERE post_id = 'managed-post'",
    )
    .get();
  assert.equal(postReference?.media_object_id, STUDENT_MEDIA_ID);
  assert.equal(revisionReference?.media_object_id, STUDENT_MEDIA_ID);
});

test("게시물 purge는 R2 삭제 전 registry와 object별 outbox를 commit하고 processor가 idempotent delete로 완료한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  await createReadyMedia(dbContext, {
    id: STUDENT_MEDIA_ID,
    ownerId: "student-1",
    operationId: OPERATION_ONE,
  });
  const createdAt = new Date("2026-01-01T00:02:00.000Z");
  const created = await createPostAtomically(dbContext, {
    actor: { id: "student-1", isAdmin: false },
    postId: "purged-post",
    operationId: OPERATION_ONE,
    snapshot: {
      category: "feedback",
      boardType: "FEEDBACK",
      isPinned: false,
      mediaUrl: `/api/media/${STUDENT_MEDIA_ID}`,
      mediaObjectId: STUDENT_MEDIA_ID,
      title: "삭제 게시물",
      contentHtml: "<p>본문</p>",
    },
    now: createdAt,
  });
  assert.equal(created.ok, true);
  const trashed = await trashPostAtomically(dbContext, {
    actor: { id: "student-1", isAdmin: false },
    postId: "purged-post",
    operationId: OPERATION_TWO,
    baseRevision: 1,
    now: new Date("2026-01-02T00:00:00.000Z"),
  });
  assert.equal(trashed.ok, true);
  const purgeWrite = {
    actor: { id: "admin-1", isAdmin: true },
    postId: "purged-post",
    operationId: OPERATION_THREE,
    baseRevision: 2,
    now: new Date("2026-02-03T00:00:00.000Z"),
  };
  const purged = await purgePostAtomically(dbContext, purgeWrite);
  const replay = await purgePostAtomically(dbContext, purgeWrite);
  assert.equal(purged.ok, true);
  assert.equal(replay.ok && replay.replayed, true);
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "PENDING_DELETE");
  assert.equal(scalarCount(sqlite, "SELECT count(*) AS count FROM posts"), 0);
  assert.equal(
    scalarCount(sqlite, "SELECT count(*) AS count FROM media_deletion_outbox"),
    2,
  );

  const deletedKeys: string[] = [];
  const processed = await processMediaDeletionOutbox(
    dbContext,
    verifiedStorage({
      async delete(objectKey) {
        deletedKeys.push(objectKey);
      },
    }),
    { now: new Date("2026-02-04T00:00:00.000Z"), limit: 5 },
  );
  assert.deepEqual(processed, { completed: 2, failed: 0 });
  assert.deepEqual(deletedKeys, [
    createMediaUploadObjectKey("COMMUNITY_POST_AUDIO", STUDENT_MEDIA_ID),
    createMediaObjectKey(
      "COMMUNITY_POST_AUDIO",
      storageIdFor(STUDENT_MEDIA_ID),
    ),
  ]);
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "DELETED");
  assert.ok(readMedia(sqlite, STUDENT_MEDIA_ID)?.deleted_at);
  assert.ok(
    sqlite
      .prepare<[], { completed_at: number | null }>(
        "SELECT completed_at FROM media_deletion_outbox",
      )
      .get()?.completed_at,
  );
});

test("R2 삭제 hang은 timeout으로 lease를 풀고 backoff 뒤 idempotent 재시도로 수렴한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  await createReadyMedia(dbContext, {
    id: STUDENT_MEDIA_ID,
    ownerId: "student-1",
    operationId: OPERATION_ONE,
  });
  const queuedAt = new Date("2026-01-01T00:02:00.000Z");
  assert.equal(
    await queueOwnedMediaDeletion(dbContext, {
      ownerId: "student-1",
      mediaObjectId: STUDENT_MEDIA_ID,
      reason: "ABANDONED_UPLOAD",
      now: queuedAt,
    }),
    true,
  );

  const uploadExpiresAt = new Date("2026-01-01T01:00:00.000Z");
  const stagingDeleteAt = new Date(
    uploadExpiresAt.getTime() + MEDIA_UPLOAD_STAGING_GRACE_SECONDS * 1_000,
  );
  const queuedOutbox = sqlite
    .prepare<[], { not_before: number; next_attempt_at: number }>(
      `SELECT not_before, next_attempt_at FROM media_deletion_outbox
       WHERE object_key LIKE 'media-upload/%'`,
    )
    .get();
  assert.deepEqual(queuedOutbox, {
    not_before: Math.floor(stagingDeleteAt.getTime() / 1_000),
    next_attempt_at: Math.floor(stagingDeleteAt.getTime() / 1_000),
  });
  assert.deepEqual(
    await processMediaDeletionOutbox(dbContext, verifiedStorage(), {
      now: new Date(queuedAt.getTime() - 1_000),
      limit: 1,
    }),
    { completed: 0, failed: 0 },
  );

  const failed = await processMediaDeletionOutbox(
    dbContext,
    verifiedStorage({
      async delete() {
        await new Promise<void>(() => {
          // storage adapter hang을 재현한다.
        });
      },
    }),
    { now: queuedAt, limit: 1, deleteTimeoutMs: 5 },
  );
  assert.deepEqual(failed, { completed: 0, failed: 1 });
  const retry = sqlite
    .prepare<
      [],
      {
        attempt_count: number;
        next_attempt_at: number;
        lease_id: string | null;
        last_error_code: string | null;
      }
    >(
      `SELECT attempt_count, next_attempt_at, lease_id, last_error_code
       FROM media_deletion_outbox
       WHERE object_key LIKE 'media/%'`,
    )
    .get();
  assert.deepEqual(retry, {
    attempt_count: 1,
    next_attempt_at: Math.floor(queuedAt.getTime() / 1_000) + 30,
    lease_id: null,
    last_error_code: "MEDIA_STORAGE_OPERATION_TIMEOUT",
  });
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "PENDING_DELETE");

  assert.deepEqual(
    await processMediaDeletionOutbox(dbContext, verifiedStorage(), {
      now: new Date(queuedAt.getTime() + 29_000),
      limit: 1,
    }),
    { completed: 0, failed: 0 },
  );
  assert.deepEqual(
    await processMediaDeletionOutbox(dbContext, verifiedStorage(), {
      now: new Date(queuedAt.getTime() + 30_000),
      limit: 1,
    }),
    { completed: 1, failed: 0 },
  );
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "PENDING_DELETE");
  assert.deepEqual(
    await processMediaDeletionOutbox(dbContext, verifiedStorage(), {
      now: stagingDeleteAt,
      limit: 1,
    }),
    { completed: 1, failed: 0 },
  );
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "DELETED");
});

test("outbox 완료 뒤 media finalization이 일시 실패해도 다음 runner가 수렴한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  await createReadyMedia(dbContext, {
    id: STUDENT_MEDIA_ID,
    ownerId: "student-1",
    operationId: OPERATION_ONE,
  });
  assert.equal(
    await queueOwnedMediaDeletion(dbContext, {
      ownerId: "student-1",
      mediaObjectId: STUDENT_MEDIA_ID,
      reason: "ABANDONED_UPLOAD",
      now: new Date("2026-01-01T00:02:00.000Z"),
    }),
    true,
  );

  let finalizeAttempts = 0;
  sqlite.function("fail_media_finalize_once", () => {
    finalizeAttempts += 1;
    return finalizeAttempts === 1 ? 1 : 0;
  });
  sqlite.exec(`
    CREATE TRIGGER fail_media_finalize_once
    BEFORE UPDATE OF state ON media_objects
    WHEN OLD.state = 'PENDING_DELETE'
      AND NEW.state = 'DELETED'
      AND fail_media_finalize_once() = 1
    BEGIN
      SELECT RAISE(ABORT, 'TRANSIENT_MEDIA_FINALIZATION_FAILURE');
    END;
  `);

  const first = await processMediaDeletionOutbox(
    dbContext,
    verifiedStorage(),
    { now: new Date("2026-01-01T03:00:00.000Z"), limit: 2 },
  );
  assert.deepEqual(first, { completed: 2, failed: 0 });
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "PENDING_DELETE");
  assert.equal(
    scalarCount(
      sqlite,
      "SELECT count(*) AS count FROM media_deletion_outbox WHERE completed_at IS NULL",
    ),
    0,
  );

  const blockerNow = new Date("2025-12-01T00:00:00.000Z");
  for (let index = 1; index <= 3; index += 1) {
    const mediaId = `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const ownerId = `finalize-blocker-${index}`;
    seedProfile(sqlite, ownerId);
    assert.equal(
      await createMediaUploadIntent(dbContext, {
        id: mediaId,
        ownerId,
        purpose: "COMMUNITY_POST_AUDIO",
        objectKey: createMediaObjectKey(
          "COMMUNITY_POST_AUDIO",
          storageIdFor(mediaId),
        ),
        uploadObjectKey: createMediaUploadObjectKey(
          "COMMUNITY_POST_AUDIO",
          mediaId,
        ),
        expectedContentType: "audio/mpeg",
        expectedSizeBytes: 1_024,
        draftOperationId: `finalize-blocker-operation-${index}`,
        uploadExpiresAt: new Date(blockerNow.getTime() + 3_600_000),
        now: blockerNow,
      }),
      true,
    );
    assert.equal(
      await queueOwnedMediaDeletion(dbContext, {
        ownerId,
        mediaObjectId: mediaId,
        reason: "ABANDONED_UPLOAD",
        now: new Date(blockerNow.getTime() + 60_000),
      }),
      true,
    );
  }

  const second = await processMediaDeletionOutbox(
    dbContext,
    verifiedStorage(),
    { now: new Date("2026-01-01T03:01:00.000Z"), limit: 2 },
  );
  assert.deepEqual(second, { completed: 2, failed: 0 });
  assert.equal(readMedia(sqlite, STUDENT_MEDIA_ID)?.state, "DELETED");
  assert.equal(finalizeAttempts, 2);
});

test("Q&A thread purge는 initial/reply 첨부를 모두 outbox에 남긴 뒤 aggregate만 삭제한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "student-1");
  seedProfile(sqlite, "admin-1", "admin");
  await createReadyMedia(dbContext, {
    id: STUDENT_MEDIA_ID,
    ownerId: "student-1",
    operationId: OPERATION_ONE,
    purpose: "QNA_ATTACHMENT",
  });
  await createReadyMedia(dbContext, {
    id: SECOND_MEDIA_ID,
    ownerId: "admin-1",
    operationId: OPERATION_TWO,
    purpose: "QNA_ATTACHMENT",
  });
  const created = await createQnaThreadAtomically(dbContext, {
    actor: { id: "student-1", isAdmin: false },
    threadId: "managed-thread",
    replyId: "question-reply",
    operationId: OPERATION_ONE,
    title: "첨부 질문",
    contentHtml: "<p>질문</p>",
    attachmentUrl: `/api/media/${STUDENT_MEDIA_ID}`,
    attachmentObjectId: STUDENT_MEDIA_ID,
    now: new Date("2026-01-01T00:02:00.000Z"),
  });
  assert.equal(created.ok, true);
  const answered = await createQnaReplyAtomically(dbContext, {
    actor: { id: "admin-1", isAdmin: true },
    threadId: "managed-thread",
    replyId: "answer-reply",
    operationId: OPERATION_TWO,
    contentHtml: "<p>답변</p>",
    attachmentUrl: `/api/media/${SECOND_MEDIA_ID}`,
    attachmentObjectId: SECOND_MEDIA_ID,
    now: new Date("2026-01-01T00:03:00.000Z"),
  });
  assert.equal(answered.ok, true);
  const trashed = await trashQnaThreadAtomically(dbContext, {
    actor: { id: "student-1", isAdmin: false },
    threadId: "managed-thread",
    operationId: OPERATION_THREE,
    baseRevision: 2,
    now: new Date("2026-01-02T00:00:00.000Z"),
  });
  assert.equal(trashed.ok, true);
  const purged = await purgeQnaThreadAtomically(dbContext, {
    actor: { id: "admin-1", isAdmin: true },
    threadId: "managed-thread",
    operationId: "20000000-0000-4000-8000-000000000004",
    baseRevision: 3,
    now: new Date("2026-02-03T00:00:00.000Z"),
  });
  assert.equal(purged.ok, true);
  assert.equal(
    scalarCount(sqlite, "SELECT count(*) AS count FROM qna_threads"),
    0,
  );
  assert.equal(
    scalarCount(sqlite, "SELECT count(*) AS count FROM qna_replies"),
    0,
  );
  assert.equal(
    scalarCount(sqlite, "SELECT count(*) AS count FROM media_deletion_outbox"),
    4,
  );
  assert.deepEqual(
    [readMedia(sqlite, STUDENT_MEDIA_ID)?.state, readMedia(sqlite, SECOND_MEDIA_ID)?.state],
    ["PENDING_DELETE", "PENDING_DELETE"],
  );
});

test("owner별 미귀속 object 수와 byte quota를 원자적으로 제한한다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  seedProfile(sqlite, "quota-count-owner");
  seedProfile(sqlite, "quota-bytes-owner");
  const now = new Date("2026-01-01T00:00:00.000Z");

  for (let index = 1; index <= 8; index += 1) {
    const id = `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    assert.equal(
      await createMediaUploadIntent(dbContext, {
        id,
        ownerId: "quota-count-owner",
        purpose: "COMMUNITY_POST_AUDIO",
        objectKey: createMediaObjectKey("COMMUNITY_POST_AUDIO", storageIdFor(id)),
        uploadObjectKey: createMediaUploadObjectKey("COMMUNITY_POST_AUDIO", id),
        expectedContentType: "audio/mpeg",
        expectedSizeBytes: 1_024,
        draftOperationId: `count-operation-${index}`,
        uploadExpiresAt: new Date(now.getTime() + 3_600_000),
        now,
      }),
      true,
    );
  }
  const overCountId = "40000000-0000-4000-8000-000000000009";
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: overCountId,
      ownerId: "quota-count-owner",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey: createMediaObjectKey(
        "COMMUNITY_POST_AUDIO",
        storageIdFor(overCountId),
      ),
      uploadObjectKey: createMediaUploadObjectKey(
        "COMMUNITY_POST_AUDIO",
        overCountId,
      ),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1_024,
      draftOperationId: "count-operation-9",
      uploadExpiresAt: new Date(now.getTime() + 3_600_000),
      now,
    }),
    false,
  );

  for (let index = 1; index <= 2; index += 1) {
    const id = `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    assert.equal(
      await createMediaUploadIntent(dbContext, {
        id,
        ownerId: "quota-bytes-owner",
        purpose: "COMMUNITY_POST_AUDIO",
        objectKey: createMediaObjectKey("COMMUNITY_POST_AUDIO", storageIdFor(id)),
        uploadObjectKey: createMediaUploadObjectKey("COMMUNITY_POST_AUDIO", id),
        expectedContentType: "audio/mpeg",
        expectedSizeBytes: 2 * 1024 * 1024 * 1024,
        draftOperationId: `bytes-operation-${index}`,
        uploadExpiresAt: new Date(now.getTime() + 3_600_000),
        now,
      }),
      true,
    );
  }
  const overBytesId = "50000000-0000-4000-8000-000000000003";
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id: overBytesId,
      ownerId: "quota-bytes-owner",
      purpose: "COMMUNITY_POST_AUDIO",
      objectKey: createMediaObjectKey(
        "COMMUNITY_POST_AUDIO",
        storageIdFor(overBytesId),
      ),
      uploadObjectKey: createMediaUploadObjectKey(
        "COMMUNITY_POST_AUDIO",
        overBytesId,
      ),
      expectedContentType: "audio/mpeg",
      expectedSizeBytes: 1,
      draftOperationId: "bytes-operation-3",
      uploadExpiresAt: new Date(now.getTime() + 3_600_000),
      now,
    }),
    false,
  );
});
