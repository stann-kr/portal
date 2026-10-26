import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import { canAccessMediaDelivery } from "./media-delivery";
import {
  completeMediaUpload,
  createMediaUploadIntent,
} from "./media-lifecycle-atomic";
import {
  createMediaObjectKey,
  createMediaUploadObjectKey,
  extractDocumentImageMediaIds,
} from "./media-lifecycle";
import {
  evaluateMediaUploadRequest,
  sniffImageMimeType,
  type MediaUploadRequestHeaders,
} from "./media-upload-request";
import { createPostAtomically, purgePostAtomically, trashPostAtomically } from "./post-atomic";
import {
  createPrivateNoteAtomically,
  purgePrivateNoteAtomically,
  trashPrivateNoteAtomically,
  updatePrivateNoteAtomically,
} from "./private-note-atomic";
import { PRIVATE_NOTE_TRASH_RETENTION_SECONDS } from "./private-note-continuity";
import type { MediaObjectStorage } from "./r2";

type LocalDbContext = Extract<DbContext, { kind: "local" }>;

const NOW = new Date("2026-01-01T00:00:00.000Z");
const STUDENT = "image-student";
const ADMIN = "image-admin";
const OTHER = "image-other";

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
  for (const [id, role] of [
    [STUDENT, "student"],
    [ADMIN, "admin"],
    [OTHER, "student"],
  ] as const) {
    sqlite
      .prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, ?)")
      .run(id, `${id}@example.com`, role);
  }
  return { sqlite, dbContext: { kind: "local", db: drizzle(sqlite, { schema }) } };
}

const imageStorage: MediaObjectStorage = {
  async putUpload() {
    return true;
  },
  async head() {
    return { size: 2_048, contentType: "image/png", etag: "image-etag" };
  },
  async seal(_uploadObjectKey, _finalObjectKey, source) {
    return source;
  },
  async delete() {},
};

