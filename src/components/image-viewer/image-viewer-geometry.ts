/** 전체화면 이미지 뷰어의 확대·이동 계산. DOM 없이 크기만 받아 테스트할 수 있게 둔다. */

export type ViewerTransform = { scale: number; x: number; y: number };

export type Size = { width: number; height: number };

export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;
export const IDENTITY: ViewerTransform = { scale: 1, x: 0, y: 0 };

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 확대된 이미지가 화면 밖으로 빈 공간을 드러내지 않게 이동 범위를 제한한다. */
export function clampTransform(transform: ViewerTransform, fit: Size, stage: Size): ViewerTransform {
  const scale = clamp(transform.scale, 1, MAX_SCALE);
  const maxX = Math.max(0, (fit.width * scale - stage.width) / 2);
  const maxY = Math.max(0, (fit.height * scale - stage.height) / 2);
  return { scale, x: clamp(transform.x, -maxX, maxX), y: clamp(transform.y, -maxY, maxY) };
}

/**
 * `point`(화면 가운데 기준 좌표)가 제자리에 머물도록 확대율을 바꾼다.
 * transform-origin이 이미지 가운데이므로 t' = p - (p - t) * (s' / s).
 */
export function zoomAround(transform: ViewerTransform, nextScale: number, point: { x: number; y: number }): ViewerTransform {
  const ratio = nextScale / transform.scale;
  return {
    scale: nextScale,
    x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio,
  };
}

/** 화면에 맞춘 크기에서 원래 크기로 가는 배율. 원래 크기가 더 작거나 같으면 1. */
export function naturalScale(natural: Size, fit: Size) {
  if (!fit.width || !natural.width) return 1;
  return clamp(natural.width / fit.width, 1, MAX_SCALE);
}

export function wrapIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}
