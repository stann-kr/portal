"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COLLAB_PENDING_SLOW_MS,
  describeCollabPending,
} from "@/lib/collab/client/collab-status";
import type { CollabDocumentState } from "@/lib/collab/client/useCollabDocument";

type PendingCollab = Pick<CollabDocumentState, "status" | "seedState" | "seedMessage" | "retrySeed">;

/**
 * 공동 편집 room이 준비되기 전, 편집기가 들어갈 자리를 같은 크기로 채우는 안내(States 보드 "편집기 연결").
 * 처음에는 "준비하는 중", 6초가 지나면 "늦어지고 있습니다", 실패하면 이유와(가능하면) 다시 시도를 보인다.
 *
 * - `boxed`(기본): FullEditor 기본 상자와 같은 테두리·모서리.
 * - `bare`: 상위가 이미 테두리를 그리는 칸(Q&A 답글 입력란) 안. 칸이 한 줄 높이에서 시작하므로 자리 표시 막대는 두지 않는다.
 * - `page`: 노트·가이드처럼 테두리 없는 문서 본문.
 */
export function CollabEditorPending({
  collab,
  minHeight,
  variant = "boxed",
  label,
  deniedMessage,
  className,
}: {
  /** 없으면(편집기 코드를 내려받는 중) "준비하는 중"만 보인다. */
  collab?: PendingCollab | null;
  minHeight?: string;
  variant?: "boxed" | "bare" | "page";
  /** 처음 문구(예: "노트를 불러오는 중…"). */
  label?: string;
  /** 권한 없음일 때 화면별 안내. */
  deniedMessage?: string;
  className?: string;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), COLLAB_PENDING_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const view = describeCollabPending({
    connection: collab?.status ?? null,
    seedState: collab?.seedState ?? null,
    seedMessage: collab?.seedMessage ?? null,
    slow,
    label,
    deniedMessage,
  });
  const failed = view.kind === "failed";

  return (
    <div
      role={failed ? "alert" : "status"}
      aria-busy={failed ? undefined : true}
      data-collab-pending={view.kind}
      className={cn(
        "flex flex-col gap-1.5",
        variant === "boxed" && "rounded-lg border border-border bg-background px-3.5 py-3 md:px-4 md:py-3.5",
        variant === "bare" && "px-3 py-2.5 md:px-4 md:py-3.5",
        variant === "page" && "py-1",
        className,
      )}
      style={minHeight ? { minHeight } : undefined}
    >
      <span
        className={cn(
          "inline-flex items-center gap-2 text-ui",
          view.kind === "connecting" && "text-muted-foreground",
          view.kind === "slow" && "font-medium text-foreground",
          failed && "font-medium text-destructive",
        )}
      >
        {failed ? (
          <AlertTriangle className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.8} aria-hidden="true" />
        )}
        {view.title}
      </span>
      {view.detail ? <span className="pl-[22px] text-ui text-secondary-foreground">{view.detail}</span> : null}
      {view.kind === "connecting" && variant !== "bare" ? (
        <span aria-hidden="true" className="mt-2.5 flex flex-col gap-1">
          <span className="h-3 w-[92%] rounded-sm bg-sidebar" />
          <span className="h-3 w-[64%] rounded-sm bg-sidebar" />
        </span>
      ) : null}
      {view.canRetry && collab ? (
        <button
          type="button"
          onClick={collab.retrySeed}
          className="ml-[22px] mt-1.5 inline-flex h-7 items-center self-start rounded-md border border-border bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          다시 시도
        </button>
      ) : null}
    </div>
  );
}
