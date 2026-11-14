/**
 * `auth()`가 JWT를 갱신하면서 방금 DB에서 읽어 확인한 profile을, 같은 호출의 session gate가 다시 읽지 않게 넘긴다.
 *
 * - 갱신(jwt callback)은 profile이 살아 있고 비밀번호 지문이 맞을 때만 여기에 남긴다.
 * - 값은 `captureVerifiedSessionProfile`로 감싼 호출 안에서만 남고, 그 호출이 끝나면 돌려받은 쪽만 쓴다.
 *   요청·호출 사이에 공유되는 캐시가 아니다.
 * - 감싸지 않은 호출(`/api/auth/session` 등)이나 갱신을 거치지 않은 session은 아무 것도 남기지 않으므로
 *   session gate가 전처럼 DB에서 읽는다.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ActiveProfile } from "@/lib/active-profile";

type Capture = { profile: ActiveProfile | null };

const captureStorage = new AsyncLocalStorage<Capture>();

/** jwt callback이 profile 확인을 모두 통과한 뒤 부른다. 비밀번호 지문 같은 다른 값은 남기지 않는다. */
export function rememberVerifiedSessionProfile(profile: ActiveProfile): void {
  const capture = captureStorage.getStore();
  if (!capture) return;
  capture.profile = {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    role: profile.role,
  };
}

/** `run` 안에서 확인된 profile을 결과와 함께 돌려준다. 확인이 없었으면 profile은 null이다. */
export async function captureVerifiedSessionProfile<T>(
  run: () => Promise<T>,
): Promise<{ result: T; profile: ActiveProfile | null }> {
  const capture: Capture = { profile: null };
  const result = await captureStorage.run(capture, run);
  return { result, profile: capture.profile };
}
