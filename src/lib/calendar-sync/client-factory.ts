/**
 * 저장된 연결(calendar_connections)에서 provider client를 만든다.
 * - Google: 저장된 access token을 만료 1분 전까지 쓰고, 이후 refresh token으로 갱신해 다시 암호화 저장한다
 *   (refresh token rotation이 오면 새 값을 저장).
 * - iCloud: Apple ID + 앱 전용 암호 + discovery로 찾은 calendar home.
 * 테스트는 setCalendarClientFactoryForTests로 가짜 client를 주입한다.
 */
import { eq } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import { calendarConnections, type ExternalCalendarProvider } from "@/db/schema";
import { getExternalCalendarEncryptionKey } from "@/lib/external-calendar-key";
import { createICloudCalendarClient } from "./caldav";
import {
  decryptConnectionCredentials,
  encryptConnectionCredentials,
  type GoogleConnectionCredentials,
} from "./credentials";
import { CALENDAR_SYNC_MESSAGES, CalendarSyncConfigError } from "./engine";
import {
  createGoogleCalendarClient,
  createGoogleSender,
  refreshGoogleAccessToken,
  stopGoogleChannel,
  watchGoogleCalendar,
  type GoogleAccessTokenProvider,
  type GoogleWatchInput,
  type GoogleWatchResult,
} from "./google";
import { getGoogleCalendarOAuthConfig } from "./oauth-config";
import type { CalendarProviderClient } from "./types";

const ACCESS_TOKEN_SKEW_MS = 60_000;

export type StoredCalendarConnection = {
  id: string;
  provider: ExternalCalendarProvider;
  encryptedCredentials: string;
  credentialsIv: string;
};

export type CalendarClientFactory = (input: { ctx: DbContext; connection: StoredCalendarConnection }) => Promise<CalendarProviderClient>;

let factoryOverride: CalendarClientFactory | null = null;

/** 테스트 전용: 실제 Google·iCloud 대신 가짜 client를 쓴다. null이면 기본 factory로 돌아간다. */
export function setCalendarClientFactoryForTests(factory: CalendarClientFactory | null): void {
  factoryOverride = factory;
}

/** EXTERNAL_CALENDAR_ENCRYPTION_KEY. 없거나 잘못되면 설정 오류. */
export function requireCalendarEncryptionKey(): Uint8Array {
  try {
    return getExternalCalendarEncryptionKey();
  } catch {
    throw new CalendarSyncConfigError(CALENDAR_SYNC_MESSAGES.encryptionMissing);
  }
}

export function isCalendarEncryptionConfigured(): boolean {
  try {
    getExternalCalendarEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

async function defaultFactory({ ctx, connection }: { ctx: DbContext; connection: StoredCalendarConnection }): Promise<CalendarProviderClient> {
  const key = requireCalendarEncryptionKey();
  if (connection.provider === "ICLOUD") {
    const credentials = await decryptConnectionCredentials({
      connectionId: connection.id,
      provider: "ICLOUD",
      encryptedCredentials: connection.encryptedCredentials,
      credentialsIv: connection.credentialsIv,
      key,
    });
    return createICloudCalendarClient({
      appleId: credentials.appleId,
      appSpecificPassword: credentials.appPassword,
      calendarHomeUrl: credentials.calendarHomeUrl,
    });
  }
  return createGoogleCalendarClient({ getAccessToken: await createGoogleAccessTokenProvider(ctx, connection, key) });
}

/**
 * 저장된 Google 자격 증명으로 access token을 준다. 만료 1분 전까지 저장된 token을 쓰고,
 * 이후 refresh token으로 갱신해 다시 암호화 저장한다(rotation이 오면 새 값 저장).
 */
async function createGoogleAccessTokenProvider(
  ctx: DbContext,
  connection: StoredCalendarConnection,
  key: Uint8Array,
): Promise<GoogleAccessTokenProvider> {
  let credentials: GoogleConnectionCredentials = await decryptConnectionCredentials({
    connectionId: connection.id,
    provider: "GOOGLE",
    encryptedCredentials: connection.encryptedCredentials,
    credentialsIv: connection.credentialsIv,
    key,
  });
  const db = ctx.db as unknown as DrizzleDb;
  return async ({ forceRefresh }) => {
    const now = Date.now();
    if (!forceRefresh && credentials.accessToken && (credentials.accessTokenExpiresAt ?? 0) > now + ACCESS_TOKEN_SKEW_MS) {
      return credentials.accessToken;
    }
    const config = getGoogleCalendarOAuthConfig();
    if (!config) throw new CalendarSyncConfigError(CALENDAR_SYNC_MESSAGES.googleNotConfigured);
    const tokens = await refreshGoogleAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: credentials.refreshToken,
    });
    credentials = {
      refreshToken: tokens.refreshToken ?? credentials.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt.getTime(),
    };
    const encrypted = await encryptConnectionCredentials({
      connectionId: connection.id,
      provider: "GOOGLE",
      credentials,
      key,
    });
    await db
      .update(calendarConnections)
      .set({ ...encrypted, updatedAt: new Date() })
      .where(eq(calendarConnections.id, connection.id));
    return credentials.accessToken!;
  };
}

