/**
 * @file src/components/admin-portal/AdminPortalClient.tsx
 * @description 어드민 원페이지 포털 오케스트레이터.
 * 4개 섹션(공지사항 / 캘린더 / 커뮤니티 / 학생 관리)을 탭으로 전환.
 * StudentPortalClient.tsx 패턴 동일 적용.
 */
"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import { Megaphone, CalendarDays, Users, Settings } from "lucide-react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import type { StudentRosterStat } from "@/lib/actions/students";
import { getUnifiedItemsForStudent } from "@/lib/actions/unifiedItems";

// ── 섹션 컴포넌트
import { AnnouncementSection } from "@/components/student-portal/AnnouncementSection";
import { CalendarSection } from "@/components/student-portal/CalendarSection";
import { CommunitySection } from "@/components/student-portal/CommunitySection";
import { StudentManagementSection } from "./StudentManagementSection";
import { StudentFilterDropdown } from "./StudentFilterDropdown";

// ── 타입 ──────────────────────────────────────────

type Section = "announcements" | "calendar" | "community" | "management";

type Post = {
  id: string;
  title: string;
  contentHtml: string;
  isPinned: boolean;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
};

type CommunityPost = {
  id: string;
  title: string;
  contentHtml: string;
  boardType: string;
  isPinned: boolean;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
};

type AdminNote = {
  id: string;
  title: string;
  contentHtml: string;
  createdAt: Date | null;
  authorId: string | null;
  authorName: string | null;
};

type AdminQnaThread = {
  id: string;
  title: string;
  status: string;
  createdAt: Date | null;
};

type AdminModule = {
  id: string;
  weekNum: number | null;
  title: string;
  isCompleted: boolean | null;
};

type StudentDetailData = {
  notes: AdminNote[];
  threads: AdminQnaThread[];
  modules: AdminModule[];
};

type StatCard = {
  label: string;
  value: number;
  sub: string;
  color: string;
};

export interface AdminPortalClientProps {
  announcements: Post[];
  initialUnifiedItems: UnifiedItem[];
  students: StudentRosterStat[];
  communityPosts: CommunityPost[];
  stats: StatCard[];
  adminId: string;
  fetchStudentDetail: (studentId: string) => Promise<StudentDetailData>;
}

// ── 탭 정의 ──────────────────────────────────────

const TABS: { id: Section; label: string; Icon: React.ElementType }[] = [
  { id: "announcements", label: "공지사항",  Icon: Megaphone },
  { id: "calendar",      label: "캘린더",    Icon: CalendarDays },
  { id: "community",     label: "커뮤니티",  Icon: Users },
  { id: "management",    label: "학생 관리", Icon: Settings },
];

// ── 컴포넌트 ─────────────────────────────────────

export function AdminPortalClient({
  announcements,
  initialUnifiedItems,
  students,
  communityPosts,
  stats,
  adminId,
  fetchStudentDetail,
}: AdminPortalClientProps) {
  const [activeSection, setActiveSection] = useState<Section>("announcements");
  const [animKey, setAnimKey] = useState(0);
  const [fading, setFading] = useState(false);
  const nextSection = useRef<Section | null>(null);

  // 캘린더 학생 필터 상태
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    students[0]?.id ?? ""
  );
  const [calendarItems, setCalendarItems] = useState<UnifiedItem[]>(initialUnifiedItems);
  const [isLoadingCalendar, startCalendarTransition] = useTransition();

  // 페이드 아웃(150ms) → 섹션 교체 → slide-in 애니메이션
  const changeSection = useCallback(
    (next: Section) => {
      if (next === activeSection || fading) return;
      nextSection.current = next;
      setFading(true);
    },
    [activeSection, fading]
  );

  useEffect(() => {
    if (!fading || !nextSection.current) return;
    const timer = setTimeout(() => {
      setActiveSection(nextSection.current!);
      setAnimKey((k) => k + 1);
      nextSection.current = null;
      setFading(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [fading]);

  // 학생 필터 변경 시 캘린더 데이터 리패치
  const handleStudentChange = (studentId: string) => {
    setSelectedStudentId(studentId);
    startCalendarTransition(async () => {
      const items = await getUnifiedItemsForStudent(studentId);
      setCalendarItems(items);
    });
  };

  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* 상단 탭 바 */}
      <header className="flex items-center gap-0.5 px-4 pt-4 pb-0 border-b border-border bg-background sticky top-0 z-10">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = activeSection === id;
          return (
            <button
              key={id}
              onClick={() => changeSection(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors ${
                isActive
                  ? "border-foreground text-foreground font-semibold"
                  : "border-transparent text-muted-foreground font-medium hover:text-foreground hover:bg-accent/60"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}

        {/* 우측 — 관리자 표시 */}
        <div className="ml-auto pr-1 hidden sm:block">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">관리자</span>
          </p>
        </div>
      </header>

      {/* 섹션 콘텐츠 — fade out → slide-in 전환 */}
      <div
        className={`flex-1 overflow-hidden transition-opacity duration-150 ${
          fading ? "opacity-0" : "opacity-100"
        }`}
      >
        <div key={animKey} className="animate-section-in h-full">
          {activeSection === "announcements" && (
            <div className="p-6 max-w-3xl mx-auto">
              <AnnouncementSection posts={announcements} />
            </div>
          )}

          {activeSection === "calendar" && (
            <CalendarSection
              unifiedItems={isLoadingCalendar ? [] : calendarItems}
              curriculumModules={[]}
              assignments={[]}
              studentId={selectedStudentId}
              headerSlot={
                students.length > 0 ? (
                  <StudentFilterDropdown
                    students={students.map((s) => ({
                      id: s.id,
                      email: s.email,
                      displayName: s.displayName,
                    }))}
                    selectedStudentId={selectedStudentId}
                    onStudentChange={handleStudentChange}
                  />
                ) : undefined
              }
            />
          )}

          {activeSection === "community" && (
            <div className="p-6 max-w-4xl mx-auto">
              <CommunitySection
                initialPosts={communityPosts}
                studentId={adminId}
              />
            </div>
          )}

          {activeSection === "management" && (
            <StudentManagementSection
              students={students}
              stats={stats}
              fetchStudentDetail={fetchStudentDetail}
            />
          )}
        </div>
      </div>
    </div>
  );
}
