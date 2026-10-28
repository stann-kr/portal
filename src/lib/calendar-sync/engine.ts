/**
 * 포탈(hub) ↔ 원격 캘린더 한 매핑의 양방향 동기화 알고리즘.
 *
 * 결정(.docs/goals/assignments-guide-calendar/design.md "동기화 엔진 결정"):
 * - 충돌은 웹 우선. 원격 쓰기는 If-Match(etag)로 하고 412면 link의 remoteId로 현재 리소스(etag)를 다시 읽어
 *   로컬 내용으로 덮거나(update) 지운다(remove). portalRef 조회는 create 응답이 유실된 claim(remoteId 없음)에만 쓴다.
 * - 원격 → 로컬 반영은 읽은 로컬 값을 조건으로 UPDATE·DELETE한다. 그 사이 웹 수정이 있으면 다시 읽어 웹 우선으로 판단한다.
 * - 원격 create는 portalRef에서 나온 결정적 id로 멱등이다. lease는 원격 쓰기마다 조건부로 갱신하고 잃으면 멈춘다.
 * - 로컬 쓰기(원격 반영·가져오기·link·series)는 모두 lease 소유 조건을 첫 문장으로 둔 같은 batch에서 실행한다(fencing).
 *   lease를 잃어 되돌려지면 다시 시도하지 않고 멈춘다. 소유 중 웹 수정 경합이면 현재 원격·로컬로 다시 판단한다.
 * - 루프 방지는 calendar_sync_links + portalRef. 로컬 → 원격은 link(remote_id NULL)를 먼저 claim한 뒤 만든다.
 * - 로컬 삭제는 link local_fingerprint를 DELETED로 남기고, 원격 remove 성공 뒤 link를 지운다.
 * - 원격 새 일정(portalRef 없음)은 학생 calendar_events(NOTE)로 가져온다. 반복 일정은 calendar_remote_series 사본만 둔다.
 * - 레슨은 원격 제목 "레슨", 60분. 원격 변경은 scheduledAt만 반영한다.
 * - window = 지금 -90일 ~ +365일. 조회 동기화는 60초 throttle, 모든 동기화는 60초 lease.
 * - 전체 모드는 push 뒤 lease를 풀기 전 마지막 cursor로 꼬리 pull을 한 번 더 해 실행 중 원격 변경(알림이 lease에 막힌 변경)을 반영한다.
 * - 오류·NEEDS_REAUTH 기록도 lease 소유 조건으로만 한다. NEEDS_REAUTH는 이 실행이 쓴 자격 증명이 여전히 저장값일 때만 기록한다.
 *
 * DB·client·시계는 주입받아 단위 테스트에서 실제 SQLite와 가짜 provider로 검증한다.
 * 오류 메시지·lastError에는 token·암호·원격 본문을 넣지 않고 짧은 한국어 분류만 남긴다.
 */
