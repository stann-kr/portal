/**
 * Google 캘린더 OAuth(PKCE) 시작·callback route 본문. route 파일은 의존성만 연결한다.
 *
 * 흐름 상태(state·PKCE verifier·시작한 관리자·만료)는 서버 저장소 없이 HttpOnly cookie에 담는다.
 * cookie 값은 외부 캘린더 암호화 key에서 HKDF로 파생한 별도 AES-GCM key로 봉인해
 * client가 읽거나 바꾸거나 만들어 낼 수 없다. 봉인을 풀지 못하면 위조로 본다.
 * code·token·verifier는 log·응답·주소에 남기지 않는다.
 */
import type { CalendarSyncFormState } from "@/lib/actions/calendarSync";
import type { GoogleCalendarOAuthConfig } from "./oauth-config";
import { base64UrlEncode } from "./types";
import { googleOAuthResultHref, type GoogleOAuthErrorCode } from "./google-oauth-result";

export const GOOGLE_OAUTH_COOKIE_NAME = "portal_google_calendar_oauth";
export const GOOGLE_OAUTH_COOKIE_PATH = "/api/calendar-connections/google";
export const GOOGLE_OAUTH_TTL_MS = 10 * 60_000;

const HKDF_SALT = "stann-lumo-portal/calendar-sync";
const HKDF_INFO = "google-calendar-oauth-cookie/v1";
const MAX_COOKIE_LENGTH = 2_048;

export const GOOGLE_OAUTH_MESSAGES = {
  unauthorized: "로그인이 필요합니다.",
  forbidden: "관리자만 캘린더 계정을 연결할 수 있습니다.",
  encryptionMissing: "설정 필요: 서버에 EXTERNAL_CALENDAR_ENCRYPTION_KEY가 없어 외부 캘린더 연결이 꺼져 있습니다.",
  googleMissing: "Google 연동 설정(GOOGLE_CALENDAR_CLIENT_ID/SECRET)이 없어 Google 연결이 꺼져 있습니다.",
} as const;

export type GoogleOAuthSession = { id: string; role: string } | null;

export type GoogleOAuthFlowState = {
  state: string;
  codeVerifier: string;
  adminId: string;
  expiresAt: number;
};

export type GoogleOAuthRouteDeps = {
  getSession: () => Promise<GoogleOAuthSession>;
  getOAuthConfig: () => GoogleCalendarOAuthConfig | null;
  /** 외부 캘린더 암호화 key(32 bytes). 없으면 null. */
  getEncryptionKey: () => Uint8Array | null;
  now?: () => number;
};

export type GoogleOAuthStartDeps = GoogleOAuthRouteDeps & {
  createPkcePair: () => Promise<{ codeVerifier: string; codeChallenge: string }>;
  createState: () => string;
  buildAuthUrl: (input: { clientId: string; redirectUri: string; state: string; codeChallenge: string }) => string;
};

export type GoogleOAuthCallbackDeps = GoogleOAuthRouteDeps & {
  complete: (input: { code: string; codeVerifier: string }) => Promise<CalendarSyncFormState>;
};

// ── cookie 봉인 ─────────────────────────────────────────────

function toBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return null;
  try {
    const padded = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function deriveCookieKey(encryptionKey: Uint8Array): Promise<CryptoKey> {
  if (encryptionKey.byteLength !== 32) throw new Error("encryption key is unavailable");
  const baseKey = await crypto.subtle.importKey("raw", toBytes(encryptionKey), "HKDF", false, ["deriveKey"]);
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(HKDF_SALT), info: encoder.encode(HKDF_INFO) },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealGoogleOAuthState(flow: GoogleOAuthFlowState, encryptionKey: Uint8Array): Promise<string> {
  const key = await deriveCookieKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(GOOGLE_OAUTH_COOKIE_NAME) },
    key,
    new TextEncoder().encode(JSON.stringify(flow)),
  ));
  const sealed = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  sealed.set(iv, 0);
  sealed.set(ciphertext, iv.byteLength);
  return base64UrlEncode(sealed);
}

/** 봉인을 풀지 못하거나 모양이 다르면 null(위조·손상·다른 key). */
export async function unsealGoogleOAuthState(value: string, encryptionKey: Uint8Array): Promise<GoogleOAuthFlowState | null> {
  if (!value || value.length > MAX_COOKIE_LENGTH) return null;
  const sealed = base64UrlDecode(value);
  if (!sealed || sealed.byteLength < 12 + 16) return null;
  try {
    const key = await deriveCookieKey(encryptionKey);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toBytes(sealed.subarray(0, 12)), additionalData: new TextEncoder().encode(GOOGLE_OAUTH_COOKIE_NAME) },
      key,
      toBytes(sealed.subarray(12)),
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (!parsed || typeof parsed !== "object") return null;
    const flow = parsed as Record<string, unknown>;
    if (
      typeof flow.state !== "string" || !flow.state
      || typeof flow.codeVerifier !== "string" || !flow.codeVerifier
      || typeof flow.adminId !== "string" || !flow.adminId
      || typeof flow.expiresAt !== "number" || !Number.isFinite(flow.expiresAt)
    ) {
      return null;
    }
    return { state: flow.state, codeVerifier: flow.codeVerifier, adminId: flow.adminId, expiresAt: flow.expiresAt };
  } catch {
    return null;
  }
}

/** 길이가 다르면 false, 같으면 모든 byte를 비교한다(조기 종료 없음). */
export function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

