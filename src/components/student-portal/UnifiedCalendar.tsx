/**
 * @file src/components/student-portal/UnifiedCalendar.tsx
 * @description FullCalendar 기반 통합 캘린더 뷰.
 * UnifiedItem[] 전체를 타입별 색상으로 표시. 날짜 클릭 → 생성 다이얼로그, 이벤트 클릭 → SlidePanel.
 */
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import { getUnifiedItemColor, getUnifiedItemKey } from "@/lib/utils/unifiedItemUtils";
import { SlidePanel } from "./SlidePanel";
import { UnifiedItemDetail } from "./UnifiedItemDetail";
import {
  matchesCalendarPreset,
  type CalendarPreset,
} from "@/lib/calendar-section-contract";

// ── 타입 필터 라벨 ──────────────────────────────

const TYPE_LABELS: Record<UnifiedItemType, string> = {
  EVENT: "일정",
  NOTE: "노트",
  DIGGING: "디깅",
  QNA: "Q&A",
  ASSIGNMENT: "과제",
};

interface UnifiedCalendarProps {
  items: UnifiedItem[];
  onCreateRequest?: (date: string) => void;
  returnTo: string;
  showSpaceContext: boolean;
  preset?: CalendarPreset | null;
  onPresetChange?: (preset: CalendarPreset | null) => void;
}

export function UnifiedCalendar({
  items,
  onCreateRequest,
  returnTo,
  showSpaceContext,
  preset = null,
  onPresetChange,
}: UnifiedCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);

  // 타입 필터 (기본 전체 표시)
  const [visibleTypes, setVisibleTypes] = useState<Set<UnifiedItemType>>(
    new Set(["EVENT", "NOTE", "DIGGING", "QNA", "ASSIGNMENT"]),
  );
  const [activePreset, setActivePreset] = useState<CalendarPreset | null>(preset);

  useEffect(() => setActivePreset(preset), [preset]);

  // 상세 패널 상태
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // 타입 토글
  const toggleType = (type: UnifiedItemType) => {
    if (activePreset) {
      setActivePreset(null);
      onPresetChange?.(null);
    }
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // UnifiedItem → FullCalendar EventInput
  const fcEvents: EventInput[] = items
    .filter((item) => matchesCalendarPreset(item, activePreset) && visibleTypes.has(item.type))
    .map((item) => {
      const color = getUnifiedItemColor(item);
      const allDay = item.metadata.allDay === true;
      const allDayStartDate = typeof item.metadata.allDayStartDate === "string"
        ? item.metadata.allDayStartDate
        : null;
      const allDayEndDate = typeof item.metadata.allDayEndDate === "string"
        ? item.metadata.allDayEndDate
        : null;
      return {
        id: getUnifiedItemKey(item),
        title: showSpaceContext ? `${item.title} · ${item.space.label}` : item.title,
        start: allDay && allDayStartDate ? allDayStartDate : item.date.toISOString(),
        end: allDay && allDayEndDate
          ? allDayEndDate
          : item.endDate?.toISOString(),
        allDay,
        backgroundColor: color,
        borderColor: color,
        extendedProps: { itemType: item.type, spaceLabel: item.space.label, sourceLabel: item.source.label },
      };
    });

  // 날짜 클릭 → 생성 다이얼로그
  const handleDateClick = useCallback(
    (arg: DateClickArg) => {
      onCreateRequest?.(arg.dateStr);
    },
    [onCreateRequest],
  );

  // 이벤트 클릭 → 상세 패널
  const handleEventClick = useCallback(
    (arg: EventClickArg) => {
      const found = items.find((item) => getUnifiedItemKey(item) === arg.event.id);
      if (found) {
        setSelectedItem(found);
        setPanelOpen(true);
      }
    },
    [items],
  );

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* 타입 필터 바 */}
      <div className="flex items-center gap-2 flex-wrap" aria-label="캘린더 항목 필터">
        {activePreset ? (
          <button
            type="button"
            onClick={() => {
              setActivePreset(null);
              onPresetChange?.(null);
            }}
            className="inline-flex min-h-7 items-center rounded-full border border-primary bg-primary/10 px-3 text-xs font-medium text-primary"
            aria-label="노트와 레슨 필터 해제"
          >
            노트 + 레슨 보기 · 해제
          </button>
        ) : null}
        {(Object.entries(TYPE_LABELS) as [UnifiedItemType, string][]).map(([type, label]) => {
          const active = visibleTypes.has(type);
          // 색상은 샘플 아이템으로 도출
          const sampleItem = items.find((i) => i.type === type);
          const color = sampleItem ? getUnifiedItemColor(sampleItem) : "var(--color-muted-foreground)";
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              aria-pressed={active}
              aria-label={`${label} ${active ? "숨기기" : "표시하기"}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                active
                  ? "border-transparent text-white"
                  : "border-border text-muted-foreground bg-background"
              }`}
              style={active ? { backgroundColor: color, borderColor: color } : undefined}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: active ? "white" : color }}
              />
              {label}
            </button>
          );
        })}
      </div>

      {/* FullCalendar */}
      <div className="fc-custom flex-1 min-h-0 [&_.fc]:h-full [&_.fc-view-harness]:flex-1" aria-label="통합 일정 달력">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,listWeek",
          }}
          locale="ko"
          events={fcEvents}
          dateClick={handleDateClick}
          eventClick={handleEventClick}
          height="100%"
          eventDisplay="block"
          dayMaxEvents={4}
        />
      </div>

      {/* 상세 패널 */}
      <SlidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={selectedItem?.title}
      >
        {selectedItem && (
          <UnifiedItemDetail
            item={selectedItem}
            onClose={() => setPanelOpen(false)}
            returnTo={returnTo}
          />
        )}
      </SlidePanel>
    </div>
  );
}
