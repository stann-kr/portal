import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import type { AuthSession } from "@/lib/auth-guard";
import { mediaObjects, posts, profiles } from "@/db/schema";
import { AUDIO_PEAKS_COUNT, AUDIO_PEAKS_MAX_BYTES, type AudioPeaks } from "@/lib/audio/peaks";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession: AuthSession | null = null;
const stored = new Map<string, string>();
const putCalls: string[] = [];
let route: typeof import("@/app/api/media/[mediaObjectId]/peaks/route");

mock.module("@/lib/auth-guard", {
  namedExports: { getActiveAuthSession: async () => activeSession },
});
mock.module("@/db/client", {
  namedExports: {
    createDb: () => {
      if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
      return activeDb;
    },
  },
});
mock.module("@/lib/r2", {
  namedExports: {
    getAudioPeaksStorage: async () => ({
      async get(audioObjectKey: string) {
        return stored.get(`${audioObjectKey}.peaks.json`) ?? null;
      },
      async putIfAbsent(audioObjectKey: string, json: string) {
        const key = `${audioObjectKey}.peaks.json`;
        putCalls.push(key);
        if (stored.has(key)) return false;
        stored.set(key, json);
        return true;
      },
    }),
  },
});

before(async () => {
  route = await import("@/app/api/media/[mediaObjectId]/peaks/route");
});
after(() => mock.restoreAll());

const READY_ID = "20000000-0000-4000-8000-000000000001";
const ATTACHED_ID = "20000000-0000-4000-8000-000000000011";
const IMAGE_ID = "20000000-0000-4000-8000-000000000021";
const DELETED_POST_AUDIO_ID = "20000000-0000-4000-8000-000000000031";

function session(id: string, role: "admin" | "student" = "student"): AuthSession {
  return { expires: "2099-01-01T00:00:00.000Z", user: { id, role, name: id, email: `${id}@example.com`, image: null } };
}

function samplePeaks(duration = 3500, value = 0.5): AudioPeaks {
  return { version: 1, duration, peaks: Array.from({ length: AUDIO_PEAKS_COUNT }, () => value) };
}

