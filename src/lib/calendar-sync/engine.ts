/**
 * 포털(hub) ↔ 원격 캘린더 한 매핑의 양방향 동기화 알고리즘.
 *
 * 결정(.docs/goals/assignments-guide-calendar/design.md "동기화 엔진 결정"):
 * - 충돌은 웹 우선. 원격 쓰기는 If-Match(etag)로 하고 412면 portalRef로 현재 etag를 다시 읽어 로컬 내용으로 덮는다.
 * - 루프 방지는 calendar_sync_links + portalRef. 로컬 → 원격은 link(remote_id NULL)를 먼저 claim한 뒤 만든다.
 * - 로컬 삭제는 link local_fingerprint를 DELETED로 남기고, 원격 remove 성공 뒤 link를 지운다.
 * - 원격 새 일정(portalRef 없음)은 학생 calendar_events(NOTE)로 가져온다. 반복 일정은 calendar_remote_series 사본만 둔다.
 * - 레슨은 원격 제목 "레슨", 60분. 원격 변경은 scheduledAt만 반영한다.
 * - window = 지금 -90일 ~ +365일. 조회 동기화는 60초 throttle, 모든 동기화는 60초 lease.
 *
 * DB·client·시계는 주입받아 단위 테스트에서 실제 SQLite와 가짜 provider로 검증한다.
 * 오류 메시지·lastError에는 token·암호·원격 본문을 넣지 않고 짧은 한국어 분류만 남긴다.
 */