// ── HTTP helpers ───────────────────────────────────────────

function isLocalHttp(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
}

function cookieAttributes(requestUrl: URL, maxAgeSeconds: number): string {
  const attributes = [`Path=${GOOGLE_OAUTH_COOKIE_PATH}`, `Max-Age=${maxAgeSeconds}`, "HttpOnly", "SameSite=Lax"];
  if (!isLocalHttp(requestUrl)) attributes.push("Secure");
  return attributes.join("; ");
}

function flowCookie(requestUrl: URL, value: string): string {
  return `${GOOGLE_OAUTH_COOKIE_NAME}=${value}; ${cookieAttributes(requestUrl, GOOGLE_OAUTH_TTL_MS / 1000)}`;
}

function clearedFlowCookie(requestUrl: URL): string {
  return `${GOOGLE_OAUTH_COOKIE_NAME}=; ${cookieAttributes(requestUrl, 0)}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function textResponse(status: number, message: string, setCookie?: string): Response {
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(message, { status, headers });
}

/** 설정된 redirect URI의 http(s) origin. 읽을 수 없으면 null. */
function configuredOrigin(redirectUri: string | undefined): string | null {
  if (!redirectUri) return null;
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function redirectResponse(location: string, setCookie: string): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

type AuthCheck = { ok: true; adminId: string } | { ok: false; status: 401 | 403; message: string };

async function checkAdmin(deps: GoogleOAuthRouteDeps): Promise<AuthCheck> {
  const session = await deps.getSession().catch(() => null);
  if (!session?.id) return { ok: false, status: 401, message: GOOGLE_OAUTH_MESSAGES.unauthorized };
  if (session.role !== "admin") return { ok: false, status: 403, message: GOOGLE_OAUTH_MESSAGES.forbidden };
  return { ok: true, adminId: session.id };
}

function safeEncryptionKey(deps: GoogleOAuthRouteDeps): Uint8Array | null {
  try {
    const key = deps.getEncryptionKey();
    return key && key.byteLength === 32 ? key : null;
  } catch {
    return null;
  }
}

// ── handlers ───────────────────────────────────────────────

export function createGoogleOAuthStartHandler(deps: GoogleOAuthStartDeps) {
  return async function GET(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const auth = await checkAdmin(deps);
    if (!auth.ok) return textResponse(auth.status, auth.message);

    const encryptionKey = safeEncryptionKey(deps);
    if (!encryptionKey) return textResponse(503, GOOGLE_OAUTH_MESSAGES.encryptionMissing);
    const config = deps.getOAuthConfig();
    if (!config) return textResponse(503, GOOGLE_OAUTH_MESSAGES.googleMissing);

    const now = deps.now?.() ?? Date.now();
    const { codeVerifier, codeChallenge } = await deps.createPkcePair();
    const state = deps.createState();
    const sealed = await sealGoogleOAuthState(
      { state, codeVerifier, adminId: auth.adminId, expiresAt: now + GOOGLE_OAUTH_TTL_MS },
      encryptionKey,
    );
    const location = deps.buildAuthUrl({ clientId: config.clientId, redirectUri: config.redirectUri, state, codeChallenge });
    return redirectResponse(location, flowCookie(requestUrl, sealed));
  };
}

export function createGoogleOAuthCallbackHandler(deps: GoogleOAuthCallbackDeps) {
  return async function GET(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    const cleared = clearedFlowCookie(requestUrl);
    const auth = await checkAdmin(deps);
    if (!auth.ok) return textResponse(auth.status, auth.message, cleared);

    const config = deps.getOAuthConfig();
    // proxy 뒤에서도 Google에 등록한 redirect URI와 같은 공개 origin으로 돌려보낸다. 설정이 없으면 요청 주소를 쓴다.
    const returnBase = configuredOrigin(config?.redirectUri) ?? requestUrl.origin;
    const finish = (result: { kind: "connected" } | { kind: "error"; code: GoogleOAuthErrorCode }) =>
      redirectResponse(new URL(googleOAuthResultHref(result), returnBase).toString(), cleared);
    const fail = (code: GoogleOAuthErrorCode) => finish({ kind: "error", code });

    const encryptionKey = safeEncryptionKey(deps);
    if (!encryptionKey || !config) return fail("config_missing");

    const params = requestUrl.searchParams;
    const providerError = params.get("error");
    if (providerError) return fail(providerError === "access_denied" ? "access_denied" : "provider_error");

    const sealed = readCookie(request, GOOGLE_OAUTH_COOKIE_NAME);
    const flow = sealed ? await unsealGoogleOAuthState(sealed, encryptionKey) : null;
    const returnedState = params.get("state") ?? "";
    if (!flow || !returnedState || !constantTimeEqual(returnedState, flow.state)) return fail("state_mismatch");
    if (flow.expiresAt <= (deps.now?.() ?? Date.now())) return fail("expired");
    if (flow.adminId !== auth.adminId) return fail("wrong_admin");

    const code = params.get("code");
    if (!code) return fail("provider_error");

    try {
      const result = await deps.complete({ code, codeVerifier: flow.codeVerifier });
      return result.error ? fail("exchange_failed") : finish({ kind: "connected" });
    } catch {
      // 오류 객체에 code·token이 섞일 수 있어 내용은 남기지 않는다.
      console.error("[calendar-sync] Google calendar connection could not be completed");
      return fail("exchange_failed");
    }
  };
}
