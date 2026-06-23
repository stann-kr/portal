/**
 * @file src/components/student-portal/StudentPortalClient.tsx
 * @description 학생 원페이지 포털 메인 오케스트레이터.
 * 3개 섹션(공지사항 / 캘린더 / 커뮤니티)을 상단 탭으로 전환.
 * CSS opacity 전환으로 페이드 애니메이션 구현 (framer-motion 미사용).
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Megaphone, CalendarDays, Users } from "lucide-react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

// ── 섹션 컴포넌트
import { AnnouncementSection } from "./AnnouncementSection";
import { CalendarSection } from "./CalendarSection";
import { CommunitySection } from "./CommunitySection";

// ── 타입 ──────────────────────────────────────────────

type Section = "announcements" | "calendar" | "community";

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
}

// ── 탭 정의 ──────────────────────────────────────────

const TABS: { id: Section; label: string; Icon: React.ElementType }[] = [
  { id: "announcements", label: "공지사항", Icon: Megaphone },
  { id: "calendar",      label: "캘린더",   Icon: CalendarDays },
  { id: "community",     label: "커뮤니티", Icon: Users },
];

/** 상단 섹션 탭 영속화 localStorage 키 */
const SECTION_STORAGE_KEY = "studentPortal:section";

/** 저장값이 유효한 Section 인지 검증 */
function isValidSection(value: string | null): value is Section {
  return value != null && TABS.some((t) => t.id === value);
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
}: StudentPortalClientProps) {
  const [activeSection, setActiveSection] = useState<Section>("announcements");
  const [items, setItems] = useState<UnifiedItem[]>(initialUnifiedItems);

  // 마운트 후 localStorage 에서 직전 섹션 복원 (SSR 기본값과 동일 초기값 사용 → 하이드레이션 불일치 방지)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SECTION_STORAGE_KEY);
      if (isValidSection(saved)) setActiveSection(saved);
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

        {/* 우측 — 인사 텍스트 */}
        <div className="ml-auto pr-1 hidden sm:block">
          <p className="text-xs text-muted-foreground">
            안녕하세요,{" "}
            <span className="font-medium text-foreground">{displayName}</span>
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

          {/* 캘린더 섹션: display:none으로 항상 마운트 유지 → 내부 상태(스크롤, 뷰탭) 보존 */}
          <div style={{ display: activeSection === "calendar" ? undefined : "none" }} className="h-full">
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
