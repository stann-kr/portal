/**
 * 학생·매핑 단위로 동기화 엔진을 부르는 orchestration. server action이 아닌 일반 module이라
 * 여기 함수는 권한을 검사하지 않는다(호출하는 action이 먼저 검증한다).
 */
import { runAfterResponse } from "@/lib/after-response";
import { createDbContext, type DbContext, type DrizzleDb } from "@/db/client";
import {
  listActiveMappingIdsForStudent,
  listGroupPeerMappingIdsForStudent,
  syncCalendarMapping,
  type RunOptions,
} from "./mapping-sync";
import { calendarMappings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureGoogleWatchChannel, ensureGoogleWatchChannelsForStudent, stopGoogleWatchChannelsFor } from "./push-channels";

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
    // 본인 학생·그룹 캘린더, 그다음 그룹 캘린더가 있으면 다른 멤버의 개인 캘린더(그룹레슨 여부가 바뀌었을 수 있다).
    const own = await listActiveMappingIdsForStudent(ctx, studentId);
    const peers = await listGroupPeerMappingIdsForStudent(ctx, studentId);
    const mappingIds = [...own, ...peers.filter((id) => !own.includes(id))];
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
 * 그룹 멤버가 바뀌었거나 그룹을 해제한 뒤(응답 뒤 best-effort): 관련 학생의 학생·그룹 캘린더를 push해 그룹레슨이
 * 그룹 캘린더와 개인 캘린더 중 맞는 쪽에만 있게 한다(2026-11-16 사용자 결정). 학생마다 시간 상한을 따로 쓴다.
 */
export async function schedulePushStudentsCalendarChanges(studentIds: readonly string[]): Promise<void> {
  const unique = [...new Set(studentIds)];
  if (unique.length === 0) return;
  await runAfterResponse(async () => {
    for (const studentId of unique) await pushStudentCalendarChanges(studentId);
  });
}

/** 그룹 해제 전에 그 그룹 캘린더들의 Google 변경 알림 channel을 멈춘다(best-effort, 매핑은 그룹 삭제 cascade로 지워진다). */
export async function stopGroupCalendarChannels(groupId: string, ctx?: DbContext): Promise<void> {
  await stopGoogleWatchChannelsFor(ctx ?? createDbContext(), { groupId }).catch(() => undefined);
}

/** 그룹 해제가 거부되면(그룹 노트 남음 등) 미리 멈춘 그룹 캘린더 channel을 다시 등록한다(best-effort). */
export async function restoreGroupCalendarChannels(groupId: string, ctx?: DbContext): Promise<void> {
  try {
    const context = ctx ?? createDbContext();
    const db = context.db as unknown as DrizzleDb;
    const rows = await db.select({ id: calendarMappings.id }).from(calendarMappings).where(eq(calendarMappings.groupId, groupId));
    for (const row of rows) await ensureGoogleWatchChannel(context, row.id).catch(() => undefined);
  } catch {
    // 다시 등록하지 못하면 다음 조회·예약 동기화가 channel을 갱신한다.
  }
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
