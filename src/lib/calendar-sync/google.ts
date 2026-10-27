/**
 * Google Calendar API v3 + OAuth 2.0(PKCE) — googleapis 없이 raw fetch만 쓴다(Worker bundle 크기).
 *
 * 범위(최소): `calendar.events`(일정 읽기·쓰기) + `calendar.calendarlist.readonly`(캘린더 목록·계정 라벨).
 * 계정 라벨: email/openid scope를 요청하지 않으므로 tokeninfo/userinfo는 email을 주지 않는다.
 * 대신 `calendarList/primary`의 `id`(= 계정 주소)를 쓴다.
 *
 * 동기화 방식:
 * - `singleEvents=false`: 반복 일정은 master(`recurrence[]`) + 예외 instance(`recurringEventId`)로만 온다.
 *   둘 다 `recurring: true` + `seriesIcs`(합성 VCALENDAR, timeZone은 TZID+Intl 기반 VTIMEZONE) + `seriesKey`(iCalUID)로
 *   표시하며 engine은 읽기 전용으로 다룬다. 취소된 예외는 changed에 cancelled로, 취소된 master는 deletedRemoteIds로 온다. 확장 instance를 만들지 않으므로
 *   syncToken과 같은 parameter 조합을 그대로 유지할 수 있다.
 * - 초기(cursor null): `timeMin`/`timeMax` window + `showDeleted=true` + `singleEvents=false`를 page 끝까지 읽고
 *   마지막 page의 `nextSyncToken`을 cursor로 저장한다.
 * - 증분: `syncToken` + 같은 `showDeleted`/`singleEvents`만 보낸다(Google 규칙상 timeMin/timeMax/updatedMin/
 *   orderBy/q/extended-property filter와 함께 쓸 수 없다). 결과는 window로 제한되지 않는다.
 * - 410 GONE → `fullResync: true`. 초기 응답에 nextSyncToken이 없으면(드묾) `updatedMin` cursor로 대체한다.
 */
import {
  CALENDAR_SYNC_MAX_PAGES,
  CalendarAuthError,
  CalendarConflictError,
  CalendarNotFoundError,
  CalendarProviderError,
  CalendarRateLimitError,
  PORTAL_REF_PATTERN,
  allDayRange,
  assertPullWindow,
  base64UrlEncode,
  dateOnlyToDate,
  fetchText,
  fullResyncResult,
  normalizeRemoteEventInput,
  parseRetryAfter,
  sha256Hex,
  type CalendarProviderClient,
  type FetchedText,
  type PullResult,
  type PullWindow,
  type RemoteCalendar,
  type RemoteEvent,
  type RemoteEventInput,
  type WriteResult,
} from "./types";
import { buildSeriesIcs, type SeriesTime } from "./ics";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;
export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_ALLOWED_HOSTS = new Set(["www.googleapis.com", "oauth2.googleapis.com", "accounts.google.com"]);
const GOOGLE_PAGE_SIZE = 250;
/** updatedMin fallback cursor의 시계 오차 여유. */
const UPDATED_MIN_SKEW_MS = 5 * 60_000;
const SKIPPED_EVENT_TYPES = new Set(["workingLocation", "outOfOffice", "focusTime", "birthday"]);

/** Google 이외 host·http·credential 포함 URL을 거부한다. */
export function assertGoogleUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CalendarProviderError("Google URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !GOOGLE_ALLOWED_HOSTS.has(url.hostname)) {
    throw new CalendarProviderError("Google URL host is not allowed");
  }
  return url;
}

async function googleFetch(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs?: number): Promise<FetchedText> {
  assertGoogleUrl(url);
  const result = await fetchText(fetchImpl, url, init, { timeoutMs });
  if (result.status >= 300 && result.status < 400) throw new CalendarProviderError("Google redirect is not allowed", { status: result.status });
  return result;
}

function parseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

// ── OAuth ──────────────────────────────────────────────────

export function buildGoogleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  if (!input.clientId || !input.redirectUri || !input.state || !input.codeChallenge) {
    throw new CalendarProviderError("Google OAuth parameters are missing");
  }
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

function randomToken(byteLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** CSRF용 OAuth state(base64url 32 bytes). */
export function createOAuthState(): string {
  return randomToken(32);
}

export async function computePkceChallenge(codeVerifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(codeVerifier)) throw new CalendarProviderError("PKCE verifier is invalid");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** RFC 7636 S256 PKCE pair. verifier는 서버 세션(암호화 cookie 등)에만 보관한다. */
export async function createPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = randomToken(48);
  return { codeVerifier, codeChallenge: await computePkceChallenge(codeVerifier) };
}

