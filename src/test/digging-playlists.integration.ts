import assert from "node:assert/strict";
import { after, before, mock, test, type TestContext } from "node:test";
import { asc, eq } from "drizzle-orm";
import type { AuthSession } from "@/lib/auth-guard";
import { diggingPlaylists, profiles } from "@/db/schema";
import { createIsolatedPortalD1, type IsolatedPortalD1 } from "@/test/isolated-d1";

type PortalTestDb = IsolatedPortalD1["db"];

let activeDb: PortalTestDb | null = null;
let activeSession = createSession("student-1", "student");
let playlistActions: typeof import("@/lib/actions/digging-playlists");
let soundCloudTitleCalls: string[] = [];
let soundCloudTitle: string | null = "Warmup Picks";

function createSession(id: string, role: "admin" | "student"): AuthSession {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: { id, role, name: id, email: `${id}@example.com`, image: null },
  };
}

function requireActiveDb(): PortalTestDb {
  if (!activeDb) throw new Error("격리 D1 테스트 DB가 준비되지 않았습니다.");
  return activeDb;
}

mock.module("@/auth", {
  namedExports: { auth: async () => activeSession, signIn: async () => "/dashboard" },
});
mock.module("@/db/client", {
  namedExports: {
    createDb: () => requireActiveDb(),
    createDbContext: () => ({ kind: "d1", db: requireActiveDb() }),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
// 외부 SoundCloud 요청 대신 호출 기록만 남긴다. Beatport 등록은 이 함수를 부르지 않아야 한다.
mock.module("@/lib/digging-link-metadata", {
  namedExports: {
    fetchSoundCloudPlaylistTitle: async (url: string) => {
      soundCloudTitleCalls.push(url);
      return soundCloudTitle;
    },
    fetchDiggingLinkMetadata: async () => ({}),
  },
});

const realFetch = globalThis.fetch;
before(async () => {
  // 혹시라도 실제 외부 요청이 나가면 테스트를 실패시킨다.
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`테스트 중 외부 요청 금지: ${String(input)}`);
  }) as typeof fetch;
  playlistActions = await import("@/lib/actions/digging-playlists");
});

after(() => {
  globalThis.fetch = realFetch;
  mock.restoreAll();
});

async function setupDatabase(context: TestContext, session: AuthSession): Promise<PortalTestDb> {
  const isolated = await createIsolatedPortalD1();
  activeDb = isolated.db;
  activeSession = session;
  soundCloudTitleCalls = [];
  soundCloudTitle = "Warmup Picks";
  context.after(async () => {
    activeDb = null;
    await isolated.dispose();
  });
  await isolated.db.insert(profiles).values([
    { id: "student-1", email: "student-1@example.com", displayName: "student-1", role: "student" },
    { id: "student-2", email: "student-2@example.com", displayName: "student-2", role: "student" },
    { id: "admin-1", email: "admin-1@example.com", displayName: "admin-1", role: "admin" },
  ]);
  return isolated.db;
}

async function readPlaylists(db: PortalTestDb) {
  return db.select().from(diggingPlaylists).orderBy(asc(diggingPlaylists.id));
}

test("학생은 Beatport를 외부 요청 없이 정규화해 등록하고 SoundCloud는 빈 제목을 oEmbed로 채운다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));

  const beatport = await playlistActions.createDiggingPlaylist({
    url: " https://beatport.com/playlists/share/11018932/?utm_source=share ",
    title: "  ",
    note: " 오프닝 후보 ",
  });
  assert.ok(beatport.ok, JSON.stringify(beatport));
  assert.equal(beatport.playlist.provider, "beatport");
  assert.equal(beatport.playlist.url, "https://www.beatport.com/playlists/share/11018932");
  assert.equal(beatport.playlist.title, null);
  assert.equal(beatport.playlist.note, "오프닝 후보");
  assert.deepEqual(soundCloudTitleCalls, []);

  const soundcloud = await playlistActions.createDiggingPlaylist({
    url: "https://m.soundcloud.com/stann/sets/warmup?si=abc",
  });
  assert.ok(soundcloud.ok, JSON.stringify(soundcloud));
  assert.equal(soundcloud.playlist.url, "https://soundcloud.com/stann/sets/warmup");
  assert.equal(soundcloud.playlist.title, "Warmup Picks");
  assert.deepEqual(soundCloudTitleCalls, ["https://soundcloud.com/stann/sets/warmup"]);

  // 사용자가 제목을 적으면 oEmbed를 부르지 않는다. oEmbed가 실패해도 등록은 성공한다.
  const titled = await playlistActions.createDiggingPlaylist({
    url: "https://soundcloud.com/stann/sets/closing",
    title: "마감 세트",
  });
  assert.ok(titled.ok && titled.playlist.title === "마감 세트");
  soundCloudTitle = null;
  const untitled = await playlistActions.createDiggingPlaylist({
    url: "https://soundcloud.com/stann/sets/private/s-AbC123",
  });
  assert.ok(untitled.ok && untitled.playlist.title === null);
  assert.equal(untitled.ok && untitled.playlist.url, "https://soundcloud.com/stann/sets/private/s-AbC123");
  assert.equal(soundCloudTitleCalls.length, 2);

  const rows = await readPlaylists(db);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.userId === "student-1"));
  const listed = await playlistActions.getDiggingPlaylists("student-1");
  assert.equal(listed.length, 4);
});

