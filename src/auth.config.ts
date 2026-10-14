/**
 * @file auth.config.ts
 * @description NextAuth.js 설정 (Edge Runtime 호환).
 * 미들웨어에서 사용 가능하도록 DB 접근 로직 없이 순수 설정만 포함.
 */
import type { NextAuthConfig } from "next-auth";

export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** 임시 비밀번호로 로그인한 사용자가 포털을 쓰기 전에 새 비밀번호를 정하는 화면. */
export const PASSWORD_CHANGE_PATH = "/account/password";

type CoarseAuthorizationInput = {
  isLoggedIn: boolean;
  pathname: string;
};

/**
 * Edge middleware는 DB profile 상태를 판정하지 않는다. 여기서는 보호 UI의
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
  if (pathname.startsWith("/api/calendar/")) return true;
  if (pathname === "/api/account-cleanup/status") return true;
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
     * Edge의 coarse 페이지 접근 제어 콜백.
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
