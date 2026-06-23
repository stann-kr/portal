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
 * 로그인 여부 확인. 미인증 시 에러 throw.
 * @returns 인증된 세션 객체
 */
export async function requireAuth(): Promise<AuthSession> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session as AuthSession;
}

/**
 * Admin 권한 확인. 미인증 또는 비관리자 시 에러 throw.
 * @returns 인증된 세션 객체
 */
export async function requireAdmin(): Promise<AuthSession> {
  const session = await requireAuth();
  if (session.user.role !== "admin") throw new Error("Admin only");
  return session;
}

export function assertOwnerOrAdmin(session: AuthSession, ownerUserId: string) {
  if (session.user.role !== "admin" && session.user.id !== ownerUserId) {
    throw new Error("Unauthorized");
  }
}
