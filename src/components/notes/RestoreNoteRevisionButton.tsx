"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { RECORD_ACTION_CELL, RECORD_FULL_ROW, RESTORE_CONFIRM_CLASS } from "@/components/notes/DocumentRecordFrame";
import { cn } from "@/lib/utils";
import { restorePrivateNoteRevision } from "@/lib/actions/privateNotes";
import { createCreationOperationId } from "@/lib/creation-operation";

export function RestoreNoteRevisionButton({
  noteId,
  baseRevision,
  revisionNumber,
}: {
  noteId: string;
  baseRevision: number;
  revisionNumber: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef<{ key: string; id: string } | null>(null);
  const restoreConfirm = useConfirmAction();
  const isCurrent = revisionNumber === baseRevision;

  const restore = () => {
    if (isPending || isCurrent) return;
    const requestKey = JSON.stringify([noteId, baseRevision, revisionNumber]);
    if (operationRef.current?.key !== requestKey) {
      operationRef.current = { key: requestKey, id: createCreationOperationId() };
    }
    const operationId = operationRef.current.id;
    startTransition(async () => {
      try {
        const result = await restorePrivateNoteRevision(
          noteId,
          operationId,
          baseRevision,
          revisionNumber,
        );
        if (!result.success) {
          setError(result.error ?? "이 버전을 복원하지 못했습니다.");
          return;
        }
        setError(null);
        router.refresh();
      } catch {
        setError("이 버전을 복원하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  // 변경 이력 행(HistoryRecordItem)의 grid에 버튼·확인·오류가 각자 칸을 차지하도록 감싸는 상자를 만들지 않는다.
  return (
    <div className="contents">
      <Button
        type="button"
        variant={isCurrent ? "secondary" : "outline"}
        size="sm"
        className={cn(
          RECORD_ACTION_CELL,
          "aria-expanded:bg-muted max-md:h-11",
          isCurrent && "font-normal text-muted-foreground disabled:opacity-100",
        )}
        disabled={isPending || isCurrent}
        aria-expanded={isCurrent ? undefined : restoreConfirm.isOpen}
        onClick={(event) => restoreConfirm.request(event.currentTarget)}
      >
        {isCurrent ? "현재 버전" : "이 버전 복원"}
      </Button>
      {restoreConfirm.isOpen ? (
        <ConfirmPanel
          confirm={restoreConfirm}
          message={`${revisionNumber}번 버전의 내용을 새 현재 버전으로 복원할까요? 기존 이력은 유지됩니다.`}
          confirmLabel="복원 확인"
          tone="neutral"
          pendingLabel="복원 중..."
          pending={isPending}
          onConfirm={restore}
          className={cn(RECORD_FULL_ROW, RESTORE_CONFIRM_CLASS)}
        />
      ) : null}
      {error ? (
        <p role="alert" className={cn(RECORD_FULL_ROW, "text-xs text-destructive")}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
