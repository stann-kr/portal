"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { processPendingMediaDeletions } from "@/lib/actions/upload";
import {
  OPERATION_CONFIRM_CLASS,
  OPERATION_DESCRIPTION_CLASS,
  OPERATION_ROW_CLASS,
  OPERATION_STATUS_CLASS,
  OPERATION_TEXT_CLASS,
  OPERATION_TITLE_CLASS,
  OPERATION_TRIGGER_CLASS,
} from "@/components/admin-portal/AccountErasureCleanupControl";

/** 운영 도구의 미디어 저장소 정리(캔버스 AdminOps 첫 줄). 실행 전 취소 우선 확인을 거친다. */
export function MediaCleanupControl() {
  const descriptionId = useId();
  const statusId = useId();
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirmAction();

  function runCleanup() {
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
    <section aria-labelledby="media-cleanup-heading" className={OPERATION_ROW_CLASS}>
      <div className={OPERATION_TEXT_CLASS}>
        <h2 id="media-cleanup-heading" className={OPERATION_TITLE_CLASS}>
          미디어 저장소 정리
        </h2>
        <p id={descriptionId} className={OPERATION_DESCRIPTION_CLASS}>
          만료된 미제출 파일과 실패한 삭제 작업을 최대 10건씩 정리합니다.
        </p>
        <p id={statusId} role="status" aria-live="polite" aria-atomic="true" className={OPERATION_STATUS_CLASS}>
          {status}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className={OPERATION_TRIGGER_CLASS}
        hidden={confirm.isOpen}
        disabled={isPending}
        aria-expanded={confirm.isOpen}
        aria-describedby={`${descriptionId} ${statusId}`}
        onClick={(event) => confirm.request(event.currentTarget)}
      >
        지금 정리
      </Button>
      {confirm.isOpen ? (
        <ConfirmPanel
          confirm={confirm}
          message="삭제 대기 파일을 실제로 정리합니다."
          confirmLabel="정리 확인"
          pendingLabel="정리 중"
          pending={isPending}
          onConfirm={runCleanup}
          className={OPERATION_CONFIRM_CLASS}
        />
      ) : null}
    </section>
  );
}
