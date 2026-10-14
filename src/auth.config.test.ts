import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  authConfig,
  isCoarseRequestAuthorized,
  PASSWORD_CHANGE_PATH,
  shouldRedirectToPasswordChange,
} from "./auth.config";
import { ACCOUNT_RAW_ID_RETENTION_SECONDS } from "./lib/account-privacy-atomic";

test("JWT와 session 수명은 raw subject ID 보존 기간보다 짧다", () => {
  assert.equal(AUTH_SESSION_MAX_AGE_SECONDS, 7 * 24 * 60 * 60);
  assert.equal(authConfig.session?.maxAge, AUTH_SESSION_MAX_AGE_SECONDS);
  assert.equal(authConfig.jwt?.maxAge, AUTH_SESSION_MAX_AGE_SECONDS);
  assert.ok(AUTH_SESSION_MAX_AGE_SECONDS < ACCOUNT_RAW_ID_RETENTION_SECONDS);
});

test("login은 stale JWT 유무와 관계없이 통과시켜 redirect loop를 막는다", () => {
  assert.equal(
    isCoarseRequestAuthorized({ isLoggedIn: false, pathname: "/login" }),
    true,
  );
  assert.equal(
    isCoarseRequestAuthorized({
      isLoggedIn: true,
      pathname: "/login?callbackUrl=%2Fdashboard",
    }),
    true,
  );
});

test("calendar feed는 route token gate에 도달할 수 있다", () => {
  assert.equal(
    isCoarseRequestAuthorized({
      isLoggedIn: false,
      pathname: "/api/calendar/student-1",
    }),
    true,
  );
});

test("익명 cleanup status만 route의 token gate에 도달할 수 있다", () => {
  assert.equal(
    isCoarseRequestAuthorized({
      isLoggedIn: false,
      pathname: "/api/account-cleanup/status",
    }),
    true,
  );
  assert.equal(
    isCoarseRequestAuthorized({
      isLoggedIn: false,
      pathname: "/api/account-cleanup/register",
    }),
    false,
  );
});

test("보호 UI의 coarse gate는 JWT token 존재를 요구한다", () => {
  assert.equal(
    isCoarseRequestAuthorized({ isLoggedIn: false, pathname: "/dashboard" }),
    false,
  );
  assert.equal(
    isCoarseRequestAuthorized({ isLoggedIn: true, pathname: "/dashboard" }),
    true,
  );
});

test("임시 비밀번호 session의 화면 이동만 새 비밀번호 설정으로 돌리고 login·API는 server gate에 맡긴다", () => {
  const redirect = (pathname: string, passwordChangeRequired = true) =>
    shouldRedirectToPasswordChange({ passwordChangeRequired, pathname });

  assert.equal(redirect("/dashboard/student"), true);
  assert.equal(redirect("/"), true);
  assert.equal(redirect("/community"), true);
  assert.equal(redirect(PASSWORD_CHANGE_PATH), false);
  assert.equal(redirect("/login"), false);
  assert.equal(redirect("/api/media/media-1"), false);
  assert.equal(redirect("/dashboard/student", false), false);
});
