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
// oEmbed 요청 도중 다른 탭이 행을 지우거나 추가하는 경합을 흉내 낸다.
let duringSoundCloudTitle: (() => Promise<void>) | null = null;

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
      const hook = duringSoundCloudTitle;
      duringSoundCloudTitle = null;
      if (hook) await hook();
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
  duringSoundCloudTitle = null;
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

  const beatport = await playlistActions.createDiggingPlaylist(activeSession.user.id, {
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

  const soundcloud = await playlistActions.createDiggingPlaylist(activeSession.user.id, {
    url: "https://m.soundcloud.com/stann/sets/warmup?si=abc",
  });
  assert.ok(soundcloud.ok, JSON.stringify(soundcloud));
  assert.equal(soundcloud.playlist.url, "https://soundcloud.com/stann/sets/warmup");
  assert.equal(soundcloud.playlist.title, "Warmup Picks");
  assert.deepEqual(soundCloudTitleCalls, ["https://soundcloud.com/stann/sets/warmup"]);

  // 사용자가 제목을 적으면 oEmbed를 부르지 않는다. oEmbed가 실패해도 등록은 성공한다.
  const titled = await playlistActions.createDiggingPlaylist(activeSession.user.id, {
    url: "https://soundcloud.com/stann/sets/closing",
    title: "마감 세트",
  });
  assert.ok(titled.ok && titled.playlist.title === "마감 세트");
  soundCloudTitle = null;
  const untitled = await playlistActions.createDiggingPlaylist(activeSession.user.id, {
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
  const created = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://www.beatport.com/playlists/share/11018932" });
  assert.ok(created.ok);
  const before = await readPlaylists(db);

  const duplicate = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://beatport.com/playlists/share/11018932/#x" });
  assert.deepEqual(duplicate, { ok: false, error: "이미 등록한 플레이리스트입니다." });
  for (const url of [
    "http://www.beatport.com/playlists/share/1",
    "https://on.soundcloud.com/AbCdE",
    "https://soundcloud.com/stann/some-track",
    "https://www.beatport.com:444/playlists/share/1",
    "https://user:pass@soundcloud.com/stann/sets/warmup",
    "https://example.com/playlists/share/1",
  ]) {
    const result = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url });
    assert.equal(result.ok, false, url);
  }
  const longTitle = await playlistActions.createDiggingPlaylist(activeSession.user.id, {
    url: "https://www.beatport.com/playlists/share/2",
    title: "가".repeat(201),
  });
  assert.equal(longTitle.ok, false);
  assert.deepEqual(await readPlaylists(db), before);
  assert.deepEqual(soundCloudTitleCalls, []);
});

test("학생은 자기 플레이리스트만 고치고 지우며 다른 학생 행은 그대로 남는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const own = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://www.beatport.com/playlists/share/1", title: "내 목록" });
  assert.ok(own.ok);
  activeSession = createSession("student-2", "student");
  const others = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://www.beatport.com/playlists/share/1", title: "남의 목록", note: "메모" });
  assert.ok(others.ok, "다른 학생은 같은 링크를 따로 등록할 수 있다");
  const othersBefore = (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, others.playlist.id)))[0];

  activeSession = createSession("student-1", "student");
  assert.equal((await playlistActions.updateDiggingPlaylist(activeSession.user.id, others.playlist.id, { title: "탈취", note: null })).ok, false);
  assert.equal((await playlistActions.updateDiggingPlaylist(activeSession.user.id, others.playlist.id, {
    url: "https://soundcloud.com/stann/sets/stolen",
    title: null,
    note: null,
  })).ok, false);
  assert.equal((await playlistActions.deleteDiggingPlaylist(activeSession.user.id, others.playlist.id)).ok, false);
  // 대상 학생을 다른 학생으로 바꿔 보내도 학생 세션은 본인만 대상으로 삼을 수 있다.
  await assert.rejects(playlistActions.createDiggingPlaylist("student-2", { url: "https://www.beatport.com/playlists/share/7" }), /Unauthorized/u);
  await assert.rejects(playlistActions.updateDiggingPlaylist("student-2", others.playlist.id, { title: "탈취" }), /Unauthorized/u);
  await assert.rejects(playlistActions.deleteDiggingPlaylist("student-2", others.playlist.id), /Unauthorized/u);
  assert.deepEqual(
    (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, others.playlist.id)))[0],
    othersBefore,
  );

  const updated = await playlistActions.updateDiggingPlaylist(activeSession.user.id, own.playlist.id, { title: "  ", note: " 새 메모 " });
  assert.ok(updated.ok);
  assert.equal(updated.playlist.title, null);
  assert.equal(updated.playlist.note, "새 메모");
  const stored = (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, own.playlist.id)))[0];
  assert.equal(stored?.title, null);
  assert.equal(stored?.note, "새 메모");
  assert.equal(stored?.url, "https://www.beatport.com/playlists/share/1");
  assert.ok(stored && stored.updatedAt.getTime() >= stored.createdAt.getTime());

  assert.deepEqual(await playlistActions.deleteDiggingPlaylist(activeSession.user.id, own.playlist.id), { ok: true });
  assert.deepEqual((await readPlaylists(db)).map((row) => row.id), [others.playlist.id]);

  await assert.rejects(playlistActions.getDiggingPlaylists("student-2"));
});

