/**
 * @file auth.ts
 * @description NextAuth.js 핵심 인증 로직 (Node.js 런타임).
 * Cloudflare Workers 환경: getCloudflareContext().env.DB를 통해 D1 접근.
 * 로컬 개발: db/client.ts의 SQLite fallback 사용.
 * 자격증명 기반(Credentials) 인증: 이메일 + bcrypt 해시 비교.
 */
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { createDb } from "@/db/client";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authConfig } from "./auth.config";
import * as bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
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
          const db = createDb();

          const userList = await db
            .select()
            .from(profiles)
            .where(eq(profiles.email, credentials.email as string))
            .limit(1);

          const user = userList[0];
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
            role: (user.role as "admin" | "student") ?? "student",
          };
        } catch {
          console.error("[auth] authorize error");
          return null;
        }
      },
    }),
  ],
});
