"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 취소 우선 2단계 확인의 열림 상태와 초점 복귀를 소유한다.
 * 목록 행처럼 trigger가 여러 개인 곳은 `value`로 확인 대상을 구분한다.
 */
export function useConfirmAction<T = true>() {
  const [target, setTarget] = useState<{ value: T } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const shouldRestoreFocus = useRef(false);

  const request = useCallback((trigger: HTMLElement | null, value?: T) => {
    triggerRef.current = trigger;
    shouldRestoreFocus.current = false;
    setTarget({ value: (value ?? true) as T });
  }, []);

  /** 확인 영역을 닫고 확인을 연 버튼으로 초점을 돌려준다. */
  const close = useCallback(() => {
    shouldRestoreFocus.current = true;
    setTarget(null);
  }, []);

  useEffect(() => {
    if (target || !shouldRestoreFocus.current) return;
    shouldRestoreFocus.current = false;
    const trigger = triggerRef.current;
    if (trigger?.isConnected && !trigger.hasAttribute("disabled")) {
      trigger.focus({ preventScroll: true });
    }
  }, [target]);

  return { isOpen: target !== null, value: target?.value ?? null, request, close };
}

export type ConfirmActionState<T = true> = ReturnType<typeof useConfirmAction<T>>;

// 좁은 화면은 줄을 채우는 44px 터치 대상(문구가 길면 다음 줄로 넘겨 전체 폭), 넓은 화면은 32px 기본 버튼.
const PANEL_BUTTON_CLASS = "h-11 flex-auto rounded-touch text-body md:h-8 md:flex-none md:rounded-md md:text-ui";

/**
 * 확인 문구와 취소·확인 버튼(캔버스 AdminOps·CalendarDialogs·NoteHistory의 확인 줄).
 * 열리면 취소에 초점을 두고 Esc로 닫는다.
 * 확인 뒤에는 `pending`이 끝날 때까지 진행 문구를 보이고, 끝나면 닫는다.
 * 실패 안내는 호출한 화면의 기존 오류 영역이 담당한다.
 */
export function ConfirmPanel({
  confirm,
  message,
  confirmLabel,
  pendingLabel,
  pending = false,
  onConfirm,
  className,
  tone = "destructive",
}: {
  confirm: Pick<ConfirmActionState<unknown>, "close">;
  message: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  className?: string;
  /** 삭제·만료처럼 되돌릴 수 없으면 destructive(위험 옅은 면·위험 면 버튼), 이력이 남는 복원은 neutral(옅은 면·먹색 버튼). */
  tone?: "destructive" | "neutral";
}) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // 확인을 누를 때마다 번호를 올리고, 그 확인의 작업(pending)이 끝나면 한 번만 닫는다.
  const [submission, setSubmission] = useState(0);
  const closedSubmissionRef = useRef(0);
  const { close } = confirm;

  useEffect(() => {
    // 화면 밖에 열리면 브라우저가 필요한 만큼만 스크롤해 확인 영역을 보이게 한다.
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (submission === 0 || pending || closedSubmissionRef.current === submission) return;
    closedSubmissionRef.current = submission;
    close();
  }, [close, pending, submission]);

  return (
    <div
      role="group"
      aria-labelledby={messageId}
      className={cn(
        "flex flex-col gap-3 rounded-touch px-3.5 py-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-3 md:gap-y-2.5",
        tone === "destructive" ? "bg-destructive-muted" : "bg-sidebar",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || pending) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <p
        id={messageId}
        className={cn(
          "min-w-0 break-words text-body md:flex-[1_1_16rem] md:text-ui",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {message}
      </p>
      <div className="flex flex-wrap gap-2 md:ml-auto">
        <Button ref={cancelRef} type="button" variant="outline" className={PANEL_BUTTON_CLASS} onClick={close} disabled={pending}>
          취소
        </Button>
        <Button
          type="button"
          variant={tone === "destructive" ? "destructive-solid" : "default"}
          className={PANEL_BUTTON_CLASS}
          aria-describedby={messageId}
          disabled={pending}
          onClick={() => {
            setSubmission((current) => current + 1);
            onConfirm();
          }}
        >
          {pending && pendingLabel ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
