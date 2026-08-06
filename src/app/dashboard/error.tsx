"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4 py-12">
      <div role="alert" className="w-full max-w-lg rounded-lg border border-destructive/25 bg-destructive-muted p-6">
        <div className="flex size-10 items-center justify-center rounded-md bg-surface text-destructive">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-foreground">
          포털을 불러오지 못했습니다
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          잠시 후 다시 시도해 주세요. 작성 중이던 내용이 있다면 현재 창을 닫지 마세요.
        </p>
        <Button type="button" className="mt-5" onClick={reset}>
          다시 시도
        </Button>
      </div>
    </div>
  );
}
