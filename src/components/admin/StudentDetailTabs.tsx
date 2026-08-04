/**
 * @file src/components/admin/StudentDetailTabs.tsx
 * @description 학생 상세 페이지 탭 네비게이션 (어드민 전용).
 * URL searchParams(?tab=xxx) 기반으로 탭 활성 상태 표시.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LayoutDashboard, Disc3, BookOpen, HelpCircle } from "lucide-react";

type TabKey = "overview" | "digging" | "notes" | "qna";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "개요", icon: LayoutDashboard },
  { key: "digging",  label: "디깅",  icon: Disc3 },
  { key: "notes",    label: "노트",    icon: BookOpen },
  { key: "qna",      label: "Q&A",      icon: HelpCircle },
];

interface StudentDetailTabsProps {
  studentId: string;
}

export function StudentDetailTabs({ studentId }: StudentDetailTabsProps) {
  const searchParams = useSearchParams();
  const activeTab = (searchParams?.get("tab") ?? "overview") as TabKey;

  return (
    <nav aria-label="학생 상세" className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <Link
            key={key}
            href={`/dashboard/admin/students/${studentId}?tab=${key}`}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
