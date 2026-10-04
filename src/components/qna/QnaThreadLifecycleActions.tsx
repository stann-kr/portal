"use client";

import { useRef, useState, useTransition, type TransitionStartFunction } from "react";
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
  disabled = false,
  transition,
}: {
  threadId: string;
  version: number;
  deletedAt: string | null;
  canRestore: boolean;
  canPurge: boolean;
  returnTo: string;
  disabled?: boolean;
  transition?: { isPending: boolean; start: TransitionStartFunction };
}) {
  const router = useRouter();
  const [ownPending, startOwnTransition] = useTransition();
  const isPending = transition?.isPending ?? ownPending;
  const startTransition = transition?.start ?? startOwnTransition;
  const [failure, setFailure] = useState<{ message: string; snapshot: string; refreshRequired: boolean } | null>(null);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const snapshot = JSON.stringify([threadId, version, deletedAt, canRestore, canPurge]);
  const needsRefresh = failure?.refreshRequired && failure.snapshot === snapshot;
  const expired = deletedAt
    ? new Date(deletedAt).getTime() + RETENTION_MILLISECONDS <= Date.now()
    : false;

  const run = (kind: "trash" | "restore" | "purge") => {
    if (disabled || isPending || needsRefresh) return;
    const confirmed =
      kind === "trash"
        ? confirm("이 Q&A를 휴지통으로 이동하시겠습니까? 30일 동안 복원할 수 있습니다.")
        : kind === "purge"
          ? confirm("스레드, 모든 답변과 이력을 영구 삭제합니다. 되돌릴 수 없습니다.")
          : true;
    if (!confirmed) return;
    const operationKey = JSON.stringify([snapshot, kind]);
    if (operation.current?.key !== operationKey) {
      operation.current = { key: operationKey, id: createCreationOperationId() };
    }
    const operationId = operation.current.id;
    setFailure(null);
    startTransition(async () => {
      try {
        const result =
          kind === "trash"
            ? await trashQnaThread(threadId, operationId, version)
            : kind === "restore"
              ? await restoreQnaThread(threadId, operationId, version)
              : await purgeQnaThread(threadId, operationId, version);
        if (!result.success) {
          setFailure({
            message: result.error ?? "Q&A 상태를 변경하지 못했습니다.",
            snapshot,
            refreshRequired: ["VERSION_CONFLICT", "TRASHED", "PURGED"].includes(result.conflictKind ?? ""),
          });
          return;
        }
        setFailure(null);
        if (kind === "restore") router.refresh();
        else router.push(returnTo);
      } catch {
        setFailure({ message: "Q&A 상태를 변경하지 못했습니다. 다시 시도해 주세요.", snapshot, refreshRequired: false });
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
          disabled={disabled || isPending || Boolean(needsRefresh)}
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
              disabled={disabled || isPending || Boolean(needsRefresh)}
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
              disabled={disabled || isPending || Boolean(needsRefresh)}
              onClick={() => run("purge")}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              영구 삭제
            </Button>
          ) : null}
        </span>
      )}
      {failure && <span role={failure.snapshot === snapshot ? "alert" : "status"} className="text-xs text-muted-foreground">
        {failure.snapshot === snapshot ? failure.message : "최신 상태를 불러왔습니다. 현재 상태를 확인한 뒤 다시 진행해 주세요."}
      </span>}
      {failure?.refreshRequired && <Button type="button" variant="outline" size="sm" disabled={disabled || isPending} onClick={() => startTransition(() => {
        try {
          router.refresh();
        } catch {
          setFailure({ message: "최신 상태를 불러오지 못했습니다. 다시 시도해 주세요.", snapshot, refreshRequired: true });
        }
      })}>최신 상태 확인</Button>}
    </span>
  );
}
