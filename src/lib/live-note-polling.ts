/**
 * @file src/lib/live-note-polling.ts
 * @description 읽기 전용 노트 실시간 보기의 폴링 간격. 탭이 보이고 온라인일 때만 돌고,
 * 변화가 없는 조회가 쌓이면 간격을 두 배씩 늘려 D1 조회를 아낀다. 순수 함수라 hook 밖에서도 검사한다.
 */

/** 기본 폴링 간격. Stann의 자동 저장(1.5초 idle)보다 조금 길어 수 초 안에 반영된다. */
export const LIVE_NOTE_BASE_POLL_MS = 4_000;
/** 변화가 없어도 이보다 길게 쉬지 않는다. */
export const LIVE_NOTE_MAX_POLL_MS = 20_000;
/** 연속으로 이만큼 변화가 없을 때마다 간격을 두 배로 늘린다. */
export const LIVE_NOTE_BACKOFF_EVERY = 3;

export type LiveNotePollInput = {
  /** `document.visibilityState === "visible"`. */
  visible: boolean;
  /** `navigator.onLine`. */
  online: boolean;
  /** 마지막 변화 이후 연속으로 변화가 없었던 조회 수. */
  unchangedPolls: number;
  baseDelay?: number;
  maxDelay?: number;
};

/**
 * 다음 조회까지 기다릴 ms. 숨김·오프라인이면 null(타이머를 두지 않는다).
 * 4초에서 시작해 변화 없는 조회가 3회 쌓일 때마다 두 배(4 → 8 → 16 → 20초 상한).
 */
export function getLiveNotePollDelay({
  visible,
  online,
  unchangedPolls,
  baseDelay = LIVE_NOTE_BASE_POLL_MS,
  maxDelay = LIVE_NOTE_MAX_POLL_MS,
}: LiveNotePollInput): number | null {
  if (!visible || !online) return null;
  const doublings = Math.floor(Math.max(0, unchangedPolls) / LIVE_NOTE_BACKOFF_EVERY);
  const delay = baseDelay * 2 ** doublings;
  return Math.min(delay, Math.max(baseDelay, maxDelay));
}
