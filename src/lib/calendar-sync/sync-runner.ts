/**
 * 학생·매핑 단위로 동기화 엔진을 부르는 orchestration. server action이 아닌 일반 module이라
 * 여기 함수는 권한을 검사하지 않는다(호출하는 action이 먼저 검증한다).
 */
import { after } from "next/server";
import { createDbContext, type DbContext } from "@/db/client";
import { listActiveMappingIdsForStudent, syncCalendarMapping, type RunOptions } from "./mapping-sync";
import { ensureGoogleWatchChannelsForStudent } from "./push-channels";

export { listActiveMappingIdsForStudent, syncCalendarMapping } from "./mapping-sync";

/** 쓰기 action 뒤 push에 쓰는 시간 상한. 이 시간이 지나면 새 원격 요청을 시작하지 않는다. */
export const CALENDAR_SYNC_WRITE_HOOK_BUDGET_MS = 4_000;
/** 조회 시 동기화 시간 상한. 남은 항목은 다음 동기화가 이어 간다. */
export const CALENDAR_SYNC_READ_BUDGET_MS = 20_000;

/** 학생의 모든 활성 매핑을 동기화한다. 원격 오류는 매핑 last_error에만 남고 throw하지 않는다. */
export async function syncStudentCalendarMappings(ctx: DbContext, studentId: string, options: RunOptions = {}): Promise<{ localChanged: boolean }> {
  const mappingIds = await listActiveMappingIdsForStudent(ctx, studentId);
  let localChanged = false;
  for (const mappingId of mappingIds) {
    try {
      const result = await syncCalendarMapping(ctx, mappingId, options);
      if (result.localChanged) localChanged = true;
    } catch {
      // DB 오류 등 예상 밖 실패도 조회·쓰기 화면을 막지 않는다.
    }
  }
  return { localChanged };
}

/**
 * 레슨·일정 쓰기 action이 commit 뒤 부르는 best-effort push. 매핑이 없으면 query 하나로 끝나고,
 * 어떤 실패도 throw하지 않으며 새 원격 요청은 시간 상한 안에서만 시작한다.
 */
export async function pushStudentCalendarChanges(studentId: string, options: { ctx?: DbContext; budgetMs?: number } = {}): Promise<void> {
  try {
    const ctx = options.ctx ?? createDbContext();
    const mappingIds = await listActiveMappingIdsForStudent(ctx, studentId);
    if (mappingIds.length === 0) return;
    const deadline = Date.now() + (options.budgetMs ?? CALENDAR_SYNC_WRITE_HOOK_BUDGET_MS);
    for (const mappingId of mappingIds) {
      if (Date.now() >= deadline) return;
      await syncCalendarMapping(ctx, mappingId, { mode: "push", deadline }).catch(() => undefined);
    }
  } catch {
    // 로컬 쓰기는 이미 끝났다. 놓친 변경은 다음 동기화가 fingerprint 차이로 보낸다.
  }
}

/**
 * 쓰기 action용: 응답을 보낸 뒤(Next `after`, OpenNext에서는 Workers waitUntil) push해 저장 화면을 늦추지 않는다.
 * request scope 밖(테스트·스크립트)에서는 `after`가 throw하므로 그 자리에서 기다린다.
 */
export async function schedulePushStudentCalendarChanges(studentId: string): Promise<void> {
  await runAfterResponse(() => pushStudentCalendarChanges(studentId));
}

/**
 * 로컬 삭제와 함께 실행할 문장: 해당 학생 매핑의 link를 DELETED tombstone으로 남겨
 * 엔진이 원격 사본을 지우게 한다(행은 원격 remove 성공 뒤 엔진이 지운다).
 */
export function markLinksDeletedStatement(kind: "LESSON" | "EVENT", localId: string, studentId: string, now: Date = new Date()) {
  return {
    query:
      "UPDATE calendar_sync_links SET local_fingerprint = 'DELETED', updated_at = ? " +
      "WHERE local_kind = ? AND local_id = ? AND mapping_id IN (SELECT id FROM calendar_mappings WHERE student_id = ?)",
    params: [Math.floor(now.getTime() / 1_000), kind, localId, studentId],
  };
}

/** request scope 안이면 응답 뒤(Next `after` → Workers waitUntil), 밖(테스트·스크립트)이면 그 자리에서 실행한다. */
async function runAfterResponse(task: () => Promise<unknown>): Promise<void> {
  try {
    after(task);
    return;
  } catch {
    // request scope 밖
  }
  await task();
}

/** 알림 동기화 시간 상한(응답 뒤 after/waitUntil 안). lease가 잡혀 있으면 이 안에서 해제를 기다렸다가 다시 돈다. */
export const CALENDAR_SYNC_NOTIFY_BUDGET_MS = 20_000;
/** lease 해제를 확인하는 간격. 확인은 lease 획득 시도(UPDATE 한 문장)라 짧게 둔다. */
const NOTIFY_LEASE_POLL_MS = 1_000;

/**
 * Google 변경 알림을 받은 매핑을 응답 뒤 동기화한다(throttle 무시, lease 존중).
 * 다른 동기화가 lease를 잡고 있으면 알림을 버리지 않고 시간 상한 안에서 짧은 간격으로 lease 획득을 다시 시도해,
 * 진행 중 실행이 끝나면 강제 동기화를 한 번 돈다. 진행 중 실행도 lease를 풀기 전 꼬리 pull로 그 사이 변경을 반영한다(engine).
 * 남는 틈: 진행 중 실행의 꼬리 pull 뒤·lease 해제 전에 생긴 변경이면서 이 시간 상한도 다 쓴 경우만 남고,
 * 그 변경은 다음 조회·예약 동기화가 cursor로 반영한다.
 */
export async function runGoogleNotificationSync(
  mappingId: string,
  options: { ctx?: DbContext; budgetMs?: number; retryDelayMs?: number } = {},
): Promise<void> {
  try {
    const ctx = options.ctx ?? createDbContext();
    const deadline = Date.now() + (options.budgetMs ?? CALENDAR_SYNC_NOTIFY_BUDGET_MS);
    const pollMs = options.retryDelayMs ?? NOTIFY_LEASE_POLL_MS;
    for (;;) {
      const result = await syncCalendarMapping(ctx, mappingId, { force: true, deadline });
      if (result.status !== "skipped" || result.reason !== "lease") return;
      if (Date.now() + pollMs >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } catch {
    // 알림 처리 실패는 다음 조회·예약 동기화가 이어 간다.
  }
}

export function scheduleGoogleNotificationSync(mappingId: string): Promise<void> {
  return runAfterResponse(() => runGoogleNotificationSync(mappingId));
}

/** 조회 동기화 뒤: 그 학생의 Google 알림 channel이 없거나 곧 만료되면 응답 뒤 갱신한다(best-effort). */
export function scheduleEnsureStudentGoogleChannels(studentId: string, ctx?: DbContext): Promise<void> {
  return runAfterResponse(async () => {
    try {
      await ensureGoogleWatchChannelsForStudent(ctx ?? createDbContext(), studentId);
    } catch {
      // 갱신 실패는 조회를 막지 않는다.
    }
  });
}