export type GoogleTokenSet = {
  accessToken: string;
  expiresAt: Date;
  /** exchange에서는 `prompt=consent`로 항상 기대한다. refresh에서는 rotation 때만 온다. */
  refreshToken?: string;
  scopes: string[];
};

function tokenError(status: number, body: Record<string, unknown> | null): Error {
  const reason = str(body?.error) ?? `http_${status}`;
  if (reason === "invalid_grant" || reason === "unauthorized_client" || reason === "invalid_token") {
    return new CalendarAuthError("Google authorization is no longer valid", { status, reason });
  }
  if (status === 429) return new CalendarRateLimitError("Google token endpoint is rate limited", { status, reason });
  return new CalendarProviderError("Google token request failed", { status, reason });
}

async function requestToken(fetchImpl: typeof fetch, params: Record<string, string>, now: Date): Promise<GoogleTokenSet> {
  const result = await googleFetch(fetchImpl, GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const body = parseJson(result.text);
  if (result.status !== 200) throw tokenError(result.status, body);
  const accessToken = str(body?.access_token);
  const expiresIn = Number(body?.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new CalendarProviderError("Google token response is invalid");
  const scopes = (str(body?.scope) ?? "").split(/\s+/u).filter(Boolean);
  if (scopes.length > 0 && !scopes.includes(GOOGLE_CALENDAR_SCOPES[0])) {
    throw new CalendarAuthError("Google calendar permission was not granted", { reason: "insufficient_scope" });
  }
  const refreshToken = str(body?.refresh_token);
  return {
    accessToken,
    expiresAt: new Date(now.getTime() + expiresIn * 1_000),
    ...(refreshToken ? { refreshToken } : {}),
    scopes,
  };
}

/** authorization code → token. `calendar.events` scope가 빠졌으면 CalendarAuthError(reason insufficient_scope). */
export async function exchangeGoogleCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<GoogleTokenSet> {
  return requestToken(
    input.fetchImpl ?? fetch,
    {
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    },
    input.now ?? new Date(),
  );
}

/** refresh token → access token. invalid_grant(폐기·만료) → CalendarAuthError. */
export async function refreshGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<GoogleTokenSet> {
  return requestToken(
    input.fetchImpl ?? fetch,
    {
      grant_type: "refresh_token",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
    },
    input.now ?? new Date(),
  );
}

/** token 폐기. 이미 무효한 token(400 invalid_token)은 성공으로 본다. */
export async function revokeGoogleToken(input: { token: string; fetchImpl?: typeof fetch }): Promise<void> {
  const result = await googleFetch(input.fetchImpl ?? fetch, GOOGLE_REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: input.token }).toString(),
  });
  if (result.status === 200) return;
  const body = parseJson(result.text);
  if (result.status === 400 && str(body?.error) === "invalid_token") return;
  throw tokenError(result.status, body);
}

/** 연결 화면에 보일 계정 라벨(primary calendar id = 계정 주소). */
export async function fetchGoogleAccountLabel(input: { accessToken: string; fetchImpl?: typeof fetch }): Promise<string | null> {
  const result = await googleFetch(input.fetchImpl ?? fetch, `${GOOGLE_CALENDAR_API}/users/me/calendarList/primary`, {
    method: "GET",
    headers: { authorization: `Bearer ${input.accessToken}`, accept: "application/json" },
  });
  if (result.status !== 200) throw apiError(result, parseJson(result.text));
  return str(parseJson(result.text)?.id) ?? null;
}

// ── API client ─────────────────────────────────────────────

function apiError(result: FetchedText, body: Record<string, unknown> | null): Error {
  const status = result.status;
  const error = obj(body?.error);
  const firstError = Array.isArray(error?.errors) ? obj(error.errors[0]) : undefined;
  const reason = str(firstError?.reason) ?? str(error?.status) ?? `http_${status}`;
  if (status === 401) return new CalendarAuthError("Google authorization is no longer valid", { status, reason });
  if (status === 429 || (status === 403 && /^(rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded)$/u.test(reason))) {
    return new CalendarRateLimitError("Google Calendar is rate limited", {
      status,
      reason,
      retryAfterSeconds: parseRetryAfter(result.headers.get("retry-after")),
    });
  }
  if (status === 403 && /^(insufficientPermissions|authError|accessNotConfigured|PERMISSION_DENIED)$/u.test(reason)) {
    return new CalendarAuthError("Google Calendar permission is missing", { status, reason });
  }
  if (status === 404 || status === 410) return new CalendarNotFoundError("Google Calendar item was not found", { status, reason });
  if (status === 412) return new CalendarConflictError("Google Calendar item changed remotely", { status, reason });
  return new CalendarProviderError("Google Calendar request failed", { status, reason });
}

