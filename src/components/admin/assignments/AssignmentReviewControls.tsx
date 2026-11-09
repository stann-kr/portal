/**
 * @file src/components/admin/assignments/AssignmentReviewControls.tsx
 * @description 과제 "확인함"(AssignmentAck 보드) 화면 조각.
 * - AssignmentReviewStatusRow: Stann 과제 상세 머리의 상태 줄(피드백 대기 + 확인함으로 표시 / 확인함 + 확인 취소 / 피드백 완료).
 * - AssignmentAcknowledgedNotice: 학생 과제 상세의 "Stann이 확인했습니다" 안내.
 * - QueueNextBar: 업무함에서 들어와 처리한 뒤 다음 피드백 대기로 이어 주는 막대.
 */
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { setAssignmentReviewed } from "@/lib/actions/assignment-review";
import { getSubmissionReviewStatus } from "@/lib/assignment-submission";
import { formatKst } from "@/lib/kst-format";

const TIME = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;

/** "11월 9일 08:20"(KST). */
export function formatReviewedAt(value: Date | string): string {
  return formatKst(value, { month: "long", day: "numeric", ...TIME });
}

function StatusDot({ className }: { className: string }) {
  return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${className}`} />;
}

export function AssignmentReviewStatusRow({
  assignmentId,
  feedbackCount,
  reviewedAt,
}: {
  assignmentId: string;
  feedbackCount: number;
  reviewedAt: Date | string | null;
}) {
  const router = useProgressRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const status = getSubmissionReviewStatus({ feedbackCount, reviewedAt });

  const change = (reviewed: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setAssignmentReviewed(assignmentId, reviewed);
        if (!result.success) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setError(reviewed ? "확인함으로 표시하지 못했습니다. 다시 시도해 주세요." : "확인을 취소하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        {status === "reviewed" ? (
          <span className="inline-flex items-center gap-1.5 text-ui text-secondary-foreground">
            <StatusDot className="bg-highlight" />
            피드백 완료 · <span className="font-mono tabular-nums">{feedbackCount}</span>
          </span>
        ) : status === "acknowledged" && reviewedAt ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-ui text-foreground">
              <Check className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
              확인함 · {formatReviewedAt(reviewedAt)}
            </span>
            <button
              type="button"
              onClick={() => change(false)}
              disabled={isPending}
              aria-busy={isPending || undefined}
              className="inline-flex h-11 items-center rounded-md px-2.5 text-ui text-secondary-foreground underline underline-offset-[3px] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-8"
            >
              확인 취소
            </button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 text-ui text-secondary-foreground">
              <StatusDot className="bg-event-note" />
              피드백 대기
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => change(true)}
              pending={isPending}
              className="max-md:h-11 font-medium"
            >
              {isPending ? null : <Check className="size-3.5" strokeWidth={1.8} aria-hidden="true" />}
              확인함으로 표시
            </Button>
          </>
        )}
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function AssignmentAcknowledgedNotice({ reviewedAt }: { reviewedAt: Date | string }) {
  return (
    <section aria-label="Stann 확인" className="flex flex-col gap-2.5 rounded-lg border border-muted bg-sidebar p-4">
      <p className="inline-flex items-center gap-2 text-body font-medium">
        <Check className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        Stann이 확인했습니다 · {formatKst(reviewedAt, { month: "long", day: "numeric" })}
      </p>
      <p className="pl-[22px] text-ui leading-5 text-secondary-foreground">
        따로 남긴 피드백은 없습니다. 확인된 제출은 고칠 수 없습니다.
      </p>
    </section>
  );
}

export type QueueNext = {
  remaining: number;
  next: { href: string; label: string } | null;
  queueHref: string;
};

export function QueueNextBar({ queueNext }: { queueNext: QueueNext }) {
  return (
    <nav
      aria-label="다음 피드백 대기"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-3.5 md:max-w-[760px]"
    >
      {queueNext.next ? (
        <>
          <span className="text-ui text-secondary-foreground">
            남은 피드백 대기 <span className="font-mono tabular-nums">{queueNext.remaining}</span>건
          </span>
          <Link
            href={queueNext.next.href}
            className="inline-flex h-11 min-w-0 items-center gap-1.5 rounded-md bg-primary px-3 text-ui font-medium text-primary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-primary/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none md:h-8"
          >
            <span className="truncate">다음: {queueNext.next.label}</span>
            <ArrowRight className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </>
      ) : (
        <span className="text-ui text-secondary-foreground">
          피드백 대기를 모두 처리했습니다 ·{" "}
          <Link href={queueNext.queueHref} className="inline-flex h-11 items-center underline underline-offset-[3px] hover:text-foreground md:h-auto">
            업무함으로
          </Link>
        </span>
      )}
    </nav>
  );
}
