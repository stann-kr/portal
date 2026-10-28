/**
 * 예약 동기화(Worker `scheduled`). 활성 연결의 모든 매핑을 돌며 동기화하고 Google 변경 알림 channel을 갱신한다.
 *
 * - 둘 다 연결한 학생은 포털이 중심이다: Google 매핑 동기화가 가져온 변경을 iCloud 매핑 동기화가 내보낸다.
 * - throttle은 조회와 같은 60초 기준(force 아님), lease는 항상 지킨다.
 * - 매핑 하나의 실패는 나머지를 막지 않는다. 시간 상한(deadlineMs, epoch ms)이 지나면 새 매핑을 시작하지 않는다.
 * - 결과에는 개수만 담는다(비밀값·원격 본문 없음).
 * - `next/server`와 server action을 import하지 않는다(worker.ts가 OpenNext request context 없이 부른다).
 *   env는 worker.ts가 `runWithCalendarSyncEnv`로 넘긴다.
 */
import type { DbContext } from "@/db/client";
import { listAllActiveMappingIds, syncCalendarMapping } from "./mapping-sync";
import { ensureGoogleWatchChannels, type EnsureChannelsSummary } from "./push-channels";

/** Worker 예약 실행에서 캘린더 동기화에 쓰는 기본 시간 상한. */
export const CALENDAR_SCHEDULED_SYNC_BUDGET_MS = 50_000;
/** 매핑 동기화가 시간을 다 써도 만료 임박 channel 갱신이 밀리지 않도록 마지막에 남겨 두는 시간. */
export const CALENDAR_SCHEDULED_CHANNEL_RESERVE_MS = 10_000;

export type ScheduledCalendarSyncSummary = {
  total: number;
  synced: number;
  skipped: number;
  failed: number;
  /** 시간 상한 때문에 이번 실행에서 시작하지 못한 매핑 수. */
  deferred: number;
  localChanged: number;
  channels: EnsureChannelsSummary;
  /** 매핑 목록 조회 자체가 실패했다. */
  listFailed: boolean;
};

export async function runScheduledCalendarSync(input: {
  ctx: DbContext;
  /** epoch ms(`now`와 같은 시계). 이 시각이 지나면 새 원격 작업을 시작하지 않는다. */
  deadlineMs: number;
  /** 시계(테스트 주입용). 엔진 throttle·deadline 판단도 같은 시계를 쓴다. */
  now?: () => Date;
}): Promise<ScheduledCalendarSyncSummary> {
  const { ctx, deadlineMs, now } = input;
  const clock = now ?? (() => new Date());
  const syncDeadline = deadlineMs - CALENDAR_SCHEDULED_CHANNEL_RESERVE_MS;
  const summary: ScheduledCalendarSyncSummary = {
    total: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
    localChanged: 0,
    channels: { renewed: 0, failed: 0, skipped: 0, deferred: 0 },
    listFailed: false,
  };

  let mappingIds: string[] = [];
  try {
    mappingIds = await listAllActiveMappingIds(ctx);
  } catch {
    summary.listFailed = true;
  }
  summary.total = mappingIds.length;
  for (const [index, mappingId] of mappingIds.entries()) {
    if (clock().getTime() >= syncDeadline) {
      summary.deferred = mappingIds.length - index;
      break;
    }
    try {
      const result = await syncCalendarMapping(ctx, mappingId, { deadline: syncDeadline, ...(now ? { now } : {}) });
      if (result.status === "synced") summary.synced += 1;
      else if (result.status === "skipped") summary.skipped += 1;
      else summary.failed += 1;
      if (result.localChanged) summary.localChanged += 1;
    } catch {
      summary.failed += 1;
    }
  }

  // 알림 channel 갱신은 남겨 둔 시간까지 쓴다(갱신 대상이 없거나 https 주소가 아니면 원격 요청 없음).
  summary.channels = await ensureGoogleWatchChannels(ctx, { deadline: deadlineMs, ...(now ? { now } : {}) });
  return summary;
}

/** log용 한 줄 JSON(개수만). */
export function serializeScheduledCalendarSyncSummary(summary: ScheduledCalendarSyncSummary): string {
  return JSON.stringify({ event: "scheduled_calendar_sync", ...summary });
}
