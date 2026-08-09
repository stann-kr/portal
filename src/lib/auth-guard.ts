/**
 * @file src/lib/auth-guard.ts
 * @description 서버 액션 공통 인증/인가 가드 유틸.
 * 모든 서버 액션에서 중복 정의되던 requireAuth / requireAdmin 패턴을 중앙화.
 */

import { auth } from "@/auth";
import {
  findActiveProfileById,
  type ActiveProfile,
} from "@/lib/active-profile";
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

export type ActiveProfileLoader = (
  profileId: string,
) => Promise<ActiveProfile | null>;

/**
 * JWT session subject를 매 요청 DB profile과 대조하고 DB role을 권한 원본으로 쓴다.
 * profile이 삭제되었거나 비활성 상태이면 stale JWT를 인증으로 승격하지 않는다.
 */
export async function resolveActiveSession(
  session: Session | null | undefined,
  loadProfile: ActiveProfileLoader = findActiveProfileById,
): Promise<AuthSession | null> {
  if (!session?.user?.id) return null;
  const profile = await loadProfile(session.user.id);
  if (!profile) return null;

  return {
    ...session,
    user: {
      ...session.user,
      id: profile.id,
      email: profile.email,
      name: profile.displayName,
      role: profile.role,
    },
  };
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
  const session = await getActiveAuthSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

/**
 * redirect/HTTP status를 직접 결정해야 하는 page와 route용 optional active session.
 */
export async function getActiveAuthSession(): Promise<AuthSession | null> {
  return resolveActiveSession(await auth());
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