import { and, eq, exists, gte, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import {
  calendarConnections,
  calendarEvents,
  calendarMappings,
  calendarRemoteSeries,
  calendarSyncLinks,
  lessons,
  type CalendarSyncLocalKind,
} from "@/db/schema";
import {
  DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  executeDocumentStatementsAtomically,
  type DocumentAtomicStatement,
} from "@/lib/document-lifecycle-atomic";
import {
  CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH,
  CALENDAR_EVENT_MAX_DURATION_MS,
  CALENDAR_EVENT_TITLE_MAX_LENGTH,
} from "@/lib/calendar-event-contract";
import { CalendarCredentialError } from "./credentials";
import {
  CALENDAR_SYNC_TIME_ZONE,
  CalendarAuthError,
  CalendarConflictError,
  CalendarNotFoundError,
  CalendarProviderError,
  CalendarRateLimitError,
  buildPortalRef,
  lessonToRemoteInput,
  normalizeRemoteEventInput,
  sha256Hex,
  wallTimeInZone,
  type CalendarProviderClient,
  type PullResult,
  type PullWindow,
  type RemoteEvent,
  type RemoteEventInput,
  type WriteResult,
} from "./types";

export const CALENDAR_SYNC_WINDOW_PAST_DAYS = 90;
export const CALENDAR_SYNC_WINDOW_FUTURE_DAYS = 365;
export const CALENDAR_SYNC_THROTTLE_MS = 60_000;
export const CALENDAR_SYNC_LEASE_MS = 60_000;
/** 한 번의 실행에서 원격 쓰기(create/update/remove) 상한. 나머지는 다음 동기화가 이어 간다. */
export const CALENDAR_SYNC_MAX_REMOTE_WRITES = 60;
export const DELETED_FINGERPRINT = "DELETED";
/**
 * 전체 재동기화에서 원격 목록에 안 보이는 연결 항목을 remoteId로 확인하는 최대 횟수(한 번 실행).
 * 상한을 넘은 항목은 지우지 않고, cursor를 저장하지 않아 다음 실행이 전체 재동기화로 이어서 확인한다.
 */
export const FULL_RESYNC_MISSING_LOOKUP_CAP = 20;
/** portalRef로 link를 다시 이은 직후 표시. 실제 fingerprint와 달라 다음 push가 로컬 내용으로 원격을 맞춘다. */
export const RELINKED_FINGERPRINT = "RELINKED";
export const LESSON_REMOTE_TITLE = "레슨";
/** 종료 시각이 없는 포탈 일정을 원격에 보낼 때의 길이. */
export const OPEN_EVENT_REMOTE_MINUTES = 60;
const MAX_SERIES_ICS_LENGTH = 262_144;
const DAY_MS = 24 * 60 * 60 * 1_000;

export const CALENDAR_SYNC_MESSAGES = {
  auth: "계정 인증이 만료되었거나 취소되었습니다. 계정을 다시 연결해 주세요.",
  credentials: "저장된 연결 정보를 읽을 수 없습니다. 계정을 다시 연결해 주세요.",
  rateLimited: "캘린더 서비스 요청이 많아 잠시 뒤 다시 동기화합니다.",
  calendarMissing: "연결된 원격 캘린더를 찾을 수 없습니다. 매핑을 다시 지정해 주세요.",
  provider: "캘린더 서비스와 동기화하지 못했습니다. 잠시 뒤 다시 시도합니다.",
  partial: "일부 일정을 원격 캘린더에 반영하지 못했습니다. 다음 동기화에서 다시 시도합니다.",
  googleNotConfigured: "설정 필요: Google 연동 설정(GOOGLE_CALENDAR_CLIENT_ID/SECRET)이 없어 동기화할 수 없습니다.",
  encryptionMissing: "설정 필요: 서버에 EXTERNAL_CALENDAR_ENCRYPTION_KEY가 없어 동기화할 수 없습니다.",
} as const;

/** 설정 누락처럼 사용자가 서버 설정으로만 고칠 수 있는 오류. */
export class CalendarSyncConfigError extends Error {}

export type SyncEngineMode = "full" | "push";

export type SyncEngineOptions = {
  ctx: DbContext;
  mappingId: string;
  /** lease를 잡은 뒤에만 부른다(token refresh·복호화 오류도 같은 오류 처리로 모은다). */
  getClient: () => Promise<CalendarProviderClient>;
  /**
   * 이 실행의 client가 지금 쓰는 연결 encrypted_credentials(갱신·저장값 채택으로 바뀔 수 있어 함수로 받는다).
   * 인증 실패는 연결의 저장값이 이 값과 같을 때만 NEEDS_REAUTH로 기록한다(재연결·다른 client의 더 새 갱신을 덮지 않는다).
   */
  credentialsCiphertext: () => string;
  now?: () => Date;
  /** true면 60초 throttle을 건너뛴다(lease는 항상 지킨다). */
  force?: boolean;
  /** push: 원격 pull 없이 로컬 변경만 보낸다(쓰기 action 직후 best-effort). */
  mode?: SyncEngineMode;
  /** epoch ms. 지나면 새 원격 요청을 시작하지 않고 멈춘다. */
  deadline?: number;
};

export type SyncEngineResult =
  | { status: "skipped"; localChanged: false; reason: "lease" | "throttled" | "inactive" | "missing" }
  | { status: "synced"; localChanged: boolean; partial: boolean }
  | { status: "failed"; localChanged: boolean; error: string; authFailed: boolean };

type LocalLesson = { kind: "LESSON"; id: string; start: Date };
type LocalEvent = { kind: "EVENT"; id: string; title: string; description: string | null; start: Date; end: Date | null };
export type LocalCalendarRow = LocalLesson | LocalEvent;

type LinkRow = typeof calendarSyncLinks.$inferSelect;

function readDb(ctx: DbContext): DrizzleDb {
  return ctx.db as unknown as DrizzleDb;
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

function persisted(date: Date): Date {
  return new Date(epochSeconds(date) * 1_000);
}

export function syncWindow(now: Date): PullWindow {
  return {
    from: new Date(now.getTime() - CALENDAR_SYNC_WINDOW_PAST_DAYS * DAY_MS),
    to: new Date(now.getTime() + CALENDAR_SYNC_WINDOW_FUTURE_DAYS * DAY_MS),
  };
}

function isKstMidnight(date: Date): boolean {
  const wall = wallTimeInZone(date, CALENDAR_SYNC_TIME_ZONE);
  return wall.hour === 0 && wall.minute === 0 && wall.second === 0;
}

/** 로컬 행을 원격 입력으로 바꾼다. 종료 없는 일정은 60분, KST 자정~자정(24시간 배수)은 종일로 보낸다. */
export function localRowToRemoteInput(row: LocalCalendarRow): RemoteEventInput {
  if (row.kind === "LESSON") {
    return lessonToRemoteInput({ lessonId: row.id, title: LESSON_REMOTE_TITLE, start: row.start, description: "" });
  }
  const end = row.end && row.end.getTime() > row.start.getTime()
    ? row.end
    : new Date(row.start.getTime() + OPEN_EVENT_REMOTE_MINUTES * 60_000);
  const duration = end.getTime() - row.start.getTime();
  const allDay = Boolean(row.end) && isKstMidnight(row.start) && isKstMidnight(end) && duration > 0 && duration % DAY_MS === 0;
  return {
    title: row.title,
    description: row.description ?? "",
    start: row.start,
    end,
    allDay,
    portalRef: buildPortalRef("event", row.id),
  };
}

/** 저장된 로컬 행 기준 fingerprint(정규화한 원격 입력의 제목·설명·시작·끝·종일). */
export async function localFingerprint(row: LocalCalendarRow): Promise<string> {
  const input = normalizeRemoteEventInput(localRowToRemoteInput(row));
  return sha256Hex([
    input.title,
    input.description ?? "",
    persisted(input.start).toISOString(),
    persisted(input.end).toISOString(),
    input.allDay ? "1" : "0",
  ].join("|"));
}

/** 원격 일정을 calendar_events 값으로 바꾼다(포탈 일정 입력 제한 안으로 자른다). */
export function remoteEventToLocalValues(remote: RemoteEvent): { title: string; description: string | null; start: Date; end: Date | null } {
  const title = remote.title.replace(/\s+/gu, " ").trim().slice(0, CALENDAR_EVENT_TITLE_MAX_LENGTH) || "일정";
  const description = remote.description.trim().slice(0, CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH) || null;
  const start = persisted(remote.start);
  let end: Date | null = persisted(remote.end);
  if (end.getTime() <= start.getTime()) end = null;
  else if (end.getTime() - start.getTime() > CALENDAR_EVENT_MAX_DURATION_MS) {
    end = new Date(start.getTime() + CALENDAR_EVENT_MAX_DURATION_MS);
  }
  return { title, description, start, end };
}

function parsePortalRef(value: string | undefined): { kind: CalendarSyncLocalKind; id: string } | null {
  const match = /^(lesson|event):(.+)$/u.exec(value ?? "");
  if (!match) return null;
  return { kind: match[1] === "lesson" ? "LESSON" : "EVENT", id: match[2] };
}

function linkKey(kind: CalendarSyncLocalKind, id: string): string {
  return `${kind}:${id}`;
}

function portalRefFor(kind: CalendarSyncLocalKind, id: string): string {
  return buildPortalRef(kind === "LESSON" ? "lesson" : "event", id);
}

/** 사용자에게 보일 짧은 한국어 분류. 원문 오류·본문은 넣지 않는다. */
export function calendarSyncErrorMessage(error: unknown): string {
  if (error instanceof CalendarSyncConfigError) return error.message;
  if (error instanceof CalendarCredentialError) return CALENDAR_SYNC_MESSAGES.credentials;
  if (error instanceof CalendarAuthError) return CALENDAR_SYNC_MESSAGES.auth;
  if (error instanceof CalendarRateLimitError) return CALENDAR_SYNC_MESSAGES.rateLimited;
  if (error instanceof CalendarNotFoundError) return CALENDAR_SYNC_MESSAGES.calendarMissing;
  return CALENDAR_SYNC_MESSAGES.provider;
}

function isAuthFailure(error: unknown): boolean {
  return error instanceof CalendarAuthError || error instanceof CalendarCredentialError;
}

/** 실행 전체를 멈춰야 하는 오류(인증·요청 제한). 나머지 항목 오류는 그 항목만 건너뛴다. */
function isFatal(error: unknown): boolean {
  return isAuthFailure(error) || error instanceof CalendarRateLimitError || error instanceof CalendarSyncConfigError;
}

class DeadlineReached extends Error {}
/** lease 소유권을 잃었다(만료 뒤 다른 실행이 잡음). 더 이상 원격·로컬에 쓰지 않고 멈춘다. */
class LeaseLost extends Error {}

// ── 로컬 행 읽기·쓰기 ─────────────────────────────────────

async function loadLocalRow(db: DrizzleDb, studentId: string, kind: CalendarSyncLocalKind, id: string): Promise<LocalCalendarRow | null> {
  if (kind === "LESSON") {
    const [row] = await db
      .select({ id: lessons.id, scheduledAt: lessons.scheduledAt })
      .from(lessons)
      .where(and(eq(lessons.id, id), eq(lessons.studentId, studentId)))
      .limit(1);
    return row ? { kind: "LESSON", id: row.id, start: row.scheduledAt } : null;
  }
  const [row] = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      description: calendarEvents.description,
      startTime: calendarEvents.startTime,
      endTime: calendarEvents.endTime,
    })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, studentId)))
    .limit(1);
  return row
    ? { kind: "EVENT", id: row.id, title: row.title, description: row.description, start: row.startTime, end: row.endTime }
    : null;
}

