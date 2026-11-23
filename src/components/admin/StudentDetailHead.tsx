/**
 * 학생 상세 머리(캔버스 AdminUx1123 ②): 위치(학생 / 이름 ▾) · 이름·이메일 · "새 노트"·"과제 내기" · 탭.
 * 개요·과제·디깅·Q&A와 노트 탭(학생 스페이스 노트 화면)이 같은 머리를 써서, 노트 탭에서도 학생을 바꾸거나 다른 탭으로 바로 간다.
 * "과제 내기"는 과제 탭을 열고 폼을 펼친다. 낸 뒤에는 과제 탭에 머물러 방금 낸 과제를 본다.
 * 좁은 화면은 위쪽 막대(StudentDetailTopBar)의 ⋯ 메뉴가 "새 노트"·"과제 내기"를 맡아 여기 버튼은 넓은 화면에만 둔다.
 */
import Link from "next/link";
import { FilePlay, FilePlus } from "lucide-react";
import { buildAdminStudentNotesHref, StudentDetailTabs } from "@/components/admin/StudentDetailTabs";
import { StudentSwitcherMenu } from "@/components/admin/StudentSwitcher";
import { buttonClassName } from "@/components/ui/button";
import type { StudentOption } from "@/lib/actions/students";
import { buildAdminAssignmentComposeHref } from "@/lib/admin-create-links";
import type { LessonGroupSummary } from "@/lib/lesson-group-rules";
import type { StudentDetailTab } from "@/lib/student-space-routes";

export function StudentDetailHead({
  studentId,
  name,
  email,
  activeTab,
  returnTo,
  counts,
  switcherStudents,
  switcherGroups,
}: {
  studentId: string;
  name: string;
  email: string;
  activeTab: StudentDetailTab;
  /** 새 노트를 저장하거나 닫으면 돌아올 지금 화면. */
  returnTo: string;
  counts: Partial<Record<StudentDetailTab, number>>;
  switcherStudents: StudentOption[];
  switcherGroups: LessonGroupSummary[];
}) {
  const initial = Array.from(name)[0]?.toUpperCase() ?? "학";
  return (
    <>
      <nav aria-label="위치" className="hidden items-center gap-1.5 text-ui md:flex">
        <Link
          href="/dashboard/admin?section=students"
          className="rounded-sm text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          학생
        </Link>
        <span aria-hidden="true" className="text-faint">/</span>
        {switcherStudents.length > 1 ? (
          <StudentSwitcherMenu studentId={studentId} name={name} tab={activeTab} students={switcherStudents} groups={switcherGroups} />
        ) : (
          <span aria-current="page" className="min-w-0 truncate text-foreground">{name}</span>
        )}
      </nav>

      <header className="flex items-center gap-3.5 pb-4 pt-5 md:gap-4 md:p-0">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-selected text-lg font-semibold text-secondary-foreground"
        >
          {initial}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="break-words text-xl font-semibold tracking-title text-foreground md:text-2xl md:tracking-display">{name}</h1>
          <p className="break-all text-ui text-muted-foreground">{email}</p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <Link
            href={`${buildAdminStudentNotesHref(studentId)}/new?returnTo=${encodeURIComponent(returnTo)}`}
            aria-label={`${name} 새 노트`}
            className={buttonClassName({ variant: "outline" })}
          >
            <FilePlus className="size-3.5" strokeWidth={1.6} aria-hidden="true" />새 노트
          </Link>
          <Link
            href={buildAdminAssignmentComposeHref(studentId)}
            aria-label={`${name} 과제 내기`}
            className={buttonClassName({ variant: "outline" })}
          >
            <FilePlay className="size-3.5" strokeWidth={1.6} aria-hidden="true" />과제 내기
          </Link>
        </div>
      </header>

      <StudentDetailTabs studentId={studentId} activeTab={activeTab} counts={counts} className="-mx-5 px-5 md:mx-0 md:px-0" />
    </>
  );
}
