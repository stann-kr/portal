"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { processDueAccountErasures } from "@/lib/actions/accountPrivacy";

// 캔버스 AdminOps·MobileAdminOps 운영 작업 줄: 넓은 화면은 설명과 버튼을 한 줄에, 확인 줄은 그 아래 전체 폭.
// 좁은 화면은 설명·전체 폭 44px 버튼·확인 줄을 세로로 쌓는다.
export const OPERATION_ROW_CLASS =
  "flex flex-col gap-3 border-b border-muted py-5 md:flex-row md:flex-wrap md:items-center md:gap-4 md:px-1 md:py-6";
export const OPERATION_TEXT_CLASS = "flex min-w-0 flex-col gap-1 md:flex-[1_1_360px]";
export const OPERATION_TITLE_CLASS = "text-md font-semibold text-foreground";
export const OPERATION_DESCRIPTION_CLASS = "text-body text-secondary-foreground md:text-ui";
export const OPERATION_STATUS_CLASS = "text-ui text-muted-foreground empty:hidden md:text-xs";
export const OPERATION_TRIGGER_CLASS = "h-11 w-full rounded-touch text-body md:h-8 md:w-auto md:rounded-md md:text-ui";
export const OPERATION_CONFIRM_CLASS = "basis-full rounded-lg p-3.5 md:px-4";

/** 운영 도구의 계정 식별자 정리(캔버스 AdminOps 둘째 줄). 실행 전 취소 우선 확인을 거친다. */
export function AccountErasureCleanupControl() {
  const descriptionId = useId();
  const statusId = useId();
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirmAction();

  const run = () => {
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
    <section aria-labelledby="account-erasure-heading" className={OPERATION_ROW_CLASS}>
      <div className={OPERATION_TEXT_CLASS}>
        <h2 id="account-erasure-heading" className={OPERATION_TITLE_CLASS}>
          계정 식별자 정리
        </h2>
        <p id={descriptionId} className={OPERATION_DESCRIPTION_CLASS}>
          삭제 후 30일이 지난 계정 식별자를 최대 10건씩 익명 값으로 바꿉니다.
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
          message="기한이 지난 계정 식별자를 복구할 수 없게 정리합니다."
          confirmLabel="정리 확인"
          pendingLabel="정리 중"
          pending={isPending}
          onConfirm={run}
          className={OPERATION_CONFIRM_CLASS}
        />
      ) : null}
    </section>
  );
}
