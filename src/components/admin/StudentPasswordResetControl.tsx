"use client";

import { useState, useTransition } from "react";
import { AccountStatusRow, ACCOUNT_ACTION_BUTTON_CLASS, OneTimeSecret } from "@/components/admin/OneTimeSecret";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { resetStudentPassword } from "@/lib/actions/students";
import { cn } from "@/lib/utils";

/**
 * 비밀번호를 잊은 학생의 임시 비밀번호 발급. 원문은 발급 직후 한 번만 보여 준다.
 * 발급하면 학생의 현재 비밀번호와 모든 기기의 로그인이 만료되므로 항상 취소 우선 확인을 거친다.
 * 계정 구역에서 상태 줄(가입)과 조작(버튼·확인·발급 값)을 따로 배치할 수 있게 둘을 형제로 그린다.
 */
export function StudentPasswordResetControl({
  studentId,
  changePending = false,
  statusClassName,
  actionsClassName,
}: {
  studentId: string;
  /** 이전에 발급한 임시 비밀번호를 학생이 아직 바꾸지 않았는지. */
  changePending?: boolean;
  statusClassName?: string;
  actionsClassName?: string;
}) {
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [isChangePending, setIsChangePending] = useState(changePending);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const resetConfirm = useConfirmAction();

  const reset = () => {
    setError(null);
    startTransition(async () => {
      try {
        setTemporaryPassword(await resetStudentPassword(studentId));
        setIsChangePending(true);
      } catch {
        setError("임시 비밀번호를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  };

  return (
    <>
      <AccountStatusRow label="가입" className={statusClassName}>
        {isChangePending ? "완료 · 임시 비밀번호를 학생이 아직 바꾸지 않았습니다" : "완료"}
      </AccountStatusRow>

      <div className={cn("flex flex-col", actionsClassName)}>
        <Button
          type="button"
          variant="outline"
          className={ACCOUNT_ACTION_BUTTON_CLASS}
          disabled={isPending}
          aria-expanded={resetConfirm.isOpen}
          onClick={(event) => resetConfirm.request(event.currentTarget)}
        >
          {isPending
            ? "발급 중…"
            : isChangePending
              ? "임시 비밀번호 다시 발급"
              : "임시 비밀번호 발급"}
        </Button>

        {resetConfirm.isOpen ? (
          <ConfirmPanel
            confirm={resetConfirm}
            message="임시 비밀번호를 발급하면 학생의 현재 비밀번호와 모든 기기의 로그인이 즉시 만료됩니다. 학생은 이 비밀번호로 로그인한 뒤 새 비밀번호를 직접 정합니다. 발급할까요?"
            confirmLabel="임시 비밀번호 발급 확인"
            pendingLabel="발급 중…"
            pending={isPending}
            onConfirm={reset}
            className="mt-2"
          />
        ) : null}

        <div aria-live="polite" aria-atomic="true" className="[&:not(:empty)]:mt-3">
          {temporaryPassword ? (
            <OneTimeSecret
              key={temporaryPassword}
              label="임시 비밀번호"
              value={temporaryPassword}
              notice="이 화면을 벗어나면 다시 볼 수 없습니다. 학생에게 직접 전달해 주세요."
            />
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}
