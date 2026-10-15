"use client";

import type { Ref } from "react";
import { Check, CloudOff, Loader2 } from "lucide-react";

export type AutosaveStatusKind = "saved" | "pending" | "saving" | "blocked" | "error";

const LABELS: Record<Exclude<AutosaveStatusKind, "error" | "blocked">, string> = {
  saved: "저장됨",
  pending: "입력 중",
  saving: "저장 중…",
};

/**
 * 저장 버튼 대신 문서 위에 보이는 저장 상태. 실패하면 이유와 다시 시도를 함께 보여 준다.
 * 화면 읽기 프로그램에는 상태가 바뀔 때만 읽히도록 polite로 둔다.
 */
export function AutosaveStatus({
  status,
  message,
  onRetry,
  alertRef,
}: {
  status: AutosaveStatusKind;
  /** blocked·error일 때 보여 줄 이유. */
  message?: string;
  onRetry?: () => void;
  /** 실패 안내로 초점을 옮겨야 하는 화면이 쓴다. */
  alertRef?: Ref<HTMLDivElement>;
}) {
  const isError = status === "error";
  return (
    <div
      ref={isError ? alertRef : undefined}
      role={isError ? "alert" : "status"}
      aria-live={isError ? undefined : "polite"}
      tabIndex={isError ? -1 : undefined}
      className="flex min-h-7 scroll-mt-4 items-center gap-1.5 rounded-sm text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {status === "saving" ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {status === "saved" ? <Check className="size-3.5 text-success" aria-hidden="true" /> : null}
      {status === "error" ? <CloudOff className="size-3.5 text-destructive" aria-hidden="true" /> : null}
      <span className={status === "error" ? "text-destructive" : undefined}>
        {status === "error" || status === "blocked" ? message : LABELS[status]}
      </span>
      {status === "error" && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          다시 시도
        </button>
      ) : null}
    </div>
  );
}
