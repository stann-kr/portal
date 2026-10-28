"use client";

import type { Ref } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AutosaveStatusKind = "saved" | "pending" | "saving" | "blocked" | "error";

const LABELS: Record<Exclude<AutosaveStatusKind, "error" | "blocked">, string> = {
  saved: "저장됨",
  pending: "입력 중",
  saving: "저장 중…",
};

function StatusIcon({ status }: { status: AutosaveStatusKind }) {
  if (status === "pending") return <span className="size-1.5 shrink-0 rounded-full bg-item-note" aria-hidden="true" />;
  if (status === "saving") {
    return <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.8} aria-hidden="true" />;
  }
  if (status === "saved") return <Check className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />;
  if (status === "error") return <AlertTriangle className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />;
  return null;
}

/**
 * 저장 버튼 대신 보이는 자동 저장 상태(States 보드 "저장 상태"). 실패하면 이유와 다시 시도를 함께 보여 준다.
 *
 * - `inline`(기본): 문서 위·본문 안의 상태 줄. 실패는 alert로 알리고 다시 시도를 둔다.
 * - `bar`: 위쪽 막대의 짧은 상태. 좁은 화면에서는 `shortMessage`만, 넓은 화면에서는 `message`까지 보인다.
 *   실패는 본문의 `inline` 안내가 alert로 알리므로 여기서는 짧은 표시만 하고 live region을 겹치지 않는다.
 */
export function AutosaveStatus({
  status,
  message,
  shortMessage = "저장 대기",
  onRetry,
  alertRef,
  variant = "inline",
  className,
}: {
  status: AutosaveStatusKind;
  /** blocked·error일 때 보여 줄 이유. */
  message?: string;
  /** bar에서 좁은 화면의 blocked 표시. */
  shortMessage?: string;
  onRetry?: () => void;
  /** 실패 안내로 초점을 옮겨야 하는 화면이 쓴다. */
  alertRef?: Ref<HTMLDivElement>;
  variant?: "inline" | "bar";
  className?: string;
}) {
  const isError = status === "error";

  if (variant === "bar") {
    return (
      <span
        role={isError ? undefined : "status"}
        aria-live={isError ? undefined : "polite"}
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
          isError && "text-destructive",
          className,
        )}
      >
        <StatusIcon status={status} />
        {status === "blocked" ? (
          <>
            <span className="truncate md:hidden">{shortMessage}</span>
            <span className="hidden truncate md:inline">{message ?? shortMessage}</span>
          </>
        ) : (
          <span className="truncate">{isError ? "저장 실패" : LABELS[status]}</span>
        )}
      </span>
    );
  }

  return (
    <div
      ref={isError ? alertRef : undefined}
      role={isError ? "alert" : "status"}
      aria-live={isError ? undefined : "polite"}
      tabIndex={isError ? -1 : undefined}
      className={cn(
        "flex min-h-7 scroll-mt-16 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className={cn("inline-flex items-center gap-1.5", isError && "text-destructive")}>
        <StatusIcon status={status} />
        <span>{status === "error" || status === "blocked" ? message : LABELS[status]}</span>
      </span>
      {isError && onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      ) : null}
    </div>
  );
}
