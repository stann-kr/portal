/**
 * 저장된 연결(calendar_connections)에서 provider client를 만든다.
 * - Google: 저장된 access token을 만료 1분 전까지 쓰고, 이후 refresh token으로 갱신해 다시 암호화 저장한다
 *   (refresh token rotation이 오면 새 값을 저장). 저장은 읽었던 ciphertext 기준 CAS라 동시 갱신이 새 값을 덮지 않는다.
 * - iCloud: Apple ID + 앱 전용 암호 + discovery로 찾은 calendar home.
 * 테스트는 setCalendarClientFactoryForTests로 가짜 client를 주입한다.
 */
import { and, eq } from "drizzle-orm";
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
import { CalendarAuthError, CalendarProviderError, type CalendarProviderClient } from "./types";

const ACCESS_TOKEN_SKEW_MS = 60_000;
/**
 * 갱신 결과 저장 CAS를 다시 시도하는 최대 횟수(회전된 refresh token 병합용). 저장에 성공하거나 다른 client가
 * refresh token을 회전해 둔 것을 확인할 때까지 다시 읽어 병합한다. 다 쓰면 회전을 잃은 채 성공하지 않고 오류로 멈춘다.
 */
const CREDENTIALS_CAS_ATTEMPTS = 10;

export type StoredCalendarConnection = {
  id: string;
  provider: ExternalCalendarProvider;
  encryptedCredentials: string;
  credentialsIv: string;
};

/**
 * client가 지금 쓰는 자격 증명 ciphertext가 바뀔 때(직접 갱신 저장·다른 client의 저장값 채택) 알린다.
 * 동기화 엔진은 인증 실패를 이 ciphertext가 여전히 저장값일 때만 연결에 기록한다(재연결·더 새 갱신을 덮지 않는다).
 */
export type CalendarCredentialsObserver = (encryptedCredentials: string) => void;

export type CalendarClientFactoryInput = {
  ctx: DbContext;
  connection: StoredCalendarConnection;
  onCredentialsChange?: CalendarCredentialsObserver;
};

export type CalendarClientFactory = (input: CalendarClientFactoryInput) => Promise<CalendarProviderClient>;

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

async function defaultFactory({ ctx, connection, onCredentialsChange }: CalendarClientFactoryInput): Promise<CalendarProviderClient> {
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
  return createGoogleCalendarClient({ getAccessToken: await createGoogleAccessTokenProvider(ctx, connection, key, onCredentialsChange) });
}

/**
 * 저장된 Google 자격 증명으로 access token을 준다. 만료 1분 전까지 가진 token을 쓴다.
 * 갱신이 필요하면 먼저 저장값을 다시 읽어 다른 client가 이미 받은 유효한 token을 재사용하고,
 * 직접 갱신한 결과는 읽었던 ciphertext가 그대로일 때만 저장한다(compare-and-swap). CAS가 실패하면 저장값을 다시 읽어:
 * - 다른 client가 refresh token을 회전했으면(저장값 ≠ 이번 갱신에 쓴 값) 저장값을 따른다.
 * - 회전 없이 access token만 바꿨고 이번 응답에 새 refresh token이 있으면, 새 refresh token과 더 늦게 만료되는
 *   access token을 합쳐 다시 CAS로 저장한다(늦게 끝난 회전 응답을 버리지 않는다).
 */
