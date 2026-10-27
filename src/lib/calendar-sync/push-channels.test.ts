import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setGoogleChannelApiFactoryForTests } from "./client-factory";
import { FakeGoogleChannels } from "./fake-channel-api";
import {
  GOOGLE_CHANNEL_TTL_SECONDS,
  constantTimeEqual,
  ensureGoogleWatchChannel,
  ensureGoogleWatchChannels,
  resolveGoogleNotification,
  stopGoogleWatchChannelsFor,
} from "./push-channels";
import { runWithCalendarSyncEnv } from "./runtime-env";
import { createSqliteTestDb, insertConnection, insertMapping, insertProfile, type SqliteTestDb } from "./sqlite-test-db";
import { sha256Hex } from "./types";

const NOW = new Date("2026-10-27T03:00:00.000Z");
const HTTPS_ENV = {
  AUTH_URL: "https://portal.example.com",
  GOOGLE_CALENDAR_CLIENT_ID: "client-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
};

type ChannelRow = { mapping_id: string; channel_id: string; resource_id: string; token_hash: string; expires_at: number };

function setup(context: TestContext): { db: SqliteTestDb; channels: FakeGoogleChannels; channelRows: () => ChannelRow[] } {
  const db = createSqliteTestDb(context);
  insertProfile(db, "admin-1", "admin");
  insertProfile(db, "student-a", "student");
  insertProfile(db, "student-b", "student");
  insertConnection(db, "conn-google", "GOOGLE");
  insertConnection(db, "conn-icloud", "ICLOUD");
  insertMapping(db, "map-google-a", "conn-google", "student-a", "cal-a");
  insertMapping(db, "map-google-b", "conn-google", "student-b", "cal-b");
  insertMapping(db, "map-icloud-a", "conn-icloud", "student-a", "https://caldav.example.com/a/");
  const channels = new FakeGoogleChannels();
  channels.expiresAt = () => new Date(NOW.getTime() + GOOGLE_CHANNEL_TTL_SECONDS * 1_000);
  setGoogleChannelApiFactoryForTests(channels.factory);
  context.after(() => setGoogleChannelApiFactoryForTests(null));
  return { db, channels, channelRows: () => db.rows<ChannelRow>("SELECT * FROM calendar_push_channels ORDER BY mapping_id") };
}

const withEnv = <T,>(env: Record<string, string>, fn: () => Promise<T>) => runWithCalendarSyncEnv(env, fn);
const now = () => NOW;

test("Google 매핑에 channel을 등록하고 token 원문 대신 sha256 hex만 저장하며 살아 있는 channel은 다시 만들지 않는다", async (context) => {
  const { db, channels, channelRows } = setup(context);
  const status = await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannel(db.ctx, "map-google-a", { now }));
  assert.equal(status, "created");
  assert.equal(channels.watches.length, 1);
  const watch = channels.watches[0];
  assert.equal(watch.calendarId, "cal-a");
  assert.equal(watch.address, "https://portal.example.com/api/calendar-connections/google/notify");
  assert.equal(watch.ttlSeconds, GOOGLE_CHANNEL_TTL_SECONDS);
  assert.match(watch.token, /^[A-Za-z0-9_-]{43}$/u, "32 bytes base64url");
  const [row] = channelRows();
  assert.equal(row.channel_id, watch.channelId);
  assert.equal(row.resource_id, watch.resourceId);
  assert.equal(row.token_hash, await sha256Hex(watch.token));
  assert.doesNotMatch(JSON.stringify(db.rows("SELECT * FROM calendar_push_channels")), new RegExp(watch.token, "u"));

  assert.equal(await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannel(db.ctx, "map-google-a", { now })), "fresh");
  assert.equal(channels.watches.length, 1);
  assert.equal(await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannel(db.ctx, "map-icloud-a", { now })), "not-google");
  assert.equal(await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannel(db.ctx, "missing", { now })), "missing");
});