/**
 * 읽었던 로컬 값과 같을 때만 맞는 WHERE 조건(웹 수정과의 경합 방지). 뒤에 DOCUMENT_CONDITIONAL_WRITE_SENTINEL을
 * 붙이면 0행이면 batch 전체가 되돌려진다.
 */
function localRowGuard(row: LocalCalendarRow, studentId: string): { where: string; params: unknown[] } {
  if (row.kind === "LESSON") {
    return { where: "id = ? AND student_id = ? AND scheduled_at = ?", params: [row.id, studentId, epochSeconds(row.start)] };
  }
  return {
    where: "id = ? AND user_id = ? AND title = ? AND description IS ? AND start_time = ? AND end_time IS ?",
    params: [row.id, studentId, row.title, row.description, epochSeconds(row.start), row.end ? epochSeconds(row.end) : null],
  };
}

function deleteLocalRowStatement(row: LocalCalendarRow, studentId: string): DocumentAtomicStatement {
  const guard = localRowGuard(row, studentId);
  return { query: `DELETE FROM ${row.kind === "LESSON" ? "lessons" : "calendar_events"} WHERE ${guard.where}`, params: guard.params };
}

// ── 엔진 ──────────────────────────────────────────────────

type RunState = {
  ctx: DbContext;
  db: DrizzleDb;
  client: CalendarProviderClient;
  mappingId: string;
  studentId: string;
  calendarId: string;
  leaseId: string;
  now: () => Date;
  deadline?: number;
  links: LinkRow[];
  localChanged: boolean;
  itemFailures: number;
  remoteWrites: number;
  stopped: boolean;
  leaseLost: boolean;
  /** 전체 재동기화의 누락 확인이 상한에 걸려 남은 항목이 있다(cursor를 저장하지 않는다). */
  fullVerificationIncomplete: boolean;
};

function indexLinks(links: LinkRow[]) {
  const byRemote = new Map<string, LinkRow>();
  const byLocal = new Map<string, LinkRow>();
  for (const link of links) {
    if (link.remoteId) byRemote.set(link.remoteId, link);
    byLocal.set(linkKey(link.localKind, link.localId), link);
  }
  return { byRemote, byLocal };
}

async function loadLinks(state: RunState): Promise<void> {
  state.links = await state.db.select().from(calendarSyncLinks).where(eq(calendarSyncLinks.mappingId, state.mappingId));
}

/** drizzle 쿼리를 원자적 batch 문장으로 바꾼다(Date 등은 drizzle이 저장 값으로 변환한다). */
function toStatement(query: { toSQL(): { sql: string; params: unknown[] } }): DocumentAtomicStatement {
  const { sql, params } = query.toSQL();
  return { query: sql, params };
}

/**
 * lease fencing: batch 첫 문장으로 내 lease id일 때만 lease를 연장한다. 다른 실행이 lease를 이어받았으면 0행 →
 * sentinel이 batch 전체(로컬 행·link·series 쓰기)를 되돌린다.
 */
function leaseGuardStatements(state: RunState): DocumentAtomicStatement[] {
  return [
    {
      query: "UPDATE calendar_mappings SET sync_lease_until = ? WHERE id = ? AND sync_lease_id = ?",
      params: [epochSeconds(new Date(state.now().getTime() + CALENDAR_SYNC_LEASE_MS)), state.mappingId, state.leaseId],
    },
    DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  ];
}

async function stillOwnsLease(state: RunState): Promise<boolean> {
  const [row] = await state.db
    .select({ leaseId: calendarMappings.syncLeaseId })
    .from(calendarMappings)
    .where(eq(calendarMappings.id, state.mappingId))
    .limit(1);
  return row?.leaseId === state.leaseId;
}

/**
 * 동기화 중 모든 로컬 쓰기는 이 함수로 lease 소유 조건과 같은 batch에서 실행한다.
 * 되돌려지면 먼저 소유권을 확인한다: 잃었으면 LeaseLost(더 쓰지 않고 멈춤), 아직 소유자면 원래 오류를 올린다.
 */
async function executeFenced(state: RunState, statements: DocumentAtomicStatement[]): Promise<void> {
  if (state.leaseLost) throw new LeaseLost();
  try {
    await executeDocumentStatementsAtomically(state.ctx, [...leaseGuardStatements(state), ...statements]);
  } catch (error) {
    if (!(await stillOwnsLease(state))) {
      state.leaseLost = true;
      throw new LeaseLost();
    }
    throw error;
  }
}

