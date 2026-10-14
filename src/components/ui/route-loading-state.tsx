import React from "react";

type RouteLoadingStateProps = {
  label: string;
  compact?: boolean;
};

/** App Router segment에서 공통으로 사용하는 접근 가능한 loading shell. */
export function RouteLoadingState({ label, compact = false }: RouteLoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className={compact ? "min-h-[60dvh]" : "min-h-[100dvh]"}
    >
      {!compact ? <div className="h-14 border-b border-border bg-background" /> : null}
      <div className="mx-auto max-w-[1180px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-3">
          <div className="h-4 w-28 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
          <div className="h-8 w-64 max-w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        </div>
        <div className="h-44 animate-pulse rounded-lg border border-border bg-surface motion-reduce:animate-none" />
        <div className="grid gap-8 md:grid-cols-2">
          <div className="h-56 animate-pulse rounded-lg border border-border bg-surface motion-reduce:animate-none" />
          <div className="h-56 animate-pulse rounded-lg border border-border bg-surface motion-reduce:animate-none" />
        </div>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
