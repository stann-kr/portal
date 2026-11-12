/**
 * @file auth.config.ts
 * @description NextAuth.js 설정 (Edge Runtime 호환).
 * 미들웨어에서 사용 가능하도록 DB 접근 로직 없이 순수 설정만 포함.
 */
import type { NextAuthConfig } from "next-auth";

/**
 * 마지막 사용부터 session이 유지되는 기간. 포탈을 열 때마다 다시 늘어난다.
 * '로그인 유지'를 끈 로그인은 cookie가 브라우저 session으로만 남는다(`session-persistence.ts`).
 * 삭제된 계정의 원 ID 보관 기간(30일)보다 짧아야 남은 token이 그 안에 만료된다.
 */
export const AUTH_SESSION_MAX_AGE_SECONDS = 28 * 24 * 60 * 60;
/** 임시 비밀번호로 로그인한 사용자가 포탈을 쓰기 전에 새 비밀번호를 정하는 화면. */
export const PASSWORD_CHANGE_PATH = "/account/password";

type CoarseAuthorizationInput = {
  isLoggedIn: boolean;
  pathname: string;
};

/**
 * proxy는 DB profile 상태를 판정하지 않는다. 여기서는 보호 UI의
 * token 존재만 빠르게 거르고, 실제 인증·role은 server active-profile gate가
 * 매 요청 다시 확인한다.
 */
export function isCoarseRequestAuthorized({
  isLoggedIn,
  pathname,
}: CoarseAuthorizationInput): boolean {
  if (pathname.startsWith("/login")) return true;
  // 가입 링크는 아직 로그인할 수 없는 학생이 연다. token 확인은 server action이 맡는다.
  if (pathname === "/invite") return true;
  // 개인정보처리방침은 Google OAuth 동의 화면이 로그인 전 사용자에게 링크한다.
  if (pathname === "/privacy") return true;
  // 레슨 상담 안내는 처음 문의하는 사람이 보는 공개 페이지다.
  if (pathname === "/lesson") return true;
  if (pathname.startsWith("/api/calendar/")) return true;
  if (pathname === "/api/account-cleanup/status") return true;
  // 서버 초안 폐기는 fetch로 부른다. login redirect(307) 대신 route가 출처·인증을 판정해 403·401 JSON을 준다.
  if (pathname === "/api/document-drafts/discard") return true;
  return isLoggedIn;
}

/**
 * 임시 비밀번호 session의 화면 이동을 새 비밀번호 설정으로 돌린다. 실제 차단은 server gate가
 * 매 요청 현재 hash로 판단한다. login은 stale claim과의 redirect loop를 피하려고, API는
 * redirect 대신 route의 인증 응답을 받도록 제외한다.
 */
export function shouldRedirectToPasswordChange({
  passwordChangeRequired,
  pathname,
}: {
  passwordChangeRequired: boolean;
  pathname: string;
}): boolean {
  if (!passwordChangeRequired) return false;
  return (
    pathname !== PASSWORD_CHANGE_PATH &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/api/")
  );
}

/**
 * 홈 화면 앱의 시작 주소·알림 기본 주소(`/dashboard`)와 루트(`/`)를 화면을 그리기 전에 역할별 첫 화면으로 보낸다.
 * 서버 page의 redirect는 셸을 먼저 보낸 뒤라 빈 본문 화면과 두 번째 문서 요청이 생긴다.
 * token의 role이 오래돼도 도착한 화면의 server gate(관리자 layout)가 다시 판정한다. page.tsx의 redirect는 남겨 둔다.
 */
export function roleHomeRedirectPath({
  isLoggedIn,
  role,
  pathname,
}: {
  isLoggedIn: boolean;
  role: unknown;
  pathname: string;
}): string | null {
  if (!isLoggedIn || (pathname !== "/" && pathname !== "/dashboard" && pathname !== "/dashboard/")) return null;
  return role === "admin" ? "/dashboard/admin" : "/dashboard/student";
}

