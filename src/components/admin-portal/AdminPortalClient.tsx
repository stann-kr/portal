/**
 * @file src/components/admin-portal/AdminPortalClient.tsx
 * @description 어드민 원페이지 포털 오케스트레이터.
 * 5개 섹션(업무함 / 학생 / 일정 / 공지 / 커뮤니티)을 navigation으로 전환.
 */
"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import { CalendarDays, Inbox, Megaphone, MessagesSquare, Users } from "lucide-react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import type { StudentRosterStat } from "@/lib/actions/students";
import type {
  AdminQueueThread,
  PendingFeedbackAssignment,
} from "@/lib/admin-work-queue";
import { getUnifiedItemsForStudent } from "@/lib/actions/unifiedItems";
import { PortalNavigation } from "@/components/ui/portal-navigation";

// ── 섹션 컴포넌트
import { AnnouncementSection } from "@/components/student-portal/AnnouncementSection";
import { CalendarSection } from "@/components/student-portal/CalendarSection";
import { CommunitySection } from "@/components/student-portal/CommunitySection";
import { StudentManagementSection } from "./StudentManagementSection";
import { StudentFilterDropdown } from "./StudentFilterDropdown";
import { AdminWorkQueueSection } from "./AdminWorkQueueSection";

// ── 타입 ──────────────────────────────────────────

type Section = "work" | "students" | "schedule" | "announcements" | "community";

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
  qnaThreads: AdminQueueThread[];
  pendingAssignments: PendingFeedbackAssignment[];
  referenceTime: Date;
  fetchStudentDetail: (studentId: string) => Promise<StudentDetailData>;
}

// ── 탭 정의 ──────────────────────────────────────

const TABS: { id: Section; label: string; Icon: React.ElementType }[] = [
  { id: "work", label: "업무함", Icon: Inbox },
  { id: "students", label: "학생", Icon: Users },
  { id: "schedule", label: "일정", Icon: CalendarDays },
  { id: "announcements", label: "공지", Icon: Megaphone },
  { id: "community", label: "커뮤니티", Icon: MessagesSquare },
];

// ── 컴포넌트 ─────────────────────────────────────

export function AdminPortalClient({
  announcements,
  initialUnifiedItems,
  students,
  communityPosts,
  stats,
  adminId,
  qnaThreads,
  pendingAssignments,
  referenceTime,
  fetchStudentDetail,
}: AdminPortalClientProps) {
  const [activeSection, setActiveSection] = useState<Section>("work");
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
    <div className="flex h-full min-h-[100dvh] flex-col">
      <PortalNavigation
        items={TABS}
        activeItem={activeSection}
        onChange={changeSection}
        disabled={fading}
        ariaLabel="관리자 포털"
        endSlot={<p className="hidden text-xs font-medium text-foreground sm:block">관리자</p>}
      />

      {/* 섹션 콘텐츠: fade out 후 slide-in 전환 */}
      <div
        className={`flex-1 overflow-hidden transition-opacity duration-150 ${
          fading ? "opacity-0" : "opacity-100"
        }`}
      >
        <div key={animKey} className="animate-section-in h-full">
          {activeSection === "work" && (
            <AdminWorkQueueSection
              students={students}
              threads={qnaThreads}
              pendingAssignments={pendingAssignments}
              referenceTime={referenceTime}
              onOpenStudents={() => changeSection("students")}
              onOpenSchedule={() => changeSection("schedule")}
            />
          )}

          {activeSection === "announcements" && (
            <div className="p-6 max-w-3xl mx-auto">
              <AnnouncementSection posts={announcements} />
            </div>
          )}

          {activeSection === "schedule" && (
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

          {activeSection === "students" && (
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
