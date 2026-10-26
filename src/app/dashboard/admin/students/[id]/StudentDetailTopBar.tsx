"use client";

import { useMemo } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CalendarDays, Ellipsis, FilePlus } from "lucide-react";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { buildAdminStudentNotesHref } from "@/components/admin/StudentDetailTabs";

const ITEM_CLASS =
  "flex h-11 w-full cursor-default select-none items-center gap-2.5 rounded-touch px-3 text-md text-foreground outline-none data-[highlighted]:bg-muted";

/**
 * 좁은 화면 학생 상세 위쪽 막대(MobileAdminStudentDetail 보드): 뒤로 "학생 목록으로" · 학생 · 더 보기.
 * 더 보기에는 탭 막대에 없는 이 학생의 바로가기(레슨 캘린더, 노트 작성)를 둔다.
 */
export function StudentDetailTopBar({ studentId, returnTo }: { studentId: string; returnTo: string }) {
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
          <DropdownMenu.Item asChild className={ITEM_CLASS}>
            <Link href={`/dashboard/admin?section=schedule&student=${encodeURIComponent(studentId)}`}>
              <CalendarDays className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
              캘린더에서 보기
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={ITEM_CLASS}>
            <Link href={`${buildAdminStudentNotesHref(studentId)}/new?returnTo=${encodeURIComponent(returnTo)}`}>
              <FilePlus className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
              노트 작성
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  ), [returnTo, studentId]);

  return (
    <MobileTopBar
      title="학생"
      back={{ href: "/dashboard/admin?section=students", label: "학생 목록으로" }}
      actions={actions}
    />
  );
}
