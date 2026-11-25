/**
 * @file src/lib/time-range.ts
 * @description 재생 시점 구간 글자(`01:20~01:45`)를 시작·끝으로 나누고 다시 쓰는 규칙.
 * 시점 하나를 읽는 규칙은 화면마다(과제 피드백·믹스셋 댓글) 그대로 두고, 이 모듈은 구분자만 다룬다.
 * 입력은 `~`와 `-`(앞뒤 공백 허용)를 받고, 쓸 때는 늘 `~`를 쓴다.
 */

export const TIME_RANGE_SEPARATOR = "~";

export const TIME_RANGE_ORDER_ERROR = "끝 시점은 시작보다 뒤여야 합니다.";

/** 구분자가 없으면 end는 null. 구분자가 둘 이상이거나 한쪽이 비면 null(형식 오류). */
export function splitTimeRange(value: string): { start: string; end: string | null } | null {
  const parts = value.split(/\s*[~-]\s*/u);
  if (parts.length === 1) return { start: parts[0].trim(), end: null };
  if (parts.length !== 2) return null;
  const start = parts[0].trim();
  const end = parts[1].trim();
  if (!start || !end) return null;
  return { start, end };
}

/** 시작만 있으면 시점 하나, 끝이 있으면 `시작~끝`. */
export function formatTimeRange(start: number, end: number | null, format: (seconds: number) => string): string {
  return end === null ? format(start) : `${format(start)}${TIME_RANGE_SEPARATOR}${format(end)}`;
}

/** 화면 낭독기용: "01:20부터 01:45까지" 또는 "01:20". */
export function describeTimeRange(start: number, end: number | null, format: (seconds: number) => string): string {
  return end === null ? format(start) : `${format(start)}부터 ${format(end)}까지`;
}