test("관리자(Stann)는 대상 학생을 명시해 플레이리스트를 등록·수정·삭제하고 다른 학생 행에는 닿지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const own = await playlistActions.createDiggingPlaylist("student-1", { url: "https://soundcloud.com/stann/sets/warmup", title: "Warmup" });
  assert.ok(own.ok);
  activeSession = createSession("student-2", "student");
  const others = await playlistActions.createDiggingPlaylist("student-2", { url: "https://www.beatport.com/playlists/share/2", title: "남의 목록" });
  assert.ok(others.ok);
  const othersBefore = (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, others.playlist.id)))[0];

  activeSession = createSession("admin-1", "admin");
  const listed = await playlistActions.getDiggingPlaylists("student-1");
  assert.deepEqual(listed.map((row) => row.id), [own.playlist.id]);

  // 등록: 대상 학생 행으로 저장하고, 링크 검증·중복 안내는 학생과 같다.
  const created = await playlistActions.createDiggingPlaylist("student-1", { url: "https://beatport.com/playlists/share/9?utm=x", note: " Stann 추천 " });
  assert.ok(created.ok, JSON.stringify(created));
  assert.equal(created.playlist.url, "https://www.beatport.com/playlists/share/9");
  const createdRow = (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, created.playlist.id)))[0];
  assert.equal(createdRow?.userId, "student-1");
  assert.equal(createdRow?.note, "Stann 추천");
  assert.deepEqual(
    await playlistActions.createDiggingPlaylist("student-1", { url: "https://www.beatport.com/playlists/share/9" }),
    { ok: false, error: "이미 등록한 플레이리스트입니다." },
  );
  assert.equal((await playlistActions.createDiggingPlaylist("student-1", { url: "https://example.com/list" })).ok, false);

  // 수정·삭제: 대상 학생의 행만 바뀐다.
  const updated = await playlistActions.updateDiggingPlaylist("student-1", own.playlist.id, { title: "Stann 수정", note: null });
  assert.ok(updated.ok && updated.playlist.title === "Stann 수정");
  assert.deepEqual(await playlistActions.deleteDiggingPlaylist("student-1", created.playlist.id), { ok: true });

  // 대상 학생과 다른 학생의 행 id를 섞어 보내면 찾을 수 없음으로 끝나고 그 행은 그대로다.
  assert.equal((await playlistActions.updateDiggingPlaylist("student-1", others.playlist.id, { title: "섞기" })).ok, false);
  assert.equal((await playlistActions.deleteDiggingPlaylist("student-1", others.playlist.id)).ok, false);
  assert.deepEqual(
    (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, others.playlist.id)))[0],
    othersBefore,
  );

  // 학생이 아닌 대상(관리자 자신·없는 id·빈 값)은 거부하고 행을 만들지 않는다.
  const rowsBefore = await readPlaylists(db);
  for (const target of ["admin-1", "missing-student", ""]) {
    await assert.rejects(playlistActions.createDiggingPlaylist(target, { url: "https://www.beatport.com/playlists/share/10" }), /Student not found/u);
    await assert.rejects(playlistActions.updateDiggingPlaylist(target, own.playlist.id, { title: "x" }), /Student not found/u);
    await assert.rejects(playlistActions.deleteDiggingPlaylist(target, own.playlist.id), /Student not found/u);
  }
  assert.deepEqual(await readPlaylists(db), rowsBefore);
  await assert.rejects(playlistActions.getDiggingPlaylists("admin-1"));
});

