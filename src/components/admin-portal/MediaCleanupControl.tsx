"use client";

import { useId, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processPendingMediaDeletions } from "@/lib/actions/upload";

export function MediaCleanupControl() {
  const statusId = useId();
  const [status, setStatus] = useState(
    "만료된 미제출 파일과 실패한 삭제 작업을 최대 10건씩 정리합니다.",
  );
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function runCleanup() {
    setConfirming(false);
    startTransition(async () => {
      try {
        const result = await processPendingMediaDeletions(10);
        setStatus(
          `정리 완료: ${result.completed}건 삭제, ${result.failed}건 재시도 대기`,
        );
      } catch {
        setStatus("미디어 정리를 완료하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      }
    });
  }

  return (
    <section
      aria-labelledby="media-cleanup-heading"
      className="flex flex-col items-start justify-between gap-3 rounded-lg border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center"
    >
      <div>
        <h2 id="media-cleanup-heading" className="text-sm font-semibold text-foreground">
          미디어 저장소 정리
        </h2>
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-1 text-xs text-muted-foreground"
        >
          {status}
        </p>
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs font-medium text-warning" role="alert">삭제 대기 파일을 실제로 정리합니다.</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>취소</Button>
          <Button type="button" variant="outline" size="sm" disabled={isPending} aria-describedby={statusId} onClick={runCleanup}>정리 확인</Button>
        </div>
      ) : (
        <Button type="button" variant="outline" disabled={isPending} aria-describedby={statusId} onClick={() => setConfirming(true)}>
          <RefreshCw className={isPending ? "motion-safe:animate-spin" : ""} aria-hidden="true" />
          {isPending ? "정리 중" : "지금 정리"}
        </Button>
      )}
    </section>
  );
}
