"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

type RouteErrorStateProps = {
  title: string;
  description: string;
  onRetry: () => void;
  retryLabel?: string;
};

/**
 * route error boundary의 공통 alert·retry 패턴(캔버스 States 보드 "오류"):
 * 옅은 1px 선의 r10 면에 위험 아이콘 칸·제목·설명·먹색 다시 시도 버튼을 왼쪽 정렬로 쌓는다.
 */
export function RouteErrorState({
  title,
  description,
  onRetry,
  retryLabel = "다시 시도",
}: RouteErrorStateProps) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-5 py-12">
      <div
        role="alert"
        className="flex w-full max-w-md flex-col items-start justify-center gap-3 rounded-lg border border-muted bg-background px-6 py-10 md:px-8 md:py-12"
      >
        <div className="flex size-9 items-center justify-center rounded-touch bg-destructive-muted text-destructive">
          <AlertTriangle className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
        </div>
        <h1 className="text-base font-semibold text-foreground">{title}</h1>
        <p className="max-w-[300px] text-body text-secondary-foreground">{description}</p>
        <Button type="button" className="mt-1" onClick={onRetry}>
          {retryLabel}
        </Button>
      </div>
    </div>
  );
}
