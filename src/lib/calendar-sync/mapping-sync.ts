/**
 * 매핑 하나·학생 하나를 동기화 엔진에 연결한다. `next/server`를 import하지 않아 worker.ts 예약 실행에서도 쓸 수 있다.
 * 여기 함수는 권한을 검사하지 않는다(호출하는 action·route가 먼저 검증한다).
 */
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import { calendarConnections, calendarMappings, lessonGroupMembers } from "@/db/schema";
import { createCalendarClientForConnection } from "./client-factory";
import { runCalendarMappingSync, type SyncEngineMode, type SyncEngineResult } from "./engine";

export type RunOptions = { force?: boolean; mode?: SyncEngineMode; deadline?: number; now?: () => Date };

function readDb(ctx: DbContext): DrizzleDb {
  return ctx.db as unknown as DrizzleDb;
}

/**
 * 매핑 하나를 동기화한다. 그룹 캘린더의 전체 동기화가 포탈 레슨·일정을 바꿨으면(원격에서 옮김·새 일정) 같은 그룹의
 * 다른 서비스 그룹 캘린더에도 바로 내보낸다(2026-11-16 사용자 결정: 그룹 캘린더끼리 따라간다). best-effort다.
 */
export async function syncCalendarMapping(ctx: DbContext, mappingId: string, options: RunOptions = {}): Promise<SyncEngineResult> {
  const result = await syncSingleMapping(ctx, mappingId, options);
  if (!result.localChanged) return result;
  const [mapping] = await readDb(ctx)
    .select({ groupId: calendarMappings.groupId })
    .from(calendarMappings)
    .where(eq(calendarMappings.id, mappingId))
    .limit(1);
  if (!mapping?.groupId) return result;
  const siblings = await readDb(ctx)
    .select({ id: calendarMappings.id })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(and(eq(calendarMappings.groupId, mapping.groupId), ne(calendarMappings.id, mappingId), eq(calendarConnections.status, "ACTIVE")));
  for (const sibling of siblings) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    await syncSingleMapping(ctx, sibling.id, { mode: "push", deadline: options.deadline, now: options.now }).catch(() => undefined);
  }
  return result;
}

async function syncSingleMapping(ctx: DbContext, mappingId: string, options: RunOptions): Promise<SyncEngineResult> {
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

/**
 * 학생의 활성 매핑 id(대개 0~4개): 학생 캘린더와 학생이 속한 그룹의 그룹 캘린더. 그룹 캘린더를 먼저 둔다
 * (원격에서 옮긴 그룹레슨을 먼저 반영한 뒤 개인 캘린더를 맞춘다).
 */
export async function listActiveMappingIdsForStudent(ctx: DbContext, studentId: string): Promise<string[]> {
  const db = readDb(ctx);
  const rows = await db
    .select({ id: calendarMappings.id, groupId: calendarMappings.groupId })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(and(
      eq(calendarConnections.status, "ACTIVE"),
      or(
        eq(calendarMappings.studentId, studentId),
        inArray(
          calendarMappings.groupId,
          db.select({ groupId: lessonGroupMembers.groupId }).from(lessonGroupMembers).where(eq(lessonGroupMembers.studentId, studentId)),
        ),
      ),
    ))
    .orderBy(sql`${calendarMappings.groupId} IS NULL`, asc(calendarMappings.id));
  return rows.map((row) => row.id);
}

/** 그룹 멤버들의 학생 캘린더 매핑 id(활성 연결만). 그룹 캘린더를 정하거나 풀 때 개인 캘린더의 그룹레슨을 맞추는 데 쓴다. */
export async function listActiveMemberMappingIdsForGroup(ctx: DbContext, groupId: string): Promise<string[]> {
  const db = readDb(ctx);
  const rows = await db
    .select({ id: calendarMappings.id })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(and(
      eq(calendarConnections.status, "ACTIVE"),
      inArray(
        calendarMappings.studentId,
        db.select({ studentId: lessonGroupMembers.studentId }).from(lessonGroupMembers).where(eq(lessonGroupMembers.groupId, groupId)),
      ),
    ))
    .orderBy(asc(calendarMappings.id));
  return rows.map((row) => row.id);
}

/**
 * 같은 그룹 다른 멤버의 학생 캘린더 매핑 id(그룹에 그룹 캘린더가 있을 때만, 활성 연결만).
 * 한 멤버가 레슨을 옮기거나 지우면 그 시각이 더는 그룹레슨이 아니라 다른 멤버의 레슨이 개인 캘린더로 돌아가야 한다.
 */
export async function listGroupPeerMappingIdsForStudent(ctx: DbContext, studentId: string): Promise<string[]> {
  const db = readDb(ctx);
  const [membership] = await db
    .select({ groupId: lessonGroupMembers.groupId })
    .from(lessonGroupMembers)
    .where(eq(lessonGroupMembers.studentId, studentId))
    .limit(1);
  if (!membership) return [];
  const [groupMapping] = await db
    .select({ id: calendarMappings.id })
    .from(calendarMappings)
    .where(eq(calendarMappings.groupId, membership.groupId))
    .limit(1);
  if (!groupMapping) return [];
  const rows = await db
    .select({ id: calendarMappings.id })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .innerJoin(lessonGroupMembers, eq(lessonGroupMembers.studentId, calendarMappings.studentId))
    .where(and(
      eq(calendarConnections.status, "ACTIVE"),
      eq(lessonGroupMembers.groupId, membership.groupId),
      ne(calendarMappings.studentId, studentId),
    ))
    .orderBy(asc(calendarMappings.id));
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
