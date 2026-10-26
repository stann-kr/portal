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
    // 기한이 바뀌었을 수 있으므로 남은 시간은 마지막으로 읽은 시각이 아니라 지금 시각으로 계산한다.
    // 이미 지났다면 0ms 뒤 바로 다시 읽는다.
    const delay = Math.min(Math.max(timestampMilliseconds - Date.now(), 0), MAX_TIMEOUT_MILLISECONDS);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [now, timestampMilliseconds]);

  return timestampMilliseconds !== null && timestampMilliseconds <= now;
}
