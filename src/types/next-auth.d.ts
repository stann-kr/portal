/**
 * @file types/next-auth.d.ts
 * @description NextAuth.js 세션, 유저, JWT 토큰 타입에 `role` 필드를 확장 선언.
 * 이로써 코드베이스 전체에서 `(user as any).role` 패턴 없이 타입 안전하게 접근 가능.
 */
import type { DefaultSession, DefaultUser } from "next-auth";
import type { JWT as DefaultJWT } from "next-auth/jwt";

type UserRole = "admin" | "student";

declare module "next-auth" {
  interface Session {
    user: {
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role: UserRole;
    /** 로그인에 사용한 비밀번호 hash의 지문. JWT에만 결합하고 session 응답에는 노출하지 않는다. */
    credentialFingerprint?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    role: UserRole;
    credentialFingerprint?: string;
  }
}
