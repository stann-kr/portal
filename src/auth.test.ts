import assert from "node:assert/strict";
import test from "node:test";
import { Auth, skipCSRFCheck } from "@auth/core";
import { decode, encode } from "@auth/core/jwt";
import * as bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { AUTH_SESSION_MAX_AGE_SECONDS } from "./auth.config";
import { createNodeAuthConfig } from "./auth";
import type { ActiveSessionProfile } from "./lib/active-profile";
import { credentialFingerprint } from "./lib/credential-fingerprint";

const AUTH_SECRET = "test-only-auth-secret-with-sufficient-entropy";
const SESSION_COOKIE_NAME = "authjs.session-token";
const PROFILE: ActiveSessionProfile = {
  id: "student-1",
  email: "student@example.com",
  displayName: "Student",
  role: "student",
  credentialFingerprint: credentialFingerprint("$2a$10$current-password-hash"),
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