test("관리자 등록도 학생별 100개 상한을 지킨다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("admin-1", "admin"));
  const seeds = Array.from({ length: 100 }, (_, index) => ({
    id: `seed-${String(index).padStart(3, "0")}`,
    userId: "student-1",
    provider: "beatport" as const,
    url: `https://www.beatport.com/playlists/share/${1000 + index}`,
  }));
  for (let index = 0; index < seeds.length; index += 10) {
    await db.insert(diggingPlaylists).values(seeds.slice(index, index + 10));
  }
  assert.deepEqual(
    await playlistActions.createDiggingPlaylist("student-1", { url: "https://www.beatport.com/playlists/share/5" }),
    { ok: false, error: "플레이리스트는 최대 100개까지 등록할 수 있습니다." },
  );
  assert.ok((await playlistActions.createDiggingPlaylist("student-2", { url: "https://www.beatport.com/playlists/share/5" })).ok);
});

test("링크를 바꾸면 provider를 다시 정하고, SoundCloud로 바꾸며 제목을 비우면 oEmbed 제목을 채운다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const created = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://www.beatport.com/playlists/share/1", note: "메모" });
  assert.ok(created.ok);
  assert.deepEqual(soundCloudTitleCalls, []);

  const toSoundCloud = await playlistActions.updateDiggingPlaylist(activeSession.user.id, created.playlist.id, {
    url: "https://m.soundcloud.com/stann/sets/warmup?si=x",
    title: " ",
    note: "메모",
  });
  assert.ok(toSoundCloud.ok, JSON.stringify(toSoundCloud));
  assert.equal(toSoundCloud.playlist.provider, "soundcloud");
  assert.equal(toSoundCloud.playlist.url, "https://soundcloud.com/stann/sets/warmup");
  assert.equal(toSoundCloud.playlist.title, "Warmup Picks");
  assert.deepEqual(soundCloudTitleCalls, ["https://soundcloud.com/stann/sets/warmup"]);
  const stored = (await db.select().from(diggingPlaylists).where(eq(diggingPlaylists.id, created.playlist.id)))[0];
  assert.equal(stored?.provider, "soundcloud");
  assert.equal(stored?.url, "https://soundcloud.com/stann/sets/warmup");
  assert.equal(stored?.title, "Warmup Picks");
  assert.equal(stored?.createdAt.getTime(), created.playlist.createdAt.getTime());

  // 링크가 그대로면 제목을 비워도 외부 요청을 하지 않는다.
  const sameUrl = await playlistActions.updateDiggingPlaylist(activeSession.user.id, created.playlist.id, {
    url: "https://soundcloud.com/stann/sets/warmup",
    title: null,
    note: null,
  });
  assert.ok(sameUrl.ok && sameUrl.playlist.title === null);
  assert.equal(soundCloudTitleCalls.length, 1);

  // Beatport로 바꾸면 요청하지 않고 기본 이름을 쓴다.
  const toBeatport = await playlistActions.updateDiggingPlaylist(activeSession.user.id, created.playlist.id, {
    url: "https://beatport.com/playlists/share/77/",
    title: null,
    note: null,
  });
  assert.ok(toBeatport.ok);
  assert.equal(toBeatport.playlist.provider, "beatport");
  assert.equal(toBeatport.playlist.url, "https://www.beatport.com/playlists/share/77");
  assert.equal(toBeatport.playlist.title, null);
  assert.equal(soundCloudTitleCalls.length, 1);
});

