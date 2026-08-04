/**
 * @file src/lib/auth-guard.ts
 * @description 서버 액션 공통 인증/인가 가드 유틸.
 * 모든 서버 액션에서 중복 정의되던 requireAuth / requireAdmin 패턴을 중앙화.
 */

import { auth } from "@/auth";
import type { Session } from "next-auth";

export type AuthSession = Session & {
  user: NonNullable<Session["user"]> & { id: string };
};

/**
 * 외부 auth provider 결과를 애플리케이션이 요구하는 인증 세션으로 좁힌다.
 */
export function assertAuthenticatedSession(
  session: Session | null | undefined,
): AuthSession {
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session as AuthSession;
}

/**
 * 인증 세션의 관리자 role을 검증한다.
 */
export function assertAdminSession(session: AuthSession): AuthSession {
  if (session.user.role !== "admin") throw new Error("Admin only");
  return session;
}

/**
 * 로그인 여부 확인. 미인증 시 에러 throw.
 * @returns 인증된 세션 객체
 */
export async function requireAuth(): Promise<AuthSession> {
  return assertAuthenticatedSession(await auth());
}

/**
 * Admin 권한 확인. 미인증 또는 비관리자 시 에러 throw.
 * @returns 인증된 세션 객체
 */
export async function requireAdmin(): Promise<AuthSession> {
  return assertAdminSession(await requireAuth());
}

export function assertOwnerOrAdmin(
  session: AuthSession,
  ownerUserId: string,
): void {
  if (session.user.role !== "admin" && session.user.id !== ownerUserId) {
    throw new Error("Unauthorized");
  }
}