test("24시간 안에 만료되는 channel은 새로 등록해 행을 바꾼 뒤 이전 channel을 중지한다", async (context) => {
  const { db, channels, channelRows } = setup(context);
  await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannel(db.ctx, "map-google-a", { now }));
  const first = channels.watches[0];
  const later = new Date(NOW.getTime() + (GOOGLE_CHANNEL_TTL_SECONDS - 23 * 3_600) * 1_000);
  channels.expiresAt = () => new Date(later.getTime() + GOOGLE_CHANNEL_TTL_SECONDS * 1_000);
  const status = await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannel(db.ctx, "map-google-a", { now: () => later }));
  assert.equal(status, "renewed");
  assert.equal(channels.watches.length, 2);
  assert.deepEqual(channels.stops, [{ connectionId: "conn-google", channelId: first.channelId, resourceId: first.resourceId }]);
  const [row] = channelRows();
  assert.equal(row.channel_id, channels.watches[1].channelId);
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: first.channelId, token: first.token }), null, "이전 channel 알림은 버린다");
});

test("로컬 http 주소나 Google 설정이 없으면 원격 요청 없이 건너뛴다", async (context) => {
  const { db, channels, channelRows } = setup(context);
  const http = { ...HTTPS_ENV, AUTH_URL: "http://localhost:3004" };
  assert.equal(await withEnv(http, () => ensureGoogleWatchChannel(db.ctx, "map-google-a", { now })), "insecure-address");
  assert.deepEqual(await withEnv(http, () => ensureGoogleWatchChannels(db.ctx, { now })), { renewed: 0, failed: 0, skipped: 0, deferred: 0 });
  assert.equal(
    await withEnv({ AUTH_URL: "https://portal.example.com", GOOGLE_CALENDAR_CLIENT_ID: "", GOOGLE_CALENDAR_CLIENT_SECRET: "" }, async () => {
      const previous = { id: process.env.GOOGLE_CALENDAR_CLIENT_ID, secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET };
      delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
      delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
      try {
        return await ensureGoogleWatchChannel(db.ctx, "map-google-a", { now });
      } finally {
        if (previous.id !== undefined) process.env.GOOGLE_CALENDAR_CLIENT_ID = previous.id;
        if (previous.secret !== undefined) process.env.GOOGLE_CALENDAR_CLIENT_SECRET = previous.secret;
      }
    }),
    "not-configured",
  );
  assert.equal(channels.watches.length, 0);
  assert.equal(channelRows().length, 0);
});

test("등록 실패는 throw하지 않고 매핑·연결 last_error를 바꾸지 않는다", async (context) => {
  const { db, channels, channelRows } = setup(context);
  channels.failWatch = new Error("google down secret-body");
  assert.equal(await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannel(db.ctx, "map-google-a", { now })), "failed");
  const summary = await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannels(db.ctx, { now }));
  assert.deepEqual(summary, { renewed: 0, failed: 2, skipped: 0, deferred: 0 });
  assert.equal(channelRows().length, 0);
  assert.deepEqual(db.rows("SELECT last_error FROM calendar_mappings WHERE last_error IS NOT NULL"), []);
  assert.deepEqual(db.rows("SELECT last_error FROM calendar_connections WHERE last_error IS NOT NULL"), []);
});

test("ensureGoogleWatchChannels는 갱신이 필요한 활성 Google 매핑만 처리하고 시간 상한이 지나면 미룬다", async (context) => {
  const { db, channels } = setup(context);
  const summary = await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannels(db.ctx, { now }));
  assert.deepEqual(summary, { renewed: 2, failed: 0, skipped: 0, deferred: 0 });
  assert.deepEqual(channels.watches.map((watch) => watch.calendarId).sort(), ["cal-a", "cal-b"]);
  assert.deepEqual(await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannels(db.ctx, { now })), { renewed: 0, failed: 0, skipped: 0, deferred: 0 });

  db.run("DELETE FROM calendar_push_channels");
  db.run("UPDATE calendar_connections SET status = 'NEEDS_REAUTH' WHERE id = 'conn-google'");
  assert.deepEqual(await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannels(db.ctx, { now })), { renewed: 0, failed: 0, skipped: 0, deferred: 0 });
  db.run("UPDATE calendar_connections SET status = 'ACTIVE' WHERE id = 'conn-google'");
  const expired = await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannels(db.ctx, { now, deadline: NOW.getTime() - 1 }));
  assert.deepEqual(expired, { renewed: 0, failed: 0, skipped: 0, deferred: 2 });
});

