"use client";

import { Fragment, useState, useTransition } from "react";
import { ACCOUNT_ACTION_BUTTON_CLASS } from "@/components/admin/OneTimeSecret";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { archiveStudent } from "@/lib/actions/students";
import { clearFlashNotice, setFlashNotice, STUDENT_LIST_NOTICE_KEY } from "@/lib/flash-notice";
import { isNavigationSignal } from "@/lib/navigation-signal";
import { cn } from "@/lib/utils";

/** 확인 안에 적는 예정 레슨(지금 이후). 날짜는 앞에서 최대 3개만 받는다. */
export type StudentArchiveUpcomingLessons = {
  count: number;
  preview: { key: string; label: string; group: boolean }[];
  /** 예정 레슨 가운데 그룹레슨이 하나라도 있는지(미리 보이는 3개 밖 포함). */
  hasGroupLesson: boolean;
};

const PREVIEW_LIMIT = 3;

/**
 * 계정 구역 맨 아래 '수강 종료'(캔버스 StudentArchive ①). 학생 데이터는 지우지 않고 로그인·목록·선택지에서만 뺀다.
 * 되돌릴 수 있는 일이라 확인은 취소 우선이되 빨간 경고색은 쓰지 않는다. 성공하면 서버가 학생 목록으로 보내고,
 * 목록 위에 결과 안내가 한 번 보인다(앱 안 이동에만 쓰는 메모리 안내).
 * 예정 레슨이 남아 있으면 확인 안에 '예정 레슨 N개도 지우기'를 둔다(캔버스 UxReview1120Policies ⑨, 기본 켬).
 */
export function StudentArchiveControl({
  studentId,
  studentName,
  upcomingLessons,
  className,
}: {
  studentId: string;
  /** 확인 문구와 결과 안내에 쓰는 이름(없으면 이메일). */
  studentName: string;
  upcomingLessons?: StudentArchiveUpcomingLessons;
  className?: string;
}) {
  const confirm = useConfirmAction();
  const [error, setError] = useState<string | null>(null);
  const [deleteUpcoming, setDeleteUpcoming] = useState(true);
  const [isPending, startTransition] = useTransition();
  const upcomingCount = upcomingLessons?.count ?? 0;

  const archive = () => {
    setError(null);
    const deleting = upcomingCount > 0 && deleteUpcoming;
    // 이동한 목록이 처음 그릴 때 읽는다. 실패하면 바로 지운다.
    setFlashNotice(STUDENT_LIST_NOTICE_KEY, `${studentName}의 수강을 종료했습니다.${
      upcomingCount === 0
        ? ""
        : deleting
          ? ` 예정 레슨 ${upcomingCount}개를 지웠습니다.`
          : ` 예정 레슨 ${upcomingCount}개는 남겨 두었고 복원하면 다시 보입니다.`
    }`);
    startTransition(async () => {
      try {
        const result = await archiveStudent(studentId, deleting);
        if (result && !result.ok) {
          clearFlashNotice(STUDENT_LIST_NOTICE_KEY);
          setError(result.error);
        }
      } catch (failure) {
        // 성공하면 서버 redirect가 이동 신호로 온다. 그 밖의 예외만 실패로 알린다.
        if (isNavigationSignal(failure)) return;
        clearFlashNotice(STUDENT_LIST_NOTICE_KEY);
        setError("수강을 종료하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
      }
    });
  };

  const preview = upcomingLessons?.preview.slice(0, PREVIEW_LIMIT) ?? [];
  const rest = upcomingCount - preview.length;
  const upcomingDetail = upcomingLessons && upcomingCount > 0 ? (
    <label className="flex items-start gap-2.5 border-t border-border pb-0.5 pt-2.5 text-body leading-5 text-foreground md:text-ui">
      <input
        type="checkbox"
        checked={deleteUpcoming}
        onChange={(event) => setDeleteUpcoming(event.target.checked)}
        disabled={isPending}
        className="mt-[3px] size-3.5 shrink-0 accent-[var(--color-foreground)]"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>예정 레슨 {upcomingCount}개도 지우기</span>
        <span className="text-xs leading-[18px] text-muted-foreground">
          {preview.map((lesson, index) => (
            <Fragment key={lesson.key}>
              {index > 0 ? " · " : null}
              <span className="font-mono tabular-nums">{lesson.label}</span>
              {lesson.group ? " 그룹레슨" : null}
            </Fragment>
          ))}
          {rest > 0 ? ` 외 ${rest}개` : null}. 학생 일정과 구독 캘린더에서도 사라집니다.
          {upcomingLessons.hasGroupLesson ? ` 그룹레슨은 ${studentName} 몫만 지웁니다.` : null}
        </span>
      </span>
    </label>
  ) : null;

  return (
    <div className={cn("flex flex-col gap-2.5 border-t border-muted pt-3 md:gap-2 md:pt-4", className)}>
      <Button
        type="button"
        variant="outline"
        className={ACCOUNT_ACTION_BUTTON_CLASS}
        disabled={isPending}
        aria-expanded={confirm.isOpen}
        onClick={(event) => {
          // 확인을 열 때마다 기본(켬)으로 돌린다.
          setDeleteUpcoming(true);
          confirm.request(event.currentTarget);
        }}
      >
        {isPending ? "수강 종료 중…" : "수강 종료"}
      </Button>

      {confirm.isOpen ? (
        <ConfirmPanel
          confirm={confirm}
          tone="neutral"
          message={
            <>
              {studentName}의 수강을 종료할까요? 모든 기기에서 로그아웃되고 다시 로그인할 수 없습니다.{" "}
              <span className="hidden md:inline">노트·과제·레슨 </span>기록은 지우지 않으며 &apos;수강 종료한 학생&apos;에서 복원할 수 있습니다.
            </>
          }
          detail={upcomingDetail}
          confirmLabel="수강 종료"
          pendingLabel="수강 종료 중…"
          pending={isPending}
          onConfirm={archive}
        />
      ) : (
        <p className="text-xs leading-[18px] text-muted-foreground">
          로그인과 학생 목록·선택지에서 빠집니다. 기록은 남고 언제든 복원할 수 있습니다.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
