import assert from "node:assert/strict";
import test from "node:test";
import { Auth, skipCSRFCheck } from "@auth/core";
import { decode, encode } from "@auth/core/jwt";
import * as bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { AUTH_SESSION_MAX_AGE_SECONDS, authConfig, PASSWORD_CHANGE_PATH } from "./auth.config";
import { createNodeAuthConfig } from "./auth";
import type { ActiveSessionProfile } from "./lib/active-profile";
import { credentialFingerprint } from "./lib/credential-fingerprint";
import { temporaryPasswordHash } from "./lib/password-storage";

const AUTH_SECRET = "test-only-auth-secret-with-sufficient-entropy";
const SESSION_COOKIE_NAME = "authjs.session-token";
const PROFILE: ActiveSessionProfile = {
  id: "student-1",
  email: "student@example.com",
  displayName: "Student",
  role: "student",
  credentialFingerprint: credentialFingerprint("$2a$10$current-password-hash"),
  passwordChangeRequired: false,
};

async function sessionRequest(
  findProfileById: (profileId: string) => Promise<ActiveSessionProfile | null>,
  tokenFingerprint?: string,
) {
  const token = await encode({
    token: {
      sub: PROFILE.id,
      name: "Stale Name",
      email: "stale@example.com",
      role: "student",
      ...(tokenFingerprint ? { credentialFingerprint: tokenFingerprint } : {}),
    },
    secret: AUTH_SECRET,
    salt: SESSION_COOKIE_NAME,
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });
  const { handlers } = NextAuth({
    ...createNodeAuthConfig(findProfileById),
    secret: AUTH_SECRET,
  });
  const request = new NextRequest("http://localhost/api/auth/session", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });

  return handlers.GET(request);
}

test("GET /api/auth/session은 active profile의 현재 session만 반환한다", async () => {
  const lookedUpIds: string[] = [];
  const response = await sessionRequest(async (profileId) => {
    lookedUpIds.push(profileId);
    return PROFILE;
  });

  assert.equal(response.status, 200);
  assert.deepEqual(lookedUpIds, [PROFILE.id]);
  const body = (await response.json()) as {
    user: Record<string, unknown>;
    expires: unknown;
  };
  assert.deepEqual(body.user, {
    name: PROFILE.displayName,
    email: PROFILE.email,
    role: PROFILE.role,
    id: PROFILE.id,
  });
  assert.equal(typeof body.expires, "string");
});

test("GET /api/auth/session은 hard-delete된 profile의 stale JWT를 폐기한다", async () => {
  const response = await sessionRequest(async () => null);

  assert.equal(response.status, 200);
  assert.equal(await response.json(), null);
  assert.match(
    response.headers.get("set-cookie") ?? "",
    /authjs\.session-token=;.*Max-Age=0/i,
  );
});

test("비밀번호 지문이 같은 session은 유지하고 응답에 지문을 노출하지 않는다", async () => {
  const response = await sessionRequest(async () => PROFILE, PROFILE.credentialFingerprint ?? undefined);

  assert.equal(response.status, 200);
  const body = (await response.json()) as { user: Record<string, unknown> };
  assert.equal(body.user.id, PROFILE.id);
  assert.equal("credentialFingerprint" in body.user, false);
});

test("비밀번호가 바뀐 뒤 이전 지문의 session은 폐기하고 지문 없는 이전 token은 만료까지 허용한다", async () => {
  const stale = await sessionRequest(async () => PROFILE, credentialFingerprint("$2a$10$previous-password-hash") ?? undefined);
  assert.equal(await stale.json(), null);
  assert.match(stale.headers.get("set-cookie") ?? "", /authjs\.session-token=;.*Max-Age=0/i);

  const passwordRemoved = await sessionRequest(async () => ({ ...PROFILE, credentialFingerprint: null }), PROFILE.credentialFingerprint ?? undefined);
  assert.equal(await passwordRemoved.json(), null);

  const legacy = await sessionRequest(async () => PROFILE);
  const legacyBody = (await legacy.json()) as { user: Record<string, unknown> } | null;
  assert.equal(legacyBody?.user.id, PROFILE.id);
});

async function credentialsLoginResponse(
  passwordHash: string,
  password: string,
  allowAttempt: (request: Request) => Promise<boolean> = async () => true,
  onProfileLookup: () => void = () => undefined,
) {
  return Auth(
    new Request("http://localhost/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.9" },
      body: new URLSearchParams({ email: PROFILE.email, password, callbackUrl: "/dashboard" }),
    }),
    {
      ...createNodeAuthConfig(async () => PROFILE, async () => { onProfileLookup(); return { ...PROFILE, passwordHash }; }, allowAttempt),
      secret: AUTH_SECRET,
      basePath: "/api/auth",
      skipCSRFCheck,
      logger: { error: () => undefined },
    },
  );
}