test("동시에 다른 요청이 channel을 먼저 바꾸면 늦은 쪽은 자기 channel을 중지하고 행을 덮지 않는다", async (context) => {
  const { db, channels, channelRows } = setup(context);
  channels.beforeWatchResolves = () => {
    channels.beforeWatchResolves = null;
    db.run(
      "INSERT INTO calendar_push_channels (mapping_id, channel_id, resource_id, token_hash, expires_at) VALUES ('map-google-a', 'winner', 'winner-res', ?, ?)",
      "b".repeat(64),
      Math.floor(NOW.getTime() / 1_000) + GOOGLE_CHANNEL_TTL_SECONDS,
    );
  };
  assert.equal(await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannel(db.ctx, "map-google-a", { now })), "raced");
  assert.equal(channelRows()[0].channel_id, "winner");
  assert.deepEqual(channels.stops.map((stop) => stop.channelId), [channels.watches[0].channelId]);
});

test("알림 검증은 channel id·token·resource id가 모두 맞을 때만 매핑 id를 준다", async (context) => {
  const { db, channels } = setup(context);
  await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannels(db.ctx, { now }));
  const watchA = channels.lastWatchFor("cal-a");
  const watchB = channels.lastWatchFor("cal-b");
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: watchA.channelId, token: watchA.token }), null, "resource id header 없음");
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: watchA.channelId, token: watchA.token, resourceId: watchA.resourceId }), "map-google-a");
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: watchA.channelId, token: watchB.token, resourceId: watchA.resourceId }), null, "다른 channel token");
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: watchA.channelId, token: `${watchA.token}x`, resourceId: watchA.resourceId }), null);
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: watchA.channelId, token: watchA.token, resourceId: watchB.resourceId }), null);
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: "unknown", token: watchA.token }), null);
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: watchA.channelId, token: null }), null);
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: null, token: watchA.token }), null);
  assert.equal(await resolveGoogleNotification(db.ctx, { channelId: watchA.channelId, token: "x".repeat(300) }), null);
});

test("constantTimeEqual은 길이·내용이 모두 같을 때만 true다", () => {
  const hash = "a".repeat(64);
  assert.equal(constantTimeEqual(hash, "a".repeat(64)), true);
  assert.equal(constantTimeEqual(hash, `${"a".repeat(63)}b`), false);
  assert.equal(constantTimeEqual(hash, "a".repeat(63)), false);
  assert.equal(constantTimeEqual("", ""), true);
  assert.equal(constantTimeEqual(hash, ""), false);
});

test("매핑·연결 해제 전 stop은 Google channel을 중지하고 행을 지우며 stop 실패도 해제를 막지 않는다", async (context) => {
  const { db, channels, channelRows } = setup(context);
  await withEnv(HTTPS_ENV, () => ensureGoogleWatchChannels(db.ctx, { now }));
  const watchA = channels.lastWatchFor("cal-a");
  assert.deepEqual(await stopGoogleWatchChannelsFor(db.ctx, { mappingId: "map-google-a" }), { stopped: 1 });
  assert.deepEqual(channels.stops.map((stop) => stop.channelId), [watchA.channelId]);
  assert.deepEqual(channelRows().map((row) => row.mapping_id), ["map-google-b"]);

  channels.failStop = new Error("stop failed");
  assert.deepEqual(await stopGoogleWatchChannelsFor(db.ctx, { connectionId: "conn-google" }), { stopped: 0 });
  assert.equal(channelRows().length, 0, "중지 실패와 무관하게 행은 지운다");
  assert.deepEqual(await stopGoogleWatchChannelsFor(db.ctx, { connectionId: "conn-icloud" }), { stopped: 0 });
});
