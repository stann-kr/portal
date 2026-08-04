/**
 * @file src/components/student-portal/CalendarSection.tsx
 * @description 캘린더 섹션의 5개 뷰 (캘린더 / 일별 목록 / 전체 항목 / 커리큘럼 / 과제).
 * 우측 상단 "+" 버튼으로 UnifiedCreateDialog 열기.
 */
"use client";

import { useState, useEffect } from "react";
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
import { NoteSlideForm } from "@/components/notes/NoteSlideForm";
import { QnaSlideForm } from "@/components/qna/QnaSlideForm";
import type { DiggingColumnType } from "@/db/schema";

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

/** 캘린더 내부 탭 영속화 localStorage 키 */
const CALENDAR_TAB_STORAGE_KEY = "studentPortal:calendarTab";

/** 유효한 내부 탭 값 */
const CALENDAR_TAB_VALUES = ["calendar", "daily", "all", "curriculum", "assignments"] as const;

interface CalendarSectionProps {
  unifiedItems: UnifiedItem[];
  curriculumModules: CurriculumModule[];
  assignments: Assignment[];
  studentId: string;
  /** 어드민에서 주입하는 헤더 슬롯 (학생 필터 드롭다운 등) */
  headerSlot?: React.ReactNode;
  /** 노트/QnA 생성 성공 시 낙관적 업데이트 콜백 */
  onAddItem?: (item: UnifiedItem) => void;
}

// ── 컴포넌트 ─────────────────────────────────────

export function CalendarSection({
  unifiedItems,
  curriculumModules,
  assignments,
  studentId,
  headerSlot,
  onAddItem,
}: CalendarSectionProps) {
  const [createDefaultDate, setCreateDefaultDate] = useState<string | undefined>(undefined);
  const [diggingColumns, setDiggingColumns] = useState<DiggingColumn[]>([]);
  const [noteSlideOpen, setNoteSlideOpen] = useState(false);
  const [qnaSlideOpen, setQnaSlideOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("calendar");

  // 마운트 후 직전 내부 탭 복원 (SSR 기본값과 동일 초기값 → 하이드레이션 불일치 방지)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CALENDAR_TAB_STORAGE_KEY);
      if (saved && (CALENDAR_TAB_VALUES as readonly string[]).includes(saved)) {
        setActiveTab(saved);
      }
    } catch {
      /* localStorage 접근 불가 환경 무시 */
    }
  }, []);

  // 탭 변경 시 영속화
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    try {
      localStorage.setItem(CALENDAR_TAB_STORAGE_KEY, value);
    } catch {
      /* localStorage 접근 불가 환경 무시 */
    }
  };

  // 마운트 시 1회 digging columns 패치
  useEffect(() => {
    if (!studentId) return;
    type RawCol = Awaited<ReturnType<typeof getOrSeedColumns>>[number];
    getOrSeedColumns(studentId).then((cols) => {
      setDiggingColumns(
        cols.map((c: RawCol) => ({
          id: c.id,
          name: c.name,
          columnType: c.columnType as DiggingColumnType,
          options: c.options,
        }))
      );
    });
  }, [studentId]);

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
          <div className="flex justify-end pb-2 sm:pb-0">
            <CreateEntryDropdown
              studentId={studentId}
              diggingColumns={diggingColumns}
              defaultDate={createDefaultDate}
              onOpenNotePanel={() => setNoteSlideOpen(true)}
              onOpenQnaPanel={() => setQnaSlideOpen(true)}
            />
          </div>
        </div>

        {/* 탭 콘텐츠 */}
        <div className="flex-1 overflow-auto">
          <TabsContent value="calendar" className="m-0 h-full p-3 sm:p-4">
            <div className="h-[calc(100dvh-12rem)] min-h-[32rem] max-h-[52rem]">
              <UnifiedCalendar
                items={unifiedItems}
                onCreateRequest={handleCreateRequest}
              />
            </div>
          </TabsContent>

          <TabsContent value="daily" className="m-0 p-6">
            <DailyListView items={unifiedItems} />
          </TabsContent>

          <TabsContent value="all" className="m-0 p-6">
            <AllItemsView items={unifiedItems} />
          </TabsContent>

          <TabsContent value="curriculum" className="m-0 p-6 max-w-3xl mx-auto">
            <CurriculumView initialModules={curriculumModules} />
          </TabsContent>

          <TabsContent value="assignments" className="m-0 p-6 max-w-3xl mx-auto">
            <AssignmentView initialAssignments={assignments} />
          </TabsContent>
        </div>
      </Tabs>

      {/* 노트 작성 슬라이드 패널 */}
      <SlidePanel
        open={noteSlideOpen}
        onOpenChange={setNoteSlideOpen}
        title="노트 작성"
        size="xl"
      >
        <NoteSlideForm
          studentId={studentId}
          defaultDate={createDefaultDate}
          onSuccess={(item) => {
            onAddItem?.(item);
            setNoteSlideOpen(false);
          }}
          onClose={() => setNoteSlideOpen(false)}
        />
      </SlidePanel>

      {/* Q&A 작성 슬라이드 패널 */}
      <SlidePanel
        open={qnaSlideOpen}
        onOpenChange={setQnaSlideOpen}
        title="Q&A 질문 작성"
        size="xl"
      >
        <QnaSlideForm
          onSuccess={(item) => {
            onAddItem?.(item);
            setQnaSlideOpen(false);
          }}
          onClose={() => setQnaSlideOpen(false)}
        />
      </SlidePanel>
    </div>
  );
}
