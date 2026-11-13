/**
 * @file src/components/ui/escape-layer.ts
 * @description 대화상자 안의 자체 팝업이 Esc를 먼저 받게 하는 표시.
 *
 * Radix Dialog는 document capture 단계에서 Esc를 받아 안쪽 요소보다 먼저 닫힌다.
 * 열린 자체 팝업의 바깥 요소에 `data-escape-layer="open"`을 두면, 그 대화상자 안에서 누른 Esc는
 * 대화상자를 닫지 않고 팝업이 처리한다.
 */

export const OPEN_ESCAPE_LAYER = { "data-escape-layer": "open" } as const;

const OPEN_LAYER_SELECTOR = '[data-escape-layer="open"]';

/**
 * 이 Esc를 대화상자 대신 열린 자체 팝업이 받아야 하는지. 초점이 팝업 안에 있을 때뿐 아니라, 같은 대화상자 안에
 * 팝업이 열려 있는데 초점은 바깥에 남은 경우도 포함한다(macOS Safari·Firefox는 버튼을 눌러도 초점을 주지 않는다).
 * 초점이 어느 대화상자에도 없으면(초점을 가진 요소가 사라지거나 blur되어 body로 빠진 경우) Esc를 받은
 * 대화상자(`container`) 안에 열린 팝업이 있는지 본다. 이때 팝업은 document에서 Esc를 받아 닫는다.
 */
export function isEscapeForOpenLayer(event: KeyboardEvent, container?: Element | null) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(OPEN_LAYER_SELECTOR)) return true;
  const dialog = target?.closest('[role="dialog"], [role="alertdialog"]') ?? container ?? null;
  return dialog?.querySelector(OPEN_LAYER_SELECTOR) != null;
}
