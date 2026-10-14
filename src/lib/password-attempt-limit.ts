/* eslint-disable @typescript-eslint/no-require-imports */

/** 로그인·비밀번호 확인 시도를 접속 주소별로 세는 Cloudflare Rate Limiting binding. */
export interface PasswordAttemptRateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export type PasswordAttemptScope = "login" | "password-change" | "invite" | "account-deletion";

export { PASSWORD_ATTEMPT_LIMITED_MESSAGE } from "@/lib/login-messages";

const MISSING_CLIENT_ADDRESS_KEY = "missing-cloudflare-client-address";

function findPasswordAttemptLimiter(): PasswordAttemptRateLimiter | null {
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env?: Record<string, unknown> };
    };
    const binding = getCloudflareContext()?.env?.PASSWORD_ATTEMPT_RATE_LIMITER as
      | PasswordAttemptRateLimiter
      | undefined;
    return binding && typeof binding.limit === "function" ? binding : null;
  } catch {
    return null;
  }
}

/**
 * 같은 접속 주소의 비밀번호 확인 시도를 binding 설정(분당 횟수)으로 제한한다.
 * binding이 없는 local 개발과 test는 제한하지 않는다. binding 호출이 실패하면 로그인 전체를
 * 막는 대신 통과시키고 bcrypt 비용을 마지막 보호선으로 둔다.
 */
export async function isPasswordAttemptAllowed(
  scope: PasswordAttemptScope,
  getHeaders: () => Headers | Promise<Headers>,
  limiter: PasswordAttemptRateLimiter | null = findPasswordAttemptLimiter(),
): Promise<boolean> {
  if (!limiter) return true;
  let address = MISSING_CLIENT_ADDRESS_KEY;
  try {
    address = (await getHeaders()).get("CF-Connecting-IP")?.trim() || MISSING_CLIENT_ADDRESS_KEY;
  } catch {
    // 요청 header를 읽을 수 없으면 주소 없는 요청끼리 같은 한도를 나눈다.
  }
  try {
    return (await limiter.limit({ key: `${scope}:${address}` })).success;
  } catch {
    console.error("[auth] password attempt rate limiter unavailable");
    return true;
  }
}
