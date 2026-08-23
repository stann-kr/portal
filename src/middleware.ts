/**
 * @file middleware.ts
 * @description NextAuth.js 인증 미들웨어.
 * Next.js App Router는 `src/middleware.ts`를 자동으로 인식함.
 * JWT 존재 기반 coarse redirect만 담당한다.
 * profile 존재·현재 role 검증은 각 server entry의 active-profile gate가 담당한다.
 */
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  /**
   * 정적 파일, 이미지 최적화 경로, favicon 제외.
   * /api/auth/** 는 NextAuth 인증 콜백 경로이므로 반드시 미들웨어에서 제외.
   * 미포함 시 /api/auth/callback/credentials 가 보호 대상이 되어 redirect loop 발생.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