async function updateLink(state: RunState, linkId: string, values: Partial<Pick<LinkRow, "remoteId" | "etag" | "localFingerprint" | "lastError">>): Promise<void> {
  await executeFenced(state, [
    toStatement(state.db.update(calendarSyncLinks).set({ ...values, updatedAt: state.now() }).where(eq(calendarSyncLinks.id, linkId))),
  ]);
}

async function deleteLink(state: RunState, linkId: string): Promise<void> {
  await executeFenced(state, [toStatement(state.db.delete(calendarSyncLinks).where(eq(calendarSyncLinks.id, linkId)))]);
}

async function loadLink(state: RunState, linkId: string): Promise<LinkRow | null> {
  const [row] = await state.db.select().from(calendarSyncLinks).where(eq(calendarSyncLinks.id, linkId)).limit(1);
  return row ?? null;
}

function assertCanWrite(state: RunState): void {
  if (state.remoteWrites >= CALENDAR_SYNC_MAX_REMOTE_WRITES) throw new DeadlineReached();
  if (state.deadline !== undefined && state.now().getTime() >= state.deadline) throw new DeadlineReached();
}

/**
 * lease를 조건부로 연장한다(내 lease id일 때만). 다른 실행이 만료된 lease를 잡았으면 LeaseLost로 멈춘다.
 * 원격 쓰기 직전마다 부르므로 쓰기 한 번(제한 시간 5초)이 끝나기 전에 다른 실행이 lease를 잡을 수 없다.
 */
async function renewLease(state: RunState): Promise<void> {
  if (state.leaseLost) throw new LeaseLost();
  const rows = await state.db
    .update(calendarMappings)
    .set({ syncLeaseUntil: new Date(state.now().getTime() + CALENDAR_SYNC_LEASE_MS) })
    .where(and(eq(calendarMappings.id, state.mappingId), eq(calendarMappings.syncLeaseId, state.leaseId)))
    .returning({ id: calendarMappings.id });
  if (rows.length === 0) {
    state.leaseLost = true;
    throw new LeaseLost();
  }
}

async function remoteCall<T>(state: RunState, call: () => Promise<T>): Promise<T> {
  assertCanWrite(state);
  await renewLease(state);
  state.remoteWrites += 1;
  return call();
}

// ── pull 적용 ──

async function importRemoteEvent(state: RunState, remote: RemoteEvent): Promise<void> {
  const values = remoteEventToLocalValues(remote);
  const id = crypto.randomUUID();
  const fingerprint = await localFingerprint({ kind: "EVENT", id, ...values });
  const nowSeconds = epochSeconds(state.now());
  await executeFenced(state, [
    {
      query:
        "INSERT INTO calendar_events (id, user_id, event_type, title, start_time, end_time, description, created_at) VALUES (?, ?, 'NOTE', ?, ?, ?, ?, ?)",
      params: [id, state.studentId, values.title, epochSeconds(values.start), values.end ? epochSeconds(values.end) : null, values.description, nowSeconds],
    },
    {
      query:
        "INSERT INTO calendar_sync_links (id, mapping_id, local_kind, local_id, remote_id, etag, local_fingerprint, created_at, updated_at) VALUES (?, ?, 'EVENT', ?, ?, ?, ?, ?, ?)",
      params: [crypto.randomUUID(), state.mappingId, id, remote.remoteId, remote.etag, fingerprint, nowSeconds, nowSeconds],
    },
  ]);
  state.localChanged = true;
}

/** 조건부 batch가 0행(웹 수정 경합)으로 되돌려지면 한 번 다시 읽어 판단한다. 그래도 실패하면 오류를 올린다. */
const MAX_CONDITIONAL_ATTEMPTS = 2;

/**
 * 조건부 batch가 되돌려졌고 lease는 아직 내 것이다(웹 수정 경합). 이전 pull 결과를 다시 쓰지 않고,
 * 최신 link와 remoteId로 다시 읽은 현재 원격 상태로 처음부터 판단한다.
 */
async function reevaluateLinked(state: RunState, link: LinkRow, attempt: number): Promise<void> {
  const fresh = await loadLink(state, link.id);
  if (!fresh || !fresh.remoteId || fresh.remoteId !== link.remoteId) return;
  const current = await state.client.get(state.calendarId, fresh.remoteId);
  if (!current || current.status === "cancelled") {
    await applyRemoteDeletion(state, fresh, attempt);
    return;
  }
  if (current.recurring) return; // 반복으로 바뀐 리소스는 건드리지 않는다.
  await applyRemoteToLinked(state, fresh, current, attempt);
}

/** 원격 변경을 연결된 로컬 행에 반영한다(로컬이 마지막 동기화 뒤 그대로일 때만). */
async function applyRemoteToLinked(state: RunState, link: LinkRow, remote: RemoteEvent, attempt = 1): Promise<void> {
  if (link.etag === remote.etag) return;
  if (link.localFingerprint === DELETED_FINGERPRINT) return;
  const local = await loadLocalRow(state.db, state.studentId, link.localKind, link.localId);
  if (!local) return; // push 단계가 원격 사본을 지운다.
  const current = await localFingerprint(local);
  if (current !== link.localFingerprint) {
    // 웹 우선: 원격 내용을 버리고 새 etag로 push 단계가 덮는다.
    await updateLink(state, link.id, { etag: remote.etag });
    return;
  }
  let next: LocalCalendarRow;
  const nowSeconds = epochSeconds(state.now());
  const statements: DocumentAtomicStatement[] = [];
  // 읽었던 값과 같을 때만 바꾼다. 그 사이 웹 수정이 있으면 0행 → sentinel이 batch 전체를 되돌린다.
  const guard = localRowGuard(local, state.studentId);
  if (local.kind === "LESSON") {
    // 레슨은 시간만 반영한다(제목·설명·길이 변경은 무시).
    next = { ...local, start: persisted(remote.start) };
    statements.push({
      query: `UPDATE lessons SET scheduled_at = ? WHERE ${guard.where}`,
      params: [epochSeconds(next.start), ...guard.params],
    });
  } else {
    const values = remoteEventToLocalValues(remote);
    next = { ...local, ...values };
    statements.push({
      query: `UPDATE calendar_events SET title = ?, description = ?, start_time = ?, end_time = ? WHERE ${guard.where}`,
      params: [values.title, values.description, epochSeconds(values.start), values.end ? epochSeconds(values.end) : null, ...guard.params],
    });
  }
  statements.push(DOCUMENT_CONDITIONAL_WRITE_SENTINEL);
  const nextFingerprint = await localFingerprint(next);
  statements.push(
    {
      query: "UPDATE calendar_sync_links SET etag = ?, local_fingerprint = ?, last_error = NULL, updated_at = ? WHERE id = ? AND local_fingerprint = ?",
      params: [remote.etag, nextFingerprint, nowSeconds, link.id, link.localFingerprint],
    },
    DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  );
  try {
    await executeFenced(state, statements);
  } catch (error) {
    // lease를 잃었으면 다시 시도하지 않고 멈춘다(이어받은 실행의 반영을 덮지 않는다).
    if (error instanceof LeaseLost) throw error;
    // 웹 수정·삭제와 겹쳤다. 현재 원격·로컬로 다시 판단한다(로컬이 바뀌었으면 push 단계가 로컬 내용을 보낸다).
    if (attempt >= MAX_CONDITIONAL_ATTEMPTS) throw error;
    await reevaluateLinked(state, link, attempt + 1);
    return;
  }
  if (nextFingerprint !== current) state.localChanged = true;
}