import { and, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
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
import { executeDocumentStatementsAtomically, type DocumentAtomicStatement } from "@/lib/document-lifecycle-atomic";
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
/** 전체 재동기화에서 원격에 안 보이는 연결 항목을 portalRef로 다시 찾는 최대 횟수(한 번 실행). */
const FULL_RESYNC_MISSING_LOOKUP_CAP = 20;
/** portalRef로 link를 다시 이은 직후 표시. 실제 fingerprint와 달라 다음 push가 로컬 내용으로 원격을 맞춘다. */
export const RELINKED_FINGERPRINT = "RELINKED";
export const LESSON_REMOTE_TITLE = "레슨";
/** 종료 시각이 없는 포털 일정을 원격에 보낼 때의 길이. */
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

/** 원격 일정을 calendar_events 값으로 바꾼다(포털 일정 입력 제한 안으로 자른다). */
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

function deleteLocalRowStatement(row: LocalCalendarRow, studentId: string): DocumentAtomicStatement {
  return row.kind === "LESSON"
    ? { query: "DELETE FROM lessons WHERE id = ? AND student_id = ?", params: [row.id, studentId] }
    : { query: "DELETE FROM calendar_events WHERE id = ? AND user_id = ?", params: [row.id, studentId] };
}

// ── 엔진 ──────────────────────────────────────────────────

type RunState = {
  ctx: DbContext;
  db: DrizzleDb;
  client: CalendarProviderClient;
  mappingId: string;
  studentId: string;
  calendarId: string;
  now: () => Date;
  deadline?: number;
  links: LinkRow[];
  localChanged: boolean;
  itemFailures: number;
  remoteWrites: number;
  stopped: boolean;
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

async function updateLink(state: RunState, linkId: string, values: Partial<Pick<LinkRow, "remoteId" | "etag" | "localFingerprint" | "lastError">>): Promise<void> {
  await state.db
    .update(calendarSyncLinks)
    .set({ ...values, updatedAt: state.now() })
    .where(eq(calendarSyncLinks.id, linkId));
}

async function deleteLink(state: RunState, linkId: string): Promise<void> {
  await state.db.delete(calendarSyncLinks).where(eq(calendarSyncLinks.id, linkId));
}

function assertCanWrite(state: RunState): void {
  if (state.remoteWrites >= CALENDAR_SYNC_MAX_REMOTE_WRITES) throw new DeadlineReached();
  if (state.deadline !== undefined && state.now().getTime() >= state.deadline) throw new DeadlineReached();
}

async function remoteCall<T>(state: RunState, call: () => Promise<T>): Promise<T> {
  assertCanWrite(state);
  state.remoteWrites += 1;
  return call();
}

// ── pull 적용 ──

async function importRemoteEvent(state: RunState, remote: RemoteEvent): Promise<void> {
  const values = remoteEventToLocalValues(remote);
  const id = crypto.randomUUID();
  const fingerprint = await localFingerprint({ kind: "EVENT", id, ...values });
  const nowSeconds = epochSeconds(state.now());
  await executeDocumentStatementsAtomically(state.ctx, [
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

/** 원격 변경을 연결된 로컬 행에 반영한다(로컬이 마지막 동기화 뒤 그대로일 때만). */
async function applyRemoteToLinked(state: RunState, link: LinkRow, remote: RemoteEvent): Promise<void> {
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
  if (local.kind === "LESSON") {
    // 레슨은 시간만 반영한다(제목·설명·길이 변경은 무시).
    next = { ...local, start: persisted(remote.start) };
    statements.push({
      query: "UPDATE lessons SET scheduled_at = ? WHERE id = ? AND student_id = ?",
      params: [epochSeconds(next.start), local.id, state.studentId],
    });
  } else {
    const values = remoteEventToLocalValues(remote);
    next = { ...local, ...values };
    statements.push({
      query: "UPDATE calendar_events SET title = ?, description = ?, start_time = ?, end_time = ? WHERE id = ? AND user_id = ?",
      params: [values.title, values.description, epochSeconds(values.start), values.end ? epochSeconds(values.end) : null, local.id, state.studentId],
    });
  }
  const nextFingerprint = await localFingerprint(next);
  statements.push({
    query: "UPDATE calendar_sync_links SET etag = ?, local_fingerprint = ?, last_error = NULL, updated_at = ? WHERE id = ?",
    params: [remote.etag, nextFingerprint, nowSeconds, link.id],
  });
  await executeDocumentStatementsAtomically(state.ctx, statements);
  if (nextFingerprint !== current) state.localChanged = true;
}

/** 원격에서 사라진 연결 항목: 로컬이 그대로면 지우고, 바뀌었으면(웹 우선) 다시 만들도록 link를 비운다. */
async function applyRemoteDeletion(state: RunState, link: LinkRow): Promise<void> {
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
  await executeDocumentStatementsAtomically(state.ctx, [
    deleteLocalRowStatement(local, state.studentId),
    { query: "DELETE FROM calendar_sync_links WHERE id = ?", params: [link.id] },
  ]);
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
  await state.db
    .insert(calendarRemoteSeries)
    .values(values)
    .onConflictDoUpdate({
      target: [calendarRemoteSeries.mappingId, calendarRemoteSeries.remoteId],
      set: { seriesKey: values.seriesKey, etag: values.etag, icsText: values.icsText, updatedAt: values.updatedAt },
    });
}

async function deleteSeries(state: RunState, remoteId: string): Promise<void> {
  await state.db
    .delete(calendarRemoteSeries)
    .where(and(eq(calendarRemoteSeries.mappingId, state.mappingId), eq(calendarRemoteSeries.remoteId, remoteId)));
}

async function applyPull(state: RunState, result: PullResult, full: boolean, window: PullWindow): Promise<void> {
  let { byRemote, byLocal } = indexLinks(state.links);
  const seen = new Set<string>();

  for (const remote of result.changed) {
    seen.add(remote.remoteId);
    const linked = byRemote.get(remote.remoteId);
    if (remote.recurring) {
      // 반복 일정은 읽기 전용 사본만. 이미 포털 항목과 이어진 원격 일정이 반복으로 바뀐 경우는 건드리지 않는다.
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
      if (!local) continue; // 다른 학생·이미 지운 포털 항목의 원격 사본은 가져오지 않는다.
      await state.db.insert(calendarSyncLinks).values({
        id: crypto.randomUUID(),
        mappingId: state.mappingId,
        localKind: ref.kind,
        localId: ref.id,
        remoteId: remote.remoteId,
        etag: remote.etag,
        localFingerprint: RELINKED_FINGERPRINT,
        createdAt: state.now(),
        updatedAt: state.now(),
      }).onConflictDoNothing();
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
    // 전체 pull은 window 안 상태 전부다. window 안 로컬 항목의 원격 사본이 없으면 원격에서 지워진 것이다.
    await loadLinks(state);
    let missingLookups = 0;
    for (const link of state.links) {
      if (!link.remoteId || seen.has(link.remoteId) || link.localFingerprint === DELETED_FINGERPRINT) continue;
      const local = await loadLocalRow(state.db, state.studentId, link.localKind, link.localId);
      if (!local) continue;
      if (local.start.getTime() < window.from.getTime() || local.start.getTime() > window.to.getTime()) continue;
      // 원격에서 window 밖으로 옮겨졌을 수 있다. 포털이 만든 사본(portalRef)은 지우기 전에 찾아보고, 있으면 다시 잇는다.
      if (missingLookups >= FULL_RESYNC_MISSING_LOOKUP_CAP) continue; // 남은 것은 다음 전체 동기화가 확인한다(지우지 않는다).
      missingLookups += 1;
      const found = await state.client.findByPortalRef(state.calendarId, portalRefFor(link.localKind, link.localId));
      if (found && found.status !== "cancelled") {
        await updateLink(state, link.id, { remoteId: found.remoteId, etag: found.etag, lastError: null });
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

/** 로컬 내용으로 원격을 맞춘다(웹 우선). */
async function writeLocalToRemote(state: RunState, link: LinkRow, input: RemoteEventInput): Promise<WriteResult> {
  if (!link.remoteId) {
    const found = await findLive(state, input.portalRef);
    if (found) return remoteCall(state, () => state.client.update(state.calendarId, found.remoteId, input, found.etag));
    return createRemote(state, input);
  }
  try {
    return await remoteCall(state, () => state.client.update(state.calendarId, link.remoteId!, input, link.etag ?? "*"));
  } catch (error) {
    if (error instanceof CalendarConflictError) {
      const found = await findLive(state, input.portalRef);
      if (found) return remoteCall(state, () => state.client.update(state.calendarId, found.remoteId, input, found.etag));
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
    const claimed = await state.db.insert(calendarSyncLinks).values({
      id: crypto.randomUUID(),
      mappingId: state.mappingId,
      localKind: row.kind,
      localId: row.id,
      remoteId: null,
      etag: null,
      localFingerprint: fingerprint,
      createdAt: state.now(),
      updatedAt: state.now(),
    }).onConflictDoNothing().returning();
    if (claimed.length === 0) return; // 다른 실행이 먼저 claim했다.
    target = claimed[0];
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
  } catch {
    // 같은 원격 id가 다른 link에 이미 있으면(드문 재연결) 이 link는 다음 동기화가 portalRef로 다시 맞춘다.
    await updateLink(state, link.id, { lastError: CALENDAR_SYNC_MESSAGES.partial });
  }
}

async function removeRemote(state: RunState, link: LinkRow): Promise<void> {
  const portalRef = portalRefFor(link.localKind, link.localId);
  const removeFound = async () => {
    const found = await findLive(state, portalRef);
    if (found) {
      try {
        await remoteCall(state, () => state.client.remove(state.calendarId, found.remoteId, found.etag));
      } catch (error) {
        if (!(error instanceof CalendarNotFoundError)) throw error;
      }
    }
  };
  if (!link.remoteId) {
    await removeFound();
  } else {
    try {
      await remoteCall(state, () => state.client.remove(state.calendarId, link.remoteId!, link.etag ?? "*"));
    } catch (error) {
      if (error instanceof CalendarConflictError) await removeFound();
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
    if (error instanceof DeadlineReached) {
      state.stopped = true;
      return;
    }
    if (isFatal(error)) throw error;
    state.itemFailures += 1;
    if (linkId) await updateLink(state, linkId, { lastError: calendarSyncErrorMessage(error) }).catch(() => undefined);
  }
}

async function pushLocal(state: RunState, window: PullWindow): Promise<void> {
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
    now,
    deadline: options.deadline,
    links: [],
    localChanged: false,
    itemFailures: 0,
    remoteWrites: 0,
    stopped: false,
  };
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
      nextCursor = result.nextCursor || null;
      // 원격 반영이 끝났으므로 push가 중간에 멈춰도 cursor는 저장한다(push는 fingerprint로 다시 찾는다).
      await db.update(calendarMappings).set({ cursor: nextCursor }).where(eq(calendarMappings.id, mapping.id));
    }
    await pushLocal(state, window);
    const finishedAt = now();
    const lastError = state.itemFailures > 0 ? CALENDAR_SYNC_MESSAGES.partial : null;
    if (mode === "full") {
      await db
        .update(calendarMappings)
        .set({ lastSyncedAt: finishedAt, lastError, updatedAt: finishedAt })
        .where(eq(calendarMappings.id, mapping.id));
    } else if (lastError) {
      await db.update(calendarMappings).set({ lastError, updatedAt: finishedAt }).where(eq(calendarMappings.id, mapping.id));
    }
    return { status: "synced", localChanged: state.localChanged, partial: state.itemFailures > 0 || state.stopped };
  } catch (error) {
    const message = calendarSyncErrorMessage(error);
    const authFailed = isAuthFailure(error);
    const finishedAt = now();
    await db
      .update(calendarMappings)
      .set({ lastError: message, updatedAt: finishedAt })
      .where(eq(calendarMappings.id, mapping.id))
      .catch(() => undefined);
    if (authFailed) {
      await db
        .update(calendarConnections)
        .set({ status: "NEEDS_REAUTH", lastError: message, updatedAt: finishedAt })
        .where(eq(calendarConnections.id, mapping.connectionId))
        .catch(() => undefined);
    }
    return { status: "failed", localChanged: state.localChanged, error: message, authFailed };
  } finally {
    await releaseLease(options.ctx, mapping.id, leaseId).catch(() => undefined);
  }
}
