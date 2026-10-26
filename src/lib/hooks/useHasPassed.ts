"use client";

import { useEffect, useState } from "react";

// setTimeout은 약 24.8일(2^31-1ms)보다 긴 지연을 즉시 실행하므로 나눠서 기다린다.
const MAX_TIMEOUT_MILLISECONDS = 2_147_483_647;

/**
 * 주어진 시각이 지났는지 돌려준다. 처음 그릴 때 한 번 시각을 읽고,
 * 아직 지나지 않았다면 그 시각에 맞춰 다시 읽어 화면이 열린 채 기한을 넘겨도 판정이 바뀐다.
 */
export function useHasPassed(timestampMilliseconds: number | null): boolean {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timestampMilliseconds === null || timestampMilliseconds <= now) return;
    const delay = Math.min(timestampMilliseconds - now, MAX_TIMEOUT_MILLISECONDS);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [now, timestampMilliseconds]);

  return timestampMilliseconds !== null && timestampMilliseconds <= now;
}
