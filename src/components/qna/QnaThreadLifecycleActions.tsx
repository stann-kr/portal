"use client";

import { useEffect, useRef, useState, useTransition, type TransitionStartFunction } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import {
  purgeQnaThread,
  restoreQnaThread,
  trashQnaThread,
} from "@/lib/actions/qna";
import { createCreationOperationId } from "@/lib/creation-operation";
import { useHasPassed } from "@/lib/hooks/useHasPassed";

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
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<{ threadId: string; version: number } | null>(null);
  const snapshot = JSON.stringify([threadId, version, deletedAt, canRestore, canPurge]);
  const needsRefresh = failure?.refreshRequired && failure.snapshot === snapshot;
  // 화면이 열린 채 보관 기간을 넘겨도 버튼이 바뀐다. 실제 영구 삭제 가능 여부는 서버가 다시 확인한다.
  const expired = useHasPassed(deletedAt ? new Date(deletedAt).getTime() + RETENTION_MILLISECONDS : null);
  const actionKind = !deletedAt
    ? "trash"
    : canRestore && !expired
      ? "restore"
      : canPurge && expired
        ? "purge"
        : null;

  useEffect(() => {
    const request = restoreFocusRef.current;
    if (!request) return;
    if (request.threadId !== threadId) {
      restoreFocusRef.current = null;
      return;
    }
    if (isPending || deletedAt || version <= request.version) return;
    restoreFocusRef.current = null;
    const activeElement = document.activeElement;
    if (activeElement === document.body || activeElement === actionButtonRef.current) {
      actionButtonRef.current?.focus({ preventScroll: true });
    }
  }, [deletedAt, isPending, threadId, version]);

  const lifecycleConfirm = useConfirmAction<"trash" | "purge">();

  const run = (kind: "trash" | "restore" | "purge") => {
    if (disabled || isPending || needsRefresh) return;
    const operationKey = JSON.stringify([snapshot, kind]);
    if (operation.current?.key !== operationKey) {
      operation.current = { key: operationKey, id: createCreationOperationId() };
    }
    const operationId = operation.current.id;
    restoreFocusRef.current = kind === "restore" ? { threadId, version } : null;
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
          restoreFocusRef.current = null;
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
        restoreFocusRef.current = null;
        setFailure({ message: "Q&A 상태를 변경하지 못했습니다. 다시 시도해 주세요.", snapshot, refreshRequired: false });
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      {actionKind ? (
        <Button
          ref={actionButtonRef}
          type="button"
          variant={actionKind === "purge" ? "default" : "outline"}
          size="sm"
          className={`gap-1.5 ${actionKind === "purge" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : actionKind === "trash" ? "text-destructive" : ""}`}
          disabled={disabled || isPending || Boolean(needsRefresh)}
          aria-expanded={actionKind === "restore" ? undefined : lifecycleConfirm.isOpen}
          onClick={(event) => {
            if (actionKind === "restore") run("restore");
            else lifecycleConfirm.request(event.currentTarget, actionKind);
          }}
        >
          {actionKind === "restore" ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
          {actionKind === "restore" ? "Q&A 복원" : actionKind === "trash" ? "휴지통 이동" : "영구 삭제"}
        </Button>
      ) : null}
      {lifecycleConfirm.isOpen && lifecycleConfirm.value ? (
        <ConfirmPanel
          confirm={lifecycleConfirm}
          message={lifecycleConfirm.value === "trash"
            ? "이 Q&A를 휴지통으로 이동할까요? 30일 동안 복원할 수 있습니다."
            : "스레드, 모든 답변과 이력을 영구 삭제합니다. 되돌릴 수 없습니다."}
          confirmLabel={lifecycleConfirm.value === "trash" ? "휴지통 이동 확인" : "영구 삭제 확인"}
          pendingLabel={lifecycleConfirm.value === "trash" ? "이동 중..." : "삭제 중..."}
          pending={isPending}
          onConfirm={() => {
            if (lifecycleConfirm.value) run(lifecycleConfirm.value);
          }}
          className="max-w-md"
        />
      ) : null}
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
    </div>
  );
}
