import { unstable_rethrow } from "next/navigation";

/**
 * 서버 action이 던진 오류가 redirect 같은 Next.js 이동 신호면 true(실패가 아니라 이동 중이다).
 * client에서 action을 직접 부르면 성공한 redirect도 promise reject로 온다.
 */
export function isNavigationSignal(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}
