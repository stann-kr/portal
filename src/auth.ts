/**
 * @file auth.ts
 * @description NextAuth.js 핵심 인증 로직 (Node.js 런타임).
 * Cloudflare Workers 환경: getCloudflareContext().env.DB를 통해 D1 접근.
 * 로컬 개발: db/client.ts의 SQLite fallback 사용.
 * 자격증명 기반(Credentials) 인증: 이메일 + bcrypt 해시 비교.
 */
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import {
  findActiveProfileByEmail,
  findActiveProfileById,
  type ActiveProfile,
} from "@/lib/active-profile";
import * as bcrypt from "bcryptjs";

type FindActiveProfileById = (
  profileId: string,
) => Promise<ActiveProfile | null>;

/**
 * Node runtime 전용 auth 설정을 만든다. Edge middleware가 import하는 authConfig에는
 * DB 의존성을 넣지 않고, JWT를 session으로 공개하기 직전에 profile 생존 여부를
 * 다시 확인한다.
 */
export function createNodeAuthConfig(
  findProfileById: FindActiveProfileById = findActiveProfileById,
) {
  const baseJwtCallback = authConfig.callbacks?.jwt;

  return {
    ...authConfig,
    callbacks: {
      ...authConfig.callbacks,
      async jwt(params) {
        const token = baseJwtCallback
          ? await baseJwtCallback(params)
          : params.token;

        if (token === null || params.user) return token;

        const profile = token.sub
          ? await findProfileById(token.sub)
          : null;
        if (!profile) return null;

        token.name = profile.displayName;
        token.email = profile.email;
        token.role = profile.role;
        return token;
      },
    },
    providers: [
      CredentialsProvider({
        /**
         * 자격증명 검증 로직.
         * DB 바인딩은 createDb()가 내부적으로 getCloudflareContext()를 통해 자동 처리.
         *
         * @param credentials - { email, password }
         * @returns 유저 객체 (성공 시) 또는 null
         */
        async authorize(credentials) {
          if (!credentials?.email || !credentials?.password) {
            return null;
          }

          try {
            const user = await findActiveProfileByEmail(
              credentials.email as string,
            );
            if (!user || !user.passwordHash) {
              return null;
            }

            const isValid = await bcrypt.compare(
              credentials.password as string,
              user.passwordHash,
            );

            if (!isValid) return null;

            return {
              id: user.id,
              email: user.email,
              name: user.displayName,
              role: user.role,
            };
          } catch {
            console.error("[auth] authorize error");
            return null;
          }
        },
      }),
    ],
  } satisfies Parameters<typeof NextAuth>[0];
}

export const { handlers, signIn, signOut, auth } = NextAuth(
  createNodeAuthConfig(),
);
