/**
 * Google 변경 알림(events.watch) channel 관리. 학생 매핑 하나에 channel 하나를 둔다.
 *
 * - 알림 주소는 Google OAuth redirect의 origin + NOTIFY_PATH이며 https일 때만 등록한다(Google은 https만 받는다).
 * - token 원문은 Google에만 보내고 DB에는 sha256 hex만 둔다. 알림 검증은 hash를 상수 시간으로 비교한다.
 * - 모든 함수는 best-effort다: 실패해도 throw하지 않고 매핑·연결의 last_error를 바꾸지 않는다
 *   (매핑 저장·해제·연결 해제·조회를 막지 않는다. 동기화 오류 표시는 엔진만 맡는다).
 * - `next/server`를 import하지 않아 worker.ts 예약 실행에서도 쓸 수 있다.
 */
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import { calendarConnections, calendarMappings, calendarPushChannels } from "@/db/schema";
import { createGoogleChannelApiForConnection, type GoogleChannelApi, type StoredCalendarConnection } from "./client-factory";
import { getGoogleCalendarOAuthConfig } from "./oauth-config";
import { base64UrlEncode, sha256Hex } from "./types";

export const GOOGLE_NOTIFY_PATH = "/api/calendar-connections/google/notify";
/** 요청하는 channel 수명(Google Calendar 기본값과 같은 7일). */
export const GOOGLE_CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60;
/** 남은 수명이 이보다 짧으면 새 channel로 바꾼다. 예약 실행이 하루 한 번이어도 끊기지 않게 한다. */
export const GOOGLE_CHANNEL_RENEW_BEFORE_MS = 24 * 60 * 60 * 1_000;
const MAX_HEADER_VALUE_LENGTH = 256;

export type EnsureChannelStatus =
  | "created"
  | "renewed"
  | "fresh"
  | "not-google"
  | "inactive"
  | "missing"
  | "not-configured"
  | "insecure-address"
  | "raced"
  | "failed";

export type EnsureChannelsSummary = { renewed: number; failed: number; skipped: number; deferred: number };

type Options = { now?: () => Date };

function readDb(ctx: DbContext): DrizzleDb {
  return ctx.db as unknown as DrizzleDb;
}

/** Google 알림 주소. 설정이 없으면 null, https가 아니면 "insecure". */
export function resolveGoogleNotifyAddress(): string | "insecure" | null {
  const config = getGoogleCalendarOAuthConfig();
  if (!config) return null;
  let origin: URL;
  try {
    origin = new URL(config.redirectUri);
  } catch {
    return null;
  }
  if (origin.protocol !== "https:") return "insecure";
  return `${origin.origin}${GOOGLE_NOTIFY_PATH}`;
}

/** 길이가 같은 두 문자열을 내용과 무관한 시간에 비교한다(sha256 hex 비교용). */
export function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) | 0) ^ (right.charCodeAt(index) | 0);
  }
  return difference === 0;
}

async function stopQuietly(api: GoogleChannelApi | null, channel: { channelId: string; resourceId: string }): Promise<void> {
  if (!api) return;
  try {
    await api.stop({ channelId: channel.channelId, resourceId: channel.resourceId });
  } catch {
    // 중지 실패는 무시한다. Google은 만료 시각에 channel을 정리하고, 모르는 channel 알림은 404로 버린다.
  }
}

async function loadMappingForChannel(ctx: DbContext, mappingId: string) {
  const [row] = await readDb(ctx)
    .select({
      mappingId: calendarMappings.id,
      remoteCalendarId: calendarMappings.remoteCalendarId,
      connectionId: calendarConnections.id,
      provider: calendarConnections.provider,
      status: calendarConnections.status,
      encryptedCredentials: calendarConnections.encryptedCredentials,
      credentialsIv: calendarConnections.credentialsIv,
      channelId: calendarPushChannels.channelId,
      resourceId: calendarPushChannels.resourceId,
      expiresAt: calendarPushChannels.expiresAt,
    })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .leftJoin(calendarPushChannels, eq(calendarPushChannels.mappingId, calendarMappings.id))
    .where(eq(calendarMappings.id, mappingId))
    .limit(1);
  return row ?? null;
}

function storedConnection(row: { connectionId: string; provider: StoredCalendarConnection["provider"]; encryptedCredentials: string; credentialsIv: string }): StoredCalendarConnection {
  return { id: row.connectionId, provider: row.provider, encryptedCredentials: row.encryptedCredentials, credentialsIv: row.credentialsIv };
}

