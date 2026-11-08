import { after } from "next/server";

/**
 * request scope 안이면 응답을 보낸 뒤(Next `after` → OpenNext에서는 Workers waitUntil) 실행해 저장 화면을 늦추지 않는다.
 * 밖(테스트·스크립트)에서는 `after`가 throw하므로 그 자리에서 기다린다.
 */
export async function runAfterResponse(task: () => Promise<unknown>): Promise<void> {
  try {
    after(task);
    return;
  } catch {
    // request scope 밖
  }
  await task();
}
