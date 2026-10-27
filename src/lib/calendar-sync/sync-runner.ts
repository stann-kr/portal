/**
 * 학생·매핑 단위로 동기화 엔진을 부르는 orchestration. server action이 아닌 일반 module이라
 * 여기 함수는 권한을 검사하지 않는다(호출하는 action이 먼저 검증한다).
 */
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { createDbContext, type DbContext, type DrizzleDb } from "@/db/client";
import { calendarConnections, calendarMappings } from "@/db/schema";
import { createCalendarClientForConnection } from "./client-factory";
import { runCalendarMappingSync, type SyncEngineMode, type SyncEngineResult } from "./engine";

/** 쓰기 action 뒤 push에 쓰는 시간 상한. 이 시간이 지나면 새 원격 요청을 시작하지 않는다. */
export const CALENDAR_SYNC_WRITE_HOOK_BUDGET_MS = 4_000;
/** 조회 시 동기화 시간 상한. 남은 항목은 다음 동기화가 이어 간다. */
export const CALENDAR_SYNC_READ_BUDGET_MS = 20_000;

type RunOptions = { force?: boolean; mode?: SyncEngineMode; deadline?: number; now?: () => Date };

function readDb(ctx: DbContext): DrizzleDb {
  return ctx.db as unknown as DrizzleDb;
}

export async function syncCalendarMapping(ctx: DbContext, mappingId: string, options: RunOptions = {}): Promise<SyncEngineResult> {
  const [row] = await readDb(ctx)
    .select({
      id: calendarConnections.id,
      provider: calendarConnections.provider,
      encryptedCredentials: calendarConnections.encryptedCredentials,
      credentialsIv: calendarConnections.credentialsIv,
    })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(eq(calendarMappings.id, mappingId))
    .limit(1);
  if (!row) return { status: "skipped", localChanged: false, reason: "missing" };
  return runCalendarMappingSync({
    ctx,
    mappingId,
    getClient: () => createCalendarClientForConnection(ctx, row),
    force: options.force,
    mode: options.mode,
    deadline: options.deadline,
    now: options.now,
  });
}

/** 학생의 활성 매핑 id(대개 0~2개). */
export async function listActiveMappingIdsForStudent(ctx: DbContext, studentId: string): Promise<string[]> {
  const rows = await readDb(ctx)
    .select({ id: calendarMappings.id })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(and(eq(calendarMappings.studentId, studentId), eq(calendarConnections.status, "ACTIVE")));
  return rows.map((row) => row.id);
}

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
  try {
    after(() => pushStudentCalendarChanges(studentId));
    return;
  } catch {
    // request scope 밖
  }
  await pushStudentCalendarChanges(studentId);
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
