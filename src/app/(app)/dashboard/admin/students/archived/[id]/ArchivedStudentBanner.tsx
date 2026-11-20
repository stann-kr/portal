"use client";

import { useState, useTransition } from "react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { Button } from "@/components/ui/button";
import { restoreStudent } from "@/lib/actions/students";

const ARCHIVED_LIST_HREF = "/dashboard/admin/students/archived";

/**
 * 보기 전용 상세 위 "수강 종료 · 보기 전용" 줄과 복원(캔버스 UxReview1120Policies ⑩).
 * 복원은 목록과 같은 restoreStudent를 쓰고, 성공하면 다시 고칠 수 있는 학생 상세로 옮긴다.
 */
export function ArchivedStudentBanner({
  studentId,
  name,
  archivedLabel,
}: {
  studentId: string;
  name: string;
  /** 수강 종료한 날("11.18"). 없으면 날짜 없이 쓴다. */
  archivedLabel: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useProgressRouter();

  const restore = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await restoreStudent(studentId);
        if (result.ok) {
          // 복원한 학생 상세로 옮긴다(이 주소는 이제 학생 상세로 보낸다).
          router.replace(`/dashboard/admin/students/${encodeURIComponent(studentId)}`);
        } else {
          setError(result.error);
        }
      } catch {
        setError("복원하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
      }
    });
  };

  return (
    <>
      <MobileTopBar title={name} back={{ href: ARCHIVED_LIST_HREF, label: "수강 종료한 학생으로" }} />
      <div
        role="note"
        className="flex min-h-11 items-center gap-3 rounded-lg bg-sidebar py-1.5 pl-3 pr-1.5 text-body leading-5 text-foreground md:text-ui"
      >
        <span className="min-w-0 flex-1">
          수강 종료 · 보기 전용{" "}
          <span className="text-muted-foreground">
            ·{" "}
            {archivedLabel ? (
              <>
                <span className="font-mono text-xs tabular-nums">{archivedLabel}</span> 종료.{" "}
              </>
            ) : null}
            로그인할 수 없고 고칠 수 없습니다.
          </span>
        </span>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 rounded-touch px-4 text-body md:h-8 md:rounded-md md:px-3 md:text-ui"
          aria-label={`${name} 복원`}
          disabled={isPending}
          onClick={restore}
        >
          {isPending ? "복원 중…" : "복원"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-ui text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
