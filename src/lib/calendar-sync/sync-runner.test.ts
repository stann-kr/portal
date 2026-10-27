import assert from "node:assert/strict";
import test from "node:test";
import { setCalendarClientFactoryForTests } from "./client-factory";
import { FakeCalendar } from "./fake-calendar-client";
import { createSqliteTestDb, insertConnection, insertMapping, insertProfile } from "./sqlite-test-db";
import { runGoogleNotificationSync, syncCalendarMapping } from "./sync-runner";
import type { CalendarProviderClient } from "./types";

const MAPPING = "map-a";

/** pull만 바꾼 가짜 client(나머지는 remote로 보낸다). */
function withPull(remote: FakeCalendar, pull: CalendarProviderClient["pull"]): CalendarProviderClient {
  return {
    kind: "GOOGLE",
    listCalendars: () => remote.listCalendars(),
    pull,
    create: (...args) => remote.create(...args),
    update: (...args) => remote.update(...args),
    remove: (...args) => remote.remove(...args),
    findByPortalRef: (...args) => remote.findByPortalRef(...args),
    get: (...args) => remote.get(...args),
  };
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let tick = 0; tick < 500; tick += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`기다린 상태가 오지 않았다: ${label}`);
}

test("lease를 잡은 실행 중 받은 Google 알림은 버리지 않고 lease가 풀린 뒤 다시 동기화한다", async (context) => {
  const db = createSqliteTestDb(context);
  insertProfile(db, "admin-1", "admin");
  insertProfile(db, "student-a", "student");
  insertConnection(db, "conn-google", "GOOGLE");
  insertMapping(db, MAPPING, "conn-google", "student-a", "cal-a");
  const remote = new FakeCalendar();

  let releaseRunning!: () => void;
  const runningGate = new Promise<void>((resolve) => {
    releaseRunning = resolve;
  });
  let runningPulled = false;
  // 진행 중 실행 A: 원격 snapshot을 읽은 뒤 멈춘다(그동안 lease를 쥐고 있다).
  const running = withPull(remote, async (...args) => {
    const result = await remote.pull(...args);
    if (!runningPulled) {
      runningPulled = true;
      await runningGate;
    }
    return result;
  });
  let notifyPulls = 0;
  const notified = withPull(remote, async (...args) => {
    notifyPulls += 1;
    return remote.pull(...args);
  });
  let clients = 0;
  setCalendarClientFactoryForTests(async () => {
    clients += 1;
    return clients === 1 ? running : notified;
  });
  context.after(() => setCalendarClientFactoryForTests(null));

  const first = syncCalendarMapping(db.ctx, MAPPING, { force: true });
  await waitFor(() => runningPulled, "진행 중 실행의 pull");

  // A의 snapshot 뒤에 원격 일정이 생기고 알림이 온다. 알림 동기화는 A의 lease에 막힌다.
  const start = new Date(Date.now() + 2 * 86_400_000);
  start.setUTCSeconds(0, 0);
  remote.remoteAdd({ title: "알림으로 온 합주", start, end: new Date(start.getTime() + 3_600_000) });
  const notify = runGoogleNotificationSync(MAPPING, { ctx: db.ctx, budgetMs: 5_000, retryDelayMs: 10 });
  // 알림 쪽이 여러 번 lease에 막힐 만큼 A를 붙잡아 둔다.
  await new Promise((resolve) => setTimeout(resolve, 150));
  releaseRunning();
  await Promise.all([first, notify]);

  assert.equal(clients, 2, "lease가 풀린 뒤 알림 동기화가 실제로 실행된다");
  assert.ok(notifyPulls >= 1, "알림 동기화가 원격을 다시 읽는다");
  assert.deepEqual(db.rows<{ title: string }>("SELECT title FROM calendar_events"), [{ title: "알림으로 온 합주" }]);
  const [mapping] = db.rows<{ cursor: string | null; sync_lease_id: string | null }>("SELECT cursor, sync_lease_id FROM calendar_mappings");
  assert.equal(mapping.cursor, remote.currentCursor(), "cursor가 알림 이후 변경 뒤로 옮겨진다");
  assert.equal(mapping.sync_lease_id, null);
});
