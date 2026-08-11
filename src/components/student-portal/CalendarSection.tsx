/**
 * @file src/components/student-portal/CalendarSection.tsx
 * @description 캘린더 섹션의 5개 뷰 (캘린더 / 일별 목록 / 전체 항목 / 커리큘럼 / 과제).
 * 우측 상단 "+" 버튼으로 UnifiedCreateDialog 열기.
 */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CalendarDays, List, Grid3x3, BookOpen, FileVideo } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
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

/** 유효한 내부 탭 값 */
const CALENDAR_TAB_VALUES = ["calendar", "daily", "all", "curriculum", "assignments"] as const;

interface CalendarSectionProps {
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
  /** 학생 전용 Q&A 생성 허용 여부 */
  canCreateQna?: boolean;
  /** 숨김 마운트 상태에서도 section 진입 시 view URL을 canonicalize하기 위한 활성 상태 */
  isActive?: boolean;
}

// ── 컴포넌트 ─────────────────────────────────────

export function CalendarSection({
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
  canCreateQna = true,
  isActive = true,
}: CalendarSectionProps) {
  const [createDefaultDate, setCreateDefaultDate] = useState<string | undefined>(undefined);
  const [diggingColumns, setDiggingColumns] = useState<DiggingColumn[]>([]);
  const [qnaSlideOpen, setQnaSlideOpen] = useState(false);
  const [qnaFormBusy, setQnaFormBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("calendar");
  const calendarTabStorageKey = createAccountCalendarTabStorageKey(actorId);
  const isStudentWorkspace = actorId === studentId;
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
  const noteCreateHref = hasNoteTarget
    ? buildNoteCreateHref({
      pathname: workspaceRole === "student"
        ? "/dashboard/student/notes/new"
        : `/dashboard/admin/students/${studentId}/notes/new`,
      defaultDate: createDefaultDate,
      returnTo: workspaceReturnTo,
      returnFallback: workspaceRole === "student" ? "/dashboard/student" : "/dashboard/admin",
    })
    : undefined;
  const canShowCreateMenu = Boolean(noteCreateHref) || canCreateQna || isStudentWorkspace;

  // 마운트 후 직전 내부 탭 복원 (SSR 기본값과 동일 초기값 → 하이드레이션 불일치 방지)
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("view");
      if (fromUrl && (CALENDAR_TAB_VALUES as readonly string[]).includes(fromUrl)) {
        setActiveTab(fromUrl);
        return;
      }

      let restored = "calendar";
      try {
        const saved = localStorage.getItem(calendarTabStorageKey)
          ?? localStorage.getItem(LEGACY_CALENDAR_TAB_STORAGE_KEY);
        if (saved && (CALENDAR_TAB_VALUES as readonly string[]).includes(saved)) {
          restored = saved;
        }
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
  }, [calendarTabStorageKey, isActive]);

  // 탭 변경 시 영속화
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    try {
      assertAccountOwnerMayPersist(localStorage, actorId);
      localStorage.setItem(calendarTabStorageKey, value);
    } catch {
      /* localStorage 접근 불가 환경 무시 */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("section", workspaceSection);
    url.searchParams.set("view", value);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  // 마운트 시 1회 digging columns 패치
  useEffect(() => {
    if (!studentId || !isStudentWorkspace) {
      setDiggingColumns([]);
      return;
    }
    let cancelled = false;
    type RawCol = Awaited<ReturnType<typeof getOrSeedColumns>>[number];
    getOrSeedColumns(studentId).then((cols) => {
      if (cancelled) return;
      setDiggingColumns(
        cols.map((c: RawCol) => ({
          id: c.id,
          name: c.name,
          columnType: c.columnType as DiggingColumnType,
          options: c.options,
        }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [isStudentWorkspace, studentId]);

  // 날짜 클릭 시 기본 날짜 설정
  const handleCreateRequest = (date: string) => {
    setCreateDefaultDate(date);
  };

  return (
    <div className="flex flex-col h-full">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        {/* 탭 헤더 */}
        <div className="flex flex-shrink-0 flex-col gap-2 border-b border-border px-3 pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pt-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            <TabsList className="h-9 shrink-0 gap-0 border-b-0 bg-transparent p-0">
              <TabsTrigger
                value="calendar"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                캘린더
              </TabsTrigger>
              <TabsTrigger
                value="daily"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <List className="w-3.5 h-3.5" />
                일별 목록
              </TabsTrigger>
              <TabsTrigger
                value="all"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <Grid3x3 className="w-3.5 h-3.5" />
                전체 항목
              </TabsTrigger>
              <TabsTrigger
                value="curriculum"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <BookOpen className="w-3.5 h-3.5" />
                커리큘럼
              </TabsTrigger>
              <TabsTrigger
                value="assignments"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <FileVideo className="w-3.5 h-3.5" />
                과제
              </TabsTrigger>
            </TabsList>

            {/* 어드민 학생 필터 슬롯 */}
            {headerSlot && (
              <div className="ml-2 flex-shrink-0">{headerSlot}</div>
            )}
          </div>

          {/* 생성 드롭다운 */}
          <div className="flex items-center justify-end gap-2 pb-2 sm:pb-0">
            {noteListHref ? (
              <Link
                href={noteListHref}
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                노트 목록
              </Link>
            ) : null}
            {canShowCreateMenu ? (
              <CreateEntryDropdown
                studentId={studentId}
                diggingColumns={diggingColumns}
                defaultDate={createDefaultDate}
                noteCreateHref={noteCreateHref}
                onOpenQnaPanel={() => setQnaSlideOpen(true)}
                canCreateQna={canCreateQna}
                canCreateEvent={isStudentWorkspace}
                canCreateDigging={isStudentWorkspace}
              />
            ) : null}
          </div>
        </div>
        <div className="flex min-h-9 items-center border-b border-border px-3 text-xs text-muted-foreground sm:px-6">
          <span aria-label={`${workspaceContextLabel}: ${spaceLabel || "선택된 학생 없음"}`}>
            {workspaceContextLabel} · <span className="font-medium text-foreground">{spaceLabel || "선택된 학생 없음"}</span>
          </span>
        </div>
        {workspaceRole === "student" && externalCalendarConnection ? (
          <ExternalCalendarConnection
            key={`${externalCalendarConnection.connected}:${externalCalendarConnection.provider ?? "NONE"}`}
            connection={externalCalendarConnection}
          />
        ) : null}

        {/* 탭 콘텐츠 */}
        <div className="flex-1 overflow-auto">
          <TabsContent value="calendar" className="m-0 h-full p-3 sm:p-4">
            <div className="h-[calc(100dvh-12rem)] min-h-[32rem] max-h-[52rem]">
              <UnifiedCalendar
                items={unifiedItems}
                onCreateRequest={handleCreateRequest}
                returnTo={workspaceReturnTo}
                showSpaceContext={showSpaceContext}
              />
            </div>
          </TabsContent>

          <TabsContent value="daily" className="m-0 p-6">
            <DailyListView
              items={unifiedItems}
              returnTo={workspaceReturnTo}
              showSpaceContext={showSpaceContext}
            />
          </TabsContent>

          <TabsContent value="all" className="m-0 p-6">
            <AllItemsView
              items={unifiedItems}
              returnTo={workspaceReturnTo}
              showSpaceContext={showSpaceContext}
            />
          </TabsContent>

          <TabsContent value="curriculum" className="m-0 p-6 max-w-3xl mx-auto">
            <CurriculumView initialModules={curriculumModules} />
          </TabsContent>

          <TabsContent value="assignments" className="m-0 p-6 max-w-3xl mx-auto">
            <AssignmentView initialAssignments={assignments} />
          </TabsContent>
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