/** 원격에서 사라진 연결 항목: 로컬이 그대로면 지우고, 바뀌었으면(웹 우선) 다시 만들도록 link를 비운다. */
async function applyRemoteDeletion(state: RunState, link: LinkRow, attempt = 1): Promise<void> {
  if (link.localFingerprint === DELETED_FINGERPRINT) {
    await deleteLink(state, link.id);
    return;
  }
  const local = await loadLocalRow(state.db, state.studentId, link.localKind, link.localId);
  if (!local) {
    await deleteLink(state, link.id);
    return;
  }
  const current = await localFingerprint(local);
  if (current !== link.localFingerprint) {
    await updateLink(state, link.id, { remoteId: null, etag: null });
    return;
  }
  try {
    await executeFenced(state, [
      deleteLocalRowStatement(local, state.studentId),
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      { query: "DELETE FROM calendar_sync_links WHERE id = ? AND local_fingerprint = ?", params: [link.id, link.localFingerprint] },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]);
  } catch (error) {
    if (error instanceof LeaseLost) throw error;
    // 읽은 뒤 웹에서 바뀌었다. 현재 원격·로컬로 다시 판단한다(바뀌었으면 지우지 않고 원격에 다시 만든다).
    if (attempt >= MAX_CONDITIONAL_ATTEMPTS) throw error;
    await reevaluateLinked(state, link, attempt + 1);
    return;
  }
  state.localChanged = true;
}

async function upsertSeries(state: RunState, remote: RemoteEvent): Promise<void> {
  if (!remote.seriesIcs || !remote.seriesKey || remote.seriesIcs.length > MAX_SERIES_ICS_LENGTH) return;
  const values = {
    mappingId: state.mappingId,
    remoteId: remote.remoteId,
    seriesKey: remote.seriesKey,
    etag: remote.etag,
    icsText: remote.seriesIcs,
    updatedAt: state.now(),
  };
  await executeFenced(state, [
    toStatement(state.db
      .insert(calendarRemoteSeries)
      .values(values)
      .onConflictDoUpdate({
        target: [calendarRemoteSeries.mappingId, calendarRemoteSeries.remoteId],
        set: { seriesKey: values.seriesKey, etag: values.etag, icsText: values.icsText, updatedAt: values.updatedAt },
      })),
  ]);
}

async function deleteSeries(state: RunState, remoteId: string): Promise<void> {
  await executeFenced(state, [
    toStatement(state.db
      .delete(calendarRemoteSeries)
      .where(and(eq(calendarRemoteSeries.mappingId, state.mappingId), eq(calendarRemoteSeries.remoteId, remoteId)))),
  ]);
}

async function applyPull(state: RunState, result: PullResult, full: boolean, window: PullWindow): Promise<void> {
  await renewLease(state);
  let { byRemote, byLocal } = indexLinks(state.links);
  const seen = new Set<string>();

  for (const remote of result.changed) {
    seen.add(remote.remoteId);
    const linked = byRemote.get(remote.remoteId);
    if (remote.recurring) {
      // 반복 일정은 읽기 전용 사본만. 이미 포탈 항목과 이어진 원격 일정이 반복으로 바뀐 경우는 건드리지 않는다.
      if (!linked) await upsertSeries(state, remote);
      continue;
    }
    if (remote.status === "cancelled") {
      if (linked) await applyRemoteDeletion(state, linked);
      continue;
    }
    if (linked) {
      await applyRemoteToLinked(state, linked, remote);
      continue;
    }
    // 반복이던 원격 일정이 단일로 바뀌었으면 이전 사본을 지운다.
    await deleteSeries(state, remote.remoteId);
    const ref = parsePortalRef(remote.portalRef);
    if (ref) {
      const byLocalLink = byLocal.get(linkKey(ref.kind, ref.id));
      if (byLocalLink) {
        if (!byLocalLink.remoteId) {
          // create 응답 유실 복구: link에 원격 id를 채운다. fingerprint는 claim 때 값이라 로컬이 바뀌었으면 push가 덮는다.
          await updateLink(state, byLocalLink.id, { remoteId: remote.remoteId, etag: remote.etag, lastError: null });
          await loadLinks(state);
          ({ byRemote, byLocal } = indexLinks(state.links));
        }
        continue; // 다른 원격 id에 이미 이어진 사본은 가져오지 않는다.
      }
      const local = await loadLocalRow(state.db, state.studentId, ref.kind, ref.id);
      if (!local) continue; // 다른 학생·이미 지운 포탈 항목의 원격 사본은 가져오지 않는다.
      await executeFenced(state, [
        toStatement(state.db.insert(calendarSyncLinks).values({
          id: crypto.randomUUID(),
          mappingId: state.mappingId,
          localKind: ref.kind,
          localId: ref.id,
          remoteId: remote.remoteId,
          etag: remote.etag,
          localFingerprint: RELINKED_FINGERPRINT,
          createdAt: state.now(),
          updatedAt: state.now(),
        }).onConflictDoNothing()),
      ]);
      await loadLinks(state);
      ({ byRemote, byLocal } = indexLinks(state.links));
      continue;
    }
    if (remote.start.getTime() < window.from.getTime() || remote.start.getTime() > window.to.getTime()) continue;
    await importRemoteEvent(state, remote);
  }

  for (const remoteId of result.deletedRemoteIds) {
    seen.add(remoteId);
    await deleteSeries(state, remoteId);
    const linked = byRemote.get(remoteId);
    if (linked) await applyRemoteDeletion(state, linked);
  }

  if (full) {
    // 전체 pull은 window 안 상태 전부다. window 안 로컬 항목의 원격 사본이 목록에 없으면 지워졌거나 window 밖으로 옮겨졌다.
    await loadLinks(state);
    let missingLookups = 0;
    for (const link of state.links) {
      if (!link.remoteId || seen.has(link.remoteId) || link.localFingerprint === DELETED_FINGERPRINT) continue;
      const local = await loadLocalRow(state.db, state.studentId, link.localKind, link.localId);
      if (!local) continue;
      if (local.start.getTime() < window.from.getTime() || local.start.getTime() > window.to.getTime()) continue;
      if (missingLookups >= FULL_RESYNC_MISSING_LOOKUP_CAP) {
        // 지우지 않는다. cursor를 저장하지 않아 다음 실행이 전체 재동기화로 이어서 확인한다.
        state.fullVerificationIncomplete = true;
        continue;
      }
      missingLookups += 1;
      await renewLease(state);
      // remoteId로 존재를 확인한다(가져온 일정은 portalRef가 없다). 있으면 옮겨진 내용을 웹 우선 정책으로 반영한다.
      const found = await state.client.get(state.calendarId, link.remoteId);
      if (found) {
        if (!found.recurring) await applyRemoteToLinked(state, link, found);
        continue;
      }
      await applyRemoteDeletion(state, link);
    }
    const seriesRows = await state.db
      .select({ remoteId: calendarRemoteSeries.remoteId })
      .from(calendarRemoteSeries)
      .where(eq(calendarRemoteSeries.mappingId, state.mappingId));
    for (const row of seriesRows) {
      if (!seen.has(row.remoteId)) await deleteSeries(state, row.remoteId);
    }
  }
}

