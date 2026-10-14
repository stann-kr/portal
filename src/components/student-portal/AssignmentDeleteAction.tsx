"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteMyAssignment } from "@/lib/actions/assignments";

/**
 * 피드백 전 학생 본인 제출의 취소 우선 2단계 삭제.
 * 실패하면 확인 영역을 유지해 이유를 보이고 다시 시도하거나 닫을 수 있게 한다.
 */
export function AssignmentDeleteAction({
  assignmentId,
  onDeleted,
}: {
  assignmentId: string;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(false);

  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    } else if (restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  const close = () => {
    restoreTriggerFocus.current = true;
    setError(null);
    setConfirming(false);
  };

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

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-destructive hover:bg-destructive/10"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        제출 삭제
      </Button>
    );
  }

  return (
    <div role="group" aria-label="제출 삭제 확인" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive-muted p-3">
      <p className="text-sm text-foreground">
        이 믹스셋 제출을 삭제할까요? 강사의 피드백 대기 목록에서도 빠지며 되돌릴 수 없습니다.
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button ref={cancelRef} type="button" variant="outline" size="sm" onClick={close} disabled={isDeleting}>
          취소
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={confirmDelete}
          disabled={isDeleting}
        >
          {isDeleting ? "삭제 중..." : "삭제"}
        </Button>
      </div>
    </div>
  );
}