/**
 * Google 매핑에 살아 있는 channel이 있게 한다. 없거나 24시간 안에 만료되면 새 channel을 등록하고
 * 행을 바꾼 뒤 이전 channel을 중지한다. 동시에 두 요청이 갱신하면 늦게 쓴 쪽이 자기 channel을 중지한다.
 */
export async function ensureGoogleWatchChannel(ctx: DbContext, mappingId: string, options: Options = {}): Promise<EnsureChannelStatus> {
  try {
    const now = (options.now ?? (() => new Date()))();
    const row = await loadMappingForChannel(ctx, mappingId);
    if (!row) return "missing";
    if (row.provider !== "GOOGLE") return "not-google";
    if (row.status !== "ACTIVE") return "inactive";
    const address = resolveGoogleNotifyAddress();
    if (address === null) return "not-configured";
    if (address === "insecure") return "insecure-address";
    const previous = row.channelId && row.resourceId && row.expiresAt
      ? { channelId: row.channelId, resourceId: row.resourceId, expiresAt: row.expiresAt }
      : null;
    if (previous && previous.expiresAt.getTime() - now.getTime() > GOOGLE_CHANNEL_RENEW_BEFORE_MS) return "fresh";

    const api = await createGoogleChannelApiForConnection(ctx, storedConnection(row));
    const channelId = crypto.randomUUID();
    const token = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256Hex(token);
    const watched = await api.watch({
      calendarId: row.remoteCalendarId,
      channelId,
      token,
      address,
      ttlSeconds: GOOGLE_CHANNEL_TTL_SECONDS,
    });
    const created = { channelId, resourceId: watched.resourceId };
    const values = { channelId, resourceId: watched.resourceId, tokenHash, expiresAt: watched.expiresAt, updatedAt: now };
    const db = readDb(ctx);
    let stored: { mappingId: string }[];
    try {
      stored = previous
        ? await db
            .update(calendarPushChannels)
            .set(values)
            .where(and(eq(calendarPushChannels.mappingId, mappingId), eq(calendarPushChannels.channelId, previous.channelId)))
            .returning({ mappingId: calendarPushChannels.mappingId })
        : await db
            .insert(calendarPushChannels)
            .values({ mappingId, ...values, createdAt: now })
            .onConflictDoNothing()
            .returning({ mappingId: calendarPushChannels.mappingId });
    } catch {
      stored = [];
    }
    if (stored.length === 0) {
      // 다른 요청이 먼저 바꿨거나 매핑이 사라졌다. 방금 만든 channel은 쓰지 않는다.
      await stopQuietly(api, created);
      return "raced";
    }
    if (previous) await stopQuietly(api, previous);
    return previous ? "renewed" : "created";
  } catch {
    return "failed";
  }
}

/** 갱신이 필요한(없거나 24시간 안에 만료) 활성 Google 매핑 id. */
async function listGoogleMappingsNeedingChannel(ctx: DbContext, now: Date, studentId?: string): Promise<string[]> {
  const renewBefore = new Date(now.getTime() + GOOGLE_CHANNEL_RENEW_BEFORE_MS);
  const conditions = [
    eq(calendarConnections.provider, "GOOGLE"),
    eq(calendarConnections.status, "ACTIVE"),
    or(isNull(calendarPushChannels.mappingId), lt(calendarPushChannels.expiresAt, renewBefore)),
  ];
  if (studentId) conditions.push(eq(calendarMappings.studentId, studentId));
  const rows = await readDb(ctx)
    .select({ id: calendarMappings.id })
    .from(calendarMappings)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .leftJoin(calendarPushChannels, eq(calendarPushChannels.mappingId, calendarMappings.id))
    .where(and(...conditions));
  return rows.map((row) => row.id);
}

/**
 * 갱신이 필요한 모든 활성 Google 매핑의 channel을 등록·갱신한다(예약 실행·조회가 부른다).
 * 주소가 https가 아니거나 설정이 없으면 원격 요청 없이 끝난다. deadline(epoch ms, `now`와 같은 시계)이 지나면 새 등록을 시작하지 않는다.
 */