async function createGoogleAccessTokenProvider(
  ctx: DbContext,
  connection: StoredCalendarConnection,
  key: Uint8Array,
  onCredentialsChange?: CalendarCredentialsObserver,
): Promise<GoogleAccessTokenProvider> {
  const db = ctx.db as unknown as DrizzleDb;
  type Sealed = { encryptedCredentials: string; credentialsIv: string };
  const decrypt = (sealed: Sealed) =>
    decryptConnectionCredentials({ connectionId: connection.id, provider: "GOOGLE", ...sealed, key });
  let sealed: Sealed = { encryptedCredentials: connection.encryptedCredentials, credentialsIv: connection.credentialsIv };
  let credentials: GoogleConnectionCredentials = await decrypt(sealed);
  const adopt = (next: Sealed) => {
    sealed = next;
    onCredentialsChange?.(next.encryptedCredentials);
  };

  const usable = (value: GoogleConnectionCredentials) =>
    Boolean(value.accessToken) && (value.accessTokenExpiresAt ?? 0) > Date.now() + ACCESS_TOKEN_SKEW_MS;

  /** 저장된 최신 자격 증명으로 바꾼다. 연결이 지워졌으면 인증 오류로 멈춘다. */
  async function adoptStored(): Promise<void> {
    const [row] = await db
      .select({ encryptedCredentials: calendarConnections.encryptedCredentials, credentialsIv: calendarConnections.credentialsIv })
      .from(calendarConnections)
      .where(eq(calendarConnections.id, connection.id))
      .limit(1);
    if (!row) throw new CalendarAuthError("Google connection was removed");
    if (row.encryptedCredentials === sealed.encryptedCredentials && row.credentialsIv === sealed.credentialsIv) return;
    credentials = await decrypt(row);
    adopt(row);
  }

  async function refresh(refreshToken: string) {
    const config = getGoogleCalendarOAuthConfig();
    if (!config) throw new CalendarSyncConfigError(CALENDAR_SYNC_MESSAGES.googleNotConfigured);
    return refreshGoogleAccessToken({ clientId: config.clientId, clientSecret: config.clientSecret, refreshToken });
  }

  return async ({ forceRefresh }) => {
    if (!forceRefresh && usable(credentials)) return credentials.accessToken!;
    const rejected = forceRefresh ? credentials.accessToken : undefined;
    // 다른 client(다른 매핑·요청)가 이미 갱신했으면 그 token을 쓴다.
    await adoptStored();
    if (usable(credentials) && credentials.accessToken !== rejected) return credentials.accessToken!;
    let tokens;
    let usedRefreshToken = credentials.refreshToken;
    try {
      tokens = await refresh(usedRefreshToken);
    } catch (error) {
      // 그 사이 다른 client가 refresh token을 회전했으면 저장된 새 값으로 한 번 더 시도한다.
      if (!(error instanceof CalendarAuthError)) throw error;
      const before = sealed.encryptedCredentials;
      await adoptStored();
      if (sealed.encryptedCredentials === before) throw error;
      if (usable(credentials) && credentials.accessToken !== rejected) return credentials.accessToken!;
      usedRefreshToken = credentials.refreshToken;
      tokens = await refresh(usedRefreshToken);
    }
    const rotatedRefreshToken = tokens.refreshToken;
    let next: GoogleConnectionCredentials = {
      refreshToken: rotatedRefreshToken ?? credentials.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt.getTime(),
    };
    let settled = false;
    for (let attempt = 1; attempt <= CREDENTIALS_CAS_ATTEMPTS; attempt += 1) {
      const encrypted = await encryptConnectionCredentials({ connectionId: connection.id, provider: "GOOGLE", credentials: next, key });
      const swapped = await db
        .update(calendarConnections)
        .set({ ...encrypted, updatedAt: new Date() })
        .where(and(eq(calendarConnections.id, connection.id), eq(calendarConnections.encryptedCredentials, sealed.encryptedCredentials)))
        .returning({ id: calendarConnections.id });
      if (swapped.length > 0) {
        credentials = next;
        adopt(encrypted);
        settled = true;
        break;
      }
      // CAS 실패: 다른 client가 먼저 저장했다. 최신 저장값을 읽는다.
      await adoptStored();
      // 이번 응답에 회전이 없거나, 다른 client가 refresh token을 이미 바꿨으면(회전) 저장값을 따른다.
      // 방금 받은 access token은 이번 요청에만 쓴다.
      if (!rotatedRefreshToken || credentials.refreshToken !== usedRefreshToken) {
        settled = true;
        break;
      }
      // 먼저 저장한 쪽은 회전 없이 access token만 바꿨다. 이번 응답의 새 refresh token을 보존하고
      // access token은 더 늦게 만료되는 쪽을 둔다.
      const storedFresher = Boolean(credentials.accessToken)
        && (credentials.accessTokenExpiresAt ?? 0) > tokens.expiresAt.getTime();
      next = {
        refreshToken: rotatedRefreshToken,
        accessToken: storedFresher ? credentials.accessToken : tokens.accessToken,
        accessTokenExpiresAt: storedFresher ? credentials.accessTokenExpiresAt : tokens.expiresAt.getTime(),
      };
    }
    if (!settled) {
      // 회전된 refresh token을 저장하지 못했다. 회전 뒤 저장된 이전 refresh token은 Google에서 이미 무효일 수 있어,
      // 여기서 access token을 돌려주면 이번 요청은 성공해도 다음 갱신이 실패해 정상 연결이 재인증 필요로 보인다.
      // 인증 오류가 아닌 provider 오류로 멈춘다(매핑 last_error만 남고 다음 실행이 다시 갱신한다). token은 담지 않는다.
      throw new CalendarProviderError("Could not persist rotated Google refresh token");
    }
    // 다른 client의 저장값을 채택했으면 그 access token을 쓴다. 인증 실패 판정(NEEDS_REAUTH의 자격 증명 일치 조건)이
    // 실제 요청에 쓴 token과 같은 저장값을 가리키게 한다.
    if (credentials === next) return tokens.accessToken;
    return usable(credentials) ? credentials.accessToken! : tokens.accessToken;
  };
}

export async function createCalendarClientForConnection(
  ctx: DbContext,
  connection: StoredCalendarConnection,
  options: { onCredentialsChange?: CalendarCredentialsObserver } = {},
): Promise<CalendarProviderClient> {
  return (factoryOverride ?? defaultFactory)({ ctx, connection, onCredentialsChange: options.onCredentialsChange });
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
