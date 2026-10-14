"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { resetStudentPassword } from "@/lib/actions/students";

/**
 * 비밀번호를 잊은 학생의 임시 비밀번호 발급. 원문은 발급 직후 한 번만 보여 준다.
 * 발급하면 학생의 현재 비밀번호와 모든 기기의 로그인이 만료되므로 항상 취소 우선 확인을 거친다.
 */
export function StudentPasswordResetControl({
  studentId,
  changePending = false,
}: {
  studentId: string;
  /** 이전에 발급한 임시 비밀번호를 학생이 아직 바꾸지 않았는지. */
  changePending?: boolean;
}) {
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [isChangePending, setIsChangePending] = useState(changePending);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const resetConfirm = useConfirmAction();

  const reset = () => {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        setTemporaryPassword(await resetStudentPassword(studentId));
        setIsChangePending(true);
      } catch {
        setError("임시 비밀번호를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    });
  };

  const copy = async () => {
    if (!temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      setError("자동 복사에 실패했습니다. 임시 비밀번호를 직접 선택해 복사해 주세요.");
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-48 flex-1 text-xs text-muted-foreground">
          {isChangePending && !temporaryPassword
            ? "발급한 임시 비밀번호를 학생이 아직 바꾸지 않았습니다. 보안을 위해 다시 표시하지 않습니다."
            : "학생이 비밀번호를 잊었을 때 임시 비밀번호를 발급합니다. 학생은 이 비밀번호로 로그인한 뒤 새 비밀번호를 정해야 포털을 쓸 수 있습니다."}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
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
      </div>

      {resetConfirm.isOpen ? (
        <ConfirmPanel
          confirm={resetConfirm}
          message="임시 비밀번호를 발급하면 학생의 현재 비밀번호와 모든 기기의 로그인이 즉시 만료됩니다. 발급할까요?"
          confirmLabel="임시 비밀번호 발급 확인"
          pendingLabel="발급 중…"
          pending={isPending}
          onConfirm={reset}
        />
      ) : null}

      <div aria-live="polite" aria-atomic="true">
        {temporaryPassword ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive">
              이 화면을 벗어나면 다시 볼 수 없습니다. 학생에게 직접 전달해 주세요.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-sm text-foreground">
                {temporaryPassword}
              </code>
              <Button type="button" size="sm" variant="outline" onClick={copy}>
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? "복사됨" : "복사"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
