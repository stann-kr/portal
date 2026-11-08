/* eslint-disable @typescript-eslint/no-require-imports */
import { readCalendarSyncEnvOverride } from "@/lib/calendar-sync/runtime-env";

/**
 * OpenNext Worker binding과 Node development 환경 모두에서 문자열 설정값(vars·secrets)을 읽는다.
 * 예약 실행처럼 `runWithCalendarSyncEnv`로 Worker env를 넘긴 경우 그 값을 먼저 쓴다.
 * 비었거나 공백뿐이면 undefined(호출자가 기능을 끈다).
 */
export function readRuntimeEnv(name: string): string | undefined {
  const override = readCalendarSyncEnvOverride(name)?.trim();
  if (override) return override;
  let value = process.env[name];
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as {
      getCloudflareContext: () => { env?: Record<string, unknown> };
    };
    const binding = getCloudflareContext()?.env?.[name];
    if (typeof binding === "string") value = binding;
  } catch {
    // Node runtime에서는 process.env contract를 사용한다.
  }
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
