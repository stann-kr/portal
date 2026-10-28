/**
 * 매핑 하나·학생 하나를 동기화 엔진에 연결한다. `next/server`를 import하지 않아 worker.ts 예약 실행에서도 쓸 수 있다.
 * 여기 함수는 권한을 검사하지 않는다(호출하는 action·route가 먼저 검증한다).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import { calendarConnections, calendarMappings } from "@/db/schema";
import { createCalendarClientForConnection } from "./client-factory";
import { runCalendarMappingSync, type SyncEngineMode, type SyncEngineResult } from "./engine";

export type RunOptions = { force?: boolean; mode?: SyncEngineMode; deadline?: number; now?: () => Date };

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
  // 이 실행의 client가 지금 쓰는 자격 증명 ciphertext(직접 갱신·다른 client 저장값 채택 때 바뀐다).
  let credentialsCiphertext = row.encryptedCredentials;
  return runCalendarMappingSync({
    ctx,
    mappingId,
    getClient: () => createCalendarClientForConnection(ctx, row, {
      onCredentialsChange: (encryptedCredentials) => {
        credentialsCiphertext = encryptedCredentials;
      },
    }),
    credentialsCiphertext: () => credentialsCiphertext,
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


/** 활성 연결의 모든 매핑 id. 가장 오래 동기화하지 않은 매핑부터(예약 실행이 시간 상한에 걸려도 돌아가며 처리). */
export async function listAllActiveMappingIds(ctx: DbContext): Promise<string[]> {
  const rows = await readDb(ctx)
    .select({ id: calendarMappings.id })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(eq(calendarConnections.status, "ACTIVE"))
    .orderBy(sql`${calendarMappings.lastSyncedAt} IS NOT NULL`, asc(calendarMappings.lastSyncedAt), asc(calendarMappings.id));
  return rows.map((row) => row.id);
}
