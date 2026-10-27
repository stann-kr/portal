/**
 * @file src/components/student-portal/StudentPortalClient.tsx
 * @description 학생 포털 메인 오케스트레이터.
 * 구역(오늘 / 워크스페이스)은 공통 사이드바가 주소로 전환하고(커뮤니티는 /community),
 * PortalShell은 주소 기반 구역 상태만 관리한다.
 */
"use client";

import type { StudentAssignmentSummary } from "@/lib/assignment-summary";
import type { AssignmentTaskItem } from "@/lib/actions/assignmentTasks";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  upsertUnifiedItem,
  upsertUnifiedItems,
  getUnifiedItemKey,
  type UnifiedItem,
} from "@/lib/utils/unifiedItemUtils";
import { useRouter } from "next/navigation";
import { syncAndGetExternalItems } from "@/lib/actions/calendarSync";
import { PortalShell } from "@/components/ui/portal-shell";

// ── 섹션 컴포넌트
import { CalendarSection } from "./CalendarSection";
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


export interface StudentPortalClientProps {
  initialLocation?: PortalLocation<"student">;
  announcements: Post[];
  unifiedItems: UnifiedItem[];
  curriculumModules: CurriculumModule[];
  assignments: StudentAssignmentSummary[];
  /** 관리자가 낸 받은 과제(정기 과제 회차 포함) */
  assignmentTasks?: AssignmentTaskItem[];
  studentId: string;
  displayName: string;
  spaceLabel: string;
  externalCalendarConnection: ExternalCalendarConnectionSummary;
  referenceTime: Date;
}

// ── 구역 정의 ──────────────────────────────────────────

/** 사이드바가 이동을 맡고, 여기서는 주소로 열 수 있는 구역만 정한다. */
const SECTIONS: readonly { id: Section }[] = [
  { id: "today" },
  { id: "workspace" },
];

/** 마지막으로 연 구역을 기억하는 localStorage 키 */
const SECTION_STORAGE_KEY = "studentPortal:section";
/** 창 복귀 시 외부 캘린더 재동기화 최소 간격(서버 조회 동기화 throttle과 같다). */
const EXTERNAL_RESYNC_MIN_INTERVAL_MS = 60_000;

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
  assignmentTasks = [],
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
    externalItems,
  ).filter((item) => !removedKeys.has(getUnifiedItemKey(item))), [createdItems, externalItems, initialUnifiedItems, removedKeys, serverItemKeys]);

  // Retire confirmed additions so a later server deletion cannot resurrect them.
  // 서버 목록이 바뀐 렌더에서 바로 정리한다(이전 서버 목록과 비교).
  const [reconciledServerItemKeys, setReconciledServerItemKeys] = useState(serverItemKeys);
  if (reconciledServerItemKeys !== serverItemKeys) {
    setReconciledServerItemKeys(serverItemKeys);
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
  }

  const addItem = useCallback((item: UnifiedItem) => {
    setCreatedItems((prev) => upsertUnifiedItem(prev, item));
  }, []);

  const removeItem = useCallback((item: UnifiedItem) => {
    const key = getUnifiedItemKey(item);
    setCreatedItems((prev) => prev.filter((candidate) => getUnifiedItemKey(candidate) !== key));
    setRemovedKeys((prev) => new Set(prev).add(key));
  }, []);

  // 내부 일정은 RSC에서 먼저 표시하고 외부 provider는 hydration 뒤 fail-soft로 병합한다.
  // iCal 연결이 끊기면 렌더 중 바로 외부 일정을 비우고, 아래 effect가 남은 동기화 항목을 다시 받는다.
  const [externalConnected, setExternalConnected] = useState(externalCalendarConnection.connected);
  if (externalConnected !== externalCalendarConnection.connected) {
    setExternalConnected(externalCalendarConnection.connected);
    if (!externalCalendarConnection.connected) setExternalItems([]);
  }

  // iCal 구독이 없어도 관리자가 Google·iCloud 캘린더를 매핑했을 수 있으므로 항상 부른다(설정이 없으면 바로 끝난다).
  // 동기화가 포털 레슨·일정을 바꿨으면 서버 목록을 다시 받는다.
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  // 창으로 돌아오면(focus·visible) 외부 변경을 다시 받는다. 서버 throttle(60초)에 맞춰 client도 60초에 한 번만 부른다.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let lastStartedAt = 0;
    const run = () => {
      if (inFlight) return;
      inFlight = true;
      lastStartedAt = Date.now();
      void syncAndGetExternalItems({}).then((result) => {
        if (cancelled) return;
        setExternalItems(result.items);
        if (result.localChanged) routerRef.current.refresh();
      }).catch(() => undefined).finally(() => {
        inFlight = false;
      });
    };
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastStartedAt < EXTERNAL_RESYNC_MIN_INTERVAL_MS) return;
      run();
    };
    run();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [externalCalendarConnection.connected, externalCalendarConnection.provider]);

  return (
    <PortalShell
      items={SECTIONS}
      initialItem={initialLocation?.section ?? "today"}
      storageKey={SECTION_STORAGE_KEY}
      storageAliases={SECTION_ALIASES}
      urlParamKey="section"
      ariaLabel="학생 포털"
    >
      {(activeSection) => (
        <>
          {activeSection === "today" && (
            <TodaySection
              announcements={announcements}
              unifiedItems={items}
              displayName={displayName}
              referenceTime={referenceTime}
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
              assignmentTasks={assignmentTasks}
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
        </>
      )}
    </PortalShell>
  );
}