export async function createCalendarClientForConnection(ctx: DbContext, connection: StoredCalendarConnection): Promise<CalendarProviderClient> {
  return (factoryOverride ?? defaultFactory)({ ctx, connection });
}

export type ICloudDiscovery = (input: { appleId: string; appPassword: string }) => Promise<{ calendarHomeUrl: string }>;

let iCloudDiscoveryOverride: ICloudDiscovery | null = null;

/** 테스트 전용: iCloud 연결 확인(discovery)을 가짜로 바꾼다. */
export function setICloudDiscoveryForTests(discovery: ICloudDiscovery | null): void {
  iCloudDiscoveryOverride = discovery;
}

/** Apple ID + 앱 전용 암호로 principal·calendar home을 찾아 연결을 확인한다. */
export async function discoverICloudAccount(input: { appleId: string; appPassword: string }): Promise<{ calendarHomeUrl: string }> {
  if (iCloudDiscoveryOverride) return iCloudDiscoveryOverride(input);
  const client = createICloudCalendarClient({ appleId: input.appleId, appSpecificPassword: input.appPassword });
  const { calendarHomeUrl } = await client.discover();
  return { calendarHomeUrl };
}

/** Google 변경 알림 channel 등록·중지(연결 하나의 자격 증명 사용). */
export type GoogleChannelApi = {
  watch(input: GoogleWatchInput): Promise<GoogleWatchResult>;
  stop(input: { channelId: string; resourceId: string }): Promise<void>;
};

export type GoogleChannelApiFactory = (input: { ctx: DbContext; connection: StoredCalendarConnection }) => Promise<GoogleChannelApi>;

let googleChannelApiOverride: GoogleChannelApiFactory | null = null;

/** 테스트 전용: Google watch·stop 호출을 가짜로 바꾼다. null이면 기본 구현으로 돌아간다. */
export function setGoogleChannelApiFactoryForTests(factory: GoogleChannelApiFactory | null): void {
  googleChannelApiOverride = factory;
}

export async function createGoogleChannelApiForConnection(ctx: DbContext, connection: StoredCalendarConnection): Promise<GoogleChannelApi> {
  if (googleChannelApiOverride) return googleChannelApiOverride({ ctx, connection });
  if (connection.provider !== "GOOGLE") throw new CalendarSyncConfigError(CALENDAR_SYNC_MESSAGES.googleNotConfigured);
  const send = createGoogleSender({ getAccessToken: await createGoogleAccessTokenProvider(ctx, connection, requireCalendarEncryptionKey()) });
  return {
    watch: (input) => watchGoogleCalendar({ ...input, send }),
    stop: (input) => stopGoogleChannel({ ...input, send }),
  };
}
