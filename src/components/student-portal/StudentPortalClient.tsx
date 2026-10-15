/**
 * @file src/components/student-portal/StudentPortalClient.tsx
 * @description 학생 원페이지 포털 메인 오케스트레이터.
 * 3개 섹션(오늘 / 워크스페이스 / 커뮤니티)을 상단 navigation으로 전환.
 * 공통 PortalShell로 navigation과 section 상태를 관리.
 */
"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { CalendarRange, House, Users } from "lucide-react";
import {
  upsertUnifiedItem,
  upsertUnifiedItems,
  getUnifiedItemKey,
  type UnifiedItem,
} from "@/lib/utils/unifiedItemUtils";
import { getExternalUnifiedItems } from "@/lib/actions/unifiedItems";
import { PortalShell } from "@/components/ui/portal-shell";

// ── 섹션 컴포넌트
import { CalendarSection } from "./CalendarSection";
import { CommunitySection } from "./CommunitySection";
import { TodaySection } from "./TodaySection";
import type { ExternalCalendarConnectionSummary } from "@/lib/external-calendar";
import type { PortalLocation, PortalSection } from "@/lib/portal-location";

// ── 타입 ──────────────────────────────────────────────

type Section = PortalSection<"student">;

type Post = {
  id: string;
  title: string;
  isPinned: boolean;
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
  boardType: string;
  isPinned: boolean;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
};

export interface StudentPortalClientProps {
  initialLocation?: PortalLocation<"student">;
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
  initialLocation,
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
  const [createdItems, setCreatedItems] = useState<UnifiedItem[]>([]);
  const [externalItems, setExternalItems] = useState<UnifiedItem[]>([]);
  const [removedKeys, setRemovedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const serverItemKeys = useMemo(() => new Set(initialUnifiedItems.map(getUnifiedItemKey)), [initialUnifiedItems]);
  const items = useMemo(() => upsertUnifiedItems(
    upsertUnifiedItems(initialUnifiedItems, createdItems.filter((item) => !serverItemKeys.has(getUnifiedItemKey(item)))),
    externalCalendarConnection.connected ? externalItems : [],
  ).filter((item) => !removedKeys.has(getUnifiedItemKey(item))), [createdItems, externalCalendarConnection.connected, externalItems, initialUnifiedItems, removedKeys, serverItemKeys]);

  // Retire confirmed additions so a later server deletion cannot resurrect them.
  useEffect(() => {
    setCreatedItems((current) => {
      const remaining = current.filter((item) => !serverItemKeys.has(getUnifiedItemKey(item)));
      return remaining.length === current.length ? current : remaining;
    });
    // 서버 목록에서 사라진 삭제 항목은 더 숨길 필요가 없다.
    setRemovedKeys((current) => {
      if (current.size === 0) return current;
      const remaining = new Set([...current].filter((key) => serverItemKeys.has(key)));
      return remaining.size === current.size ? current : remaining;
    });
  }, [serverItemKeys]);

  const addItem = useCallback((item: UnifiedItem) => {
    setCreatedItems((prev) => upsertUnifiedItem(prev, item));
  }, []);

  const removeItem = useCallback((item: UnifiedItem) => {
    const key = getUnifiedItemKey(item);
    setCreatedItems((prev) => prev.filter((candidate) => getUnifiedItemKey(candidate) !== key));
    setRemovedKeys((prev) => new Set(prev).add(key));
  }, []);

  // 내부 일정은 RSC에서 먼저 표시하고 외부 provider는 hydration 뒤 fail-soft로 병합한다.
  useEffect(() => {
    if (!externalCalendarConnection.connected) {
      setExternalItems([]);
      return;
    }
    let cancelled = false;
    void getExternalUnifiedItems().then((loadedItems) => {
      if (!cancelled) {
        setExternalItems(loadedItems);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [externalCalendarConnection.connected, externalCalendarConnection.provider]);

  return (
    <PortalShell
      items={TABS}
      initialItem={initialLocation?.section ?? "today"}
      storageKey={SECTION_STORAGE_KEY}
      storageAliases={SECTION_ALIASES}
      urlParamKey="section"
      ariaLabel="학생 포털"
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
              initialLocation={initialLocation}
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
              onRemoveItem={removeItem}
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
