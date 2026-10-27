/**
 * @file src/components/qna/qna-display.tsx
 * @description Q&A 목록·상세가 함께 쓰는 표시 조각(Quiet Ledger 상태 점·숫자 날짜·이니셜).
 * 상태 이름은 registry(`QNA_STATUS_LABELS`)를 따르고, 점 색은 캔버스 Qna 보드 값이다.
 */
import type { QnaStatus } from "@/db/schema";
import { QNA_STATUS_LABELS } from "@/lib/qna-status";
import { cn } from "@/lib/utils";

/** 캔버스 Qna 보드: 답변 대기 Q&A 점, 답변 완료 강조 파랑, 종료 비활성 점. */
export const QNA_STATUS_DOT_CLASS: Record<QnaStatus, string> = {
  OPEN: "bg-item-qna",
  ANSWERED: "bg-highlight",
  CLOSED: "bg-faint",
};

/** 6px 상태 점과 글자 2 상태 이름. */
export function QnaStatusLabel({ status, className }: { status: QnaStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-secondary-foreground", className)}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", QNA_STATUS_DOT_CLASS[status])} />
      {QNA_STATUS_LABELS[status]}
    </span>
  );
}

/** 아바타 원 안의 첫 글자. */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? "?";
}