test("링크 수정은 중복·잘못된 링크를 거부하고 행을 바꾸지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const first = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://www.beatport.com/playlists/share/1" });
  const second = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://www.beatport.com/playlists/share/2", title: "둘째" });
  assert.ok(first.ok && second.ok);
  const before = await readPlaylists(db);

  assert.deepEqual(
    await playlistActions.updateDiggingPlaylist(activeSession.user.id, second.playlist.id, { url: "https://beatport.com/playlists/share/1?x=1", title: "둘째" }),
    { ok: false, error: "이미 등록한 플레이리스트입니다." },
  );
  for (const url of [
    "",
    "https://soundcloud.com/stann/some-track",
    "https://www.beatport.com:443/playlists/share/3",
    "https://soundcloud.com:443/stann/sets/warmup",
    "http://www.beatport.com/playlists/share/3",
  ]) {
    const result = await playlistActions.updateDiggingPlaylist(activeSession.user.id, second.playlist.id, { url, title: "둘째" });
    assert.equal(result.ok, false, url);
  }

  // 수정 도중 다른 탭이 같은 링크를 등록하면 unique index 위반도 같은 중복 안내로 돌려준다.
  duringSoundCloudTitle = async () => {
    await db.insert(diggingPlaylists).values({
      id: "race-dup",
      userId: "student-1",
      provider: "soundcloud",
      url: "https://soundcloud.com/stann/sets/race",
    });
  };
  assert.deepEqual(
    await playlistActions.updateDiggingPlaylist(activeSession.user.id, second.playlist.id, { url: "https://soundcloud.com/stann/sets/race", title: null }),
    { ok: false, error: "이미 등록한 플레이리스트입니다." },
  );
  assert.deepEqual((await readPlaylists(db)).filter((row) => row.id !== "race-dup"), before);
});

test("지워진 행을 고치면 성공으로 보고하지 않고 찾을 수 없음 안내를 돌려준다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const created = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://www.beatport.com/playlists/share/1" });
  assert.ok(created.ok);
  const notFound = { ok: false, error: "플레이리스트를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요." };

  // 조회 뒤 UPDATE 전에 다른 탭이 지운 경합: oEmbed 요청 중 행을 지운다.
  duringSoundCloudTitle = async () => {
    await db.delete(diggingPlaylists).where(eq(diggingPlaylists.id, created.playlist.id));
  };
  assert.deepEqual(
    await playlistActions.updateDiggingPlaylist(activeSession.user.id, created.playlist.id, { url: "https://soundcloud.com/stann/sets/warmup", title: null }),
    notFound,
  );
  assert.deepEqual(await readPlaylists(db), []);
  assert.deepEqual(await playlistActions.updateDiggingPlaylist(activeSession.user.id, created.playlist.id, { title: "다시" }), notFound);
});

test("100개 상한은 INSERT가 다시 확인해 동시 등록에도 넘지 않는다", { concurrency: false }, async (context) => {
  const db = await setupDatabase(context, createSession("student-1", "student"));
  const limitError = { ok: false, error: "플레이리스트는 최대 100개까지 등록할 수 있습니다." };
  const seeds = Array.from({ length: 99 }, (_, index) => ({
    id: `seed-${String(index).padStart(3, "0")}`,
    userId: "student-1",
    provider: "beatport" as const,
    url: `https://www.beatport.com/playlists/share/${1000 + index}`,
  }));
  // D1은 한 문장의 bind 변수 수를 제한하므로 나눠 넣는다.
  for (let index = 0; index < seeds.length; index += 10) {
    await db.insert(diggingPlaylists).values(seeds.slice(index, index + 10));
  }
  // 다른 학생의 행은 상한에 세지 않는다.
  await db.insert(diggingPlaylists).values({
    id: "other-1",
    userId: "student-2",
    provider: "beatport",
    url: "https://www.beatport.com/playlists/share/1",
  });

  // 개수 선검사(99개)를 지난 뒤 oEmbed 요청 중 다른 탭이 100번째를 등록한 경합.
  duringSoundCloudTitle = async () => {
    await db.insert(diggingPlaylists).values({
      id: "race-100",
      userId: "student-1",
      provider: "beatport",
      url: "https://www.beatport.com/playlists/share/9999",
    });
  };
  assert.deepEqual(await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://soundcloud.com/stann/sets/late" }), limitError);
  assert.equal(soundCloudTitleCalls.length, 1);
  const owned = (await readPlaylists(db)).filter((row) => row.userId === "student-1");
  assert.equal(owned.length, 100);
  assert.ok(!owned.some((row) => row.url === "https://soundcloud.com/stann/sets/late"));

  // 100개가 찬 뒤에는 선검사가 바로 막는다.
  assert.deepEqual(await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://www.beatport.com/playlists/share/5" }), limitError);
  await db.delete(diggingPlaylists).where(eq(diggingPlaylists.id, "race-100"));
  const fits = await playlistActions.createDiggingPlaylist(activeSession.user.id, { url: "https://www.beatport.com/playlists/share/5" });
  assert.ok(fits.ok, JSON.stringify(fits));
});