test("로그인 시도 한도를 넘으면 계정 조회와 비밀번호 비교 전에 rate_limited로 거부한다", async () => {
  const passwordHash = await bcrypt.hash("correct horse battery", 4);
  const seenAddresses: (string | null)[] = [];
  let lookups = 0;
  const response = await credentialsLoginResponse(
    passwordHash,
    "correct horse battery",
    async (request) => { seenAddresses.push(request.headers.get("cf-connecting-ip")); return false; },
    () => { lookups += 1; },
  );
  const location = new URL(response.headers.get("location") ?? "", "http://localhost");
  assert.equal(location.searchParams.get("error"), "CredentialsSignin");
  assert.equal(location.searchParams.get("code"), "rate_limited");
  assert.equal(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`)), false);
  assert.deepEqual(seenAddresses, ["203.0.113.9"]);
  assert.equal(lookups, 0);
});

async function credentialsLogin(passwordHash: string, password: string) {
  const response = await Auth(
    new Request("http://localhost/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: PROFILE.email, password, callbackUrl: "/dashboard" }),
    }),
    {
      ...createNodeAuthConfig(async () => PROFILE, async () => ({ ...PROFILE, passwordHash })),
      secret: AUTH_SECRET,
      basePath: "/api/auth",
      skipCSRFCheck,
      // 거부된 로그인의 예상된 CredentialsSignin 오류 로그를 테스트 출력에서 뺀다.
      logger: { error: () => undefined },
    },
  );
  const sessionCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!sessionCookie) return null;
  return decode({
    token: sessionCookie.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0],
    secret: AUTH_SECRET,
    salt: SESSION_COOKIE_NAME,
  });
}

test("관리자가 발급한 임시 비밀번호 로그인은 새 비밀번호 설정 필요 상태로 발급된다", async () => {
  const storedHash = temporaryPasswordHash(await bcrypt.hash("abcd-efgh-jkmn", 4));
  assert.equal(await credentialsLogin(storedHash, "wrong-password"), null);

  const token = await credentialsLogin(storedHash, "abcd-efgh-jkmn");
  assert.equal(token?.sub, PROFILE.id);
  assert.equal(token?.passwordChangeRequired, true);
  assert.equal(token?.credentialFingerprint, credentialFingerprint(storedHash));

  const normal = await credentialsLogin(await bcrypt.hash("abcd-efgh-jkmn", 4), "abcd-efgh-jkmn");
  assert.equal(normal?.passwordChangeRequired, undefined);
});

test("임시 비밀번호 상태는 매 요청 현재 profile에서 다시 판단해 지문 없는 이전 token에도 적용한다", async () => {
  const temporary = { ...PROFILE, passwordChangeRequired: true };
  const current = await sessionRequest(async () => temporary, PROFILE.credentialFingerprint ?? undefined);
  const currentBody = (await current.json()) as { user: Record<string, unknown> };
  assert.equal(currentBody.user.passwordChangeRequired, true);

  const legacy = await sessionRequest(async () => temporary);
  const legacyBody = (await legacy.json()) as { user: Record<string, unknown> };
  assert.equal(legacyBody.user.passwordChangeRequired, true);
});

test("credentials 로그인은 검증한 비밀번호 hash의 지문을 session token에 결합한다", async () => {
  const passwordHash = await bcrypt.hash("correct horse battery", 4);
  const response = await Auth(
    new Request("http://localhost/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: PROFILE.email, password: "correct horse battery", callbackUrl: "/dashboard" }),
    }),
    {
      ...createNodeAuthConfig(async () => PROFILE, async () => ({ ...PROFILE, passwordHash })),
      secret: AUTH_SECRET,
      basePath: "/api/auth",
      skipCSRFCheck,
    },
  );
  const sessionCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.ok(sessionCookie, "로그인 성공 시 session cookie를 발급한다");
  const token = await decode({
    token: sessionCookie.slice(SESSION_COOKIE_NAME.length + 1).split(";")[0],
    secret: AUTH_SECRET,
    salt: SESSION_COOKIE_NAME,
  });
  assert.equal(token?.sub, PROFILE.id);
  assert.equal(token?.credentialFingerprint, credentialFingerprint(passwordHash));
});

test("edge middleware는 임시 비밀번호 token의 화면 이동을 새 비밀번호 설정으로 돌린다", async () => {
  const middleware = NextAuth({ ...authConfig, secret: AUTH_SECRET }).auth as unknown as (
    request: NextRequest,
    event: unknown,
  ) => Promise<Response | undefined>;
  const request = async (pathname: string, passwordChangeRequired: boolean) => {
    const token = await encode({
      token: { sub: PROFILE.id, role: "student", ...(passwordChangeRequired ? { passwordChangeRequired: true } : {}) },
      secret: AUTH_SECRET,
      salt: SESSION_COOKIE_NAME,
      maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    });
    return middleware(
      // middleware는 host·protocol header로 session 확인 주소와 cookie 이름을 정한다.
      new NextRequest(`http://localhost${pathname}`, {
        headers: { host: "localhost", "x-forwarded-proto": "http", cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }),
      {},
    );
  };

  const redirected = await request("/dashboard/student", true);
  assert.ok(redirected && redirected.status >= 300 && redirected.status < 400);
  assert.equal(new URL(redirected?.headers.get("location") ?? "").pathname, PASSWORD_CHANGE_PATH);
  for (const pathname of [PASSWORD_CHANGE_PATH, "/login"]) {
    assert.equal((await request(pathname, true))?.headers.get("location") ?? null, null, pathname);
  }
  assert.equal((await request("/dashboard/student", false))?.headers.get("location") ?? null, null);
});
