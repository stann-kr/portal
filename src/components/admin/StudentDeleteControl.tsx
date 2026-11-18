"use client";

import { useState, useTransition } from "react";
import { ACCOUNT_ACTION_BUTTON_CLASS } from "@/components/admin/OneTimeSecret";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { deleteStudent } from "@/lib/actions/students";
import type { StudentDeletionState } from "@/lib/student-deletion";
import { clearFlashNotice, setFlashNotice, STUDENT_LIST_NOTICE_KEY } from "@/lib/flash-notice";
import { withObjectParticle } from "@/lib/korean-particle";
import { isNavigationSignal } from "@/lib/navigation-signal";
import { cn } from "@/lib/utils";

const HINT_CLASS = "text-xs leading-[18px] text-muted-foreground";

/**
 * 수강 종료 아래 '학생 삭제'(캔버스 StudentArchive 5번). 가입 전이면서 기록·그룹 자리가 없는 학생에게만 버튼을 보이고,
 * 가입 전인데 삭제할 수 없으면 이유를 한 줄로 알린다. 가입한 학생에게는 아무것도 그리지 않는다(수강 종료만).
 * 되돌릴 수 없는 일이라 확인은 취소 우선 + 위험 색이다. 성공하면 서버가 학생 목록으로 보내고 결과 안내가 한 번 보인다.
 */
export function StudentDeleteControl({
  studentId,
  studentName,
  deletion,
  className,
}: {
  studentId: string;
  /** 확인 문구와 결과 안내에 쓰는 이름(없으면 이메일). */
  studentName: string;
  deletion: StudentDeletionState;
  className?: string;
}) {
  const confirm = useConfirmAction();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (deletion.kind === "signed-up") return null;
  if (deletion.kind === "has-records") {
    return (
      <p className={cn(HINT_CLASS, className)}>
        가입 전이지만 레슨·노트·과제 같은 기록이 있어 삭제할 수 없습니다. 기록을 남기려면 수강 종료를 쓰세요.
      </p>
    );
  }
  if (deletion.kind === "in-group") {
    return (
      <p className={cn(HINT_CLASS, className)}>
        가입 전이지만 그룹 &apos;{deletion.groupName}&apos;에 속해 있어 삭제할 수 없습니다. 그룹에서 뺀 뒤 삭제하세요.
      </p>
    );
  }

  const remove = () => {
    setError(null);
    // 이동한 목록이 처음 그릴 때 읽는다. 실패하면 바로 지운다.
    setFlashNotice(STUDENT_LIST_NOTICE_KEY, `${withObjectParticle(studentName)} 삭제했습니다.`);
    startTransition(async () => {
      try {
        const result = await deleteStudent(studentId);
        if (result && !result.ok) {
          clearFlashNotice(STUDENT_LIST_NOTICE_KEY);
          setError(result.error);
        }
      } catch (failure) {
        // 성공하면 서버 redirect가 이동 신호로 온다. 그 밖의 예외만 실패로 알린다.
        if (isNavigationSignal(failure)) return;
        clearFlashNotice(STUDENT_LIST_NOTICE_KEY);
        setError("학생을 삭제하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className={cn("flex flex-col gap-2.5 md:gap-2", className)}>
      <Button
        type="button"
        variant="destructive"
        className={ACCOUNT_ACTION_BUTTON_CLASS}
        disabled={isPending}
        aria-expanded={confirm.isOpen}
        onClick={(event) => confirm.request(event.currentTarget)}
      >
        {isPending ? "삭제 중…" : "학생 삭제"}
      </Button>

      {confirm.isOpen ? (
        <ConfirmPanel
          confirm={confirm}
          tone="destructive"
          message={`${withObjectParticle(studentName)} 삭제할까요? 계정과 가입 링크, 발급한 캘린더 구독 URL과 가이드 공개 설정이 함께 지워지고 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          pendingLabel="삭제 중…"
          pending={isPending}
          onConfirm={remove}
        />
      ) : (
        <p className={HINT_CLASS}>가입 전이고 기록이 없어 삭제할 수 있습니다. 삭제하면 되돌릴 수 없습니다.</p>
      )}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
