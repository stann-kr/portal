"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { restorePostRevision } from "@/lib/actions/posts";
import { createCreationOperationId } from "@/lib/creation-operation";

export function RestorePostRevisionButton({
  postId,
  baseRevision,
  revisionNumber,
}: {
  postId: string;
  baseRevision: number;
  revisionNumber: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const requestKey = JSON.stringify([postId, baseRevision, revisionNumber]);
  const operation = useRef<{ key: string; id: string } | null>(null);

  const restoreConfirm = useConfirmAction();

  const restore = () => {
    if (isPending) return;
    if (operation.current?.key !== requestKey) {
      operation.current = { key: requestKey, id: createCreationOperationId() };
    }
    const operationId = operation.current.id;
    startTransition(async () => {
      try {
        const result = await restorePostRevision(
          postId,
          operationId,
          baseRevision,
          revisionNumber,
        );
        if (!result.success) {
          setError(result.error ?? "게시물 버전을 복원하지 못했습니다.");
          return;
        }
        setError(null);
        router.refresh();
      } catch {
        setError("게시물 버전을 복원하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={isPending}
        aria-expanded={restoreConfirm.isOpen}
        onClick={(event) => restoreConfirm.request(event.currentTarget)}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        이 버전 복원
      </Button>
      {restoreConfirm.isOpen ? (
        <ConfirmPanel
          confirm={restoreConfirm}
          message={`${revisionNumber}번 내용을 새 현재 버전으로 복원할까요? 기존 이력은 유지됩니다.`}
          confirmLabel="복원 확인"
          tone="neutral"
          pendingLabel="복원 중..."
          pending={isPending}
          onConfirm={restore}
          className="max-w-sm text-left"
        />
      ) : null}
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
