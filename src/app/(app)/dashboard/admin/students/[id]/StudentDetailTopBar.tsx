"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CalendarDays, Ellipsis, FilePlay, FilePlus, Pencil } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { buildAdminStudentNotesHref } from "@/components/admin/StudentDetailTabs";
import { isCurriculumVisible } from "@/lib/curriculum-visibility";
import { buildAdminAssignmentComposeHref } from "@/lib/admin-create-links";
import { StudentSwitcherSheet } from "@/components/admin/StudentSwitcher";
import type { StudentOption } from "@/lib/actions/students";
import type { LessonGroupSummary } from "@/lib/lesson-group-rules";
import type { StudentDetailTab } from "@/lib/student-space-routes";

const ITEM_CLASS =
  "flex h-11 w-full cursor-default select-none items-center gap-2.5 rounded-touch px-3 text-md text-foreground outline-none data-[highlighted]:bg-muted";

/**
 * 좁은 화면 학생 상세 위쪽 막대(MobileAdminStudentDetail 보드): 뒤로 "학생 목록으로" · 학생 · 더 보기.
 * 더 보기에는 탭 막대에 없는 이 학생의 바로가기(레슨 캘린더, 새 노트, 과제 내기)를 둔다(넓은 화면은 머리 버튼, 캔버스 AdminUx1123 ②).
 * 다른 학생이 있으면 제목 자리가 학생 이름 버튼이 되고, 누르면 학생 고르기가 아래 시트로 열린다(캔버스 UxReview1120Admin ③).
 */
export function StudentDetailTopBar({
  studentId,
  activeTab,
  returnTo,
  switcher,
}: {
  studentId: string;
  /** `?tab=`이 아닌 주소에서 쓰는 화면(노트 탭)이면 그 탭. 없으면 주소의 탭을 따른다. */
  activeTab?: StudentDetailTab;
  returnTo: string;
  switcher?: { name: string; tab: StudentDetailTab; students: StudentOption[]; groups: LessonGroupSummary[] } | null;
}) {
  const searchParams = useSearchParams();
  const onOverview = (activeTab ?? searchParams?.get("tab") ?? "overview") === "overview";
  const editing = searchParams?.get("edit") === "1";
  const actions = useMemo(() => (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="더 보기"
          className="flex size-11 shrink-0 items-center justify-center rounded-touch text-secondary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          <Ellipsis className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          style={{ zIndex: "var(--z-dropdown)" }}
          className="portal-menu w-56 rounded-lg border border-border bg-background p-1 shadow-floating"
        >
          {onOverview ? (
            <DropdownMenu.Item asChild className={ITEM_CLASS}>
              <Link
                href={`/dashboard/admin/students/${encodeURIComponent(studentId)}?tab=overview${editing ? "" : "&edit=1"}`}
                replace
              >
                <Pencil className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
                {editing ? "편집 완료" : isCurriculumVisible() ? "레슨·커리큘럼 편집" : "레슨 편집"}
              </Link>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item asChild className={ITEM_CLASS}>
            <Link href={`/dashboard/admin?section=schedule&student=${encodeURIComponent(studentId)}`}>
              <CalendarDays className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
              캘린더에서 보기
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={ITEM_CLASS}>
            <Link href={`${buildAdminStudentNotesHref(studentId)}/new?returnTo=${encodeURIComponent(returnTo)}`}>
              <FilePlus className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
              새 노트
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={ITEM_CLASS}>
            <Link href={buildAdminAssignmentComposeHref(studentId)}>
              <FilePlay className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
              과제 내기
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ), [editing, onOverview, returnTo, studentId]);

  const titleSlot = useMemo(
    () => (switcher ? <StudentSwitcherSheet studentId={studentId} {...switcher} /> : undefined),
    [studentId, switcher],
  );

  return (
    <MobileTopBar
      title={switcher?.name ?? "학생"}
      back={{ href: "/dashboard/admin?section=students", label: "학생 목록으로" }}
      actions={actions}
      titleSlot={titleSlot}
    />
  );
}
