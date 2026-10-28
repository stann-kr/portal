import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 예약 실행(Worker `scheduled`)에는 OpenNext request context가 없어 `getCloudflareContext()`가 env를 주지 못한다.
 * worker.ts가 Worker `env`를 이 저장소에 넣고 실행하면 캘린더 설정·암호화 key reader가 먼저 여기서 읽는다.
 * 저장소가 비어 있는 fetch 경로는 기존 동작(OpenNext binding → process.env)을 그대로 따른다.
 */
const runtimeEnvStorage = new AsyncLocalStorage<Readonly<Record<string, unknown>>>();

export function runWithCalendarSyncEnv<T>(env: Readonly<Record<string, unknown>>, fn: () => T): T {
  return runtimeEnvStorage.run(env, fn);
}

/** override env에 문자열 값이 있으면 그 값, 없으면 undefined(호출자는 기존 경로로 넘어간다). */
export function readCalendarSyncEnvOverride(name: string): string | undefined {
  const value = runtimeEnvStorage.getStore()?.[name];
  return typeof value === "string" ? value : undefined;
}
