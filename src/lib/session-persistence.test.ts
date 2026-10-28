import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_SESSION_SCOPE,
  withBrowserScopedSessionCookies,
  withoutSessionCookieExpiry,
} from "./session-persistence";

const NOW = Date.parse("2026-10-29T00:00:00Z");

test("유지를 끈 session token cookie는 만료를 떼고 나머지 속성은 남긴다", () => {
  assert.equal(
    withoutSessionCookieExpiry(
      "__Secure-authjs.session-token=abc; Path=/; Expires=Wed, 25 Nov 2026 00:00:00 GMT; Max-Age=2419200; HttpOnly; Secure; SameSite=Lax",
      NOW,
    ),
    "__Secure-authjs.session-token=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
  );
  assert.equal(
    withoutSessionCookieExpiry("authjs.session-token.1=def; Path=/; Expires=Wed, 25 Nov 2026 00:00:00 GMT; HttpOnly", NOW),
    "authjs.session-token.1=def; Path=/; HttpOnly",
  );
});

test("지우는 cookie와 session token이 아닌 cookie는 그대로 둔다", () => {
  const removal = "__Secure-authjs.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly";
  assert.equal(withoutSessionCookieExpiry(removal, NOW), removal);
  const other = "__Host-authjs.csrf-token=x; Path=/; Expires=Wed, 25 Nov 2026 00:00:00 GMT";
  assert.equal(withoutSessionCookieExpiry(other, NOW), other);
});

test("표시 cookie가 있을 때만 응답의 session cookie를 바꾸고 상태·본문·다른 header는 유지한다", async () => {
  const make = () => {
    const headers = new Headers({ location: "/dashboard" });
    headers.append("set-cookie", "authjs.session-token=abc; Path=/; Expires=Wed, 25 Nov 2026 00:00:00 GMT; HttpOnly");
    headers.append("set-cookie", "other=1; Path=/; Max-Age=60");
    return new Response("body", { status: 307, headers });
  };

  const untouched = make();
  assert.equal(withBrowserScopedSessionCookies(undefined, untouched), untouched);

  const scoped = withBrowserScopedSessionCookies(BROWSER_SESSION_SCOPE, make())!;
  assert.equal(scoped.status, 307);
  assert.equal(scoped.headers.get("location"), "/dashboard");
  assert.equal(await scoped.text(), "body");
  assert.deepEqual(scoped.headers.getSetCookie(), ["authjs.session-token=abc; Path=/; HttpOnly", "other=1; Path=/; Max-Age=60"]);
});
