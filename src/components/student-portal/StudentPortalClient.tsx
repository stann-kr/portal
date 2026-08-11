/**
 * @file src/components/student-portal/StudentPortalClient.tsx
 * @description 학생 원페이지 포털 메인 오케스트레이터.
 * 3개 섹션(오늘 / 워크스페이스 / 커뮤니티)을 상단 navigation으로 전환.
 * 공통 PortalShell로 navigation과 section 상태를 관리.
 */
"use client";

import { useState, useCallback } from "react";
import { CalendarRange, House, Users } from "lucide-react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { PortalShell } from "@/components/ui/portal-shell";

// ── 섹션 컴포넌트
import { CalendarSection } from "./CalendarSection";
import { CommunitySection } from "./CommunitySection";
import { TodaySection } from "./TodaySection";
import type { ExternalCalendarConnectionSummary } from "@/lib/external-calendar";

// ── 타입 ──────────────────────────────────────────────

type Section = "today" | "workspace" | "community";

type Post = {
  id: string;
  title: string;
  contentHtml: string;
  isPinned: boolean;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
};

type CurriculumModule = {
  id: string;
  weekNum: number;
  title: string;
  description: string | null;
  isCompleted: boolean;
};

type Assignment = {
  id: string;
  mediaUrl: string;
  submittedAt: Date | null;
  feedbackCount: number;
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

export interface StudentPortalClientProps {
  announcements: Post[];
  unifiedItems: UnifiedItem[];
  curriculumModules: CurriculumModule[];
  assignments: Assignment[];
  communityPosts: CommunityPost[];
  studentId: string;
  displayName: string;
  spaceLabel: string;
  externalCalendarConnection: ExternalCalendarConnectionSummary;
  referenceTime: Date;
}

// ── 탭 정의 ──────────────────────────────────────────

const TABS: { id: Section; label: string; Icon: React.ElementType }[] = [
  { id: "today", label: "오늘", Icon: House },
  { id: "workspace", label: "워크스페이스", Icon: CalendarRange },
  { id: "community", label: "커뮤니티", Icon: Users },
];

/** 상단 섹션 탭 영속화 localStorage 키 */
const SECTION_STORAGE_KEY = "studentPortal:section";

const SECTION_ALIASES: Readonly<Record<string, Section>> = {
  announcements: "today",
  calendar: "workspace",
};

// ── 컴포넌트 ─────────────────────────────────────────

export function StudentPortalClient({
  announcements,
  unifiedItems: initialUnifiedItems,
  curriculumModules,
  assignments,
  communityPosts,
  studentId,
  displayName,
  spaceLabel,
  externalCalendarConnection,
  referenceTime,
}: StudentPortalClientProps) {
  const [items, setItems] = useState<UnifiedItem[]>(initialUnifiedItems);

  const addItem = useCallback((item: UnifiedItem) => {
    setItems((prev) =>
      [item, ...prev].sort((a, b) => b.date.getTime() - a.date.getTime()),
    );
  }, []);
  return (
    <PortalShell
      items={TABS}
      initialItem="today"
      storageKey={SECTION_STORAGE_KEY}
      storageAliases={SECTION_ALIASES}
      urlParamKey="section"
      ariaLabel="학생 포털"
      endSlot={
        <p className="hidden text-xs text-muted-foreground sm:block">
          <span className="font-medium text-foreground">{displayName || "학생"}</span>님
        </p>
      }
    >
      {(activeSection, changeSection) => (
        <>
          {activeSection === "today" && (
            <TodaySection
              announcements={announcements}
              unifiedItems={items}
              displayName={displayName}
              referenceTime={referenceTime}
              onOpenWorkspace={() => changeSection("workspace")}
            />
          )}

          <div
            hidden={activeSection !== "workspace"}
            className="h-full"
          >
            <CalendarSection
              unifiedItems={items}
              curriculumModules={curriculumModules}
              assignments={assignments}
              studentId={studentId}
              actorId={studentId}
              spaceLabel={spaceLabel}
              workspaceRole="student"
              externalCalendarConnection={externalCalendarConnection}
              isActive={activeSection === "workspace"}
              onAddItem={addItem}
            />
          </div>

          {activeSection === "community" && (
            <div className="mx-auto max-w-4xl p-4 sm:p-6">
              <CommunitySection
                initialPosts={communityPosts}
                returnTo="/dashboard/student?section=community"
              />
            </div>
          )}
        </>
      )}
    </PortalShell>
  );
}