export type GoogleAccessTokenProvider = (options: { forceRefresh: boolean }) => Promise<string>;

type GoogleCursor = { v: 1; syncToken: string } | { v: 1; updatedMin: string };

export function encodeGoogleCursor(cursor: GoogleCursor): string {
  return JSON.stringify(cursor);
}

export function decodeGoogleCursor(value: string): GoogleCursor | null {
  try {
    const parsed: unknown = JSON.parse(value);
    const record = obj(parsed);
    if (!record || record.v !== 1) return null;
    if (typeof record.syncToken === "string" && record.syncToken) return { v: 1, syncToken: record.syncToken };
    if (typeof record.updatedMin === "string" && Number.isFinite(Date.parse(record.updatedMin))) return { v: 1, updatedMin: record.updatedMin };
    return null;
  } catch {
    return null;
  }
}

type GoogleEventTime = { date?: string; dateTime?: string };

function readEventTime(value: unknown): { date: Date; allDay: boolean; dateOnly?: string } | null {
  const time = obj(value) as GoogleEventTime | undefined;
  if (!time) return null;
  if (typeof time.dateTime === "string") {
    const ms = Date.parse(time.dateTime);
    return Number.isFinite(ms) ? { date: new Date(ms), allDay: false } : null;
  }
  if (typeof time.date === "string") {
    try {
      return { date: dateOnlyToDate(time.date), allDay: true, dateOnly: time.date };
    } catch {
      return null;
    }
  }
  return null;
}

function seriesTime(value: unknown): SeriesTime | null {
  const time = obj(value);
  if (!time) return null;
  if (typeof time.dateTime === "string") {
    const ms = Date.parse(time.dateTime);
    if (!Number.isFinite(ms)) return null;
    return { kind: "dateTime", instant: new Date(ms), ...(typeof time.timeZone === "string" ? { timeZone: time.timeZone } : {}) };
  }
  if (typeof time.date === "string") return { kind: "date", date: time.date };
  return null;
}

/** 시리즈 key(iCalUID). 취소된 예외처럼 iCalUID가 빠지면 Google 기본 형식 `<masterId>@google.com`으로 대신한다. */
function googleSeriesKey(raw: Record<string, unknown>): string | null {
  const iCalUID = str(raw.iCalUID);
  if (iCalUID) return iCalUID;
  const masterId = str(raw.recurringEventId) ?? (Array.isArray(raw.recurrence) ? str(raw.id) : undefined);
  return masterId ? `${masterId}@google.com` : null;
}

function googleSeries(raw: Record<string, unknown>, cancelled: boolean): { seriesIcs: string; seriesKey: string } | null {
  const seriesKey = googleSeriesKey(raw);
  const isException = typeof raw.recurringEventId === "string";
  const recurrenceId = isException ? seriesTime(raw.originalStartTime) : null;
  const start = seriesTime(raw.start) ?? recurrenceId;
  if (!seriesKey || !start || (isException && !recurrenceId)) return null;
  const end = seriesTime(raw.end) ?? undefined;
  const updated = str(raw.updated);
  try {
    const seriesIcs = buildSeriesIcs({
      uid: seriesKey,
      start,
      ...(end ? { end } : {}),
      ...(recurrenceId ? { recurrenceId } : {}),
      ...(!isException && Array.isArray(raw.recurrence) ? { recurrenceLines: raw.recurrence.filter((line): line is string => typeof line === "string") } : {}),
      status: cancelled ? "cancelled" : "confirmed",
      summary: str(raw.summary) ?? "",
      description: str(raw.description) ?? "",
      ...(updated && Number.isFinite(Date.parse(updated)) ? { dtstamp: new Date(updated) } : {}),
    });
    return { seriesIcs, seriesKey };
  } catch {
    return null;
  }
}

