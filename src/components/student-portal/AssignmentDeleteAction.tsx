"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmAction, type ConfirmActionState } from "@/components/ui/confirm-action";
import { deleteMyAssignment } from "@/lib/actions/assignments";
import { cn } from "@/lib/utils";

/**
 * 확인 영역. 열리면 취소에 초점을 두고 Esc로 닫는다.
 * 거부되면 영역을 유지해 이유를 보이고 다시 시도하거나 닫을 수 있게 한다(ConfirmPanel은 작업이 끝나면 닫힌다).
 */
function AssignmentDeleteConfirm({
  assignmentId,
  onDeleted,
  onClose,
}: {
  assignmentId: string;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const confirmDelete = () => {
    setError(null);
    startDelete(async () => {
      try {
        const result = await deleteMyAssignment(assignmentId);
        if (result.success) onDeleted();
        else setError(result.error);
      } catch {
        setError("삭제 결과를 확인하지 못했습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div
      role="group"
      aria-label="제출 삭제 확인"
      className="flex flex-col gap-3 self-stretch rounded-lg border border-destructive-border bg-destructive-muted p-3"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isDeleting) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <p className="text-body text-foreground">
        이 믹스셋 제출을 삭제할까요? Stann의 피드백 대기 목록에서도 빠지며 되돌릴 수 없습니다.
      </p>
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button ref={cancelRef} type="button" variant="outline" size="sm" onClick={onClose} disabled={isDeleting}>
          취소
        </Button>
        <Button type="button" variant="destructive-solid" size="sm" onClick={confirmDelete} disabled={isDeleting}>
          {isDeleting ? "삭제 중..." : "삭제"}
        </Button>
      </div>
    </div>
  );
}

/**
 * 피드백 전 학생 본인 제출의 취소 우선 2단계 삭제.
 * 상세 화면의 더 보기 메뉴처럼 다른 곳에서도 확인을 열 수 있게 `confirm` 상태를 상위가 넘길 수 있다.
 * 확인을 닫으면 확인을 연 버튼(이 버튼 또는 메뉴 버튼)으로 초점이 돌아간다.
 */
export function AssignmentDeleteAction({
  assignmentId,
  onDeleted,
  confirm,
  className,
}: {
  assignmentId: string;
  onDeleted: () => void;
  confirm?: ConfirmActionState;
  className?: string;
}) {
  const ownConfirm = useConfirmAction();
  const state = confirm ?? ownConfirm;

  return (
    <div className={cn("flex flex-col items-start gap-3", className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2.5 text-destructive hover:bg-destructive-muted hover:text-destructive"
        aria-expanded={state.isOpen}
        onClick={(event) => state.request(event.currentTarget)}
      >
        <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
        제출 삭제
      </Button>
      {state.isOpen ? (
        <AssignmentDeleteConfirm assignmentId={assignmentId} onDeleted={onDeleted} onClose={state.close} />
      ) : null}
    </div>
  );
}