// ── push ──

async function loadLocalRowsForPush(state: RunState, window: PullWindow): Promise<LocalCalendarRow[]> {
  const linkedIds = (kind: CalendarSyncLocalKind) =>
    state.db
      .select({ id: calendarSyncLinks.localId })
      .from(calendarSyncLinks)
      .where(and(eq(calendarSyncLinks.mappingId, state.mappingId), eq(calendarSyncLinks.localKind, kind)));
  const [lessonRows, eventRows] = await Promise.all([
    state.db
      .select({ id: lessons.id, scheduledAt: lessons.scheduledAt })
      .from(lessons)
      .where(and(
        eq(lessons.studentId, state.studentId),
        or(
          and(gte(lessons.scheduledAt, window.from), lte(lessons.scheduledAt, window.to)),
          inArray(lessons.id, linkedIds("LESSON")),
        ),
      )),
    state.db
      .select({
        id: calendarEvents.id,
        title: calendarEvents.title,
        description: calendarEvents.description,
        startTime: calendarEvents.startTime,
        endTime: calendarEvents.endTime,
      })
      .from(calendarEvents)
      .where(and(
        eq(calendarEvents.userId, state.studentId),
        or(
          and(gte(calendarEvents.startTime, window.from), lte(calendarEvents.startTime, window.to)),
          inArray(calendarEvents.id, linkedIds("EVENT")),
        ),
      )),
  ]);
  return [
    ...lessonRows.map((row): LocalCalendarRow => ({ kind: "LESSON", id: row.id, start: row.scheduledAt })),
    ...eventRows.map((row): LocalCalendarRow => ({
      kind: "EVENT",
      id: row.id,
      title: row.title,
      description: row.description,
      start: row.startTime,
      end: row.endTime,
    })),
  ];
}

async function createRemote(state: RunState, input: RemoteEventInput): Promise<WriteResult> {
  return remoteCall(state, () => state.client.create(state.calendarId, input));
}

async function findLive(state: RunState, portalRef: string): Promise<RemoteEvent | null> {
  const found = await state.client.findByPortalRef(state.calendarId, portalRef);
  return found && found.status !== "cancelled" && !found.recurring ? found : null;
}

/** link의 원격 리소스를 remoteId로 다시 읽는다(412 복구). 반복 일정으로 바뀐 리소스는 덮지 않고 항목 오류로 남긴다. */
async function getLinkedRemote(state: RunState, remoteId: string): Promise<RemoteEvent | null> {
  const found = await state.client.get(state.calendarId, remoteId);
  if (found?.recurring) throw new CalendarProviderError("Linked remote event became recurring");
  return found;
}

/** 로컬 내용으로 원격을 맞춘다(웹 우선). */
async function writeLocalToRemote(state: RunState, link: LinkRow, input: RemoteEventInput): Promise<WriteResult> {
  if (!link.remoteId) {
    // create 응답이 유실된 claim: 포탈이 만든 사본은 portalRef로 찾는다(create 자체도 결정적 id라 멱등).
    const found = await findLive(state, input.portalRef);
    if (found) return remoteCall(state, () => state.client.update(state.calendarId, found.remoteId, input, found.etag));
    return createRemote(state, input);
  }
  const remoteId = link.remoteId;
  try {
    return await remoteCall(state, () => state.client.update(state.calendarId, remoteId, input, link.etag ?? "*"));
  } catch (error) {
    if (error instanceof CalendarConflictError) {
      // 원격이 바뀌었다. 같은 리소스의 최신 etag로 다시 덮는다(가져온 일정도 remoteId로 찾으므로 사본을 새로 만들지 않는다).
      const fresh = await getLinkedRemote(state, remoteId);
      if (fresh) return remoteCall(state, () => state.client.update(state.calendarId, fresh.remoteId, input, fresh.etag));
      return createRemote(state, input);
    }
    if (error instanceof CalendarNotFoundError) return createRemote(state, input);
    throw error;
  }
}

async function pushRow(state: RunState, row: LocalCalendarRow, link: LinkRow | undefined): Promise<void> {
  const fingerprint = await localFingerprint(row);
  if (link && link.remoteId && link.localFingerprint === fingerprint) return;
  assertCanWrite(state);
  const input = localRowToRemoteInput(row);
  let target = link;
  if (!target) {
    const claimId = crypto.randomUUID();
    await executeFenced(state, [
      toStatement(state.db.insert(calendarSyncLinks).values({
        id: claimId,
        mappingId: state.mappingId,
        localKind: row.kind,
        localId: row.id,
        remoteId: null,
        etag: null,
        localFingerprint: fingerprint,
        createdAt: state.now(),
        updatedAt: state.now(),
      }).onConflictDoNothing()),
    ]);
    const claimed = await loadLink(state, claimId);
    if (!claimed) return; // 다른 실행이 먼저 claim했다.
    target = claimed;
    const created = await createRemote(state, input);
    await saveWrite(state, target, created, fingerprint);
    return;
  }
  const written = await writeLocalToRemote(state, target, input);
  await saveWrite(state, target, written, fingerprint);
}

