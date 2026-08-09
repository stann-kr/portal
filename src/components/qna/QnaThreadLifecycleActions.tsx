"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  purgeQnaThread,
  restoreQnaThread,
  trashQnaThread,
} from "@/lib/actions/qna";
import { createCreationOperationId } from "@/lib/creation-operation";

const RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

export function QnaThreadLifecycleActions({
  threadId,
  version,
  deletedAt,
  canRestore,
  canPurge,
  returnTo,
}: {
  threadId: string;
  version: number;
  deletedAt: string | null;
  canRestore: boolean;
  canPurge: boolean;
  returnTo: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [trashOperationId] = useState(() => createCreationOperationId());
  const [restoreOperationId] = useState(() => createCreationOperationId());
  const [purgeOperationId] = useState(() => createCreationOperationId());
  const expired = deletedAt
    ? new Date(deletedAt).getTime() + RETENTION_MILLISECONDS <= Date.now()
    : false;

  const run = (kind: "trash" | "restore" | "purge") => {
    const confirmed =
      kind === "trash"
        ? confirm("이 Q&A를 휴지통으로 이동하시겠습니까? 30일 동안 복원할 수 있습니다.")
        : kind === "purge"
          ? confirm("스레드, 모든 답변과 이력을 영구 삭제합니다. 되돌릴 수 없습니다.")
          : true;
    if (!confirmed) return;
    startTransition(async () => {
      try {
        const result =
          kind === "trash"
            ? await trashQnaThread(threadId, trashOperationId, version)
            : kind === "restore"
              ? await restoreQnaThread(threadId, restoreOperationId, version)
              : await purgeQnaThread(threadId, purgeOperationId, version);
        if (!result.success) {
          setError(result.error ?? "Q&A 상태를 변경하지 못했습니다.");
          return;
        }
        setError(null);
        if (kind === "restore") router.refresh();
        else router.push(returnTo);
      } catch {
        setError("Q&A 상태를 변경하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {!deletedAt ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-destructive"
          disabled={isPending}
          onClick={() => run("trash")}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          휴지통 이동
        </Button>
      ) : (
        <span className="inline-flex flex-wrap gap-2">
          {canRestore && !expired ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={isPending}
              onClick={() => run("restore")}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Q&amp;A 복원
            </Button>
          ) : null}
          {canPurge && expired ? (
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isPending}
              onClick={() => run("purge")}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              영구 삭제
            </Button>
          ) : null}
        </span>
      )}
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