async function setup(context: TestContext) {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  stored.clear();
  putCalls.length = 0;
  context.after(async () => {
    activeDb = null;
    activeSession = null;
    await isolated.dispose();
  });
  const db = isolated.db;
  // 수명주기 전이(PENDING_UPLOAD→SEALING→READY→ATTACHED)는 media 수명주기 테스트가 지킨다.
  // 이 테스트는 읽기 권한만 보므로 최종 상태 행을 바로 넣도록 이 격리 DB에서만 첫 상태 trigger를 뺀다.
  await isolated.binding.prepare("DROP TRIGGER IF EXISTS `media_objects_before_insert_guard`").run();
  await db.insert(profiles).values([
    { id: "owner", email: "owner@example.com", displayName: "김학생", role: "student" },
    { id: "other", email: "other@example.com", displayName: "이학생", role: "student" },
    { id: "admin", email: "admin@example.com", displayName: "Stann", role: "admin" },
  ]);
  const now = new Date("2026-11-01T00:00:00.000Z");
  const base = {
    ownerId: "owner",
    expectedSizeBytes: 84_000_000,
    actualSizeBytes: 84_000_000,
    etag: "etag",
    uploadExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    readyAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const audio = (id: string, storageSuffix: string) => ({
    ...base,
    id,
    purpose: "COMMUNITY_POST_AUDIO" as const,
    objectKey: `media/community-post-audio/20000000-0000-4000-8000-0000000000${storageSuffix}`,
    uploadObjectKey: `media-upload/community-post-audio/${id}`,
    expectedContentType: "audio/mpeg",
    draftOperationId: `${id}-op`,
  });
  await db.insert(mediaObjects).values([
    { ...audio(READY_ID, "02"), state: "READY" },
    { ...audio(ATTACHED_ID, "12"), state: "ATTACHED", resourceType: "COMMUNITY_POST", resourceId: "post-live", attachedAt: now },
    { ...audio(DELETED_POST_AUDIO_ID, "32"), state: "ATTACHED", resourceType: "COMMUNITY_POST", resourceId: "post-deleted", attachedAt: now },
    {
      ...base,
      id: IMAGE_ID,
      purpose: "DOCUMENT_IMAGE" as const,
      state: "READY",
      objectKey: "media/document-image/20000000-0000-4000-8000-000000000022",
      uploadObjectKey: `media-upload/document-image/${IMAGE_ID}`,
      expectedContentType: "image/png",
      draftOperationId: `${IMAGE_ID}-op`,
    },
  ]);
  await db.insert(posts).values([
    { id: "post-live", authorId: "owner", category: "FEEDBACK", boardType: "FEEDBACK", title: "셋", contentHtml: "<p>셋</p>", mediaUrl: `/api/media/${ATTACHED_ID}`, mediaObjectId: ATTACHED_ID },
    { id: "post-deleted", authorId: "owner", category: "FEEDBACK", boardType: "FEEDBACK", title: "지운 셋", contentHtml: "<p>셋</p>", mediaUrl: `/api/media/${DELETED_POST_AUDIO_ID}`, mediaObjectId: DELETED_POST_AUDIO_ID, deletedAt: now },
  ]);
}

function context(id: string) {
  return { params: Promise.resolve({ mediaObjectId: id }) };
}

function put(id: string, body: string) {
  return route.PUT(new Request(`https://portal.test/api/media/${id}/peaks`, { method: "PUT", body, headers: { "Content-Type": "application/json" } }), context(id));
}

function get(id: string) {
  return route.GET(new Request(`https://portal.test/api/media/${id}/peaks`), context(id));
}

test("로그인하지 않으면 파형을 읽거나 쓸 수 없다(401)", async (t) => {
  await setup(t);
  activeSession = null;
  assert.equal((await get(READY_ID)).status, 401);
  assert.equal((await put(READY_ID, JSON.stringify(samplePeaks()))).status, 401);
  assert.equal(putCalls.length, 0);
});

test("오디오를 읽을 수 없는 사람·오디오가 아닌 매체·잘못된 ID는 존재를 숨긴 404다", async (t) => {
  await setup(t);
  activeSession = session("other");
  assert.equal((await put(READY_ID, JSON.stringify(samplePeaks()))).status, 404, "아직 붙지 않은 남의 업로드");
  assert.equal((await put(DELETED_POST_AUDIO_ID, JSON.stringify(samplePeaks()))).status, 404, "휴지통 게시물의 오디오");
  activeSession = session("owner");
  assert.equal((await put(IMAGE_ID, JSON.stringify(samplePeaks()))).status, 404, "이미지 매체에는 파형을 두지 않는다");
  assert.equal((await get("not-a-uuid")).status, 404);
  assert.equal(putCalls.length, 0, "권한이 없으면 저장소에 쓰지 않는다");
});

test("형식이 틀리거나 너무 큰 파형은 400·413으로 거절한다", async (t) => {
  await setup(t);
  activeSession = session("owner");
  assert.equal((await put(READY_ID, "{not json")).status, 400);
  assert.equal((await put(READY_ID, JSON.stringify({ ...samplePeaks(), peaks: [0.1, 0.2] }))).status, 400);
  assert.equal((await put(READY_ID, JSON.stringify({ ...samplePeaks(), duration: -1 }))).status, 400);
  assert.equal((await put(READY_ID, JSON.stringify(samplePeaks()).padEnd(AUDIO_PEAKS_MAX_BYTES + 10, " "))).status, 413);
  assert.equal(putCalls.length, 0);
});

test("길이가 파일 크기와 맞지 않는 파형(평균 10,000kbps 초과 등)은 400으로 거절한다", async (t) => {
  await setup(t);
  activeSession = session("other");
  // 파일은 84MB(3500초 × 192kbps). 1초·30초 길이는 이 파일의 파형일 수 없다(평균 22,400kbps 이상).
  assert.equal((await put(ATTACHED_ID, JSON.stringify(samplePeaks(1, 0.9)))).status, 400);
  assert.equal((await put(ATTACHED_ID, JSON.stringify(samplePeaks(30, 0.9)))).status, 400);
  assert.equal(putCalls.length, 0);
  assert.equal(stored.size, 0);
});

test("오디오를 읽을 수 있는 다른 학생도 아직 없는 파형을 처음 저장하고, 다른 사람이 모두 불러온다", async (t) => {
  await setup(t);
  activeSession = session("other");
  assert.equal((await get(ATTACHED_ID)).status, 404, "아직 파형이 없다");
  const saved = await put(ATTACHED_ID, JSON.stringify(samplePeaks(3500, 0.25)));
  assert.equal(saved.status, 201);
  assert.deepEqual(await saved.json(), { saved: true });

  // 처음 쓴 값이 이긴다: 그 뒤 소유자의 쓰기는 덮지 않는다(POST도 같다).
  activeSession = session("owner");
  const ownerPost = await route.POST(new Request(`https://portal.test/api/media/${ATTACHED_ID}/peaks`, { method: "POST", body: JSON.stringify(samplePeaks(3400, 0.9)) }), context(ATTACHED_ID));
  assert.equal(ownerPost.status, 200);
  assert.deepEqual(await ownerPost.json(), { saved: false });

  for (const reader of [session("owner"), session("other"), session("admin", "admin")]) {
    activeSession = reader;
    const loaded = await get(ATTACHED_ID);
    assert.equal(loaded.status, 200, `${reader.user.id}가 서버 파형을 불러온다`);
    assert.equal(((await loaded.json()) as AudioPeaks).peaks[0], 0.25);
  }
});

test("소유자가 처음 쓴 파형만 남고 관리자의 두 번째 쓰기는 덮지 않는다", async (t) => {
  await setup(t);
  activeSession = session("owner");
  const first = await put(ATTACHED_ID, JSON.stringify(samplePeaks(3500, 0.25)));
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { saved: true });

  activeSession = session("admin", "admin");
  const second = await route.POST(new Request(`https://portal.test/api/media/${ATTACHED_ID}/peaks`, { method: "POST", body: JSON.stringify(samplePeaks(3400, 0.9)) }), context(ATTACHED_ID));
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { saved: false });

  const loaded = await get(ATTACHED_ID);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.headers.get("Cache-Control"), "private, no-store");
  const body = (await loaded.json()) as AudioPeaks;
  assert.equal(body.duration, 3500, "처음 값이 그대로다");
  assert.equal(body.peaks[0], 0.25);
  assert.deepEqual(putCalls, [
    "media/community-post-audio/20000000-0000-4000-8000-000000000012.peaks.json",
    "media/community-post-audio/20000000-0000-4000-8000-000000000012.peaks.json",
  ], "오디오 key 옆에 저장한다");
});

test("관리자는 소유자가 아니어도 파형을 처음 저장할 수 있다(201)", async (t) => {
  await setup(t);
  activeSession = session("admin", "admin");
  const saved = await put(ATTACHED_ID, JSON.stringify(samplePeaks()));
  assert.equal(saved.status, 201);
  assert.deepEqual(await saved.json(), { saved: true });
  activeSession = session("owner");
  assert.equal((await get(ATTACHED_ID)).status, 200);
});

test("올린 사람은 붙이기 전(READY)에도 파형을 저장할 수 있다", async (t) => {
  await setup(t);
  activeSession = session("owner");
  assert.equal((await put(READY_ID, JSON.stringify(samplePeaks()))).status, 201);
  assert.equal((await get(READY_ID)).status, 200);
});
