import React from "react";
import { cn } from "@/lib/utils";

type RouteLoadingStateProps = {
  label: string;
  /** 독립 route(커뮤니티 등)처럼 화면 높이를 다 채우지 않아도 되는 곳. */
  compact?: boolean;
};

const PULSE = "animate-pulse motion-reduce:animate-none";

/**
 * App Router segment에서 공통으로 사용하는 접근 가능한 loading shell(캔버스 States 보드 "불러오는 중").
 * 셸(사이드바·위쪽 막대) 안 화면 영역의 본문 여백에 머리(작은 줄·제목 줄), 구분선, 본문 줄을 그린다.
 */
export function RouteLoadingState({ label, compact = false }: RouteLoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className={cn(
        "box-border px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14",
        compact ? "min-h-[60dvh]" : "min-h-[100dvh]",
      )}
    >
      <div aria-hidden="true" className="flex max-w-[760px] flex-col gap-3.5">
        <span className={cn("h-2.5 w-24 rounded-sm bg-muted", PULSE)} />
        <span className={cn("h-[22px] w-[220px] max-w-full rounded-sm bg-muted", PULSE)} />
        <span className="mb-1 mt-3 h-px bg-muted" />
        <span className={cn("h-3.5 w-full rounded-sm bg-sidebar", PULSE)} />
        <span className={cn("h-3.5 w-[88%] rounded-sm bg-sidebar", PULSE)} />
        <span className={cn("h-3.5 w-[94%] rounded-sm bg-sidebar", PULSE)} />
        <span className={cn("h-3.5 w-[72%] rounded-sm bg-sidebar", PULSE)} />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