function operationId(value: number): string {
  return `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

async function createReadyImage(
  dbContext: LocalDbContext,
  id: string,
  ownerId: string,
): Promise<void> {
  assert.equal(
    await createMediaUploadIntent(dbContext, {
      id,
      ownerId,
      purpose: "DOCUMENT_IMAGE",
      objectKey: createMediaObjectKey("DOCUMENT_IMAGE", `${id[0]}f${id.slice(2)}`),
      uploadObjectKey: createMediaUploadObjectKey("DOCUMENT_IMAGE", id),
      expectedContentType: "image/png",
      expectedSizeBytes: 2_048,
      draftOperationId: operationId(90),
      uploadExpiresAt: new Date(NOW.getTime() + 3_600_000),
      now: NOW,
    }),
    true,
  );
  const completed = await completeMediaUpload(dbContext, imageStorage, {
    ownerId,
    mediaObjectId: id,
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(completed.ok, true);
}

function mediaRow(sqlite: SqliteDatabase, id: string) {
  return sqlite
    .prepare<[string], { state: string; resource_type: string | null; resource_id: string | null }>(
      "SELECT state, resource_type, resource_id FROM media_objects WHERE id = ?",
    )
    .get(id);
}

function imageHtml(...ids: string[]): string {
  return ids.map((id) => `<p><img src="/api/media/${id}" alt=""></p>`).join("");
}

test("본문 HTML에서 관리 이미지 ID만 중복 없이 꺼낸다", () => {
  const first = "30000000-0000-4000-8000-000000000001";
  const second = "30000000-0000-4000-8000-000000000002";
  assert.deepEqual(
    extractDocumentImageMediaIds(
      `${imageHtml(first, second, first)}<img src="https://example.com/a.png">` +
        `<a href="/api/media/30000000-0000-4000-8000-000000000003">link</a>` +
        `<img alt="x" src="/api/media/not-a-uuid">`,
    ),
    [first, second],
  );
});

test("노트 저장은 저장자 소유 READY 이미지만 노트에 연결하고 영구 삭제 때 함께 지운다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  const ownImage = "30000000-0000-4000-8000-000000000011";
  const laterImage = "30000000-0000-4000-8000-000000000012";
  const othersImage = "30000000-0000-4000-8000-000000000013";
  await createReadyImage(dbContext, ownImage, STUDENT);
  await createReadyImage(dbContext, laterImage, ADMIN);
  await createReadyImage(dbContext, othersImage, OTHER);
  const noteId = "note-with-image";
  const writeTime = new Date(NOW.getTime() + 5_000);

  const created = await createPrivateNoteAtomically(dbContext, {
    actor: { id: STUDENT, isAdmin: false },
    subjectId: STUDENT,
    noteId,
    operationId: operationId(1),
    title: "이미지 노트",
    contentHtml: imageHtml(ownImage, othersImage),
    noteDate: null,
    now: writeTime,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.deepEqual(mediaRow(sqlite, ownImage), {
    state: "ATTACHED",
    resource_type: "PRIVATE_NOTE",
    resource_id: noteId,
  });
  // 다른 사용자의 이미지는 본문에 붙여 넣어도 이 노트로 가져오지 않는다.
  assert.deepEqual(mediaRow(sqlite, othersImage), {
    state: "READY",
    resource_type: null,
    resource_id: null,
  });

  // 관리자가 학생 노트를 고치며 넣은 이미지는 관리자 소유로 같은 노트에 연결된다.
  const updated = await updatePrivateNoteAtomically(dbContext, {
    actor: { id: ADMIN, isAdmin: true },
    noteId,
    operationId: operationId(2),
    baseRevision: 1,
    title: "이미지 노트",
    contentHtml: imageHtml(ownImage, laterImage),
    noteDate: null,
    now: new Date(writeTime.getTime() + 1_000),
  });
  assert.equal(updated.ok, true, JSON.stringify(updated));
  assert.equal(mediaRow(sqlite, laterImage)?.resource_id, noteId);

  assert.throws(
    () => sqlite.prepare("DELETE FROM private_notes WHERE id = ?").run(noteId),
    /PRIVATE_NOTE_MEDIA_DELETE_NOT_QUEUED/u,
  );

  const trashed = await trashPrivateNoteAtomically(dbContext, {
    actor: { id: STUDENT, isAdmin: false },
    noteId,
    operationId: operationId(3),
    baseRevision: 2,
    now: new Date(writeTime.getTime() + 2_000),
  });
  assert.equal(trashed.ok, true, JSON.stringify(trashed));
  const purgeTime = new Date(
    writeTime.getTime() + (PRIVATE_NOTE_TRASH_RETENTION_SECONDS + 10) * 1_000,
  );
  const purged = await purgePrivateNoteAtomically(dbContext, {
    actor: { id: ADMIN, isAdmin: true },
    noteId,
    operationId: operationId(4),
    baseRevision: 3,
    now: purgeTime,
  });
  assert.equal(purged.ok, true, JSON.stringify(purged));
  for (const id of [ownImage, laterImage]) {
    assert.equal(mediaRow(sqlite, id)?.state, "PENDING_DELETE");
  }
  assert.equal(
    sqlite
      .prepare<[], { value: number }>(
        "SELECT count(*) AS value FROM media_deletion_outbox WHERE reason = 'RESOURCE_PURGED'",
      )
      .get()?.value,
    2,
  );
});

test("글 본문 이미지는 글에 연결되고 글 영구 삭제 때 함께 지운다", async (context) => {
  const { sqlite, dbContext } = setupDatabase(context);
  const image = "30000000-0000-4000-8000-000000000021";
  await createReadyImage(dbContext, image, STUDENT);
  const created = await createPostAtomically(dbContext, {
    actor: { id: STUDENT, isAdmin: false },
    postId: "post-with-image",
    operationId: operationId(11),
    snapshot: {
      category: "general",
      boardType: "GENERAL",
      isPinned: false,
      mediaUrl: null,
      mediaObjectId: null,
      title: "이미지 글",
      contentHtml: imageHtml(image),
    },
    now: new Date(NOW.getTime() + 5_000),
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.deepEqual(mediaRow(sqlite, image), {
    state: "ATTACHED",
    resource_type: "COMMUNITY_POST",
    resource_id: "post-with-image",
  });

  const trashTime = new Date(NOW.getTime() + 6_000);
  const trashed = await trashPostAtomically(dbContext, {
    actor: { id: STUDENT, isAdmin: false },
    postId: "post-with-image",
    operationId: operationId(12),
    baseRevision: 1,
    now: trashTime,
  });
  assert.equal(trashed.ok, true, JSON.stringify(trashed));
  const purged = await purgePostAtomically(dbContext, {
    actor: { id: ADMIN, isAdmin: true },
    postId: "post-with-image",
    operationId: operationId(13),
    baseRevision: 2,
    now: new Date(trashTime.getTime() + 31 * 24 * 60 * 60 * 1_000),
  });
  assert.equal(purged.ok, true, JSON.stringify(purged));
  assert.equal(mediaRow(sqlite, image)?.state, "PENDING_DELETE");
});

test("본문 이미지는 연결된 문서를 볼 수 있는 사람에게만 전달된다", () => {
  const student = { id: STUDENT, role: "student" };
  const admin = { id: ADMIN, role: "admin" };
  const other = { id: OTHER, role: "student" };
  const attached = (resourceType: "PRIVATE_NOTE" | "QNA_REPLY" | "COMMUNITY_POST") => ({
    ownerId: ADMIN,
    purpose: "DOCUMENT_IMAGE" as const,
    state: "ATTACHED" as const,
    resourceType,
  });

  const note = { kind: "PRIVATE_NOTE" as const, studentId: STUDENT };
  assert.equal(canAccessMediaDelivery(student, attached("PRIVATE_NOTE"), note), true);
  assert.equal(canAccessMediaDelivery(admin, attached("PRIVATE_NOTE"), note), true);
  assert.equal(canAccessMediaDelivery(other, attached("PRIVATE_NOTE"), note), false);
  assert.equal(canAccessMediaDelivery(student, attached("PRIVATE_NOTE"), null), false);

  const reply = { kind: "QNA_REPLY" as const, studentId: STUDENT };
  assert.equal(canAccessMediaDelivery(student, attached("QNA_REPLY"), reply), true);
  assert.equal(canAccessMediaDelivery(other, attached("QNA_REPLY"), reply), false);
  // resource 종류가 media 귀속과 다르면 열지 않는다.
  assert.equal(canAccessMediaDelivery(student, attached("PRIVATE_NOTE"), reply), false);

  const livePost = { kind: "COMMUNITY_POST" as const, authorId: STUDENT, deleted: false };
  const deletedPost = { ...livePost, deleted: true };
  assert.equal(canAccessMediaDelivery(other, attached("COMMUNITY_POST"), livePost), true);
  assert.equal(canAccessMediaDelivery(other, attached("COMMUNITY_POST"), deletedPost), false);
  assert.equal(canAccessMediaDelivery(student, attached("COMMUNITY_POST"), deletedPost), true);

  const ready = { ...attached("PRIVATE_NOTE"), state: "READY" as const, resourceType: null };
  assert.equal(canAccessMediaDelivery(admin, ready, null), true);
  assert.equal(canAccessMediaDelivery(student, ready, null), false);
});

test("Worker 업로드 요청은 same-origin, 대기 상태, 형식과 정확한 크기를 요구한다", () => {
  const target = {
    purpose: "DOCUMENT_IMAGE",
    state: "PENDING_UPLOAD",
    expectedContentType: "image/png",
    expectedSizeBytes: 2_048,
    uploadExpiresAt: new Date(NOW.getTime() + 60_000),
  };
  const headers: MediaUploadRequestHeaders = {
    contentType: "image/png",
    contentLength: "2048",
    origin: "https://portal.example",
    secFetchSite: "same-origin",
  };
  const evaluate = (
    overrides: Partial<MediaUploadRequestHeaders> = {},
    targetOverrides: Partial<typeof target> | null = {},
  ) =>
    evaluateMediaUploadRequest({
      target: targetOverrides === null ? null : { ...target, ...targetOverrides },
      headers: { ...headers, ...overrides },
      requestOrigin: "https://portal.example",
      now: NOW,
    });

  assert.deepEqual(evaluate(), { ok: true, sniffImage: true });
  assert.deepEqual(evaluate({ origin: "https://evil.example" }), { ok: false, status: 403 });
  assert.deepEqual(evaluate({ secFetchSite: "cross-site" }), { ok: false, status: 403 });
  assert.deepEqual(evaluate({}, null), { ok: false, status: 404 });
  assert.deepEqual(evaluate({}, { state: "READY" }), { ok: false, status: 409 });
  assert.deepEqual(evaluate({}, { uploadExpiresAt: NOW }), { ok: false, status: 410 });
  assert.deepEqual(evaluate({ contentType: "image/svg+xml" }), { ok: false, status: 415 });
  assert.deepEqual(evaluate({ contentLength: null }), { ok: false, status: 411 });
  assert.deepEqual(evaluate({ contentLength: "4096" }), { ok: false, status: 413 });
  assert.deepEqual(evaluate({ contentLength: "1x" }), { ok: false, status: 400 });
  assert.deepEqual(
    evaluate({ contentType: "audio/mpeg" }, { expectedContentType: "audio/mpeg" }),
    { ok: true, sniffImage: false },
  );
});

test("이미지 형식은 첫 bytes로 확인하고 SVG·임의 데이터는 거부한다", () => {
  assert.equal(
    sniffImageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    "image/png",
  );
  assert.equal(sniffImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageMimeType(new TextEncoder().encode("GIF89a....")), "image/gif");
  assert.equal(sniffImageMimeType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageMimeType(new TextEncoder().encode("<svg xmlns='x'/>")), null);
  assert.equal(sniffImageMimeType(new Uint8Array([0x89, 0x50])), null);
});
