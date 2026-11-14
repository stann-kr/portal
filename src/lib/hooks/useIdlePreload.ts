"use client";

import { useEffect } from "react";

/**
 * 화면이 뜬 뒤 한가할 때 나중에 열 패널의 코드를 미리 받아 둔다.
 * 편집기처럼 무거운 패널은 `next/dynamic`으로 나눠 서버 첫 렌더·초기 JS에서 빼고, 이 hook으로 열기 전에 받아
 * 처음 열 때 기다리지 않게 한다. `load`는 모듈 수준 함수여야 한다(렌더마다 다시 예약하지 않는다).
 */
export function useIdlePreload(load: () => Promise<unknown>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      void load().catch(() => undefined);
    };
    const idleWindow = window;
    const requestIdle = Reflect.get(idleWindow, "requestIdleCallback");
    if (typeof requestIdle === "function") {
      try {
        const handle: unknown = requestIdle.call(idleWindow, run, { timeout: 3_000 });
        return () => {
          const cancelIdle = Reflect.get(idleWindow, "cancelIdleCallback");
          if (typeof cancelIdle === "function" && typeof handle === "number") cancelIdle.call(idleWindow, handle);
        };
      } catch {
        // 일부 sandbox 구현은 API를 노출한 뒤 호출만 거부한다.
      }
    }
    const timeout = setTimeout(run, 1_500);
    return () => clearTimeout(timeout);
  }, [enabled, load]);
}