/**
 * Google event resource → RemoteEvent. 시간 정보가 없는 비취소 항목은 null.
 * 반복 master·예외는 `seriesIcs`(합성 VCALENDAR)와 `seriesKey`(iCalUID)를 함께 준다.
 * 취소된 예외 instance(cancelled + recurringEventId)는 originalStartTime을 시간으로 쓰는 cancelled 항목이 된다.
 */
export function mapGoogleEvent(raw: Record<string, unknown>): RemoteEvent | null {
  const remoteId = str(raw.id);
  if (!remoteId) return null;
  const cancelled = raw.status === "cancelled";
  const isException = typeof raw.recurringEventId === "string";
  if (cancelled && !isException) return null;
  const etag = str(raw.etag) ?? "";
  if (!etag && !cancelled) return null;
  const start = readEventTime(raw.start) ?? (cancelled ? readEventTime(raw.originalStartTime) : null);
  const end = readEventTime(raw.end) ?? start;
  if (!start || !end) return null;
  const updated = str(raw.updated);
  const updatedMs = updated ? Date.parse(updated) : Number.NaN;
  const portalRef = str(obj(obj(raw.extendedProperties)?.private)?.portalRef);
  const recurring = Array.isArray(raw.recurrence) || isException;
  const series = recurring ? googleSeries(raw, cancelled) : null;
  return {
    remoteId,
    etag,
    title: str(raw.summary) ?? "",
    description: str(raw.description) ?? "",
    start: start.date,
    end: end.date,
    allDay: start.allDay,
    ...(start.allDay ? { allDayStartDate: start.dateOnly, allDayEndDate: end.dateOnly } : {}),
    status: cancelled ? "cancelled" : "confirmed",
    ...(Number.isFinite(updatedMs) ? { updatedAt: new Date(updatedMs) } : {}),
    ...(portalRef ? { portalRef } : {}),
    recurring,
    ...(series ?? {}),
  };
}

function eventBody(rawInput: RemoteEventInput, forPatch: boolean): Record<string, unknown> {
  const input = normalizeRemoteEventInput(rawInput);
  let start: Record<string, unknown>;
  let end: Record<string, unknown>;
  if (input.allDay) {
    const range = allDayRange(input);
    start = { date: range.startDate };
    end = { date: range.endDate };
    if (forPatch) {
      start = { ...start, dateTime: null, timeZone: null };
      end = { ...end, dateTime: null, timeZone: null };
    }
  } else {
    start = { dateTime: input.start.toISOString() };
    end = { dateTime: input.end.toISOString() };
    if (forPatch) {
      start = { ...start, date: null, timeZone: null };
      end = { ...end, date: null, timeZone: null };
    }
  }
  return {
    summary: input.title,
    description: input.description ?? "",
    start,
    end,
    extendedProperties: { private: { portalRef: input.portalRef } },
  };
}

/**
 * portalRef에서 결정적 Google event id를 만든다(클라이언트 지정 id 규칙: base32hex 소문자 a-v·0-9, 5~1024자).
 * sha256 hex(0-9a-f)는 base32hex 부분집합이다. 같은 portalRef의 동시 create는 같은 id라 409로 중복을 막는다.
 */
export async function deriveGoogleEventId(portalRef: string): Promise<string> {
  return sha256Hex(`portal-google-event:v1:${portalRef}`);
}

function assertEtag(etag: string): string {
  if (typeof etag !== "string" || !etag || /[\r\n]/u.test(etag)) throw new CalendarProviderError("ETag is invalid");
  return etag;
}

function writeResult(body: Record<string, unknown> | null): WriteResult {
  const remoteId = str(body?.id);
  const etag = str(body?.etag);
  if (!remoteId || !etag) throw new CalendarProviderError("Google Calendar write response is invalid");
  return { remoteId, etag };
}

export type GoogleRequestInit = { body?: unknown; headers?: Record<string, string> };

/** access token을 붙여 Google API를 부르는 함수. 401이면 token을 한 번 새로 받아 다시 보낸다. */
export type GoogleSender = (method: string, url: string, init?: GoogleRequestInit) => Promise<FetchedText>;

export function createGoogleSender(options: {
  getAccessToken: GoogleAccessTokenProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): GoogleSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (method, url, init = {}) => {
    const attempt = async (forceRefresh: boolean) => {
      const token = await options.getAccessToken({ forceRefresh });
      return googleFetch(
        fetchImpl,
        url,
        {
          method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
            ...init.headers,
          },
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        },
        options.timeoutMs,
      );
    };
    let result = await attempt(false);
    if (result.status === 401) result = await attempt(true);
    return result;
  };
}

