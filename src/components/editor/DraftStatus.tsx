"use client";

import { AlertCircle, Check, CloudCog } from "lucide-react";
import type { FormDraftStatus } from "@/lib/form-draft";

function formatSavedTime(value: Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function DraftStatus({
  status,
  savedAt,
  restored,
}: {
  status: FormDraftStatus;
  savedAt: Date | null;
  restored: boolean;
}) {
  const time = formatSavedTime(savedAt);

  if (status === "error") {
    return (
      <p role="alert" className="inline-flex items-center gap-1.5 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        임시 저장을 사용할 수 없습니다. 직접 저장해 주세요.
      </p>
    );
  }

  if (status === "conflict") {
    return (
      <p role="alert" className="inline-flex items-center gap-1.5 text-xs text-warning">
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        다른 탭의 임시 저장을 감지했습니다. 이 탭의 내용은 직접 저장해 주세요.
      </p>
    );
  }

  if (status === "saving") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CloudCog className="h-3.5 w-3.5" aria-hidden="true" />
        이 기기에 임시 저장 중…
      </p>
    );
  }

  if (status === "saved") {
    return (
      <p role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        {restored ? "저장되지 않은 작성 내용을 복원했습니다" : "이 기기에 임시 저장됨"}
        {time ? <span className="tabular-nums">· {time}</span> : null}
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      작성 중인 내용은 이 기기에 임시 저장됩니다.
    </p>
  );
}
