/**
 * @file src/components/editor/keyboard-inset.ts
 * @description 휴대폰 화면 키보드가 가리는 높이를 `--keyboard-inset`(html)으로 알린다(B 묶음 ⑦).
 * 문서 편집 서식 줄은 position:fixed로 화면 아래에 두고 이 값만큼 올려 키보드 바로 위에 붙인다.
 * iOS Safari는 키보드가 열려도 layout viewport가 줄지 않아 bottom:0 고정 요소가 키보드 뒤로 숨는다.
 * visualViewport가 줄어든 만큼(innerHeight − 보이는 높이 − 위쪽 밀림)을 키보드 높이로 본다.
 */
"use client";

import { useEffect, type RefObject } from "react";

const INSET_VAR = "--keyboard-inset";
/** 서식 줄 높이(44px) + 여유. 캐럿이 서식 줄 뒤로 들어가지 않도록 scroll-padding에 더한다. */
const TOOLBAR_CLEARANCE_PX = 52;

/** 보이는 영역 아래로 가려진 높이(px). 주소 막대 접힘 같은 작은 차이는 0으로 본다. */
export function keyboardInsetPx(innerHeight: number, viewport: { height: number; offsetTop: number }): number {
  const hidden = innerHeight - viewport.height - viewport.offsetTop;
  return hidden > 80 ? Math.round(hidden) : 0;
}

/** 편집 영역 안에 초점이 있는 동안만 키보드 높이를 따라간다. 초점이 나가면 값을 지운다. */
export function useKeyboardInset(containerRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const container = containerRef.current;
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!enabled || !container || !viewport) return;
    const root = document.documentElement;
    let active = false;
    const update = () => {
      if (!active) return;
      const inset = keyboardInsetPx(window.innerHeight, viewport);
      root.dataset.editorDock = "";
      root.style.setProperty(INSET_VAR, `${inset}px`);
      root.style.scrollPaddingBottom = `${inset + TOOLBAR_CLEARANCE_PX}px`;
    };
    const clear = () => {
      delete root.dataset.editorDock;
      root.style.removeProperty(INSET_VAR);
      root.style.scrollPaddingBottom = "";
    };
    const onFocusIn = () => {
      active = true;
      update();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return;
      active = false;
      clear();
    };
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    if (container.contains(document.activeElement)) onFocusIn();
    return () => {
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      if (active) clear();
    };
  }, [containerRef, enabled]);
}
