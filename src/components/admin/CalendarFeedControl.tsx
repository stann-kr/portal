"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { issueStudentCalendarFeedUrl } from "@/lib/actions/calendarFeed";
import { formatKst } from "@/lib/kst-format";

const ISSUED_AT_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * 학생 레슨 캘린더 구독 URL 발급·교체. URL 원문은 발급 직후 한 번만 보여 준다.
 * 이미 발급한 URL이 있으면 교체가 학생의 기존 구독을 끊으므로 취소 우선 확인을 거친다.
 */
export function CalendarFeedControl({
  studentId,
  issuedAt = null,
}: {
  studentId: string;
  /** 현재 유효한 구독 URL을 마지막으로 발급한 시각. 없으면 null. */
  issuedAt?: Date | null;
}) {
  const [relativeUrl, setRelativeUrl] = useState<string | null>(null);
  const [lastIssuedAt, setLastIssuedAt] = useState<Date | null>(issuedAt);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const rotateConfirm = useConfirmAction();
  const hasActiveUrl = lastIssuedAt !== null || relativeUrl !== null;

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
        setLastIssuedAt(new Date());
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
          {lastIssuedAt && !relativeUrl
            ? `${formatKst(lastIssuedAt, ISSUED_AT_FORMAT)}에 발급한 구독 URL이 사용 중입니다. 보안을 위해 다시 표시하지 않습니다.`
            : "캘린더 구독 URL은 발급 직후 한 번만 표시됩니다."}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          aria-expanded={hasActiveUrl ? rotateConfirm.isOpen : undefined}
          onClick={(event) => {
            if (hasActiveUrl) rotateConfirm.request(event.currentTarget);
            else issue();
          }}
        >
          {isPending
            ? "발급 중…"
            : hasActiveUrl
              ? "새 URL로 교체"
              : "구독 URL 발급"}
        </Button>
      </div>

      {rotateConfirm.isOpen ? (
        <ConfirmPanel
          confirm={rotateConfirm}
          message="새 URL을 발급하면 학생이 캘린더 앱에 등록한 기존 구독 URL이 즉시 만료됩니다. 교체할까요?"
          confirmLabel="URL 교체 확인"
          pendingLabel="발급 중…"
          pending={isPending}
          onConfirm={issue}
        />
      ) : null}

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
