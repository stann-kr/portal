/**
 * @file src/components/ui/escape-layer.ts
 * @description 대화상자 안의 자체 팝업이 Esc를 먼저 받게 하는 표시.
 *
 * Radix Dialog는 document capture 단계에서 Esc를 받아 안쪽 요소보다 먼저 닫힌다.
 * 열린 자체 팝업의 바깥 요소에 `data-escape-layer="open"`을 두면, 그 안에서 누른 Esc는
 * 대화상자를 닫지 않고 팝업 자신의 onKeyDown이 처리한다.
 */

export const OPEN_ESCAPE_LAYER = { "data-escape-layer": "open" } as const;

export function isEscapeInsideOpenLayer(event: KeyboardEvent) {
  const target = event.target;
  return target instanceof Element && target.closest('[data-escape-layer="open"]') !== null;
}