test("중복·잘못된 링크·길이 초과는 결과 오류로 돌려주고 DB를 바꾸지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const created = await playlistActions.createDiggingPlaylist({ url: "https://www.beatport.com/playlists/share/11018932" });
  assert.ok(created.ok);
  const before = await readPlaylists(db);

  const duplicate = await playlistActions.createDiggingPlaylist({ url: "https://beatport.com/playlists/share/11018932/#x" });
  assert.deepEqual(duplicate, { ok: false, error: "이미 등록한 플레이리스트입니다." });
  for (const url of [
    "http://www.beatport.com/playlists/share/1",
    "https://on.soundcloud.com/AbCdE",
    "https://soundcloud.com/stann/some-track",
    "https://www.beatport.com:444/playlists/share/1",
    "https://user:pass@soundcloud.com/stann/sets/warmup",
    "https://example.com/playlists/share/1",
  ]) {
    const result = await playlistActions.createDiggingPlaylist({ url });
    assert.equal(result.ok, false, url);
  }
  const longTitle = await playlistActions.createDiggingPlaylist({
    url: "https://www.beatport.com/playlists/share/2",
    title: "가".repeat(201),
  });
  assert.equal(longTitle.ok, false);
  assert.deepEqual(await readPlaylists(db), before);
  assert.deepEqual(soundCloudTitleCalls, []);
});

test("학생은 자기 플레이리스트만 고치고 지우며 다른 학생 행은 그대로 남는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const own = await playlistActions.createDiggingPlaylist({ url: "https://www.beatport.com/playlists/share/1", title: "내 목록" });
  assert.ok(own.ok);
  activeSession = createSession("student-2", "student");
  const others = await playlistActions.createDiggingPlaylist({ url: "https://www.beatport.com/playlists/share/1", title: "남의 목록", note: "메모" });
  assert.ok(others.ok, "다른 학생은 같은 링크를 따로 등록할 수 있다");
  const othersBefore = (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, others.playlist.id)))[0];

  activeSession = createSession("student-1", "student");
  assert.equal((await playlistActions.updateDiggingPlaylist(others.playlist.id, { title: "탈취", note: null })).ok, false);
  assert.equal((await playlistActions.deleteDiggingPlaylist(others.playlist.id)).ok, false);
  assert.deepEqual(
    (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, others.playlist.id)))[0],
    othersBefore,
  );

  const updated = await playlistActions.updateDiggingPlaylist(own.playlist.id, { title: "  ", note: " 새 메모 " });
  assert.ok(updated.ok);
  assert.equal(updated.playlist.title, null);
  assert.equal(updated.playlist.note, "새 메모");
  const stored = (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, own.playlist.id)))[0];
  assert.equal(stored?.title, null);
  assert.equal(stored?.note, "새 메모");
  assert.equal(stored?.url, "https://www.beatport.com/playlists/share/1");
  assert.ok(stored && stored.updatedAt.getTime() >= stored.createdAt.getTime());

  assert.deepEqual(await playlistActions.deleteDiggingPlaylist(own.playlist.id), { ok: true });
  assert.deepEqual((await readPlaylists(db)).map((row) => row.id), [others.playlist.id]);

  await assert.rejects(playlistActions.getDiggingPlaylists("student-2"));
});

test("관리자는 학생 플레이리스트를 읽기만 하고 등록·수정·삭제는 거부된다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const own = await playlistActions.createDiggingPlaylist({ url: "https://soundcloud.com/stann/sets/warmup", title: "Warmup" });
  assert.ok(own.ok);
  const before = await readPlaylists(db);

  activeSession = createSession("admin-1", "admin");
  const listed = await playlistActions.getDiggingPlaylists("student-1");
  assert.deepEqual(listed.map((row) => row.id), [own.playlist.id]);
  await assert.rejects(
    playlistActions.createDiggingPlaylist({ url: "https://www.beatport.com/playlists/share/9" }),
    /학생만/u,
  );
  await assert.rejects(playlistActions.updateDiggingPlaylist(own.playlist.id, { title: "관리자 수정" }), /학생만/u);
  await assert.rejects(playlistActions.deleteDiggingPlaylist(own.playlist.id), /학생만/u);
  assert.deepEqual(await readPlaylists(db), before);
  // 관리자 계정 id로는 학생 대상 목록이 아니므로 읽을 수 없다.
  await assert.rejects(playlistActions.getDiggingPlaylists("admin-1"));
});
