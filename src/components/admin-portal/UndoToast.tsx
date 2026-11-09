/**
 * @file src/components/admin-portal/UndoToast.tsx
 * @description 화면 아래쪽 되돌리기 안내(AssignmentAck 보드). 정해진 시간 뒤 닫히고,
 * 포인터가 올라가 있거나 focus가 안에 있는 동안은 닫히지 않는다.
 */
"use client";

import { forwardRef, useEffect, useRef, useState } from "react";

export const UNDO_TOAST_DURATION_MS = 6_000;

export type UndoToastMessage = { key: string; message: string; undoLabel?: string; tone?: "status" | "error" };

export const UndoToast = forwardRef<HTMLButtonElement, {
  toast: UndoToastMessage | null;
  onUndo?: () => void;
  onDismiss: () => void;
  durationMs?: number;
}>(function UndoToast({ toast, onUndo, onDismiss, durationMs = UNDO_TOAST_DURATION_MS }, undoRef) {
  // 잡아 둔 안내의 key. 새 안내가 오면 자동으로 풀린다.
  const [heldKey, setHeldKey] = useState<string | null>(null);
  const held = toast !== null && heldKey === toast.key;
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    if (!toast || held) return;
    const timer = window.setTimeout(() => dismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, held, durationMs]);

  // 알림 영역은 항상 두어 새 문구가 읽히게 한다.
  return (
    <div
      role={toast?.tone === "error" ? "alert" : "status"}
      className="pointer-events-none fixed inset-x-4 bottom-[max(16px,env(safe-area-inset-bottom))] flex justify-center md:inset-x-auto md:right-8 md:bottom-8"
      style={{ zIndex: "var(--z-toast)" }}
    >
      {toast ? (
        <div
          key={toast.key}
          className="pointer-events-auto flex min-h-11 w-full items-center justify-between gap-3 rounded-lg bg-foreground py-1 pl-3.5 pr-2 text-ui text-primary-foreground shadow-floating md:w-auto md:min-w-[360px] md:max-w-[480px]"
          onPointerEnter={() => setHeldKey(toast.key)}
          onPointerLeave={() => setHeldKey(null)}
          onFocus={() => setHeldKey(toast.key)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeldKey(null);
          }}
        >
          <span className="min-w-0 break-words">{toast.message}</span>
          {onUndo && toast.undoLabel ? (
            <button
              ref={undoRef}
              type="button"
              onClick={onUndo}
              className="h-11 shrink-0 rounded-md px-2.5 text-ui font-medium underline underline-offset-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground md:h-8"
            >
              {toast.undoLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