async function saveWrite(state: RunState, link: LinkRow, written: WriteResult, fingerprint: string): Promise<void> {
  try {
    await updateLink(state, link.id, { remoteId: written.remoteId, etag: written.etag, localFingerprint: fingerprint, lastError: null });
  } catch (error) {
    // 원격 응답 뒤라도 lease를 잃었으면 link를 쓰지 않는다(이어받은 실행이 portalRef·fingerprint로 다시 맞춘다).
    if (error instanceof LeaseLost) throw error;
    // 같은 원격 id가 다른 link에 이미 있으면(드문 재연결) 이 link는 다음 동기화가 portalRef로 다시 맞춘다.
    await updateLink(state, link.id, { lastError: CALENDAR_SYNC_MESSAGES.partial });
  }
}

async function removeRemote(state: RunState, link: LinkRow): Promise<void> {
  const removeFound = async (found: RemoteEvent | null) => {
    if (!found) return;
    try {
      await remoteCall(state, () => state.client.remove(state.calendarId, found.remoteId, found.etag));
    } catch (error) {
      if (!(error instanceof CalendarNotFoundError)) throw error;
    }
  };
  if (!link.remoteId) {
    await removeFound(await findLive(state, portalRefFor(link.localKind, link.localId)));
  } else {
    const remoteId = link.remoteId;
    try {
      await remoteCall(state, () => state.client.remove(state.calendarId, remoteId, link.etag ?? "*"));
    } catch (error) {
      // 412: 원격이 바뀌었어도 웹 삭제가 우선이다. 같은 리소스의 최신 etag로 다시 지운다(다시 충돌하면 link를 남겨 다음 실행이 재시도).
      if (error instanceof CalendarConflictError) await removeFound(await state.client.get(state.calendarId, remoteId));
      else if (!(error instanceof CalendarNotFoundError)) throw error;
    }
  }
  await deleteLink(state, link.id);
}

async function runItem(state: RunState, linkId: string | null, work: () => Promise<void>): Promise<void> {
  if (state.stopped) return;
  try {
    await work();
  } catch (error) {
    if (error instanceof DeadlineReached || error instanceof LeaseLost) {
      state.stopped = true;
      return;
    }
    if (isFatal(error)) throw error;
    state.itemFailures += 1;
    if (linkId) await updateLink(state, linkId, { lastError: calendarSyncErrorMessage(error) }).catch(() => undefined);
  }
}

async function pushLocal(state: RunState, window: PullWindow): Promise<void> {
  if (state.leaseLost) return;
  await loadLinks(state);
  const { byLocal } = indexLinks(state.links);
  const rows = await loadLocalRowsForPush(state, window);
  const present = new Set<string>();
  for (const row of rows) {
    const key = linkKey(row.kind, row.id);
    present.add(key);
    const link = byLocal.get(key);
    // DELETED link인데 로컬 행이 남아 있으면 fingerprint가 달라 로컬 내용으로 다시 맞춘다.
    await runItem(state, link?.id ?? null, () => pushRow(state, row, link));
  }
  for (const link of state.links) {
    const orphan = link.localFingerprint === DELETED_FINGERPRINT || !present.has(linkKey(link.localKind, link.localId));
    if (!orphan) continue;
    // DELETED인데 로컬 행이 남아 있으면 위에서 다시 push했으므로 지우지 않는다.
    if (present.has(linkKey(link.localKind, link.localId))) continue;
    await runItem(state, link.id, () => removeRemote(state, link));
  }
}

// ── 꼬리 pull ──

/**
 * push 뒤 lease를 풀기 전에 마지막 cursor로 증분 pull을 한 번 더 해 실행 중에 원격에 생긴 변경을 반영한다.
 * 이 실행이 lease를 쥔 동안 온 Google 알림은 lease에 막히므로(sync-runner가 lease 해제를 기다려 다시 돌지만
 * 시간 상한이 있다) 그 변경이 여기서 들어온다. 한 번만 한다(상한: provider pull 한 번의 page 상한).
 * 남는 틈: 꼬리 pull 뒤 lease 해제 전에 생긴 변경 + 알림 쪽 시간 상한 소진이 겹치면 다음 조회·예약 동기화가 반영한다.
 */
async function tailPull(state: RunState, cursor: string | null, window: PullWindow, ownsLease: SQL): Promise<void> {
  if (state.leaseLost || state.stopped || cursor === null) return;
  if (state.deadline !== undefined && state.now().getTime() >= state.deadline) return;
  await renewLease(state);
  const result = await state.client.pull(state.calendarId, cursor, window);
  // cursor 재설정(410 등)은 다음 실행이 전체 재동기화로 처리한다. cursor는 그대로 둔다.
  if (result.fullResync) return;
  // push가 link를 바꿨다. 다시 읽어야 이번 실행이 쓴 원격 변경(같은 etag)을 원격 변경으로 오인하지 않는다.
  await loadLinks(state);
  await applyPull(state, result, false, window);
  const nextCursor = result.nextCursor || cursor;
  const saved = await state.db.update(calendarMappings).set({ cursor: nextCursor }).where(ownsLease).returning({ id: calendarMappings.id });
  if (saved.length === 0) throw new LeaseLost();
}

// ── lease ──

async function acquireLease(ctx: DbContext, mappingId: string, now: Date, force: boolean): Promise<string | null> {
  const db = readDb(ctx);
  const leaseId = crypto.randomUUID();
  const throttleBefore = new Date(now.getTime() - CALENDAR_SYNC_THROTTLE_MS);
  const conditions = [
    eq(calendarMappings.id, mappingId),
    or(isNull(calendarMappings.syncLeaseUntil), lt(calendarMappings.syncLeaseUntil, now)),
  ];
  if (!force) conditions.push(lte(calendarMappings.updatedAt, throttleBefore));
  const rows = await db
    .update(calendarMappings)
    .set({ syncLeaseUntil: new Date(now.getTime() + CALENDAR_SYNC_LEASE_MS), syncLeaseId: leaseId })
    .where(and(...conditions))
    .returning({ id: calendarMappings.id });
  return rows.length > 0 ? leaseId : null;
}

