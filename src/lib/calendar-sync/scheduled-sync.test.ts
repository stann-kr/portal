import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { getExternalCalendarEncryptionKey } from "@/lib/external-calendar-key";
import { setCalendarClientFactoryForTests, setGoogleChannelApiFactoryForTests } from "./client-factory";
import { FakeCalendar } from "./fake-calendar-client";
import { FakeGoogleChannels } from "./fake-channel-api";
import { readCalendarSyncEnv } from "./oauth-config";
import { runWithCalendarSyncEnv } from "./runtime-env";
import { CALENDAR_SCHEDULED_CHANNEL_RESERVE_MS, runScheduledCalendarSync, serializeScheduledCalendarSyncSummary } from "./scheduled-sync";
import { createSqliteTestDb, insertConnection, insertMapping, insertProfile } from "./sqlite-test-db";
import { CalendarProviderError } from "./types";

const NOW = new Date("2026-10-27T03:00:00.000Z");
const TEST_KEY = Buffer.alloc(32, 9).toString("base64");
const ENV = {
  AUTH_URL: "https://portal.example.com",
  GOOGLE_CALENDAR_CLIENT_ID: "client-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret-value",
  EXTERNAL_CALENDAR_ENCRYPTION_KEY: TEST_KEY,
};

function setup(context: TestContext) {
  const db = createSqliteTestDb(context);
  insertProfile(db, "admin-1", "admin");
  for (const student of ["student-a", "student-b", "student-c"]) insertProfile(db, student, "student");
  insertConnection(db, "conn-google", "GOOGLE");
  insertConnection(db, "conn-icloud", "ICLOUD");
  insertMapping(db, "map-a", "conn-google", "student-a", "cal-a");
  insertMapping(db, "map-b", "conn-google", "student-b", "cal-b");
  insertMapping(db, "map-c", "conn-icloud", "student-c", "cal-c");
  const remotes = new Map([["conn-google", new FakeCalendar()], ["conn-icloud", new FakeCalendar()]]);
  setCalendarClientFactoryForTests(async ({ connection }) => remotes.get(connection.id)!);
  const channels = new FakeGoogleChannels();
  channels.expiresAt = () => new Date(NOW.getTime() + 7 * 86_400_000);
  setGoogleChannelApiFactoryForTests(channels.factory);
  context.after(() => {
    setCalendarClientFactoryForTests(null);
    setGoogleChannelApiFactoryForTests(null);
  });
  return { db, remotes, channels };
}

test("예약 동기화는 한 매핑의 실패와 무관하게 나머지를 동기화하고 Google channel을 갱신한다", async (context) => {
  const { db, remotes, channels } = setup(context);
  const google = remotes.get("conn-google")!;
  remotes.get("conn-icloud")!.remoteAdd({ title: "합주", start: new Date("2026-11-02T10:00:00Z"), end: new Date("2026-11-02T11:00:00Z") });
  const failing = new FakeCalendar();
  failing.failAll = new CalendarProviderError("provider down secret-body", { status: 503 });
  // 매핑은 id 순(map-a, map-b, map-c)으로 돌므로 첫 Google client만 실패한다.
  let calls = 0;
  setCalendarClientFactoryForTests(async ({ connection }) => {
    calls += 1;
    if (connection.id === "conn-icloud") return remotes.get("conn-icloud")!;
    return calls === 1 ? failing : google;
  });

  const summary = await runWithCalendarSyncEnv(ENV, () =>
    runScheduledCalendarSync({ ctx: db.ctx, deadlineMs: NOW.getTime() + 60_000, now: () => NOW }),
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.failed, 1);
  assert.equal(summary.synced, 2);
  assert.equal(summary.deferred, 0);
  assert.equal(summary.localChanged, 1, "iCloud 원격 일정을 가져왔다");
  assert.deepEqual(summary.channels, { renewed: 2, failed: 0, skipped: 0, deferred: 0 });
  assert.deepEqual(channels.watches.map((watch) => watch.calendarId).sort(), ["cal-a", "cal-b"]);
  const serialized = serializeScheduledCalendarSyncSummary(summary);
  assert.doesNotMatch(serialized, /secret|client-secret-value|token/iu);
  const errors = db.rows<{ id: string; last_error: string | null }>("SELECT id, last_error FROM calendar_mappings ORDER BY id");
  assert.equal(errors.filter((row) => row.last_error).length, 1);
  assert.equal(db.rows("SELECT id FROM calendar_events WHERE user_id = 'student-c'").length, 1);

  // 60초 안에 다시 돌면 throttle로 건너뛴다(force 아님).
  const again = await runWithCalendarSyncEnv(ENV, () =>
    runScheduledCalendarSync({ ctx: db.ctx, deadlineMs: NOW.getTime() + 90_000, now: () => new Date(NOW.getTime() + 30_000) }),
  );
  assert.equal(again.skipped, 3);
  assert.equal(again.channels.renewed, 0);
});

test("시간 상한이 지나면 새 매핑을 시작하지 않고 미룬 수를 돌려준다", async (context) => {
  const { db, remotes } = setup(context);
  const summary = await runWithCalendarSyncEnv(ENV, () =>
    runScheduledCalendarSync({ ctx: db.ctx, deadlineMs: NOW.getTime() + CALENDAR_SCHEDULED_CHANNEL_RESERVE_MS - 1, now: () => NOW }),
  );
  assert.equal(summary.deferred, 3);
  assert.equal(summary.synced + summary.failed + summary.skipped, 0);
  assert.equal(remotes.get("conn-google")!.calls.length, 0);
});

test("env override 안에서는 Worker env의 암호화 key·설정을 읽고 밖에서는 기존 경로를 따른다", async () => {
  const previous = process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY;
  const previousId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  delete process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY;
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "process-client-id";
  try {
    assert.throws(() => getExternalCalendarEncryptionKey());
    const inside = await runWithCalendarSyncEnv(ENV, async () => {
      await Promise.resolve();
      return { key: getExternalCalendarEncryptionKey(), clientId: readCalendarSyncEnv("GOOGLE_CALENDAR_CLIENT_ID") };
    });
    assert.deepEqual(Buffer.from(inside.key), Buffer.alloc(32, 9));
    assert.equal(inside.clientId, "client-id");
    assert.throws(() => getExternalCalendarEncryptionKey(), "override는 실행 범위 밖으로 새지 않는다");
    assert.equal(readCalendarSyncEnv("GOOGLE_CALENDAR_CLIENT_ID"), "process-client-id");
    // override에 없는 이름은 기존 경로(process.env)로 넘어간다.
    assert.equal(await runWithCalendarSyncEnv({ AUTH_URL: "https://x.example" }, async () => readCalendarSyncEnv("GOOGLE_CALENDAR_CLIENT_ID")), "process-client-id");
  } finally {
    if (previous === undefined) delete process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY;
    else process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY = previous;
    if (previousId === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    else process.env.GOOGLE_CALENDAR_CLIENT_ID = previousId;
  }
});