// ── 변경 알림(push notification channel) ───────────────────

/** Google channel id·token 형식(문서: id는 64자 이하 [A-Za-z0-9-_+/=], token은 256자 이하). */
const GOOGLE_CHANNEL_ID_PATTERN = /^[A-Za-z0-9_+/=-]{1,64}$/u;
const GOOGLE_CHANNEL_TOKEN_MAX_LENGTH = 256;

export type GoogleWatchInput = {
  calendarId: string;
  channelId: string;
  /** Google이 알림마다 X-Goog-Channel-Token으로 돌려주는 값. 응답·오류에 넣지 않는다. */
  token: string;
  /** https 알림 주소. */
  address: string;
  ttlSeconds: number;
};

export type GoogleWatchResult = { resourceId: string; expiresAt: Date };

/** `calendars/{id}/events/watch`로 web_hook channel을 등록한다. */
export async function watchGoogleCalendar(
  input: GoogleWatchInput & ({ send: GoogleSender } | { getAccessToken: GoogleAccessTokenProvider; fetchImpl?: typeof fetch }),
  now: Date = new Date(),
): Promise<GoogleWatchResult> {
  const send = "send" in input ? input.send : createGoogleSender({ getAccessToken: input.getAccessToken, fetchImpl: input.fetchImpl });
  if (!input.calendarId) throw new CalendarProviderError("Calendar id is missing");
  if (!GOOGLE_CHANNEL_ID_PATTERN.test(input.channelId)) throw new CalendarProviderError("Channel id is invalid");
  if (!input.token || input.token.length > GOOGLE_CHANNEL_TOKEN_MAX_LENGTH || /[\r\n]/u.test(input.token)) {
    throw new CalendarProviderError("Channel token is invalid");
  }
  let address: URL;
  try {
    address = new URL(input.address);
  } catch {
    throw new CalendarProviderError("Channel address is invalid");
  }
  if (address.protocol !== "https:" || address.username || address.password) throw new CalendarProviderError("Channel address must be https");
  const ttlSeconds = Math.floor(input.ttlSeconds);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new CalendarProviderError("Channel ttl is invalid");
  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(input.calendarId)}/events/watch`;
  const result = await send("POST", url, {
    body: { id: input.channelId, type: "web_hook", address: address.toString(), token: input.token, params: { ttl: String(ttlSeconds) } },
  });
  const body = parseJson(result.text);
  if (result.status < 200 || result.status >= 300) throw apiError(result, body);
  const resourceId = str(body?.resourceId);
  if (!resourceId || str(body?.id) !== input.channelId) throw new CalendarProviderError("Google channel response is invalid");
  // expiration은 epoch ms 문자열(int64)이다. 없으면 요청한 ttl을 쓴다.
  const expiration = Number(str(body?.expiration) ?? body?.expiration);
  const expiresAt = Number.isFinite(expiration) && expiration > 0
    ? new Date(expiration)
    : new Date(now.getTime() + ttlSeconds * 1_000);
  return { resourceId, expiresAt };
}

/** `channels/stop`. 이미 없거나 만료된 channel(404)은 성공으로 본다. */
export async function stopGoogleChannel(
  input: { channelId: string; resourceId: string } & ({ send: GoogleSender } | { getAccessToken: GoogleAccessTokenProvider; fetchImpl?: typeof fetch }),
): Promise<void> {
  const send = "send" in input ? input.send : createGoogleSender({ getAccessToken: input.getAccessToken, fetchImpl: input.fetchImpl });
  if (!input.channelId || !input.resourceId) throw new CalendarProviderError("Channel is invalid");
  const result = await send("POST", `${GOOGLE_CALENDAR_API}/channels/stop`, {
    body: { id: input.channelId, resourceId: input.resourceId },
  });
  if (result.status === 404) return;
  if (result.status < 200 || result.status >= 300) throw apiError(result, parseJson(result.text));
}

export type GoogleCalendarClient = CalendarProviderClient & {
  watch(input: GoogleWatchInput): Promise<GoogleWatchResult>;
  stopChannel(input: { channelId: string; resourceId: string }): Promise<void>;
};

export function createGoogleCalendarClient(options: {
  getAccessToken: GoogleAccessTokenProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}): GoogleCalendarClient {
  const now = options.now ?? (() => new Date());
  const send = createGoogleSender(options);

  async function sendOk(method: string, url: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<Record<string, unknown> | null> {
    const result = await send(method, url, init);
    if (result.status < 200 || result.status >= 300) throw apiError(result, parseJson(result.text));
    return parseJson(result.text);
  }

  function eventsUrl(calendarId: string, suffix = ""): URL {
    if (!calendarId) throw new CalendarProviderError("Calendar id is missing");
    return new URL(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events${suffix}`);
  }

  function eventUrl(calendarId: string, remoteId: string): URL {
    if (!remoteId || !/^[A-Za-z0-9_@.-]+$/u.test(remoteId)) throw new CalendarProviderError("Remote event id is invalid");
    return eventsUrl(calendarId, `/${encodeURIComponent(remoteId)}`);
  }

  return {
    kind: "GOOGLE",

    watch(input: GoogleWatchInput): Promise<GoogleWatchResult> {
      return watchGoogleCalendar({ ...input, send }, now());
    },

    stopChannel(input: { channelId: string; resourceId: string }): Promise<void> {
      return stopGoogleChannel({ ...input, send });
    },

    async listCalendars(): Promise<RemoteCalendar[]> {
      const calendars: RemoteCalendar[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < CALENDAR_SYNC_MAX_PAGES; page += 1) {
        const url = new URL(`${GOOGLE_CALENDAR_API}/users/me/calendarList`);
        url.searchParams.set("maxResults", "250");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const body = await sendOk("GET", url.toString());
        for (const item of Array.isArray(body?.items) ? body.items : []) {
          const entry = obj(item);
          const id = str(entry?.id);
          if (!entry || !id || entry.deleted === true) continue;
          const role = str(entry.accessRole);
          const color = str(entry.backgroundColor);
          calendars.push({
            id,
            name: str(entry.summaryOverride) ?? str(entry.summary) ?? id,
            ...(color && /^#[0-9a-fA-F]{6}$/u.test(color) ? { color: color.toLowerCase() } : {}),
            readOnly: role !== "owner" && role !== "writer",
          });
        }
        pageToken = str(body?.nextPageToken);
        if (!pageToken) return calendars;
      }
      throw new CalendarProviderError("Google calendar list has too many pages");
    },

    async pull(calendarId: string, cursor: string | null, window: PullWindow): Promise<PullResult> {
      let decoded: GoogleCursor | null = null;
      if (cursor !== null) {
        decoded = decodeGoogleCursor(cursor);
        if (!decoded) return fullResyncResult();
      } else {
        assertPullWindow(window);
      }
      const startedAt = now();
      const state = new Map<string, RemoteEvent | "deleted">();
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;
      for (let page = 0; page < CALENDAR_SYNC_MAX_PAGES; page += 1) {
        const url = eventsUrl(calendarId);
        const params = url.searchParams;
        params.set("maxResults", String(GOOGLE_PAGE_SIZE));
        params.set("singleEvents", "false");
        params.set("showDeleted", "true");
        if (decoded && "syncToken" in decoded) {
          params.set("syncToken", decoded.syncToken);
        } else {
          if (decoded && "updatedMin" in decoded) params.set("updatedMin", decoded.updatedMin);
          else {
            params.set("timeMin", window.from.toISOString());
            params.set("timeMax", window.to.toISOString());
          }
        }
        if (pageToken) params.set("pageToken", pageToken);
        const result = await send("GET", url.toString());
        if (result.status === 410) return fullResyncResult();
        const body = parseJson(result.text);
        if (result.status !== 200) throw apiError(result, body);
        for (const item of Array.isArray(body?.items) ? body.items : []) {
          const raw = obj(item);
          if (!raw) continue;
          const id = str(raw.id);
          if (!id) continue;
          if (raw.status === "cancelled") {
            // 취소된 반복 예외는 펼칠 때 그 회차를 빼야 하므로 changed(cancelled + seriesIcs)로 보고한다.
            const cancelledException = typeof raw.recurringEventId === "string" ? mapGoogleEvent(raw) : null;
            state.set(id, cancelledException ?? "deleted");
            continue;
          }
          if (typeof raw.eventType === "string" && SKIPPED_EVENT_TYPES.has(raw.eventType)) continue;
          const event = mapGoogleEvent(raw);
          if (event) state.set(id, event);
        }
        pageToken = str(body?.nextPageToken);
        nextSyncToken = str(body?.nextSyncToken) ?? nextSyncToken;
        if (!pageToken) break;
        if (page === CALENDAR_SYNC_MAX_PAGES - 1) throw new CalendarProviderError("Google event list has too many pages");
      }
      const changed: RemoteEvent[] = [];
      const deletedRemoteIds: string[] = [];
      for (const [id, value] of state) {
        if (value === "deleted") deletedRemoteIds.push(id);
        else changed.push(value);
      }
      const nextCursor = nextSyncToken
        ? encodeGoogleCursor({ v: 1, syncToken: nextSyncToken })
        : encodeGoogleCursor({ v: 1, updatedMin: new Date(startedAt.getTime() - UPDATED_MIN_SKEW_MS).toISOString() });
      return { changed, deletedRemoteIds, nextCursor, fullResync: false };
    },

    async create(calendarId: string, input: RemoteEventInput): Promise<WriteResult> {
      const url = eventsUrl(calendarId);
      url.searchParams.set("sendUpdates", "none");
      const id = await deriveGoogleEventId(normalizeRemoteEventInput(input).portalRef);
      const result = await send("POST", url.toString(), { body: { id, ...eventBody(input, false) } });
      if (result.status !== 409) {
        const body = parseJson(result.text);
        if (result.status < 200 || result.status >= 300) throw apiError(result, body);
        return writeResult(body);
      }
      // 409 duplicate: 같은 portalRef를 다른 실행이 먼저 만들었거나, 삭제(cancelled)된 같은 id가 남아 있다.
      // 새 사본을 만들지 않고 그 id를 읽어 이 입력으로 맞춘다(cancelled면 status confirmed로 되살린다).
      const existing = await send("GET", eventUrl(calendarId, id).toString());
      const existingBody = parseJson(existing.text);
      if (existing.status !== 200) throw apiError(existing, existingBody);
      const etag = str(existingBody?.etag);
      if (!etag) throw new CalendarProviderError("Google Calendar event response is invalid");
      const patchUrl = eventUrl(calendarId, id);
      patchUrl.searchParams.set("sendUpdates", "none");
      return writeResult(
        await sendOk("PATCH", patchUrl.toString(), {
          body: { ...eventBody(input, true), status: "confirmed" },
          headers: { "if-match": assertEtag(etag) },
        }),
      );
    },

    async update(calendarId: string, remoteId: string, input: RemoteEventInput, ifMatchEtag: string): Promise<WriteResult> {
      const url = eventUrl(calendarId, remoteId);
      url.searchParams.set("sendUpdates", "none");
      return writeResult(
        await sendOk("PATCH", url.toString(), { body: eventBody(input, true), headers: { "if-match": assertEtag(ifMatchEtag) } }),
      );
    },

    async remove(calendarId: string, remoteId: string, ifMatchEtag: string): Promise<void> {
      const url = eventUrl(calendarId, remoteId);
      url.searchParams.set("sendUpdates", "none");
      await sendOk("DELETE", url.toString(), { headers: { "if-match": assertEtag(ifMatchEtag) } });
    },

    async get(calendarId: string, remoteId: string): Promise<RemoteEvent | null> {
      const result = await send("GET", eventUrl(calendarId, remoteId).toString());
      if (result.status === 404 || result.status === 410) return null;
      const body = parseJson(result.text);
      if (result.status !== 200) throw apiError(result, body);
      if (!body || body.status === "cancelled") return null;
      return mapGoogleEvent(body);
    },

    async findByPortalRef(calendarId: string, portalRef: string): Promise<RemoteEvent | null> {
      if (!PORTAL_REF_PATTERN.test(portalRef) || portalRef.length > 200) throw new CalendarProviderError("Portal reference is invalid");
      const url = eventsUrl(calendarId);
      url.searchParams.set("privateExtendedProperty", `portalRef=${portalRef}`);
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("singleEvents", "false");
      url.searchParams.set("maxResults", "10");
      const body = await sendOk("GET", url.toString());
      for (const item of Array.isArray(body?.items) ? body.items : []) {
        const raw = obj(item);
        if (!raw || raw.status === "cancelled") continue;
        const event = mapGoogleEvent(raw);
        if (event && event.portalRef === portalRef) return event;
      }
      return null;
    },
  };
}
