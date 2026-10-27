"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type RefObject, type TransitionStartFunction } from "react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import {
  purgeQnaThread,
  restoreQnaThread,
  trashQnaThread,
} from "@/lib/actions/qna";
import { createCreationOperationId } from "@/lib/creation-operation";
import { useHasPassed } from "@/lib/hooks/useHasPassed";

const RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

export type QnaLifecycleKind = "trash" | "restore" | "purge";

export const QNA_LIFECYCLE_LABELS: Record<QnaLifecycleKind, string> = {
  trash: "휴지통 이동",
  restore: "Q&A 복원",
  purge: "영구 삭제",
};

type QnaThreadLifecycleOptions = {
  threadId: string;
  version: number;
  deletedAt: string | null;
  canRestore: boolean;
  canPurge: boolean;
  returnTo: string;
  disabled?: boolean;
  transition?: { isPending: boolean; start: TransitionStartFunction };
};

type QnaThreadLifecycleHookOptions = QnaThreadLifecycleOptions & {
  /** 동작 버튼(복원 뒤 초점이 이어질 곳). 화면에 하나만 붙인다. */
  actionButtonRef: RefObject<HTMLButtonElement | null>;
  /** 동작 버튼이 화면에 없을 때(좁은 화면은 더 보기 메뉴로 연다) 대신 초점을 받을 곳. */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
};

export type QnaThreadLifecycle = {
  /** 지금 가능한 한 가지 동작. 없으면 null. */
  actionKind: QnaLifecycleKind | null;
  triggerDisabled: boolean;
  /** 확인 없이 바로 실행하는 복원이 진행 중이다. */
  restorePending: boolean;
  confirmOpen: boolean;
  /** 복원은 바로 실행하고, 휴지통 이동·영구 삭제는 취소 우선 확인을 연다. trigger는 확인을 닫을 때 초점이 돌아갈 곳이다. */
  request: (trigger: HTMLElement | null) => void;
  /** 확인 영역·실패 안내·최신 상태 확인 버튼. 동작 버튼과 떨어진 본문 자리에 그릴 수 있다. */
  feedback: ReactNode;
};

/**
 * Q&A 스레드의 휴지통 이동·복원·영구 삭제 상태를 한 곳에서 소유한다.
 * 같은 스레드 화면 안에서 버튼(넓은 화면 머리)과 더 보기 메뉴(좁은 화면 위쪽 막대)가
 * 하나의 요청 식별자·실패 상태를 함께 쓰도록 hook으로 연다.
 */
export function useQnaThreadLifecycle({
  threadId,
  version,
  deletedAt,
  canRestore,
  canPurge,
  returnTo,
  disabled = false,
  transition,
  actionButtonRef,
  fallbackFocusRef,
}: QnaThreadLifecycleHookOptions): QnaThreadLifecycle {
  const router = useProgressRouter();
  const [ownPending, startOwnTransition] = useTransition();
  const isPending = transition?.isPending ?? ownPending;
  const startTransition = transition?.start ?? startOwnTransition;
  const [failure, setFailure] = useState<{ message: string; snapshot: string; refreshRequired: boolean } | null>(null);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const restoreFocusRef = useRef<{ threadId: string; version: number } | null>(null);
  const snapshot = JSON.stringify([threadId, version, deletedAt, canRestore, canPurge]);
  const needsRefresh = failure?.refreshRequired && failure.snapshot === snapshot;
  // 화면이 열린 채 보관 기간을 넘겨도 버튼이 바뀐다. 실제 영구 삭제 가능 여부는 서버가 다시 확인한다.
  const expired = useHasPassed(deletedAt ? new Date(deletedAt).getTime() + RETENTION_MILLISECONDS : null);
  const actionKind: QnaLifecycleKind | null = !deletedAt
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
      if (document.activeElement !== actionButtonRef.current) fallbackFocusRef?.current?.focus({ preventScroll: true });
    }
  }, [actionButtonRef, deletedAt, fallbackFocusRef, isPending, threadId, version]);

  const lifecycleConfirm = useConfirmAction<"trash" | "purge">();
  const triggerDisabled = disabled || isPending || Boolean(needsRefresh);

  const run = (kind: QnaLifecycleKind) => {
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

  const request = (trigger: HTMLElement | null) => {
    if (!actionKind || triggerDisabled) return;
    if (actionKind === "restore") run("restore");
    else lifecycleConfirm.request(trigger, actionKind);
  };

  const feedback = (
    <>
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
          className="w-full max-w-md"
        />
      ) : null}
      {failure ? (
        <span role={failure.snapshot === snapshot ? "alert" : "status"} className="text-xs text-muted-foreground">
          {failure.snapshot === snapshot ? failure.message : "최신 상태를 불러왔습니다. 현재 상태를 확인한 뒤 다시 진행해 주세요."}
        </span>
      ) : null}
      {failure?.refreshRequired ? (
        <Button type="button" variant="outline" size="sm" disabled={disabled} pending={isPending} onClick={() => startTransition(() => {
          try {
            router.refresh();
          } catch {
            setFailure({ message: "최신 상태를 불러오지 못했습니다. 다시 시도해 주세요.", snapshot, refreshRequired: true });
          }
        })}>최신 상태 확인</Button>
      ) : null}
    </>
  );

  return {
    actionKind,
    triggerDisabled,
    restorePending: isPending && actionKind === "restore",
    confirmOpen: lifecycleConfirm.isOpen,
    request,
    feedback,
  };
}

/** 휴지통 화면처럼 버튼과 확인 영역을 한 자리에 두는 기본 조합. */
export function QnaThreadLifecycleActions(props: QnaThreadLifecycleOptions) {
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const lifecycle = useQnaThreadLifecycle({ ...props, actionButtonRef });
  const { actionKind } = lifecycle;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      {actionKind ? (
        <Button
          ref={actionButtonRef}
          type="button"
          variant={actionKind === "purge" ? "destructive" : "outline"}
          size="sm"
          className={cn("max-md:h-11", actionKind === "trash" && "text-destructive")}
          disabled={lifecycle.triggerDisabled}
          pending={lifecycle.restorePending}
          aria-expanded={actionKind === "restore" ? undefined : lifecycle.confirmOpen}
          onClick={(event) => lifecycle.request(event.currentTarget)}
        >
          {actionKind === "restore"
            ? <RotateCcw className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
            : <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />}
          {QNA_LIFECYCLE_LABELS[actionKind]}
        </Button>
      ) : null}
      {lifecycle.feedback}
    </div>
  );
}
