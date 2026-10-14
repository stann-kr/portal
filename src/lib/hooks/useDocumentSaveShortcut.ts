/**
 * @file src/lib/hooks/useDocumentSaveShortcut.ts
 * @description 문서 폼 전체에서 Cmd/Ctrl+S 저장 동작과 중복 제출 방지를 일관되게 제공한다.
 */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEventHandler,
} from "react";

export const DOCUMENT_SAVE_SHORTCUT_LOCK_MS = 1_000;
export const DOCUMENT_SAVE_SHORTCUT_IGNORED_SELECTOR = "[data-editor-insert-panel]";

export type DocumentSaveShortcutEvent = {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
  key: string;
  metaKey: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
  preventDefault: () => void;
  repeat: boolean;
  target: unknown;
};

type CancelableUnlock = {
  cancel: () => void;
};

export type DocumentSaveShortcutUnlockScheduler = (
  unlock: () => void,
  delayMs: number,
) => CancelableUnlock;

export type DocumentSaveShortcutController = {
  dispose: () => void;
  handleKeyDown: (event: DocumentSaveShortcutEvent) => void;
};

export type CreateDocumentSaveShortcutControllerOptions = {
  isDisabled: () => boolean;
  onSave: () => void;
  scheduleUnlock?: DocumentSaveShortcutUnlockScheduler;
};

export type UseDocumentSaveShortcutOptions = {
  disabled?: boolean;
  onSave: () => void;
};

type ClosestTarget = {
  closest: (selector: string) => unknown;
};

function hasClosest(target: unknown): target is ClosestTarget {
  return (
    typeof target === "object" &&
    target !== null &&
    "closest" in target &&
    typeof target.closest === "function"
  );
}

function isEditorInsertPanelTarget(target: unknown): boolean {
  return (
    hasClosest(target) &&
    target.closest(DOCUMENT_SAVE_SHORTCUT_IGNORED_SELECTOR) != null
  );
}

function isSaveShortcut(event: DocumentSaveShortcutEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "s"
  );
}

function scheduleUnlockWithTimeout(
  unlock: () => void,
  delayMs: number,
): CancelableUnlock {
  const timer = setTimeout(unlock, delayMs);
  return {
    cancel: () => clearTimeout(timer),
  };
}

/**
 * React 바깥에서도 같은 저장 단축키 계약을 재사용·검증할 수 있는 controller다.
 * 단축키로 판정되면 저장 가능 여부보다 먼저 브라우저의 Save Page 동작을 막는다.
 */
export function createDocumentSaveShortcutController({
  isDisabled,
  onSave,
  scheduleUnlock = scheduleUnlockWithTimeout,
}: CreateDocumentSaveShortcutControllerOptions): DocumentSaveShortcutController {
  let locked = false;
  let lockGeneration = 0;
  let pendingUnlock: CancelableUnlock | null = null;

  const handleKeyDown = (event: DocumentSaveShortcutEvent) => {
    if (!isSaveShortcut(event)) return;

    event.preventDefault();
    if (
      isDisabled() ||
      event.repeat ||
      event.isComposing === true ||
      event.nativeEvent?.isComposing === true ||
      event.altKey ||
      isEditorInsertPanelTarget(event.target) ||
      locked
    ) return;

    locked = true;
    const currentGeneration = ++lockGeneration;
    pendingUnlock = scheduleUnlock(() => {
      if (lockGeneration !== currentGeneration) return;
      locked = false;
      pendingUnlock = null;
    }, DOCUMENT_SAVE_SHORTCUT_LOCK_MS);
    onSave();
  };

  const dispose = () => {
    lockGeneration += 1;
    pendingUnlock?.cancel();
    pendingUnlock = null;
    locked = false;
  };

  return { dispose, handleKeyDown };
}

/** 폼 루트의 `onKeyDownCapture`에 연결할 안정적인 저장 단축키 handler를 반환한다. */
export function useDocumentSaveShortcut({
  disabled = false,
  onSave,
}: UseDocumentSaveShortcutOptions): KeyboardEventHandler<HTMLElement> {
  const disabledRef = useRef(disabled);
  const onSaveRef = useRef(onSave);
  disabledRef.current = disabled;
  onSaveRef.current = onSave;

  const controller = useMemo(
    () =>
      createDocumentSaveShortcutController({
        isDisabled: () => disabledRef.current,
        onSave: () => onSaveRef.current(),
      }),
    [],
  );

  useEffect(() => () => controller.dispose(), [controller]);

  return useCallback(
    (event) => controller.handleKeyDown(event),
    [controller],
  );
}
