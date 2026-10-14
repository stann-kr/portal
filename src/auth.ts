/**
 * @file auth.ts
 * @description NextAuth.js 핵심 인증 로직 (Node.js 런타임).
 * Cloudflare Workers 환경: getCloudflareContext().env.DB를 통해 D1 접근.
 * 로컬 개발: db/client.ts의 SQLite fallback 사용.
 * 자격증명 기반(Credentials) 인증: 이메일 + bcrypt 해시 비교(관리자 발급 임시 비밀번호 포함).
 */
import NextAuth, { CredentialsSignin } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";
import {
  findActiveProfileByEmail,
  findActiveSessionProfileById,
  type ActiveLoginProfile,
  type ActiveSessionProfile,
} from "@/lib/active-profile";
import { credentialFingerprint } from "@/lib/credential-fingerprint";
import {
  isTemporaryPasswordHash,
  verifyStoredPassword,
} from "@/lib/password-storage";
import { isPasswordAttemptAllowed } from "@/lib/password-attempt-limit";

type FindActiveSessionProfileById = (
  profileId: string,
) => Promise<ActiveSessionProfile | null>;
type FindActiveLoginProfileByEmail = (
  email: string,
) => Promise<ActiveLoginProfile | null>;
type AllowLoginAttempt = (request: Request) => Promise<boolean>;

/** 접속 주소별 로그인 시도 한도를 넘었다. 로그인 form은 이 code로 안내를 구분한다. */
export class LoginAttemptLimited extends CredentialsSignin {
  code = "rate_limited";
}

const allowLoginAttempt: AllowLoginAttempt = (request) =>
  isPasswordAttemptAllowed("login", () => request.headers);

/**
 * Node runtime 전용 auth 설정을 만든다. Edge middleware가 import하는 authConfig에는
 * DB 의존성을 넣지 않고, JWT를 session으로 공개하기 직전에 profile 생존 여부와
 * 발급 당시 비밀번호에 결합된 지문을 다시 확인한다.
 */
export function createNodeAuthConfig(
  findProfileById: FindActiveSessionProfileById = findActiveSessionProfileById,
  findProfileByEmail: FindActiveLoginProfileByEmail = findActiveProfileByEmail,
  allowAttempt: AllowLoginAttempt = allowLoginAttempt,
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
          if (params.user.passwordChangeRequired) token.passwordChangeRequired = true;
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
        // 임시 비밀번호 여부는 매 요청 현재 hash에서 다시 판단한다. 지문 없는 이전 token도
        // 관리자가 비밀번호를 초기화한 뒤에는 포털 기능을 쓰지 못한다.
        if (profile.passwordChangeRequired) token.passwordChangeRequired = true;
        else delete token.passwordChangeRequired;
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
        async authorize(credentials, request) {
          if (!credentials?.email || !credentials?.password) {
            return null;
          }
          // server action과 callback endpoint 직접 호출이 모두 이 경계를 지난다.
          if (!(await allowAttempt(request))) throw new LoginAttemptLimited();

          try {
            const user = await findProfileByEmail(
              credentials.email as string,
            );
            if (!user || !user.passwordHash) {
              return null;
            }

            const isValid = await verifyStoredPassword(
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
              passwordChangeRequired: isTemporaryPasswordHash(user.passwordHash),
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
