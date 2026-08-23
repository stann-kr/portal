"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { issueStudentCalendarFeedUrl } from "@/lib/actions/calendarFeed";

export function CalendarFeedControl({ studentId }: { studentId: string }) {
  const [relativeUrl, setRelativeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const absoluteUrl =
    relativeUrl && typeof window !== "undefined"
      ? `${window.location.origin}${relativeUrl}`
      : relativeUrl;

  const issue = () => {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        setRelativeUrl(await issueStudentCalendarFeedUrl(studentId));
      } catch {
        setError("구독 URL을 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  };

  const copy = async () => {
    if (!absoluteUrl) return;
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
    } catch {
      setError("자동 복사에 실패했습니다. URL을 직접 선택해 복사해 주세요.");
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-48 flex-1 text-xs text-muted-foreground">
          캘린더 구독 URL은 발급 직후 한 번만 표시됩니다.
        </p>
        <Button type="button" size="sm" onClick={issue} disabled={isPending}>
          {isPending
            ? "발급 중…"
            : relativeUrl
              ? "새 URL로 교체"
              : "구독 URL 발급"}
        </Button>
      </div>

      {absoluteUrl && (
        <div className="space-y-2" aria-live="polite" aria-atomic="true">
          <p className="text-xs text-destructive">
            다시 발급하면 이전 URL은 즉시 만료됩니다. 지금 안전하게 전달해 주세요.
          </p>
          <div className="flex items-center gap-2">
            <a
              href={relativeUrl ?? undefined}
              className="min-w-0 flex-1 break-all font-mono text-xs text-primary hover:underline"
            >
              {absoluteUrl}
            </a>
            <Button type="button" size="sm" variant="outline" onClick={copy}>
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? "복사됨" : "복사"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
