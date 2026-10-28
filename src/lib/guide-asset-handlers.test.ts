import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DbContext } from "@/db/client";
import * as schema from "@/db/schema";
import type { GuideAssetObjectStorage } from "@/lib/r2";
import {
  handleGuideAssetGet,
  handleGuideAssetUpload,
  type GuideAssetDeps,
  type GuideAssetSession,
} from "./guide-asset-handlers";

const ASSET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4, 5]);

function setup(context: TestContext, session: GuideAssetSession) {
  const sqlite = new Database(":memory:");
  context.after(() => sqlite.close());
  sqlite.pragma("foreign_keys = ON");
  const directory = join(process.cwd(), "drizzle");
  for (const file of readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
    sqlite.exec(readFileSync(join(directory, file), "utf8"));
  }
  sqlite.prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, ?)").run("admin-1", "a@example.com", "admin");
  sqlite.prepare("INSERT INTO profiles (id, email, role) VALUES (?, ?, ?)").run("student-1", "s@example.com", "student");
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const storage: GuideAssetObjectStorage = {
    async put(objectKey, bytes, contentType) {
      objects.set(objectKey, { bytes, contentType });
    },
    async delete(objectKey) {
      objects.delete(objectKey);
    },
    async get(objectKey) {
      const object = objects.get(objectKey);
      if (!object) return null;
      return { body: new Response(object.bytes.slice()).body!, size: object.bytes.byteLength, contentType: object.contentType };
    },
  };
  const state = { session };
  const dbContext: DbContext = { kind: "local", db: drizzle(sqlite, { schema }) as never };
  const deps: GuideAssetDeps = {
    getSession: async () => state.session,
    getContext: () => dbContext,
    getStorage: async () => storage,
    createId: () => ASSET_ID,
  };
  return { sqlite, objects, deps, state };
}

function uploadRequest(body: Uint8Array, headers: Record<string, string> = {}) {
  return new Request("https://portal.test/api/guide-assets", {
    method: "POST",
    body: body.slice(),
    headers: {
      "content-type": "image/png",
      "content-length": String(body.byteLength),
      origin: "https://portal.test",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  });
}

const admin: GuideAssetSession = { user: { id: "admin-1", role: "admin" } };
const student: GuideAssetSession = { user: { id: "student-1", role: "student" } };

test("가이드 이미지 업로드는 관리자만 하고 비로그인은 401, 학생은 403이다", async (context) => {
  const { deps, state, objects } = setup(context, null);
  assert.equal((await handleGuideAssetUpload(uploadRequest(PNG), deps)).status, 401);
  state.session = student;
  assert.equal((await handleGuideAssetUpload(uploadRequest(PNG), deps)).status, 403);
  assert.equal(objects.size, 0);
});

test("관리자 업로드는 실제 형식을 확인해 guide/<id>에 저장하고 행을 남긴다", async (context) => {
  const { deps, sqlite, objects } = setup(context, admin);
  const response = await handleGuideAssetUpload(uploadRequest(PNG), deps);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: ASSET_ID, url: `/api/guide-assets/${ASSET_ID}`, contentType: "image/png" });
  assert.equal(objects.get(`guide/${ASSET_ID}`)?.contentType, "image/png");
  assert.deepEqual(
    sqlite.prepare("SELECT object_key, content_type, size_bytes, guide_page_id, uploaded_by_id FROM guide_assets").all(),
    [{ object_key: `guide/${ASSET_ID}`, content_type: "image/png", size_bytes: PNG.byteLength, guide_page_id: null, uploaded_by_id: "admin-1" }],
  );
});

test("다른 출처·형식 위장·SVG·크기 초과 업로드를 거부한다", async (context) => {
  const { deps, objects } = setup(context, admin);
  assert.equal((await handleGuideAssetUpload(uploadRequest(PNG, { origin: "https://evil.test", "sec-fetch-site": "cross-site" }), deps)).status, 403);
  assert.equal((await handleGuideAssetUpload(uploadRequest(PNG, { "content-type": "image/jpeg" }), deps)).status, 415);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await handleGuideAssetUpload(uploadRequest(svg, { "content-type": "image/svg+xml" }), deps)).status, 415);
  assert.equal((await handleGuideAssetUpload(uploadRequest(PNG, { "content-length": String(10 * 1024 * 1024 + 1) }), deps)).status, 413);
  assert.equal(objects.size, 0);
});

test("가이드 이미지 열람은 로그인이 필요하고 private cache·nosniff로 보낸다", async (context) => {
  const { deps, state } = setup(context, admin);
  assert.equal((await handleGuideAssetUpload(uploadRequest(PNG), deps)).status, 201);

  state.session = null;
  assert.equal((await handleGuideAssetGet(ASSET_ID, deps)).status, 401);

  state.session = student;
  const response = await handleGuideAssetGet(ASSET_ID, deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control") ?? "", /^private\b/u);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);

  assert.equal((await handleGuideAssetGet("7c9e6679-7425-40de-944b-e07fc1f90ae7", deps)).status, 404);
  assert.equal((await handleGuideAssetGet("../media/x", deps)).status, 404);
});

test("R2 저장 뒤 DB 기록이 실패하면 올린 객체를 지운다", async (context) => {
  const { deps, sqlite, objects } = setup(context, admin);
  sqlite.prepare("INSERT INTO guide_assets (id, object_key, content_type, size_bytes) VALUES (?, ?, 'image/png', 1)").run(ASSET_ID, `guide/${ASSET_ID}`);
  objects.clear();
  const response = await handleGuideAssetUpload(uploadRequest(PNG), deps);
  assert.equal(response.status, 502);
  assert.equal(objects.has(`guide/${ASSET_ID}`), false);
});
