/**
 * @file src/components/student-portal/CalendarSection.tsx
 * @description 캘린더(학생)·일정(관리자) 화면과 같은 워크스페이스의 커리큘럼·과제 보기.
 * 캘린더는 "월·주·일별·전체" 하나의 세그먼트로 보기를 바꾼다(좁은 화면은 월·일별·전체, MobileSpec).
 * 머리의 "새로 만들기"(관리자는 "레슨 예약")가 만들기를 맡고, 좁은 화면 위쪽 막대의 +는
 * `create=today`·`create=lesson` 주소로 들어와 오늘 빠른 만들기·레슨 예약을 연다.
 */
"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, FileText, Music, NotebookPen, TriangleAlert } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import { getOrSeedColumns } from "@/lib/actions/digging";
import { UnifiedCalendar, type CalendarGridView } from "./UnifiedCalendar";
import { DailyListView } from "./DailyListView";
import { AllItemsView } from "./AllItemsView";
import { CurriculumView } from "./CurriculumView";
import { AssignmentView } from "./AssignmentView";
import { CreateEntryDropdown } from "./CreateEntryDropdown";
import { SlidePanel } from "./SlidePanel";
import { QnaSlideForm } from "@/components/qna/QnaSlideForm";
import { CalendarTypeFilter } from "@/components/calendar/CalendarTypeFilter";
import { CalendarQuickCreate, type CalendarQuickCreateOptions } from "@/components/calendar/CalendarQuickCreate";
import { LessonScheduleDialog } from "@/components/calendar/LessonScheduleDialog";
import { UNIFIED_ITEM_TYPES } from "@/components/ui/unified-item-type";
import type { DiggingColumnType } from "@/db/schema";
import { assertAccountOwnerMayPersist } from "@/lib/account-terminal-lock";
import { createAccountCalendarTabStorageKey } from "@/lib/local-owner-keys";
import { ExternalCalendarConnection } from "./ExternalCalendarConnection";
import type { ExternalCalendarConnectionSummary } from "@/lib/external-calendar";
import { buildNoteCreateHref } from "@/lib/note-create-route";
import { buildAdminStudentDetailHref, buildStudentDiggingBoardHref } from "@/lib/student-space-routes";
import type { WorkspaceLocation } from "@/lib/portal-location";
import {
  resolveCalendarPreset,
  resolveCalendarTab,
  resolveUnifiedItemType,
  type CalendarPreset,
  type CalendarTabValue,
} from "@/lib/calendar-section-contract";
import type { CalendarQuickCreateSelection } from "@/lib/calendar-quick-create";
import { createDaySelection } from "@/lib/unified-item-views";
import { toKstDateInputValue, toKstDateTimeInputValue } from "@/lib/date-input";
import { cn } from "@/lib/utils";

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

/** 세그먼트 칸. 월·주는 같은 캘린더 보기(view=calendar) 안의 달력 모양이다. */
type SegmentValue = "month" | "week" | "daily" | "all";

const SEGMENTS: ReadonlyArray<{ value: SegmentValue; label: string }> = [
  { value: "month", label: "월" },
  { value: "week", label: "주" },
  { value: "daily", label: "일별" },
  { value: "all", label: "전체" },
];

/** 이전 버전 캘린더 내부 탭 localStorage 키 */
const LEGACY_CALENDAR_TAB_STORAGE_KEY = "studentPortal:calendarTab";

/** 같은 일정을 다른 모양으로 보는 보기. 화면 안에서 전환한다. */
const CALENDAR_FAMILY_VIEWS: ReadonlySet<CalendarTabValue> = new Set(["calendar", "daily", "all"]);
const NO_DIGGING_COLUMNS: DiggingColumn[] = [];

