import assert from "node:assert/strict";
import test from "node:test";
import { withoutSessionRefreshOnMutation } from "./middleware-session-cookie";

function middlewareResponse() {
  const headers = new Headers({ "x-middleware-next": "1" });
  headers.append("set-cookie", "authjs.session-token=refreshed; Path=/; HttpOnly");
  return new Response(null, { status: 200, headers });
}

test("상태를 바꾸는 요청에서는 middleware의 session 갱신 cookie를 떼어 action의 로그아웃·재발급을 덮지 않는다", () => {
  const response = withoutSessionRefreshOnMutation("POST", middlewareResponse());
  assert.equal(response?.headers.get("set-cookie"), null);
  assert.equal(response?.headers.get("x-middleware-next"), "1");
  assert.equal(response?.status, 200);
});

test("화면 요청에서는 session 만료 연장 cookie를 유지한다", () => {
  const response = withoutSessionRefreshOnMutation("GET", middlewareResponse());
  assert.match(response?.headers.get("set-cookie") ?? "", /refreshed/);
});