export async function ensureGoogleWatchChannels(
  ctx: DbContext,
  options: Options & { deadline?: number; studentId?: string } = {},
): Promise<EnsureChannelsSummary> {
  const summary: EnsureChannelsSummary = { renewed: 0, failed: 0, skipped: 0, deferred: 0 };
  try {
    const address = resolveGoogleNotifyAddress();
    if (address === null || address === "insecure") return summary;
    const clock = options.now ?? (() => new Date());
    const mappingIds = await listGoogleMappingsNeedingChannel(ctx, clock(), options.studentId);
    for (const [index, mappingId] of mappingIds.entries()) {
      if (options.deadline !== undefined && clock().getTime() >= options.deadline) {
        summary.deferred += mappingIds.length - index;
        break;
      }
      const status = await ensureGoogleWatchChannel(ctx, mappingId, options);
      if (status === "created" || status === "renewed") summary.renewed += 1;
      else if (status === "failed") summary.failed += 1;
      else summary.skipped += 1;
    }
  } catch {
    // 목록 조회 실패도 호출자(예약 실행·조회)를 막지 않는다.
  }
  return summary;
}

/** 학생 조회 동기화용: 그 학생의 Google 매핑 중 갱신이 필요한 것만 처리한다. */
export function ensureGoogleWatchChannelsForStudent(ctx: DbContext, studentId: string, options: Options & { deadline?: number } = {}): Promise<EnsureChannelsSummary> {
  return ensureGoogleWatchChannels(ctx, { ...options, studentId });
}

/**
 * 매핑 해제·연결 해제 전에 부른다: Google channel을 중지(best-effort)하고 channel 행을 지운다.
 * 매핑 행 자체는 지우지 않는다(호출자가 지우며 cascade로도 지워진다).
 */
export async function stopGoogleWatchChannelsFor(
  ctx: DbContext,
  target: { mappingId: string } | { connectionId: string },
): Promise<{ stopped: number }> {
  let stopped = 0;
  try {
    const db = readDb(ctx);
    const rows = await db
      .select({
        mappingId: calendarPushChannels.mappingId,
        channelId: calendarPushChannels.channelId,
        resourceId: calendarPushChannels.resourceId,
        connectionId: calendarConnections.id,
        provider: calendarConnections.provider,
        encryptedCredentials: calendarConnections.encryptedCredentials,
        credentialsIv: calendarConnections.credentialsIv,
      })
      .from(calendarPushChannels)
      .innerJoin(calendarMappings, eq(calendarMappings.id, calendarPushChannels.mappingId))
      .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
      .where("mappingId" in target ? eq(calendarMappings.id, target.mappingId) : eq(calendarMappings.connectionId, target.connectionId));
    if (rows.length === 0) return { stopped };
    let api: GoogleChannelApi | null = null;
    try {
      api = await createGoogleChannelApiForConnection(ctx, storedConnection(rows[0]));
    } catch {
      api = null;
    }
    for (const row of rows) {
      if (!api) break;
      try {
        await api.stop({ channelId: row.channelId, resourceId: row.resourceId });
        stopped += 1;
      } catch {
        // 중지 실패는 해제를 막지 않는다.
      }
    }
    // 한 매핑·한 연결의 channel만 지운다(대개 몇 개라 bind 수 제한에 닿지 않지만 100개씩 나눈다).
    const mappingIds = rows.map((row) => row.mappingId);
    for (let offset = 0; offset < mappingIds.length; offset += 90) {
      await db.delete(calendarPushChannels).where(inArray(calendarPushChannels.mappingId, mappingIds.slice(offset, offset + 90)));
    }
  } catch {
    // DB·자격 증명 오류도 해제를 막지 않는다(매핑 삭제 cascade가 행을 정리한다).
  }
  return { stopped };
}

/**
 * 알림 header의 channel id·token(·resource id)을 검증해 매핑 id를 돌려준다. 하나라도 맞지 않으면 null.
 * token은 sha256 hex를 상수 시간으로 비교한다.
 */
export async function resolveGoogleNotification(
  ctx: DbContext,
  input: { channelId: string | null; token: string | null; resourceId?: string | null },
): Promise<string | null> {
  const channelId = input.channelId ?? "";
  const token = input.token ?? "";
  if (!channelId || !token || channelId.length > MAX_HEADER_VALUE_LENGTH || token.length > MAX_HEADER_VALUE_LENGTH) return null;
  const tokenHash = await sha256Hex(token);
  const [row] = await readDb(ctx)
    .select({ mappingId: calendarPushChannels.mappingId, tokenHash: calendarPushChannels.tokenHash, resourceId: calendarPushChannels.resourceId })
    .from(calendarPushChannels)
    .where(eq(calendarPushChannels.channelId, channelId))
    .limit(1);
  const matches = constantTimeEqual(tokenHash, row?.tokenHash ?? "0".repeat(64));
  if (!row || !matches) return null;
  if (input.resourceId && input.resourceId !== row.resourceId) return null;
  return row.mappingId;
}
