/**
 * @file src/components/admin/StudentSwitcher.tsx
 * @description 학생 상세 머리의 학생 고르기(캔버스 UxReview1120Admin ③). 이름을 누르면 학생 목록이 열리고,
 * 고르면 보고 있던 탭 그대로 그 학생 상세로 간다. 그룹 멤버는 그룹 이름 아래에 묶는다.
 * 넓은 화면은 경로의 이름 자리 메뉴, 좁은 화면은 위쪽 막대 이름을 누르면 같은 목록이 아래 시트로 열린다.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StudentOption } from "@/lib/actions/students";
import type { LessonGroupSummary } from "@/lib/lesson-group-rules";
import { buildAdminStudentDetailHref, type StudentDetailTab } from "@/lib/student-space-routes";
import { cn } from "@/lib/utils";

export type StudentSwitcherSection = { key: string; label: string | null; students: StudentOption[] };

/**
 * 고르기 목록의 묶음. 멤버가 2명 이상인 그룹마다 한 묶음, 그 밖의 학생은 "학생" 묶음이다.
 * 그룹이 하나도 없으면 머리 없이 학생만 둔다. 학생 순서는 받은 목록(이름순)을 따른다.
 */
export function buildStudentSwitcherSections(
  students: readonly StudentOption[],
  groups: readonly LessonGroupSummary[],
): StudentSwitcherSection[] {
  const grouped = new Set<string>();
  const sections: StudentSwitcherSection[] = [];
  for (const group of groups) {
    const members = students.filter((student) => group.memberIds.includes(student.id) && !grouped.has(student.id));
    if (members.length < 2) continue;
    for (const member of members) grouped.add(member.id);
    sections.push({ key: `group:${group.id}`, label: group.name, students: members });
  }
  const rest = students.filter((student) => !grouped.has(student.id));
  if (rest.length > 0) sections.push({ key: "students", label: sections.length > 0 ? "학생" : null, students: rest });
  return sections;
}

const SECTION_LABEL_CLASS = "px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground";

function optionClass(current: boolean, touch: boolean) {
  return cn(
    "flex w-full items-center justify-between gap-2 rounded-md px-2 text-left text-foreground outline-none",
    touch ? "h-11 rounded-touch px-3 text-md" : "h-9 text-ui",
    current ? "bg-muted font-medium" : "hover:bg-muted data-[highlighted]:bg-muted focus-visible:bg-muted",
  );
}

type SwitcherProps = {
  studentId: string;
  name: string;
  tab: StudentDetailTab;
  students: readonly StudentOption[];
  groups: readonly LessonGroupSummary[];
};

/** 넓은 화면 경로의 이름 자리. */
export function StudentSwitcherMenu({ studentId, name, tab, students, groups }: SwitcherProps) {
  const sections = buildStudentSwitcherSections(students, groups);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${name}, 다른 학생 고르기`}
          className="-ml-1 inline-flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-ui font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          <span className="min-w-0 truncate">{name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-secondary-foreground" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          style={{ zIndex: "var(--z-dropdown)" }}
          aria-label="학생 고르기"
          className="portal-menu flex max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] w-60 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-background p-1.5 shadow-floating"
        >
          {sections.map((section) => (
            <DropdownMenu.Group key={section.key} className="flex flex-col gap-0.5">
              {section.label ? <DropdownMenu.Label className={SECTION_LABEL_CLASS}>{section.label}</DropdownMenu.Label> : null}
              {section.students.map((student) => {
                const current = student.id === studentId;
                return (
                  <DropdownMenu.Item key={student.id} asChild className={optionClass(current, false)}>
                    <Link href={buildAdminStudentDetailHref(student.id, tab)} aria-current={current ? "page" : undefined}>
                      <span className="min-w-0 truncate">{student.name}</span>
                      {current ? <Check className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" /> : null}
                    </Link>
                  </DropdownMenu.Item>
                );
              })}
            </DropdownMenu.Group>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** 좁은 화면 위쪽 막대의 이름 자리. 누르면 같은 목록이 아래 시트로 열린다. */
export function StudentSwitcherSheet({ studentId, name, tab, students, groups }: SwitcherProps) {
  const [open, setOpen] = useState(false);
  const sections = buildStudentSwitcherSections(students, groups);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${name}, 다른 학생 고르기`}
        onClick={() => setOpen(true)}
        className="inline-flex h-11 min-w-0 items-center gap-1 rounded-touch px-2 text-md font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 truncate">{name}</span>
        <ChevronDown className="size-4 shrink-0 text-secondary-foreground" strokeWidth={1.8} aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>학생 고르기</DialogTitle>
          </DialogHeader>
          <nav aria-label="학생 고르기" className="flex flex-col gap-0.5">
            {sections.map((section) => (
              <div key={section.key} role="group" aria-label={section.label ?? undefined} className="flex flex-col gap-0.5">
                {section.label ? <p aria-hidden="true" className={cn(SECTION_LABEL_CLASS, "px-3")}>{section.label}</p> : null}
                {section.students.map((student) => {
                  const current = student.id === studentId;
                  return (
                    <Link
                      key={student.id}
                      href={buildAdminStudentDetailHref(student.id, tab)}
                      aria-current={current ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(optionClass(current, true), "focus-visible:ring-2 focus-visible:ring-ring")}
                    >
                      <span className="min-w-0 truncate">{student.name}</span>
                      {current ? <Check className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" /> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </DialogContent>
      </Dialog>
    </>
  );
}
