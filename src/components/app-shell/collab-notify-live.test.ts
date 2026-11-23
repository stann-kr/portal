import assert from "node:assert/strict";
import test from "node:test";
import {
  ROUTE_AUTO_REFRESH_NOTIFY_INTERVAL_MS,
  isCollabNotifyLive,
  markCollabNotifyLive,
  resolveRouteRefreshInterval,
  subscribeCollabNotifyLive,
} from "./collab-notify-live";

test("알림 room이 연결된 동안만 주기 재조회를 5분으로 늘리고, 해제는 한 번만 센다", () => {
  let notified = 0;
  const unsubscribe = subscribeCollabNotifyLive(() => {
    notified += 1;
  });
  assert.equal(isCollabNotifyLive(), false);
  assert.equal(resolveRouteRefreshInterval(30_000, isCollabNotifyLive()), 30_000);

  const releaseA = markCollabNotifyLive();
  const releaseB = markCollabNotifyLive();
  assert.equal(isCollabNotifyLive(), true);
  assert.equal(resolveRouteRefreshInterval(30_000, isCollabNotifyLive()), ROUTE_AUTO_REFRESH_NOTIFY_INTERVAL_MS);

  releaseA();
  releaseA();
  assert.equal(isCollabNotifyLive(), true, "같은 해제를 두 번 불러도 다른 연결은 남는다");
  releaseB();
  assert.equal(isCollabNotifyLive(), false);
  assert.equal(notified, 4);
  unsubscribe();

  // 주기 재조회를 끈 화면은 그대로 두고, 이미 더 긴 간격은 줄이지 않는다.
  assert.equal(resolveRouteRefreshInterval(null, true), null);
  assert.equal(resolveRouteRefreshInterval(10 * 60_000, true), 10 * 60_000);
});
