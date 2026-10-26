/**
 * @file src/components/student-portal/CalendarSection.tsx
 * @description 캘린더 섹션의 5개 뷰 (캘린더 / 일별 목록 / 전체 항목 / 커리큘럼 / 과제).
 * 우측 상단 "+" 버튼으로 UnifiedCreateDialog 열기.
 */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import { getOrSeedColumns } from "@/lib/actions/digging";
import { UnifiedCalendar } from "./UnifiedCalendar";
import { DailyListView } from "./DailyListView";
import { AllItemsView } from "./AllItemsView";
import { CurriculumView } from "./CurriculumView";
import { AssignmentView } from "./AssignmentView";
import { CreateEntryDropdown } from "./CreateEntryDropdown";
import { SlidePanel } from "./SlidePanel";
import { QnaSlideForm } from "@/components/qna/QnaSlideForm";
import type { DiggingColumnType } from "@/db/schema";
import { assertAccountOwnerMayPersist } from "@/lib/account-terminal-lock";
import { createAccountCalendarTabStorageKey } from "@/lib/local-owner-keys";
import { ExternalCalendarConnection } from "./ExternalCalendarConnection";
import type { ExternalCalendarConnectionSummary } from "@/lib/external-calendar";
import { buildNoteCreateHref } from "@/lib/note-create-route";
import { buildAdminStudentDetailHref, buildStudentDiggingBoardHref } from "@/lib/student-space-routes";
import type { WorkspaceLocation } from "@/lib/portal-location";
import {
  getCalendarTabs,
  resolveCalendarPreset,
  resolveCalendarTab,
  resolveUnifiedItemType,
  type CalendarPreset,
  type CalendarTabValue,
} from "@/lib/calendar-section-contract";
import type { CalendarQuickCreateOptions } from "@/components/calendar/CalendarQuickCreate";

// ── 타입 ──────────────────────────────────────────

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

type DiggingColumn = {
  id: string;
  name: string;
  columnType: DiggingColumnType;
  options: string | null | undefined;
};

/** 이전 버전 캘린더 내부 탭 localStorage 키 */
const LEGACY_CALENDAR_TAB_STORAGE_KEY = "studentPortal:calendarTab";

/** 같은 일정을 다른 모양으로 보는 보기. 화면 안에서 전환한다. */
const CALENDAR_FAMILY_VIEWS: ReadonlySet<CalendarTabValue> = new Set(["calendar", "daily", "all"]);
const NO_DIGGING_COLUMNS: DiggingColumn[] = [];

interface CalendarSectionProps {
  initialLocation?: WorkspaceLocation;
  unifiedItems: UnifiedItem[];
  curriculumModules: CurriculumModule[];
  assignments: Assignment[];
  studentId: string;
  /** 현재 작성자의 ID. draft를 계정별로 격리한다. */
  actorId: string;
  /** 현재 보고 있는 학생 스페이스의 표시명. */
  spaceLabel: string;
  /** 관리자/학생에 따른 스페이스 문맥 표기. */
  workspaceRole: "admin" | "student";
  externalCalendarConnection?: ExternalCalendarConnectionSummary;
  /** 어드민에서 주입하는 헤더 슬롯 (학생 필터 드롭다운 등) */
  headerSlot?: React.ReactNode;
  /** QnA 생성 성공 시 낙관적 업데이트 콜백 */
  onAddItem?: (item: UnifiedItem) => void;
  /** 학생 본인 일정 삭제 성공 시 즉시 목록에서 제외한다. */
  onRemoveItem?: (item: UnifiedItem) => void;
  /** 학생 전용 Q&A 생성 허용 여부 */
  canCreateQna?: boolean;
  /** 숨김 마운트 상태에서도 section 진입 시 view URL을 canonicalize하기 위한 활성 상태 */
  isActive?: boolean;
  loading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
}

// ── 컴포넌트 ─────────────────────────────────────

