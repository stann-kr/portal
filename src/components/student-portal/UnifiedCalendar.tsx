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
import koLocale from "@fullcalendar/core/locales/ko";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import { getUnifiedItemColor, getUnifiedItemKey } from "@/lib/utils/unifiedItemUtils";
import { SlidePanel } from "./SlidePanel";
import { UnifiedItemDetail } from "./UnifiedItemDetail";
import { UNIFIED_ITEM_TYPE_LABELS, UnifiedItemTypeIcon } from "@/components/ui/unified-item-type";
import {
  matchesCalendarPreset,
  type CalendarPreset,
} from "@/lib/calendar-section-contract";

interface UnifiedCalendarProps {
  isActive?: boolean;
  items: UnifiedItem[];
  onCreateRequest?: (date: string) => void;
  returnTo: string;
  showSpaceContext: boolean;
  preset?: CalendarPreset | null;
  onPresetChange?: (preset: CalendarPreset | null) => void;
}

export function UnifiedCalendar({
  isActive = true,
  items,
  onCreateRequest,
  returnTo,
  showSpaceContext,
  preset = null,
  onPresetChange,
}: UnifiedCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [initialView] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches
      ? "listWeek"
      : "dayGridMonth",
  );

  // Hidden tabs keep their date/view; FullCalendar must remeasure once visible.
  useEffect(() => {
    if (!isActive) return;
    let frame = 0;
    const updateSize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => calendarRef.current?.getApi().updateSize());
    };
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    updateSize();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [isActive]);

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
        arg.el.focus({ preventScroll: true });
        setSelectedItem(found);
        setPanelOpen(true);
      }
    },
    [items],
  );

  return (
    <div ref={containerRef} className="flex flex-col gap-3 h-full">
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
        {(Object.entries(UNIFIED_ITEM_TYPE_LABELS) as [UnifiedItemType, string][]).map(([type, label]) => {
          const active = visibleTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              aria-pressed={active}
              aria-label={`${label} ${active ? "숨기기" : "표시하기"}`}
              className={`inline-flex min-h-8 items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "border-primary/20 bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground bg-surface hover:bg-muted"
              }`}
            >
              <UnifiedItemTypeIcon type={type} className="size-3.5" />
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
          initialView={initialView}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,listWeek",
          }}
          locale={koLocale}
          buttonText={{ prev: "이전", next: "다음", list: "목록" }}
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
