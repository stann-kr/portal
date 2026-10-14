"use client";

import { useId, useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processDueAccountErasures } from "@/lib/actions/accountPrivacy";

export function AccountErasureCleanupControl() {
  const statusId = useId();
  const [status, setStatus] = useState(
    "삭제 후 30일이 지난 계정 식별자를 최대 10건씩 무작위 alias로 바꿉니다.",
  );
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const run = () => {
    setConfirming(false);
    startTransition(async () => {
      try {
        const result = await processDueAccountErasures(10);
        setStatus(
          `식별자 정리 완료: ${result.processed}건 처리, ${result.skipped}건 동시 작업으로 건너뜀, ${result.failed}건 재시도 필요`,
        );
      } catch {
        setStatus("식별자 정리를 완료하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      }
    });
  };

  return (
    <section
      aria-labelledby="account-erasure-heading"
      className="flex flex-col items-start justify-between gap-3 rounded-lg border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center"
    >
      <div>
        <h2 id="account-erasure-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="size-4" aria-hidden="true" />
          계정 식별자 정리
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
          <span className="text-xs font-medium text-warning" role="alert">기한이 지난 원래 식별자를 복구 불가능하게 바꿉니다.</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>취소</Button>
          <Button type="button" variant="outline" size="sm" disabled={isPending} aria-describedby={statusId} onClick={run}>정리 확인</Button>
        </div>
      ) : (
        <Button type="button" variant="outline" disabled={isPending} aria-describedby={statusId} onClick={() => setConfirming(true)}>
          {isPending ? "정리 중" : "기한 지난 ID 정리"}
        </Button>
      )}
    </section>
  );
}
