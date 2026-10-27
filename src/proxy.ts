/**
 * @file proxy.ts
 * @description NextAuth.js 인증 proxy(Next.js 16에서 middleware가 proxy로 바뀜).
 * Next.js App Router는 `src/proxy.ts`를 자동으로 인식하고 Node.js runtime에서 실행한다.
 * JWT 존재 기반 coarse redirect만 담당한다.
 * profile 존재·현재 role 검증은 각 server entry의 active-profile gate가 담당한다.
 */
import NextAuth from "next-auth";
import type { NextFetchEvent, NextRequest } from "next/server";
import { authConfig } from "./auth.config";
import { withoutSessionRefreshOnMutation } from "./lib/middleware-session-cookie";

// `export default auth`로 쓰던 middleware 형태다. auth overload 타입은 이 호출 형태를 표현하지 않는다.
const authProxy = NextAuth(authConfig).auth as unknown as (
  request: NextRequest,
  event: NextFetchEvent,
) => Promise<Response>;

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  return withoutSessionRefreshOnMutation(request.method, await authProxy(request, event));
}

export const config = {
  /**
   * 정적 파일, 이미지 최적화 경로, favicon 제외.
   * /api/auth/** 는 NextAuth 인증 콜백 경로이므로 반드시 proxy에서 제외.
   * 미포함 시 /api/auth/callback/credentials 가 보호 대상이 되어 redirect loop 발생.
   * /api/calendar-connections/google/notify 는 Google이 로그인 없이 POST하는 변경 알림이다.
   * route가 channel token으로 직접 검증한다(같은 경로의 start·callback은 계속 보호한다).
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/calendar-connections/google/notify(?:/?$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
