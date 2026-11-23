/**
 * 알림 room(`CollabNotifyRefresh`) 연결 상태를 같은 화면의 `RouteAutoRefresh`에 알리는 작은 저장소.
 * 연결된(또는 잠시 쉬는) 알림 room이 하나라도 있으면 주기 재조회를 늘린다. 알림이 주요 변경을 바로 알리기 때문이다.
 */

/** 알림 room이 연결돼 있을 때의 주기 재조회 간격. 알림이 다루지 않는 변경(일정·과제 등)을 늦게라도 따라잡는다. */
export const ROUTE_AUTO_REFRESH_NOTIFY_INTERVAL_MS = 5 * 60_000;

let liveCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeCollabNotifyLive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isCollabNotifyLive(): boolean {
  return liveCount > 0;
}

/** 알림 room이 연결됐음을 알린다. 돌려준 함수를 부르면(연결이 끊기거나 unmount) 해제한다. 해제는 한 번만 센다. */
export function markCollabNotifyLive(): () => void {
  liveCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    liveCount = Math.max(0, liveCount - 1);
    emit();
  };
}

/** 주기 재조회 간격: 끈 화면(null)은 그대로, 알림이 연결돼 있으면 5분보다 짧게 받지 않는다. */
export function resolveRouteRefreshInterval(intervalMs: number | null, notifyLive: boolean): number | null {
  if (intervalMs === null) return null;
  return notifyLive ? Math.max(intervalMs, ROUTE_AUTO_REFRESH_NOTIFY_INTERVAL_MS) : intervalMs;
}
