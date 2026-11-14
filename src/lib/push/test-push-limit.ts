import { findPasswordAttemptLimiter, type PasswordAttemptRateLimiter } from "@/lib/password-attempt-limit";

export const TEST_PUSH_LIMITED_MESSAGE = "테스트 알림을 너무 자주 보냈습니다. 1분 뒤 다시 시도해 주세요.";

/**
 * 테스트 알림을 계정별로 센다. binding을 새로 만들지 않고 비밀번호 시도와 같은 limiter(분당 횟수)를
 * 계정 key로 따로 쓴다. binding이 없는 local 개발·test와 binding 호출 실패는 막지 않는다.
 */
export async function isTestPushAllowed(
  profileId: string,
  limiter: PasswordAttemptRateLimiter | null = findPasswordAttemptLimiter(),
): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key: `push-test:${profileId}` })).success;
  } catch {
    console.error("[push] test push rate limiter unavailable");
    return true;
  }
}
