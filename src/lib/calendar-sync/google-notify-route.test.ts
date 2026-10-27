import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleNotifyHandler } from "./google-notify-route";

const NOTIFY_URL = "https://portal.example.com/api/calendar-connections/google/notify";

function notify(headers: Record<string, string>): Request {
  return new Request(NOTIFY_URL, { method: "POST", headers });
}

function harness(options: { resolve?: (input: { channelId: string | null; token: string | null; resourceId: string | null }) => Promise<string | null> } = {}) {
  const resolved: Array<{ channelId: string | null; token: string | null; resourceId: string | null }> = [];
  const scheduled: string[] = [];
  const handler = createGoogleNotifyHandler({
    resolve: async (input) => {
      resolved.push(input);
      if (options.resolve) return options.resolve(input);
      return input.channelId === "channel-1" && input.token === "good-token" ? "mapping-1" : null;
    },
    scheduleSync: (mappingId) => {
      scheduled.push(mappingId);
    },
  });
  return { handler, resolved, scheduled };
}

async function expectEmpty(response: Response, status: number): Promise<void> {
  assert.equal(response.status, status);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("cache-control"), "no-store");
}

test("channel id·token이 없거나 맞지 않으면 빈 본문 404이고 동기화를 예약하지 않는다", async () => {
  const { handler, scheduled, resolved } = harness();
  await expectEmpty(await handler(notify({})), 404);
  await expectEmpty(await handler(notify({ "X-Goog-Channel-ID": "channel-1" })), 404);
  assert.equal(resolved.length, 0, "header가 빠지면 DB를 조회하지 않는다");
  await expectEmpty(await handler(notify({ "X-Goog-Channel-ID": "channel-1", "X-Goog-Channel-Token": "wrong", "X-Goog-Resource-State": "exists" })), 404);
  await expectEmpty(await handler(notify({ "X-Goog-Channel-ID": "unknown", "X-Goog-Channel-Token": "good-token", "X-Goog-Resource-State": "exists" })), 404);
  assert.deepEqual(scheduled, []);
});

test("sync(등록 확인) 알림은 200만 주고, 변경 알림은 200 뒤 해당 매핑 동기화를 예약한다", async () => {
  const { handler, scheduled, resolved } = harness();
  const headers = { "X-Goog-Channel-ID": "channel-1", "X-Goog-Channel-Token": "good-token", "X-Goog-Resource-ID": "res-1" };
  await expectEmpty(await handler(notify({ ...headers, "X-Goog-Resource-State": "sync" })), 200);
  assert.deepEqual(scheduled, []);
  await expectEmpty(await handler(notify({ ...headers, "X-Goog-Resource-State": "exists" })), 200);
  assert.deepEqual(scheduled, ["mapping-1"]);
  assert.deepEqual(resolved.at(-1), { channelId: "channel-1", token: "good-token", resourceId: "res-1" });
});

test("검증 중 DB 오류는 Google이 다시 보내도록 빈 본문 503, 예약 실패는 응답을 바꾸지 않는다", async () => {
  const failing = harness({ resolve: async () => { throw new Error("db down secret"); } });
  await expectEmpty(await failing.handler(notify({ "X-Goog-Channel-ID": "channel-1", "X-Goog-Channel-Token": "good-token" })), 503);
  const handler = createGoogleNotifyHandler({
    resolve: async () => "mapping-1",
    scheduleSync: async () => { throw new Error("schedule failed"); },
  });
  await expectEmpty(await handler(notify({ "X-Goog-Channel-ID": "channel-1", "X-Goog-Channel-Token": "good-token", "X-Goog-Resource-State": "exists" })), 200);
});
