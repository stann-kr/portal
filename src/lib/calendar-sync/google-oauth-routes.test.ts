import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGoogleAuthUrl, computePkceChallenge, createOAuthState, createPkcePair } from "./google";
import {
  GOOGLE_OAUTH_COOKIE_NAME,
  GOOGLE_OAUTH_COOKIE_PATH,
  GOOGLE_OAUTH_MESSAGES,
  GOOGLE_OAUTH_TTL_MS,
  constantTimeEqual,
  createGoogleOAuthCallbackHandler,
  createGoogleOAuthStartHandler,
  sealGoogleOAuthState,
  unsealGoogleOAuthState,
  type GoogleOAuthFlowState,
  type GoogleOAuthSession,
} from "./google-oauth-routes";
import { parseGoogleOAuthResult } from "./google-oauth-result";

const NOW = Date.UTC(2026, 9, 27, 3, 0, 0);
const KEY = new Uint8Array(32).map((_, index) => index + 1);
const CONFIG = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://portal.test/api/calendar-connections/google/callback",
};
const ADMIN: GoogleOAuthSession = { id: "admin-1", role: "admin" };

function startHandler(overrides: Partial<Parameters<typeof createGoogleOAuthStartHandler>[0]> = {}) {
  return createGoogleOAuthStartHandler({
    getSession: async () => ADMIN,
    getOAuthConfig: () => CONFIG,
    getEncryptionKey: () => KEY,
    now: () => NOW,
    createPkcePair,
    createState: createOAuthState,
    buildAuthUrl: buildGoogleAuthUrl,
    ...overrides,
  });
}

function callbackHandler(overrides: Partial<Parameters<typeof createGoogleOAuthCallbackHandler>[0]> = {}) {
  const calls: { code: string; codeVerifier: string }[] = [];
  const handler = createGoogleOAuthCallbackHandler({
    getSession: async () => ADMIN,
    getOAuthConfig: () => CONFIG,
    getEncryptionKey: () => KEY,
    now: () => NOW,
    complete: async (input) => {
      calls.push(input);
      return { success: "연결했습니다." };
    },
    ...overrides,
  });
  return { handler, calls };
}