/** 좁은 화면(md 미만)은 주 보기를 두지 않는다. 서버 렌더는 넓은 화면으로 본다. */
const NARROW_QUERY = "(max-width: 47.99rem)";
function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function useNarrowViewport(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

/** 요청마다 새 객체라 같은 만들기를 다시 눌러도 주소 정리가 다시 돈다. */
type CreateRequest = { kind: "today" | "lesson" };

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
  /** 어드민에서 주입하는 머리 슬롯(학생 선택). 세그먼트 옆, 좁은 화면은 세그먼트 위에 놓는다. */
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
  // 관리자 일정은 주 보기(AdminSchedule 보드), 학생 캘린더는 월 보기(Calendar 보드)로 시작한다. 이 세션 동안 유지한다.
  const [calendarView, setCalendarView] = useState<CalendarGridView>(
    workspaceRole === "admin" ? "timeGridWeek" : "dayGridMonth",
  );
  const [calendarPreset, setCalendarPreset] = useState<CalendarPreset | null>(initialLocation?.preset ?? null);
  const [allItemsInitialType, setAllItemsInitialType] = useState<UnifiedItemType | null>(initialLocation?.type ?? null);
  // 보기를 바꿔도 남는 유형 필터(월·주·일별 공통).
  const [visibleTypes, setVisibleTypes] = useState<ReadonlySet<UnifiedItemType>>(() => new Set(UNIFIED_ITEM_TYPES));
  // 위쪽 막대의 +로 들어온 만들기 요청. 화면이 그린 뒤 주소에서 지운다.
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null);
  const [todayQuickCreate, setTodayQuickCreate] = useState<CalendarQuickCreateSelection | null>(null);
  const [lessonDialogOpen, setLessonDialogOpen] = useState(false);
  const [lessonDefaultStart, setLessonDefaultStart] = useState<string | undefined>(undefined);
  const narrow = useNarrowViewport();
  const calendarTabStorageKey = createAccountCalendarTabStorageKey(actorId);
  const isStudentWorkspace = actorId === studentId;
  const diggingColumns =
    studentId && isStudentWorkspace && loadedDiggingColumns?.studentId === studentId
      ? loadedDiggingColumns.columns
      : NO_DIGGING_COLUMNS;
  const showSpaceContext = workspaceRole === "admin";
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
  const canQuickCreateToday = hasNoteTarget || isStudentWorkspace || canManageLessons;
  const isCalendarFamily = CALENDAR_FAMILY_VIEWS.has(activeTab);
  // 캘린더 보기의 제목. 과제·커리큘럼 보기는 그 화면이 제목을 그린다.
  const pageTitle = workspaceRole === "admin" ? "일정" : "캘린더";
  // 관리자 머리의 주 버튼은 "레슨 예약" 하나다. 노트는 칸 선택의 빠른 만들기와 더 보기 메뉴가 맡는다.
  const canShowCreateMenu = workspaceRole === "admin"
    ? canManageLessons
    : Boolean(noteCreateHref) || canCreateQna || isStudentWorkspace;
  const segmentValue: SegmentValue = activeTab === "calendar"
    ? calendarView === "timeGridWeek" && !narrow ? "week" : "month"
    : activeTab === "daily" ? "daily" : "all";
  const effectiveCalendarView: CalendarGridView = narrow ? "dayGridMonth" : calendarView;

  // URL이 없을 때만 기기의 직전 탭을 복원하고 history 이동을 구독한다.
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("view");
      const resolvedFromUrl = resolveCalendarTab(fromUrl, workspaceRole);
      const section = params.get("section");
      setCalendarPreset(resolveCalendarPreset(params.get("preset")));
      setAllItemsInitialType(resolveUnifiedItemType(params.get("type")));
      // 위쪽 막대의 +: 이 화면 주소일 때만 받는다. 주소에서 지우는 일은 화면이 그린 뒤에 한다.
      const create = params.get("create");
      if (section === workspaceSection && create === "lesson" && canManageLessons) {
        // 다음 정시로 시작 시각을 채운다(AdminSchedule 빠른 만들기처럼 시작 시각이 보이게).
        const nextHour = new Date(Math.ceil((Date.now() + 1) / 3_600_000) * 3_600_000);
        setLessonDefaultStart(toKstDateTimeInputValue(nextHour));
        setLessonDialogOpen(true);
        setCreateRequest({ kind: create });
      } else if (section === workspaceSection && create === "today" && canQuickCreateToday) {
        setTodayQuickCreate(createDaySelection(toKstDateInputValue(new Date())));
        setCreateRequest({ kind: create });
      }
      if (fromUrl && resolvedFromUrl === fromUrl) {
        setActiveTab(resolvedFromUrl);
        return;
      }

      // 저장된 선택이 없으면 좁은 화면은 일별(MobileCalendar·MobileAdminSchedule), 넓은 화면은 달력으로 시작한다.
      let restored: CalendarTabValue = window.matchMedia(NARROW_QUERY).matches ? "daily" : "calendar";
      try {
        const saved = localStorage.getItem(calendarTabStorageKey)
          ?? localStorage.getItem(LEGACY_CALENDAR_TAB_STORAGE_KEY);
        if (saved) restored = resolveCalendarTab(saved, workspaceRole);
      } catch {
        /* localStorage 접근 불가 환경 무시 */
      }
      setActiveTab(restored);

      if (isActive && (section === "workspace" || section === "schedule")) {
        const url = new URL(window.location.href);
        url.searchParams.set("view", restored);
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    };

    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [calendarTabStorageKey, canManageLessons, canQuickCreateToday, isActive, workspaceRole, workspaceSection]);

  // 만들기 창을 연 뒤 뒤로 가기에 다시 열리지 않게 주소의 create 값을 지운다. 같은 이동에서 관리자 학생이
  // 바뀌어 화면이 새로 마운트되면, 이 정리가 돌기 전에 새 화면이 같은 값을 다시 읽어 연다.
  useEffect(() => {
    if (!createRequest) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("create")) return;
    url.searchParams.delete("create");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [createRequest]);

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

  const handleSegmentChange = (value: string) => {
    if (value === "month" || value === "week") {
      setCalendarView(value === "week" ? "timeGridWeek" : "dayGridMonth");
      handleTabChange("calendar");
      return;
    }
    handleTabChange(value);
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

  const clearPreset = () => {
    setCalendarPreset(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("preset");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const toggleType = (type: UnifiedItemType) => {
    if (calendarPreset) clearPreset();
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const filterProps = {
    visibleTypes,
    onToggle: toggleType,
    presetActive: Boolean(calendarPreset),
    onClearPreset: clearPreset,
  };
  const filters = <CalendarTypeFilter {...filterProps} />;
  const mobileFilters = <CalendarTypeFilter {...filterProps} variant="touch" className="-mr-5 pr-5" />;
  const viewer = { actorId, role: workspaceRole };

  const moreLinks = workspaceRole === "admin" ? [
    noteCreateHref ? { href: noteCreateHref, label: "새 노트", Icon: NotebookPen } : null,
    noteListHref ? { href: noteListHref, label: "노트 목록", Icon: FileText } : null,
    diggingBoardHref ? { href: diggingBoardHref, label: "디깅 보드", Icon: Music } : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null) : [];

  return (
    <div className="flex min-h-full flex-col" aria-busy={loading}>
      <Tabs
        value={segmentValue}
        onValueChange={handleSegmentChange}
        activationMode="manual"
        className={cn("flex flex-col", isCalendarFamily && "pb-8 md:gap-5 md:px-[clamp(20px,3vw,40px)] md:pb-10 md:pt-8")}
      >
        {isCalendarFamily ? (
          <>
            {/* 머리: 제목 · 보기 세그먼트 · (관리자) 학생 선택 · 주 버튼 */}
            <header className="flex flex-wrap items-center justify-between gap-4 px-5 pt-3 md:px-0 md:pt-0">
              <div className={cn("flex w-full min-w-0 flex-col gap-2 md:w-auto md:flex-row md:flex-wrap md:items-center", workspaceRole === "admin" ? "md:gap-4" : "md:gap-x-5 md:gap-y-2")}>
                <h1 className="sr-only text-2xl font-semibold tracking-display md:not-sr-only">{pageTitle}</h1>
                <TabsList aria-label="보기" className="flex w-full md:inline-flex md:w-auto">
                  {SEGMENTS.map(({ value, label }) => (
                    <TabsTrigger key={value} value={value} className={value === "week" ? "hidden md:inline-flex" : undefined}>
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {workspaceRole === "admin" && headerSlot ? <div className="-order-1 min-w-0 md:order-none">{headerSlot}</div> : null}
              </div>

              <div className="hidden items-center gap-1 md:flex">
                {canShowCreateMenu ? (
                  <CreateEntryDropdown
                    studentId={studentId}
                    diggingColumns={diggingColumns}
                    spaceLabel={spaceLabel}
                    open={createMenuOpen}
                    onOpenChange={setCreateMenuOpen}
                    noteCreateHref={workspaceRole === "admin" ? undefined : noteCreateHref}
                    onOpenQnaPanel={() => setQnaSlideOpen(true)}
                    canCreateQna={workspaceRole === "admin" ? false : canCreateQna}
                    canCreateEvent={isStudentWorkspace}
                    canCreateDigging={isStudentWorkspace}
                    canCreateLesson={canManageLessons}
                    onSuccess={(item) => {
                      onAddItem?.(item);
                      setCreateMenuOpen(false);
                    }}
                  />
                ) : null}
                {moreLinks.length > 0 ? (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <Button type="button" variant="ghost" size="icon" aria-label="더 보기">
                        <Ellipsis className="size-4" strokeWidth={1.6} aria-hidden="true" />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content align="end" sideOffset={6} className="portal-menu z-50 w-48 rounded-lg border border-border bg-background p-1 shadow-floating">
                        {moreLinks.map(({ href, label, Icon }) => (
                          <DropdownMenu.Item key={href} asChild>
                            <Link href={href} className="flex h-9 w-full cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-ui text-foreground outline-none data-[highlighted]:bg-muted">
                              <Icon className="size-4 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
                              {label}
                            </Link>
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                ) : null}
              </div>
            </header>

            {loading ? (
              <p className="mx-5 mt-3 text-xs text-muted-foreground md:mx-0 md:mt-0" role="status">학생 일정을 불러오는 중입니다.</p>
            ) : null}
            {loadError ? (
              <div className="mx-5 mt-3 flex min-h-10 flex-wrap items-center justify-between gap-2 rounded-touch bg-destructive-muted py-1.5 pl-3.5 pr-2 md:mx-0 md:mt-0" role="alert">
                <p className="flex items-center gap-2 text-ui text-destructive">
                  <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                  {loadError}
                </p>
                {onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry}>다시 시도</Button> : null}
              </div>
            ) : null}

            {/* 월·주: FullCalendar(넓은 화면)·작은 월 달력(좁은 화면). 날짜와 보기를 지키려고 늘 마운트해 둔다. */}
            <div
              role="tabpanel"
              aria-label={segmentValue === "week" ? "주" : "월"}
              hidden={activeTab !== "calendar"}
            >
              <UnifiedCalendar
                isActive={isActive && activeTab === "calendar"}
                items={unifiedItems}
                view={effectiveCalendarView}
                visibleTypes={visibleTypes}
                preset={calendarPreset}
                filters={activeTab === "calendar" ? filters : null}
                mobileFilters={activeTab === "calendar" ? mobileFilters : null}
                editContext={viewer}
                quickCreate={quickCreate}
                returnTo={workspaceReturnTo}
                showSpaceContext={showSpaceContext}
                canManageEvents={isStudentWorkspace}
                canManageLessons={canManageLessons}
                onItemUpdated={onAddItem}
                onItemRemoved={onRemoveItem}
              />
            </div>

            <TabsContent value="daily" className="m-0">
              <DailyListView
                items={unifiedItems}
                quickCreate={quickCreate}
                visibleTypes={visibleTypes}
                preset={calendarPreset}
                filters={filters}
                mobileFilters={mobileFilters}
                viewer={viewer}
                returnTo={workspaceReturnTo}
                showSpaceContext={showSpaceContext}
                canManageEvents={isStudentWorkspace}
                canManageLessons={canManageLessons}
                onItemUpdated={onAddItem}
                onItemRemoved={onRemoveItem}
              />
            </TabsContent>

            <TabsContent value="all" className="m-0">
              <AllItemsView
                items={unifiedItems}
                viewer={viewer}
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

            {workspaceRole === "student" && externalCalendarConnection ? (
              <ExternalCalendarConnection
                key={`${externalCalendarConnection.connected}:${externalCalendarConnection.provider ?? "NONE"}`}
                connection={externalCalendarConnection}
                className="mx-5 mt-6 md:mx-0 md:mt-0 md:max-w-[640px]"
              />
            ) : null}
          </>
        ) : null}

        {/* 같은 워크스페이스의 커리큘럼·과제. 두 보기가 캔버스(Curriculum·Assignments)의 제목·여백·최대 폭을 직접 그린다. */}
        {workspaceRole === "student" && activeTab === "curriculum" ? (
          <CurriculumView pageHeader initialModules={curriculumModules} />
        ) : null}
        {workspaceRole === "student" && activeTab === "assignments" ? (
          <AssignmentView pageHeader initialAssignments={assignments} />
        ) : null}
      </Tabs>

      {/* 위쪽 막대 +: 오늘 빠른 만들기(학생) */}
      {todayQuickCreate ? (
        <CalendarQuickCreate
          selection={todayQuickCreate}
          anchor={null}
          options={quickCreate}
          onCreated={(item) => onAddItem?.(item)}
          onClose={() => setTodayQuickCreate(null)}
        />
      ) : null}

      {/* 위쪽 막대 +: 레슨 예약(관리자) */}
      {canManageLessons ? (
        <LessonScheduleDialog
          open={lessonDialogOpen}
          onOpenChange={setLessonDialogOpen}
          studentId={studentId}
          spaceLabel={spaceLabel}
          defaultStart={lessonDefaultStart}
          onSuccess={(item) => onAddItem?.(item)}
        />
      ) : null}

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