export function CalendarSection({
  initialLocation,
  unifiedItems,
  curriculumModules,
  assignments,
  studentId,
  actorId,
  spaceLabel,
  workspaceRole,
  externalCalendarConnection,
  headerSlot,
  onAddItem,
  onRemoveItem,
  canCreateQna = true,
  isActive = true,
  loading = false,
  loadError = null,
  onRetry,
}: CalendarSectionProps) {
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  // 불러온 컬럼은 어느 학생 것인지 함께 둔다. 지금 학생 본인의 스페이스가 아니면 렌더에서 빈 목록으로 본다.
  const [loadedDiggingColumns, setLoadedDiggingColumns] = useState<{
    studentId: string;
    columns: DiggingColumn[];
  } | null>(null);
  const [qnaSlideOpen, setQnaSlideOpen] = useState(false);
  const [qnaFormBusy, setQnaFormBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<CalendarTabValue>(initialLocation?.view ?? "calendar");
  const [calendarPreset, setCalendarPreset] = useState<CalendarPreset | null>(initialLocation?.preset ?? null);
  const [allItemsInitialType, setAllItemsInitialType] = useState<UnifiedItemType | null>(initialLocation?.type ?? null);
  const calendarTabs = getCalendarTabs(workspaceRole);
  const calendarTabStorageKey = createAccountCalendarTabStorageKey(actorId);
  const isStudentWorkspace = actorId === studentId;
  const diggingColumns =
    studentId && isStudentWorkspace && loadedDiggingColumns?.studentId === studentId
      ? loadedDiggingColumns.columns
      : NO_DIGGING_COLUMNS;
  const showSpaceContext = workspaceRole === "admin";
  const workspaceContextLabel = workspaceRole === "student" ? "내 스페이스" : "학생 스페이스";
  const workspaceSection = isStudentWorkspace ? "workspace" : "schedule";
  const workspaceReturnTo = isStudentWorkspace
    ? `/dashboard/student?section=${workspaceSection}&view=${encodeURIComponent(activeTab)}`
    : `/dashboard/admin?section=${workspaceSection}&view=${encodeURIComponent(activeTab)}&student=${encodeURIComponent(studentId)}`;
  const hasNoteTarget = workspaceRole === "student" || studentId.trim().length > 0;
  const noteListHref = hasNoteTarget
    ? workspaceRole === "student"
      ? "/dashboard/student/notes"
      : `/dashboard/admin/students/${studentId}/notes`
    : undefined;
  const noteCreatePathname = workspaceRole === "student"
    ? "/dashboard/student/notes/new"
    : `/dashboard/admin/students/${studentId}/notes/new`;
  const noteReturnFallback = workspaceRole === "student" ? "/dashboard/student" : "/dashboard/admin";
  const noteCreateHref = hasNoteTarget
    ? buildNoteCreateHref({
      pathname: noteCreatePathname,
      returnTo: workspaceReturnTo,
      returnFallback: noteReturnFallback,
    })
    : undefined;
  const diggingBoardHref = workspaceRole === "student"
    ? buildStudentDiggingBoardHref(workspaceReturnTo)
    : hasNoteTarget
      ? buildAdminStudentDetailHref(studentId, "digging")
      : undefined;
  const canManageLessons = workspaceRole === "admin" && studentId.trim().length > 0;
  const viewTabs = calendarTabs.filter(({ value }) => CALENDAR_FAMILY_VIEWS.has(value));
  const isCalendarFamily = CALENDAR_FAMILY_VIEWS.has(activeTab);
  const pageTitle = activeTab === "assignments"
    ? "과제"
    : activeTab === "curriculum"
      ? "커리큘럼"
      : workspaceRole === "admin" ? "일정" : "캘린더";
  const canShowCreateMenu = Boolean(noteCreateHref) || canCreateQna || isStudentWorkspace || canManageLessons;

  // URL이 없을 때만 기기의 직전 탭을 복원하고 history 이동을 구독한다.
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("view");
      const resolvedFromUrl = resolveCalendarTab(fromUrl, workspaceRole);
      setCalendarPreset(resolveCalendarPreset(params.get("preset")));
      setAllItemsInitialType(resolveUnifiedItemType(params.get("type")));
      if (fromUrl && resolvedFromUrl === fromUrl) {
        setActiveTab(resolvedFromUrl);
        return;
      }

      let restored: CalendarTabValue = "calendar";
      try {
        const saved = localStorage.getItem(calendarTabStorageKey)
          ?? localStorage.getItem(LEGACY_CALENDAR_TAB_STORAGE_KEY);
        restored = resolveCalendarTab(saved, workspaceRole);
      } catch {
        /* localStorage 접근 불가 환경 무시 */
      }
      setActiveTab(restored);

      const section = params.get("section");
      if (isActive && (section === "workspace" || section === "schedule")) {
        const url = new URL(window.location.href);
        url.searchParams.set("view", restored);
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    };

    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [calendarTabStorageKey, isActive, workspaceRole]);

  // 탭 변경 시 영속화
  const handleTabChange = (value: string) => {
    const nextTab = resolveCalendarTab(value, workspaceRole);
    if (nextTab === activeTab) return;
    setActiveTab(nextTab);
    try {
      assertAccountOwnerMayPersist(localStorage, actorId);
      localStorage.setItem(calendarTabStorageKey, nextTab);
    } catch {
      /* localStorage 접근 불가 환경 무시 */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("section", workspaceSection);
    url.searchParams.set("view", nextTab);
    if (nextTab !== "calendar") {
      setCalendarPreset(null);
      url.searchParams.delete("preset");
    }
    if (nextTab !== "all") {
      setAllItemsInitialType(null);
      url.searchParams.delete("type");
    }
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  // 마운트 시 1회 digging columns 패치
  useEffect(() => {
    if (!studentId || !isStudentWorkspace) return;
    let cancelled = false;
    type RawCol = Awaited<ReturnType<typeof getOrSeedColumns>>[number];
    getOrSeedColumns(studentId).then((cols) => {
      if (cancelled) return;
      setLoadedDiggingColumns({
        studentId,
        columns: cols.map((c: RawCol) => ({
          id: c.id,
          name: c.name,
          columnType: c.columnType as DiggingColumnType,
          options: c.options,
        })),
      });
    }).catch(() => {
      // 컬럼을 못 불러와도 일정·노트 작성은 계속 쓸 수 있다. 디깅 추가는 링크만 받는다.
      if (!cancelled) setLoadedDiggingColumns({ studentId, columns: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [isStudentWorkspace, studentId]);

  // 캘린더 칸에서 바로 만들기. 노트는 그 날짜의 작성 페이지로, 일정·레슨은 그 자리에서 저장한다.
  const quickCreate: CalendarQuickCreateOptions = {
    buildNoteHref: hasNoteTarget
      ? (dateKey, title) => buildNoteCreateHref({
        pathname: noteCreatePathname,
        defaultDate: dateKey,
        defaultTitle: title,
        returnTo: workspaceReturnTo,
        returnFallback: noteReturnFallback,
      })
      : undefined,
    canCreateEvent: isStudentWorkspace,
    canCreateLesson: canManageLessons,
    studentId,
    spaceLabel,
  };

  const handlePresetChange = (preset: CalendarPreset | null) => {
    setCalendarPreset(preset);
    const url = new URL(window.location.href);
    if (preset) url.searchParams.set("preset", preset);
    else url.searchParams.delete("preset");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <div className="flex min-h-0 flex-col h-full" aria-busy={loading}>
      <Tabs value={activeTab} onValueChange={handleTabChange} activationMode="manual" className="flex min-h-0 flex-col h-full">
        {/* 화면 제목과 보기 전환. 캘린더·과제·커리큘럼 이동은 사이드바가 맡는다. */}
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 sm:px-6 sm:pt-6">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">{pageTitle}</h1>
            {isCalendarFamily ? (
              <TabsList aria-label="보기" className="h-8 gap-0.5 rounded-lg border-0 bg-muted p-0.5">
                {viewTabs.map(({ value, label }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="h-7 rounded-md px-2.5 text-xs text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                  >
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {showSpaceContext && noteListHref ? (
              <Link
                href={noteListHref}
                className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                노트 목록
              </Link>
            ) : null}
            {showSpaceContext && diggingBoardHref ? (
              <Link
                href={diggingBoardHref}
                className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                디깅 보드
              </Link>
            ) : null}
            {canShowCreateMenu ? (
              <CreateEntryDropdown
                studentId={studentId}
                diggingColumns={diggingColumns}
                spaceLabel={spaceLabel}
                open={createMenuOpen}
                onOpenChange={setCreateMenuOpen}
                noteCreateHref={noteCreateHref}
                onOpenQnaPanel={() => setQnaSlideOpen(true)}
                canCreateQna={canCreateQna}
                canCreateEvent={isStudentWorkspace}
                canCreateDigging={isStudentWorkspace}
                canCreateLesson={canManageLessons}
                onSuccess={(item) => {
                  onAddItem?.(item);
                  setCreateMenuOpen(false);
                }}
              />
            ) : null}
          </div>
        </div>
        {showSpaceContext ? (
          <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-y border-border px-4 py-2 text-xs text-muted-foreground sm:px-6">
            <span className="min-w-0 break-words" aria-label={`${workspaceContextLabel}: ${spaceLabel || "선택된 학생 없음"}`}>
              {workspaceContextLabel} · <span className="font-medium text-foreground">{spaceLabel || "선택된 학생 없음"}</span>
            </span>
            {headerSlot ? <div className="min-w-0 max-w-full">{headerSlot}</div> : null}
          </div>
        ) : null}
        {loading ? (
          <p className="shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground sm:px-6" role="status">학생 일정을 불러오는 중입니다.</p>
        ) : null}
        {loadError ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2 sm:px-6" role="alert">
            <p className="text-xs text-destructive">{loadError}</p>
            {onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry}>다시 시도</Button> : null}
          </div>
        ) : null}
        {workspaceRole === "student" && externalCalendarConnection && isCalendarFamily ? (
          <ExternalCalendarConnection
            key={`${externalCalendarConnection.connected}:${externalCalendarConnection.provider ?? "NONE"}`}
            connection={externalCalendarConnection}
          />
        ) : null}

        {/* 탭 콘텐츠 */}
        <div className="min-h-0 flex-1 overflow-auto">
          <TabsContent value="calendar" forceMount hidden={activeTab !== "calendar"} className="m-0 h-full p-3 sm:p-4">
            <div className="h-full min-h-[24rem]">
              <UnifiedCalendar
                isActive={isActive && activeTab === "calendar"}
                items={unifiedItems}
                editContext={{ actorId, role: workspaceRole }}
                quickCreate={quickCreate}
                returnTo={workspaceReturnTo}
                showSpaceContext={showSpaceContext}
                preset={calendarPreset}
                onPresetChange={handlePresetChange}
                canManageEvents={isStudentWorkspace}
                canManageLessons={canManageLessons}
                onItemUpdated={onAddItem}
                onItemRemoved={onRemoveItem}
              />
            </div>
          </TabsContent>

          <TabsContent value="daily" className="m-0 p-4 sm:p-6">
            <DailyListView
              items={unifiedItems}
              returnTo={workspaceReturnTo}
              showSpaceContext={showSpaceContext}
              canManageEvents={isStudentWorkspace}
              canManageLessons={canManageLessons}
              onItemUpdated={onAddItem}
              onItemRemoved={onRemoveItem}
            />
          </TabsContent>

          <TabsContent value="all" className="m-0 p-4 sm:p-6">
            <AllItemsView
              items={unifiedItems}
              returnTo={workspaceReturnTo}
              showSpaceContext={showSpaceContext}
              initialType={allItemsInitialType}
              canManageEvents={isStudentWorkspace}
              canManageLessons={canManageLessons}
              onItemUpdated={onAddItem}
              onItemRemoved={onRemoveItem}
              onInitialTypeCleared={() => {
                setAllItemsInitialType(null);
                const url = new URL(window.location.href);
                url.searchParams.delete("type");
                window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
              }}
            />
          </TabsContent>

          {workspaceRole === "student" ? (
            <>
              <TabsContent value="curriculum" className="m-0 mx-auto max-w-3xl p-4 sm:p-6">
                <CurriculumView initialModules={curriculumModules} />
              </TabsContent>

              <TabsContent value="assignments" className="m-0 mx-auto max-w-3xl p-4 sm:p-6">
                <AssignmentView initialAssignments={assignments} />
              </TabsContent>
            </>
          ) : null}
        </div>
      </Tabs>

      {/* Q&A 작성 슬라이드 패널 */}
      {canCreateQna ? (
        <SlidePanel
          open={qnaSlideOpen}
          onOpenChange={setQnaSlideOpen}
          title="Q&A 질문 작성"
          size="xl"
          dismissible={!qnaFormBusy}
        >
          <QnaSlideForm
            actorId={actorId}
            spaceLabel={spaceLabel}
            returnTo={workspaceReturnTo}
            onSuccess={(item) => {
              onAddItem?.(item);
              setQnaSlideOpen(false);
            }}
            onClose={() => setQnaSlideOpen(false)}
            onBusyChange={setQnaFormBusy}
          />
        </SlidePanel>
      ) : null}
    </div>
  );
}
