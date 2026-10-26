/**
 * @file src/components/admin/StudentDetailTabs.tsx
 * @description 학생 상세 탭(AdminStudentDetail 보드): 개요 · 과제 · 디깅 · 노트 · Q&A.
 * 개요·과제·디깅·Q&A는 `?tab=`, 노트는 학생 스페이스 노트 화면(검색·표/목록)이 canonical이다.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  buildAdminStudentDetailHref,
  type StudentDetailTab,
} from "@/lib/student-space-routes";

const TABS: { key: StudentDetailTab; label: string }[] = [
  { key: "overview", label: "개요" },
  { key: "assignments", label: "과제" },
  { key: "digging", label: "디깅" },
  { key: "notes", label: "노트" },
  { key: "qna", label: "Q&A" },
];

export function buildAdminStudentNotesHref(studentId: string): string {
  return `/dashboard/admin/students/${encodeURIComponent(studentId)}/notes`;
}

interface StudentDetailTabsProps {
  studentId: string;
  activeTab: StudentDetailTab;
  className?: string;
}

export function StudentDetailTabs({ studentId, activeTab, className }: StudentDetailTabsProps) {
  return (
    <nav
      aria-label="학생 상세"
      className={cn("scroll-row flex gap-5 overflow-x-auto border-b border-border text-body md:gap-6", className)}
    >
      {TABS.map(({ key, label }) => {
        const isActive = activeTab === key;
        return (
          <Link
            key={key}
            href={key === "notes" ? buildAdminStudentNotesHref(studentId) : buildAdminStudentDetailHref(studentId, key)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-11 shrink-0 items-center whitespace-nowrap rounded-sm transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:h-auto md:py-2",
              isActive
                ? "font-medium text-foreground shadow-[inset_0_-2px_0_var(--color-foreground)]"
                : "text-secondary-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
