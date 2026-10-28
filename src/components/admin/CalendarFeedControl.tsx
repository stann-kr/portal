"use client";

import { useState, useTransition } from "react";
import { AccountStatusRow, ACCOUNT_ACTION_BUTTON_CLASS, OneTimeSecret } from "@/components/admin/OneTimeSecret";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { issueStudentCalendarFeedUrl } from "@/lib/actions/calendarFeed";
import { formatKstShortDate } from "@/lib/kst-format";
import { cn } from "@/lib/utils";

/**
 * 학생 레슨 캘린더 구독 URL 발급·교체. URL 원문은 발급 직후 한 번만 보여 준다.
 * 이미 발급한 URL이 있으면 교체가 학생의 기존 구독을 끊으므로 취소 우선 확인을 거친다.
 * 계정 구역에서 상태 줄(캘린더 구독)과 조작(버튼·확인·발급 값)을 따로 배치할 수 있게 둘을 형제로 그린다.
 */
export function CalendarFeedControl({
  studentId,
  issuedAt = null,
  referenceTime,
  statusClassName,
  actionsClassName,
}: {
  studentId: string;
  /** 현재 유효한 구독 URL을 마지막으로 발급한 시각. 없으면 null. */
  issuedAt?: Date | null;
  /** 발급 날짜에 연도를 붙일지 정하는 서버 기준 시각. */
  referenceTime?: Date;
  statusClassName?: string;
  actionsClassName?: string;
}) {
  const [relativeUrl, setRelativeUrl] = useState<string | null>(null);
  const [lastIssuedAt, setLastIssuedAt] = useState<Date | null>(issuedAt);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rotateConfirm = useConfirmAction();
  const hasActiveUrl = lastIssuedAt !== null || relativeUrl !== null;

  const absoluteUrl =
    relativeUrl && typeof window !== "undefined"
      ? `${window.location.origin}${relativeUrl}`
      : relativeUrl;

  const issue = () => {
    setError(null);
    startTransition(async () => {
      try {
        setRelativeUrl(await issueStudentCalendarFeedUrl(studentId));
        setLastIssuedAt(new Date());
      } catch {
        setError("구독 URL을 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  };

  return (
    <>
      <AccountStatusRow label="캘린더 구독" className={statusClassName}>
        {lastIssuedAt ? `${formatKstShortDate(lastIssuedAt, "", referenceTime)} 발급 · 사용 중` : "발급 전"}
      </AccountStatusRow>

      <div className={cn("flex flex-col", actionsClassName)}>
        <Button
          type="button"
          variant="outline"
          className={ACCOUNT_ACTION_BUTTON_CLASS}
          disabled={isPending}
          aria-expanded={hasActiveUrl ? rotateConfirm.isOpen : undefined}
          onClick={(event) => {
            if (hasActiveUrl) rotateConfirm.request(event.currentTarget);
            else issue();
          }}
        >
          {isPending ? "발급 중…" : hasActiveUrl ? "구독 URL 다시 발급" : "구독 URL 발급"}
        </Button>

        {rotateConfirm.isOpen ? (
          <ConfirmPanel
            confirm={rotateConfirm}
            message="새 URL을 발급하면 학생이 캘린더 앱에 등록한 기존 구독 URL이 즉시 만료됩니다. 다시 발급할까요?"
            confirmLabel="구독 URL 다시 발급 확인"
            pendingLabel="발급 중…"
            pending={isPending}
            onConfirm={issue}
            className="mt-2"
          />
        ) : null}

        <div aria-live="polite" aria-atomic="true" className="[&:not(:empty)]:mt-3">
          {absoluteUrl ? (
            <OneTimeSecret
              key={absoluteUrl}
              label="구독 URL"
              value={absoluteUrl}
              href={relativeUrl ?? undefined}
              notice="다시 발급하면 이전 URL은 즉시 만료됩니다. 지금 안전하게 전달해 주세요."
            />
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}
