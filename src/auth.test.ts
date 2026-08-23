import assert from "node:assert/strict";
import test from "node:test";
import { encode } from "@auth/core/jwt";
import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { AUTH_SESSION_MAX_AGE_SECONDS } from "./auth.config";
import { createNodeAuthConfig } from "./auth";
import type { ActiveProfile } from "./lib/active-profile";

const AUTH_SECRET = "test-only-auth-secret-with-sufficient-entropy";
const SESSION_COOKIE_NAME = "authjs.session-token";
const PROFILE: ActiveProfile = {
  id: "student-1",
  email: "student@example.com",
  displayName: "Student",
  role: "student",
};

async function sessionRequest(
  findProfileById: (profileId: string) => Promise<ActiveProfile | null>,
) {
  const token = await encode({
    token: {
      sub: PROFILE.id,
      name: "Stale Name",
      email: "stale@example.com",
      role: "student",
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