/**
 * 예전 주소를 화면을 그리기 전에 정식 주소로 보낸다(page의 redirect는 셸·스켈레톤을 보낸 뒤라 문서를 한 번 더 받았다).
 * `/dashboard/student/assignments?task=`(과제 알림·복사 링크)와 `/dashboard/calendar`(예전 알림·북마크). page의 redirect는 남겨 둔다.
 */
export function legacyRouteRedirectPath({
  isLoggedIn,
  role,
  pathname,
  search,
}: {
  isLoggedIn: boolean;
  role: unknown;
  pathname: string;
  search: string;
}): string | null {
  if (!isLoggedIn) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  if (path === "/dashboard/calendar") {
    return role === "admin" ? "/dashboard/admin?section=schedule&view=calendar" : "/dashboard/student?section=workspace&view=calendar";
  }
  // 역할이 다른 첫 화면(학생이 /dashboard/admin, 관리자가 /dashboard/student)은 자기 첫 화면으로. 하위 화면은 layout gate가 맡는다.
  if (path === "/dashboard/admin" && role !== "admin") return "/dashboard/student";
  if (path === "/dashboard/student" && role === "admin") return "/dashboard/admin";
  // 관리자 학생 상세의 예전 디깅 주소는 탭 주소로.
  const digging = /^\/dashboard\/admin\/students\/([^/]+)\/digging$/u.exec(path);
  if (digging && role === "admin") return `/dashboard/admin/students/${digging[1]}?tab=digging`;
  if (path === "/dashboard/student/assignments" && role !== "admin") {
    const task = new URLSearchParams(search).get("task");
    const target = new URLSearchParams({ section: "workspace", view: "assignments" });
    if (task) target.set("task", task);
    return `/dashboard/student?${target.toString()}`;
  }
  return null;
}

export const authConfig: NextAuthConfig = {
  providers: [],
  session: {
    strategy: "jwt",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  },
  jwt: {
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  },
  callbacks: {
    /**
     * proxy의 coarse 페이지 접근 제어 콜백.
     * 로그인 페이지는 stale JWT와 server active-profile gate 사이 redirect loop를
     * 피하려고 항상 통과시킨다. calendar feed는 route의 session/token gate가 담당한다.
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      if (
        isLoggedIn &&
        shouldRedirectToPasswordChange({
          passwordChangeRequired: auth?.user?.passwordChangeRequired === true,
          pathname: nextUrl.pathname,
        })
      ) {
        return Response.redirect(new URL(PASSWORD_CHANGE_PATH, nextUrl));
      }
      const legacyPath = legacyRouteRedirectPath({ isLoggedIn, role: auth?.user?.role, pathname: nextUrl.pathname, search: nextUrl.search });
      if (legacyPath) return Response.redirect(new URL(legacyPath, nextUrl), 307);
      const homePath = roleHomeRedirectPath({ isLoggedIn, role: auth?.user?.role, pathname: nextUrl.pathname });
      if (homePath) {
        const target = new URL(homePath, nextUrl);
        // 알림·바로 열기 주소의 query(?task 등)는 그대로 넘긴다.
        target.search = nextUrl.search;
        return Response.redirect(target);
      }
      return isCoarseRequestAuthorized({
        isLoggedIn,
        pathname: nextUrl.pathname,
      });
    },
    /**
     * JWT 생성/갱신 시 role을 토큰에 포함.
     */
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role ?? "student";
      }
      return token;
    },
    /**
     * 세션 객체에 JWT의 role 및 sub(user id) 전달.
     * NextAuth v5 JWT 전략에서 token.sub이 user.id를 담음.
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.id = token.sub ?? "";
        if (token.passwordChangeRequired === true) session.user.passwordChangeRequired = true;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  /**
   * Cloudflare Workers 및 리버스 프록시 환경에서의 호스트 신뢰 설정.
   * 미설정 시 NextAuth가 unknown host로 판단하여 /api/auth/callback/credentials로
   * redirect loop가 발생함.
   */
  trustHost: true,
};
