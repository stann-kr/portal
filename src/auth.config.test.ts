import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  authConfig,
  isCoarseRequestAuthorized,
  PASSWORD_CHANGE_PATH,
  roleHomeRedirectPath,
  shouldRedirectToPasswordChange,
} from "./auth.config";
import { ACCOUNT_RAW_ID_RETENTION_SECONDS } from "./lib/account-privacy-atomic";

test("JWT와 session 수명은 raw subject ID 보존 기간보다 짧다", () => {
  assert.equal(AUTH_SESSION_MAX_AGE_SECONDS, 28 * 24 * 60 * 60);
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

test("가입 링크 화면은 로그인 전에도 열린다", () => {
  assert.equal(isCoarseRequestAuthorized({ isLoggedIn: false, pathname: "/invite" }), true);
  assert.equal(isCoarseRequestAuthorized({ isLoggedIn: false, pathname: "/invite/other" }), false);
});

test("개인정보처리방침은 로그인 전에도 열린다", () => {
  assert.equal(isCoarseRequestAuthorized({ isLoggedIn: false, pathname: "/privacy" }), true);
  assert.equal(isCoarseRequestAuthorized({ isLoggedIn: false, pathname: "/privacy/other" }), false);
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

test("서버 초안 폐기 API는 login redirect 대신 route의 403·401 판정을 받는다", () => {
  assert.equal(isCoarseRequestAuthorized({ isLoggedIn: false, pathname: "/api/document-drafts/discard" }), true);
  assert.equal(isCoarseRequestAuthorized({ isLoggedIn: false, pathname: "/api/document-drafts/other" }), false);
});

test("/dashboard 시작 주소는 화면을 그리기 전에 역할별 첫 화면으로 보낸다", async () => {
  assert.equal(roleHomeRedirectPath({ isLoggedIn: true, role: "admin", pathname: "/dashboard" }), "/dashboard/admin");
  assert.equal(roleHomeRedirectPath({ isLoggedIn: true, role: "student", pathname: "/dashboard/" }), "/dashboard/student");
  assert.equal(roleHomeRedirectPath({ isLoggedIn: true, role: undefined, pathname: "/dashboard" }), "/dashboard/student");
  assert.equal(roleHomeRedirectPath({ isLoggedIn: false, role: "admin", pathname: "/dashboard" }), null);
  assert.equal(roleHomeRedirectPath({ isLoggedIn: true, role: "admin", pathname: "/dashboard/admin" }), null);

  const authorized = authConfig.callbacks!.authorized! as unknown as (input: {
    auth: { user: { role?: string; passwordChangeRequired?: boolean } } | null;
    request: { nextUrl: URL };
  }) => unknown;
  const admin = await authorized({
    auth: { user: { role: "admin" } },
    request: { nextUrl: new URL("https://portal.example/dashboard?task=t1") },
  });
  assert.ok(admin instanceof Response);
  assert.equal(admin.headers.get("location"), "https://portal.example/dashboard/admin?task=t1");
  // 임시 비밀번호 session은 새 비밀번호 화면이 먼저다.
  const pending = await authorized({
    auth: { user: { role: "student", passwordChangeRequired: true } },
    request: { nextUrl: new URL("https://portal.example/dashboard") },
  });
  assert.ok(pending instanceof Response);
  assert.equal(pending.headers.get("location"), `https://portal.example${PASSWORD_CHANGE_PATH}`);
  assert.equal(await authorized({ auth: null, request: { nextUrl: new URL("https://portal.example/dashboard") } }), false);
});
