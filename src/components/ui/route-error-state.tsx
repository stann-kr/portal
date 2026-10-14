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

/** route error boundary의 공통 alert·retry 패턴. */
export function RouteErrorState({
  title,
  description,
  onRetry,
  retryLabel = "다시 시도",
}: RouteErrorStateProps) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4 py-12">
      <div
        role="alert"
        className="w-full max-w-lg rounded-lg border border-destructive/25 bg-destructive-muted p-6"
      >
        <div className="flex size-10 items-center justify-center rounded-md bg-surface text-destructive">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <Button type="button" className="mt-5" onClick={onRetry}>
          {retryLabel}
        </Button>
      </div>
    </div>
  );
}
