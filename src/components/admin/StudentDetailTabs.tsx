/**
 * @file src/components/admin/StudentDetailTabs.tsx
 * @description 학생 상세 페이지 탭 네비게이션 (어드민 전용).
 * URL searchParams(?tab=xxx) 기반으로 탭 활성 상태 표시.
 */
import Link from "next/link";
import { LayoutDashboard, Disc3, BookOpen, HelpCircle, Radio } from "lucide-react";
import {
  buildAdminStudentDetailHref,
  type StudentDetailTab,
} from "@/lib/student-space-routes";

const TABS: { key: StudentDetailTab; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "개요", icon: LayoutDashboard },
  { key: "assignments", label: "과제", icon: Radio },
  { key: "digging",  label: "디깅",  icon: Disc3 },
  { key: "notes",    label: "노트",    icon: BookOpen },
  { key: "qna",      label: "Q&A",      icon: HelpCircle },
];

interface StudentDetailTabsProps {
  studentId: string;
  activeTab: StudentDetailTab;
}

export function StudentDetailTabs({ studentId, activeTab }: StudentDetailTabsProps) {
  return (
    <nav aria-label="학생 상세" className="scroll-row flex gap-1 border-b border-border">
      {TABS.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <Link
            key={key}
            href={buildAdminStudentDetailHref(studentId, key)}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
