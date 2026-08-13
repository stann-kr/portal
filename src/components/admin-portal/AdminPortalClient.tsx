/**
 * @file src/components/admin-portal/AdminPortalClient.tsx
 * @description 어드민 원페이지 포털 오케스트레이터.
 * 5개 섹션(업무함 / 학생 / 일정 / 공지 / 커뮤니티)을 navigation으로 전환.
 */
"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CalendarDays, Inbox, Megaphone, MessagesSquare, Users } from "lucide-react";
import { upsertUnifiedItems, type UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import type { StudentRosterStat } from "@/lib/actions/students";
import type {
  AdminQueueThread,
  PendingFeedbackAssignment,
} from "@/lib/admin-work-queue";
import {
  getExternalUnifiedItemsForStudent,
  getUnifiedItemsForStudent,
} from "@/lib/actions/unifiedItems";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";
import { PortalShell } from "@/components/ui/portal-shell";

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
  version: number;
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

export interface AdminPortalClientProps {
  announcements: Post[];
  initialUnifiedItems: UnifiedItem[];
  students: StudentRosterStat[];
  communityPosts: CommunityPost[];
  adminId: string;
  qnaThreads: AdminQueueThread[];
  pendingAssignments: PendingFeedbackAssignment[];
  referenceTime: Date;
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
  adminId,
  qnaThreads,
  pendingAssignments,
  referenceTime,
}: AdminPortalClientProps) {
  // 캘린더 학생 필터 상태
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    students[0]?.id ?? ""
  );
  const [calendarItems, setCalendarItems] = useState<UnifiedItem[]>(initialUnifiedItems);
  const [calendarLoadedStudentId, setCalendarLoadedStudentId] = useState(
    students[0]?.id ?? "",
  );
  const [isLoadingCalendar, startCalendarTransition] = useTransition();
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const calendarRequestRef = useRef(0);

  const selectStudent = useCallback((studentId: string, historyMode: "push" | "replace" | "none") => {
    if (!students.some((student) => student.id === studentId)) return;
    const requestId = ++calendarRequestRef.current;
    setSelectedStudentId(studentId);
    setCalendarItems([]);
    setCalendarLoadedStudentId("");
    setCalendarError(null);

    if (historyMode !== "none") {
      const url = new URL(window.location.href);
      url.searchParams.set("section", "schedule");
      url.searchParams.set("student", studentId);
      window.history[historyMode === "push" ? "pushState" : "replaceState"](
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }

    startCalendarTransition(async () => {
      try {
        const items = await getUnifiedItemsForStudent(studentId);
        if (calendarRequestRef.current === requestId) {
          setCalendarItems(items);
          setCalendarLoadedStudentId(studentId);
        }
      } catch {
        if (calendarRequestRef.current === requestId) {
          setCalendarError("학생 일정을 불러오지 못했습니다. 다시 시도해 주세요.");
        }
      }
    });
  }, [students]);

  // 내부 일정이 준비된 뒤에만 외부 provider를 별도 요청해 느린 feed가 첫 표시를 막지 않는다.
  useEffect(() => {
    if (!calendarLoadedStudentId || calendarLoadedStudentId !== selectedStudentId) return;
    const requestId = calendarRequestRef.current;
    let cancelled = false;
    void getExternalUnifiedItemsForStudent(calendarLoadedStudentId).then((externalItems) => {
      if (!cancelled && calendarRequestRef.current === requestId) {
        setCalendarItems((current) => upsertUnifiedItems(current, externalItems));
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [calendarLoadedStudentId, selectedStudentId]);

  // URL의 학생 선택을 복원하고, 뒤로/앞으로 이동도 같은 데이터 문맥으로 맞춘다.
  useEffect(() => {
    const restoreStudent = () => {
      const fromUrl = new URLSearchParams(window.location.search).get("student");
      const restored = students.find((student) => student.id === fromUrl)?.id;
      const fallback = students[0]?.id ?? "";
      const nextStudentId = restored ?? fallback;
      if (!nextStudentId) return;

      if (!restored) {
        const url = new URL(window.location.href);
        url.searchParams.set("student", nextStudentId);
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }

      if (nextStudentId !== selectedStudentId) selectStudent(nextStudentId, "none");
    };

    restoreStudent();
    window.addEventListener("popstate", restoreStudent);
    return () => window.removeEventListener("popstate", restoreStudent);
  }, [selectStudent, selectedStudentId, students]);

  const handleStudentChange = (studentId: string) => selectStudent(studentId, "push");
  const selectedStudent = students.find((student) => student.id === selectedStudentId);
  const selectedSpaceLabel = selectedStudent
    ? getUnifiedItemSpaceLabel(selectedStudent)
    : "";

  return (
    <PortalShell
      items={TABS}
      initialItem="work"
      storageKey="adminPortal:section"
      urlParamKey="section"
      ariaLabel="관리자 포털"
      endSlot={<p className="hidden text-xs font-medium text-foreground sm:block">관리자</p>}
    >
      {(activeSection, changeSection) => (
        <>
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
              <AnnouncementSection
                posts={announcements}
                returnTo="/dashboard/admin?section=announcements"
                isAdmin
              />
            </div>
          )}

          {activeSection === "schedule" && (
            <CalendarSection
              unifiedItems={isLoadingCalendar ? [] : calendarItems}
              curriculumModules={[]}
              assignments={[]}
              studentId={selectedStudentId}
              actorId={adminId}
              spaceLabel={selectedSpaceLabel}
              workspaceRole="admin"
              canCreateQna={false}
              loading={isLoadingCalendar}
              loadError={calendarError}
              onRetry={() => selectedStudentId && selectStudent(selectedStudentId, "none")}
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
                    loading={isLoadingCalendar}
                  />
                ) : undefined
              }
            />
          )}

          {activeSection === "community" && (
            <div className="p-6 max-w-4xl mx-auto">
              <CommunitySection
                initialPosts={communityPosts}
                returnTo="/dashboard/admin?section=community"
              />
            </div>
          )}

          {activeSection === "students" && (
            <StudentManagementSection
              students={students}
            />
          )}
        </>
      )}
    </PortalShell>
  );
}