function cookieValue(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${GOOGLE_OAUTH_COOKIE_NAME}=([^;]*)`, "u").exec(header);
  assert.ok(match, "flow cookie is set");
  return match[1];
}

async function flowCookie(overrides: Partial<GoogleOAuthFlowState> = {}) {
  const flow: GoogleOAuthFlowState = {
    state: "state-value-abcdefghijklmnopqrstuvwxyz012345",
    codeVerifier: "verifier-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    adminId: "admin-1",
    expiresAt: NOW + GOOGLE_OAUTH_TTL_MS,
    ...overrides,
  };
  return { flow, sealed: await sealGoogleOAuthState(flow, KEY) };
}

function callbackRequest(params: Record<string, string>, cookie?: string) {
  const url = new URL("https://portal.test/api/calendar-connections/google/callback");
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return new Request(url, { headers: cookie ? { cookie: `other=1; ${GOOGLE_OAUTH_COOKIE_NAME}=${cookie}` } : {} });
}

function resultOf(response: Response) {
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.origin, "https://portal.test");
  assert.equal(location.pathname, "/dashboard/admin/calendar-sync");
  return { google: location.searchParams.get("google"), message: location.searchParams.get("message"), location };
}

function assertCookieCleared(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  assert.match(header, new RegExp(`^${GOOGLE_OAUTH_COOKIE_NAME}=;`, "u"));
  assert.match(header, /Max-Age=0/u);
  assert.match(header, new RegExp(`Path=${GOOGLE_OAUTH_COOKIE_PATH}`, "u"));
}

const START_URL = "https://portal.test/api/calendar-connections/google/start";

test("Google start refuses anonymous and student sessions before touching config", async () => {
  let configRead = false;
  const anonymous = await startHandler({ getSession: async () => null, getOAuthConfig: () => { configRead = true; return CONFIG; } })(new Request(START_URL));
  assert.equal(anonymous.status, 401);
  const student = await startHandler({ getSession: async () => ({ id: "student-1", role: "student" }) })(new Request(START_URL));
  assert.equal(student.status, 403);
  assert.equal(student.headers.get("set-cookie"), null);
  assert.equal(configRead, false);
});

test("Google start answers 503 with the setup notice when the OAuth client or encryption key is missing", async () => {
  const noConfig = await startHandler({ getOAuthConfig: () => null })(new Request(START_URL));
  assert.equal(noConfig.status, 503);
  assert.equal(await noConfig.text(), GOOGLE_OAUTH_MESSAGES.googleMissing);
  const noKey = await startHandler({ getEncryptionKey: () => { throw new Error("missing"); } })(new Request(START_URL));
  assert.equal(noKey.status, 503);
  assert.equal(await noKey.text(), GOOGLE_OAUTH_MESSAGES.encryptionMissing);
  assert.equal(noKey.headers.get("set-cookie"), null);
});

test("Google start seals state, verifier and admin into an HttpOnly cookie and redirects with PKCE", async () => {
  const response = await startHandler()(new Request(START_URL));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.origin + location.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(location.searchParams.get("redirect_uri"), CONFIG.redirectUri);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  const state = location.searchParams.get("state");
  const challenge = location.searchParams.get("code_challenge");
  assert.ok(state && challenge);

  const header = response.headers.get("set-cookie") ?? "";
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", `Path=${GOOGLE_OAUTH_COOKIE_PATH}`, "Max-Age=600"]) {
    assert.ok(header.includes(attribute), `cookie attribute ${attribute}`);
  }
  const sealed = cookieValue(response);
  assert.ok(!sealed.includes(state), "state is not readable in the cookie");
  const flow = await unsealGoogleOAuthState(sealed, KEY);
  assert.ok(flow);
  assert.equal(flow.state, state);
  assert.equal(flow.adminId, "admin-1");
  assert.equal(flow.expiresAt, NOW + GOOGLE_OAUTH_TTL_MS);
  assert.equal(await computePkceChallenge(flow.codeVerifier), challenge);
  assert.ok(!sealed.includes(flow.codeVerifier), "verifier is not readable in the cookie");
  assert.equal(await unsealGoogleOAuthState(sealed, new Uint8Array(32)), null, "another key cannot open it");
});

test("Google start omits Secure only for plain-http localhost development", async () => {
  const response = await startHandler()(new Request("http://localhost:3004/api/calendar-connections/google/start"));
  assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /Secure/u);
  const http = await startHandler()(new Request("http://portal.test/api/calendar-connections/google/start"));
  assert.match(http.headers.get("set-cookie") ?? "", /Secure/u);
});

test("Google callback exchanges the code with the sealed verifier and clears the cookie", async () => {
  const { flow, sealed } = await flowCookie();
  const { handler, calls } = callbackHandler();
  const response = await handler(callbackRequest({ code: "auth-code", state: flow.state }, sealed));
  assert.deepEqual(calls, [{ code: "auth-code", codeVerifier: flow.codeVerifier }]);
  const result = resultOf(response);
  assert.equal(result.google, "connected");
  assert.equal(result.message, null);
  assert.ok(!result.location.toString().includes("auth-code"), "the code never reaches the admin page address");
  assertCookieCleared(response);
});

test("Google callback rejects missing, mismatched and forged state without exchanging", async () => {
  const { flow, sealed } = await flowCookie();
  const forged = `${sealed.slice(0, 20)}${sealed[20] === "A" ? "B" : "A"}${sealed.slice(21)}`;
  const cases = [
    callbackRequest({ code: "c", state: flow.state }),
    callbackRequest({ code: "c" }, sealed),
    callbackRequest({ code: "c", state: `${flow.state.slice(0, -1)}x` }, sealed),
    callbackRequest({ code: "c", state: flow.state }, forged),
    callbackRequest({ code: "c", state: flow.state }, "not base64 !!"),
  ];
  for (const request of cases) {
    const { handler, calls } = callbackHandler();
    const response = await handler(request);
    const result = resultOf(response);
    assert.equal(result.google, "error");
    assert.equal(result.message, "state_mismatch");
    assert.equal(calls.length, 0);
    assertCookieCleared(response);
  }
});

test("Google callback rejects an expired flow and a flow started by another admin", async () => {
  const expired = await flowCookie({ expiresAt: NOW });
  const first = callbackHandler();
  const expiredResponse = await first.handler(callbackRequest({ code: "c", state: expired.flow.state }, expired.sealed));
  assert.equal(resultOf(expiredResponse).message, "expired");
  assert.equal(first.calls.length, 0);

  const other = await flowCookie({ adminId: "admin-2" });
  const second = callbackHandler();
  const otherResponse = await second.handler(callbackRequest({ code: "c", state: other.flow.state }, other.sealed));
  assert.equal(resultOf(otherResponse).message, "wrong_admin");
  assert.equal(second.calls.length, 0);
  assertCookieCleared(otherResponse);
});

test("Google callback refuses non-admin sessions with status codes and clears the cookie", async () => {
  const { flow, sealed } = await flowCookie();
  const anonymous = callbackHandler({ getSession: async () => null });
  const anonymousResponse = await anonymous.handler(callbackRequest({ code: "c", state: flow.state }, sealed));
  assert.equal(anonymousResponse.status, 401);
  assertCookieCleared(anonymousResponse);
  const student = callbackHandler({ getSession: async () => ({ id: "admin-1", role: "student" }) });
  const studentResponse = await student.handler(callbackRequest({ code: "c", state: flow.state }, sealed));
  assert.equal(studentResponse.status, 403);
  assert.equal(anonymous.calls.length + student.calls.length, 0);
});

test("Google callback maps access_denied and provider errors to fixed codes without reflecting text", async () => {
  const { flow, sealed } = await flowCookie();
  const denied = callbackHandler();
  const deniedResponse = await denied.handler(callbackRequest({ error: "access_denied", state: flow.state }, sealed));
  assert.equal(resultOf(deniedResponse).message, "access_denied");
  assertCookieCleared(deniedResponse);

  const injected = callbackHandler();
  const injectedResponse = await injected.handler(callbackRequest({ error: "<script>alert(1)</script>", error_description: "evil", state: flow.state }, sealed));
  const result = resultOf(injectedResponse);
  assert.equal(result.message, "provider_error");
  assert.ok(!result.location.toString().includes("script") && !result.location.toString().includes("evil"));
  assert.equal(denied.calls.length + injected.calls.length, 0);
});

test("Google callback turns engine failures into exchange_failed and never forwards engine text", async () => {
  const { flow, sealed } = await flowCookie();
  const returned = callbackHandler({ complete: async () => ({ error: "token=secret-value 교환 실패" }) });
  const returnedResult = resultOf(await returned.handler(callbackRequest({ code: "c", state: flow.state }, sealed)));
  assert.equal(returnedResult.message, "exchange_failed");
  assert.ok(!returnedResult.location.toString().includes("secret"));

  const originalError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const thrown = callbackHandler({ complete: async () => { throw new Error("code=auth-code refresh_token=leak"); } });
    const thrownResponse = await thrown.handler(callbackRequest({ code: "auth-code", state: flow.state }, sealed));
    assert.equal(resultOf(thrownResponse).message, "exchange_failed");
    assertCookieCleared(thrownResponse);
  } finally {
    console.error = originalError;
  }
  assert.ok(!JSON.stringify(logged).includes("auth-code") && !JSON.stringify(logged).includes("leak"));
});

test("Google callback reports config_missing when the server setup disappeared mid-flow", async () => {
  const { flow, sealed } = await flowCookie();
  const { handler, calls } = callbackHandler({ getOAuthConfig: () => null });
  assert.equal(resultOf(await handler(callbackRequest({ code: "c", state: flow.state }, sealed))).message, "config_missing");
  assert.equal(calls.length, 0);
});

test("Google callback returns to the configured redirect origin even when the proxy rewrote the request host", async () => {
  const { flow, sealed } = await flowCookie();
  const internal = new URL("http://127.0.0.1:8787/api/calendar-connections/google/callback");
  internal.searchParams.set("code", "c");
  internal.searchParams.set("state", flow.state);
  const request = new Request(internal, { headers: { cookie: `${GOOGLE_OAUTH_COOKIE_NAME}=${sealed}` } });
  const { handler } = callbackHandler();
  const result = resultOf(await handler(request));
  assert.equal(result.google, "connected");

  // 설정이 없으면 요청 주소의 origin으로 돌아간다.
  const missing = callbackHandler({ getOAuthConfig: () => null });
  const fallback = new URL((await missing.handler(callbackRequest({ code: "c", state: flow.state }, sealed))).headers.get("location") ?? "");
  assert.equal(fallback.origin, "https://portal.test");
  const local = await missing.handler(new Request(internal, { headers: { cookie: `${GOOGLE_OAUTH_COOKIE_NAME}=${sealed}` } }));
  assert.equal(new URL(local.headers.get("location") ?? "").origin, "http://127.0.0.1:8787");
});

test("constant-time state comparison and result parsing only accept exact fixed values", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.deepEqual(parseGoogleOAuthResult("connected", undefined), { kind: "connected" });
  assert.deepEqual(parseGoogleOAuthResult("error", "expired"), { kind: "error", code: "expired" });
  assert.deepEqual(parseGoogleOAuthResult("error", "임의 문구"), { kind: "error", code: "unknown" });
  assert.equal(parseGoogleOAuthResult(undefined, "expired"), null);
});
