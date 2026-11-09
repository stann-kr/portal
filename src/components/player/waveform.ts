/**
 * @file src/components/player/waveform.ts
 * @description 파형 플레이어의 순수 계산: 저장 막대(1000개)를 화면 막대 수로 줄이기, 시점 댓글 위치,
 * 키보드 이동, 화면 낭독용 시간 문구.
 */

/** 화면 막대 하나의 폭+간격(px). 760px 카드에서 약 150개. */
export const WAVEFORM_BAR_SLOT_PX = 5;
export const WAVEFORM_KEY_STEP_SECONDS = 5;

/** 컨테이너 폭에 맞는 막대 수(최소 16, 최대 저장 막대 수). */
export function waveformBarCount(widthPx: number, sourceCount: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return Math.min(120, sourceCount);
  return Math.max(16, Math.min(sourceCount, Math.floor(widthPx / WAVEFORM_BAR_SLOT_PX)));
}

/**
 * 저장 막대를 화면 막대 수로 다시 나눈다. 줄일 때는 구간 최댓값(짧은 드롭이 사라지지 않게),
 * 늘릴 때는 가장 가까운 값을 쓴다. 결과는 0~1.
 */
export function resamplePeaks(peaks: readonly number[], barCount: number): number[] {
  const count = Math.max(0, Math.floor(barCount));
  if (count === 0 || peaks.length === 0) return [];
  const result: number[] = new Array(count);
  const ratio = peaks.length / count;
  for (let bar = 0; bar < count; bar += 1) {
    const start = Math.floor(bar * ratio);
    const end = Math.max(start + 1, Math.floor((bar + 1) * ratio));
    let max = 0;
    for (let index = start; index < end && index < peaks.length; index += 1) {
      const value = peaks[index];
      if (Number.isFinite(value) && value > max) max = value;
    }
    result[bar] = Math.min(1, Math.max(0, max));
  }
  return result;
}

export type WaveformMarkerInput = {
  id: string;
  seconds: number;
  author: string;
  isStann: boolean;
  text: string;
};

export type WaveformMarker = WaveformMarkerInput & { leftPercent: number };

/** 길이를 알 때만 시점 댓글을 0~100% 위치에 놓는다. 길이를 넘는 시점은 빼고 시간순으로 둔다. */
export function positionMarkers(markers: readonly WaveformMarkerInput[], duration: number): WaveformMarker[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return markers
    .filter((marker) => Number.isFinite(marker.seconds) && marker.seconds >= 0 && marker.seconds <= duration)
    .map((marker) => ({ ...marker, leftPercent: (marker.seconds / duration) * 100 }))
    .sort((a, b) => a.seconds - b.seconds || a.id.localeCompare(b.id));
}

/** 재생 비율(0~1). */
export function playedFraction(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return 0;
  return Math.min(1, Math.max(0, position / duration));
}

/** 슬라이더 키. ←/→ 5초, Home/End 처음·끝. 처리하지 않는 키는 null. */
export function seekForKey(key: string, position: number, duration: number): number | null {
  const max = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const clamp = (value: number) => Math.min(max, Math.max(0, value));
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(position - WAVEFORM_KEY_STEP_SECONDS);
    case "ArrowRight":
    case "ArrowUp":
      return clamp(position + WAVEFORM_KEY_STEP_SECONDS);
    case "Home":
      return 0;
    case "End":
      return Number.isFinite(max) ? max : null;
    default:
      return null;
  }
}

/** 화면 낭독용: "12분 48초", "1시간 2분 3초", "0초". */
export function spokenTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}시간`);
  if (m) parts.push(`${m}분`);
  if (s || parts.length === 0) parts.push(`${s}초`);
  return parts.join(" ");
}

/** 가로 위치(clientX)를 0~1 비율로. */
export function fractionFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (!Number.isFinite(rect.width) || rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}
