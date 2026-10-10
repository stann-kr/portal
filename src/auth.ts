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
  findActiveSessionProfileById,
  type ActiveLoginProfile,
  type ActiveSessionProfile,
} from "@/lib/active-profile";
import { credentialFingerprint } from "@/lib/credential-fingerprint";
import * as bcrypt from "bcryptjs";

type FindActiveSessionProfileById = (
  profileId: string,
) => Promise<ActiveSessionProfile | null>;
type FindActiveLoginProfileByEmail = (
  email: string,
) => Promise<ActiveLoginProfile | null>;

/**
 * Node runtime 전용 auth 설정을 만든다. Edge middleware가 import하는 authConfig에는
 * DB 의존성을 넣지 않고, JWT를 session으로 공개하기 직전에 profile 생존 여부와
 * 발급 당시 비밀번호에 결합된 지문을 다시 확인한다.
 */
export function createNodeAuthConfig(
  findProfileById: FindActiveSessionProfileById = findActiveSessionProfileById,
  findProfileByEmail: FindActiveLoginProfileByEmail = findActiveProfileByEmail,
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

        if (token === null) return token;
        if (params.user) {
          // 로그인 직후: authorize가 검증한 비밀번호 hash의 지문에 session을 결합한다.
          const fingerprint = params.user.credentialFingerprint;
          if (typeof fingerprint === "string") token.credentialFingerprint = fingerprint;
          return token;
        }

        const profile = token.sub
          ? await findProfileById(token.sub)
          : null;
        if (!profile) return null;
        // 비밀번호가 바뀐 뒤 남은 다른 기기의 session은 지문이 달라 거부한다.
        // 지문 결합 전에 발급된 token은 지문이 없으며 기존 최대 수명까지 유지된다.
        if (
          typeof token.credentialFingerprint === "string" &&
          token.credentialFingerprint !== profile.credentialFingerprint
        ) {
          return null;
        }

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
            const user = await findProfileByEmail(
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
              credentialFingerprint: credentialFingerprint(user.passwordHash),
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
