"use client";

import { useRef } from "react";

/** Controlled dialogs often open without a Radix Trigger to restore focus to. */
export function useOverlayFocus() {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const captureFocus = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      && document.activeElement !== document.body
      ? document.activeElement
      : null;
  };

  const restoreFocus = (event: Event) => {
    if (event.defaultPrevented || !returnFocusRef.current?.isConnected) return;
    event.preventDefault();
    returnFocusRef.current.focus({ preventScroll: true });
  };

  return { captureFocus, restoreFocus };
}
