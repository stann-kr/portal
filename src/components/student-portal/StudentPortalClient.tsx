/**
 * @file src/components/student-portal/StudentPortalClient.tsx
 * @description 학생 원페이지 포털 메인 오케스트레이터.
 * 3개 섹션(오늘 / 워크스페이스 / 커뮤니티)을 상단 navigation으로 전환.
 * CSS opacity 전환으로 페이드 애니메이션 구현 (framer-motion 미사용).
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { CalendarRange, House, Users } from "lucide-react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { PortalNavigation } from "@/components/ui/portal-navigation";

// ── 섹션 컴포넌트
import { CalendarSection } from "./CalendarSection";
import { CommunitySection } from "./CommunitySection";
import { TodaySection } from "./TodaySection";

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

/** 저장값이 유효한 Section 인지 검증 */
function isValidSection(value: string | null): value is Section {
  return value != null && TABS.some((t) => t.id === value);
}

function restoreSection(value: string | null): Section | null {
  if (isValidSection(value)) return value;
  if (value === "announcements") return "today";
  if (value === "calendar") return "workspace";
  return null;
}

// ── 컴포넌트 ─────────────────────────────────────────

export function StudentPortalClient({
  announcements,
  unifiedItems: initialUnifiedItems,
  curriculumModules,
  assignments,
  communityPosts,
  studentId,
  displayName,
  referenceTime,
}: StudentPortalClientProps) {
  const [activeSection, setActiveSection] = useState<Section>("today");
  const [items, setItems] = useState<UnifiedItem[]>(initialUnifiedItems);

  // 마운트 후 localStorage 에서 직전 섹션 복원 (SSR 기본값과 동일 초기값 사용 → 하이드레이션 불일치 방지)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SECTION_STORAGE_KEY);
      const restored = restoreSection(saved);
      if (restored) setActiveSection(restored);
    } catch {
      /* localStorage 접근 불가 환경 무시 */
    }
  }, []);

  // 섹션 변경 시 영속화
  useEffect(() => {
    try {
      localStorage.setItem(SECTION_STORAGE_KEY, activeSection);
    } catch {
      /* localStorage 접근 불가 환경 무시 */
    }
  }, [activeSection]);

  const addItem = useCallback((item: UnifiedItem) => {
    setItems((prev) =>
      [item, ...prev].sort((a, b) => b.date.getTime() - a.date.getTime()),
    );
  }, []);
  const [animKey, setAnimKey] = useState(0);
  const [fading, setFading] = useState(false);
  const nextSection = useRef<Section | null>(null);

  // 페이드 아웃(150ms) → 섹션 교체 → slide-in 애니메이션
  const changeSection = useCallback((next: Section) => {
    if (next === activeSection || fading) return;
    nextSection.current = next;
    setFading(true);
  }, [activeSection, fading]);

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

  return (
    <div className="flex flex-col h-full min-h-screen">
      <PortalNavigation
        items={TABS}
        activeItem={activeSection}
        onChange={changeSection}
        disabled={fading}
        ariaLabel="학생 포털"
        endSlot={
          <p className="hidden text-xs text-muted-foreground sm:block">
            <span className="font-medium text-foreground">{displayName || "학생"}</span>님
          </p>
        }
      />

      {/* 섹션 콘텐츠: fade out 후 slide-in 전환 */}
      <div
        className={`flex-1 overflow-hidden transition-opacity duration-150 ${
          fading ? "opacity-0" : "opacity-100"
        }`}
      >
        <div key={animKey} className="animate-section-in h-full">
          {activeSection === "today" && (
            <TodaySection
              announcements={announcements}
              unifiedItems={items}
              displayName={displayName}
              referenceTime={referenceTime}
              onOpenWorkspace={() => changeSection("workspace")}
            />
          )}

          {/* 캘린더 섹션: display:none으로 항상 마운트 유지 → 내부 상태(스크롤, 뷰탭) 보존 */}
          <div style={{ display: activeSection === "workspace" ? undefined : "none" }} className="h-full">
            <CalendarSection
              unifiedItems={items}
              curriculumModules={curriculumModules}
              assignments={assignments}
              studentId={studentId}
              onAddItem={addItem}
            />
          </div>

          {activeSection === "community" && (
            <div className="p-6 max-w-4xl mx-auto">
              <CommunitySection
                initialPosts={communityPosts}
                studentId={studentId}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