async function releaseLease(ctx: DbContext, mappingId: string, leaseId: string): Promise<void> {
  await readDb(ctx)
    .update(calendarMappings)
    .set({ syncLeaseUntil: null, syncLeaseId: null })
    .where(and(eq(calendarMappings.id, mappingId), eq(calendarMappings.syncLeaseId, leaseId)));
}

/** 매핑 하나를 동기화한다. 원격 오류는 throw하지 않고 mapping/connection last_error에 남긴다. */
export async function runCalendarMappingSync(options: SyncEngineOptions): Promise<SyncEngineResult> {
  const now = options.now ?? (() => new Date());
  const mode = options.mode ?? "full";
  const db = readDb(options.ctx);
  const [mapping] = await db
    .select({
      id: calendarMappings.id,
      studentId: calendarMappings.studentId,
      remoteCalendarId: calendarMappings.remoteCalendarId,
      cursor: calendarMappings.cursor,
      updatedAt: calendarMappings.updatedAt,
      connectionId: calendarMappings.connectionId,
      connectionStatus: calendarConnections.status,
    })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(eq(calendarMappings.id, options.mappingId))
    .limit(1);
  if (!mapping) return { status: "skipped", localChanged: false, reason: "missing" };
  if (mapping.connectionStatus !== "ACTIVE") return { status: "skipped", localChanged: false, reason: "inactive" };

  const startedAt = now();
  const force = Boolean(options.force) || mode === "push";
  const leaseId = await acquireLease(options.ctx, mapping.id, startedAt, force);
  if (!leaseId) {
    const throttled = !force && mapping.updatedAt.getTime() > startedAt.getTime() - CALENDAR_SYNC_THROTTLE_MS;
    return { status: "skipped", localChanged: false, reason: throttled ? "throttled" : "lease" };
  }

  const state: RunState = {
    ctx: options.ctx,
    db,
    client: undefined as unknown as CalendarProviderClient,
    mappingId: mapping.id,
    studentId: mapping.studentId,
    calendarId: mapping.remoteCalendarId,
    leaseId,
    now,
    deadline: options.deadline,
    links: [],
    localChanged: false,
    itemFailures: 0,
    remoteWrites: 0,
    stopped: false,
    leaseLost: false,
    fullVerificationIncomplete: false,
  };
  const ownsLease = and(eq(calendarMappings.id, mapping.id), eq(calendarMappings.syncLeaseId, leaseId))!;
  try {
    state.client = await options.getClient();
    const window = syncWindow(startedAt);
    let nextCursor: string | null = mapping.cursor;
    if (mode === "full") {
      await loadLinks(state);
      let full = mapping.cursor === null;
      let result = await state.client.pull(mapping.remoteCalendarId, mapping.cursor, window);
      if (result.fullResync) {
        full = true;
        result = await state.client.pull(mapping.remoteCalendarId, null, window);
        if (result.fullResync) throw new CalendarRateLimitError("Calendar provider kept resetting the sync cursor");
      }
      await applyPull(state, result, full, window);
      // 전체 재동기화의 누락 확인이 남았으면 cursor를 비워 둬 다음 실행이 전체 확인을 이어 간다.
      nextCursor = state.fullVerificationIncomplete ? null : result.nextCursor || null;
      // 원격 반영이 끝났으므로 push가 중간에 멈춰도 cursor는 저장한다(push는 fingerprint로 다시 찾는다). lease를 잃었으면 쓰지 않는다.
      const saved = await db.update(calendarMappings).set({ cursor: nextCursor }).where(ownsLease).returning({ id: calendarMappings.id });
      if (saved.length === 0) throw new LeaseLost();
    }
    await pushLocal(state, window);
    if (mode === "full") await tailPull(state, nextCursor, window, ownsLease);
    const finishedAt = now();
    const lastError = state.itemFailures > 0 ? CALENDAR_SYNC_MESSAGES.partial : null;
    if (state.leaseLost) {
      // 다른 실행이 이어받았다. 그 실행의 상태 기록을 덮지 않는다.
    } else if (mode === "full") {
      await db
        .update(calendarMappings)
        .set({ lastSyncedAt: finishedAt, lastError, updatedAt: finishedAt })
        .where(ownsLease);
    } else if (lastError) {
      await db.update(calendarMappings).set({ lastError, updatedAt: finishedAt }).where(ownsLease);
    }
    return {
      status: "synced",
      localChanged: state.localChanged,
      partial: state.itemFailures > 0 || state.stopped || state.fullVerificationIncomplete,
    };
  } catch (error) {
    if (error instanceof LeaseLost) {
      // 소유권을 잃은 실행은 오류를 기록하지 않고 멈춘다(이어받은 실행이 처리한다).
      return { status: "synced", localChanged: state.localChanged, partial: true };
    }
    const message = calendarSyncErrorMessage(error);
    const authFailed = isAuthFailure(error);
    const finishedAt = now();
    // 오류 기록도 lease를 아직 가진 실행만 한다. 만료 뒤 다른 실행이 이어받았으면 그 실행의 상태·연결을 덮지 않는다.
    const recorded = await db
      .update(calendarMappings)
      .set({ lastError: message, updatedAt: finishedAt })
      .where(ownsLease)
      .returning({ id: calendarMappings.id })
      .catch(() => null);
    if (recorded && recorded.length === 0) {
      return { status: "synced", localChanged: state.localChanged, partial: true };
    }
    if (authFailed) {
      // 연결 비활성화는 lease 소유 + 이 실행이 쓴 자격 증명이 여전히 저장값일 때만(한 문장으로 원자적 판단).
      // 그 사이 재연결·다른 client의 갱신 저장이 있었으면 새 자격 증명은 다음 실행이 다시 판단한다.
      await db
        .update(calendarConnections)
        .set({ status: "NEEDS_REAUTH", lastError: message, updatedAt: finishedAt })
        .where(and(
          eq(calendarConnections.id, mapping.connectionId),
          eq(calendarConnections.encryptedCredentials, options.credentialsCiphertext()),
          exists(db.select({ one: sql`1` }).from(calendarMappings).where(ownsLease)),
        ))
        .catch(() => undefined);
    }
    return { status: "failed", localChanged: state.localChanged, error: message, authFailed };
  } finally {
    await releaseLease(options.ctx, mapping.id, leaseId).catch(() => undefined);
  }
}
