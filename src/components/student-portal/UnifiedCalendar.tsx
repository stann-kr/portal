/**
 * @file src/components/student-portal/UnifiedCalendar.tsx
 * @description FullCalendar 기반 통합 캘린더 뷰.
 * UnifiedItem[] 전체를 타입별 색상으로 표시. 날짜 클릭 → 생성 다이얼로그, 이벤트 클릭 → SlidePanel.
 */
"use client";

import { useState, useCallback, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { getUnifiedItemColor, getUnifiedItemKey } from "@/lib/utils/unifiedItemUtils";
import { SlidePanel } from "./SlidePanel";
import { UnifiedItemDetail } from "./UnifiedItemDetail";

// ── 타입 필터 라벨 ──────────────────────────────

const TYPE_LABELS: Record<string, string> = {
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
}

export function UnifiedCalendar({
  items,
  onCreateRequest,
  returnTo,
  showSpaceContext,
}: UnifiedCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);

  // 타입 필터 (기본 전체 표시)
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(
    new Set(["EVENT", "NOTE", "DIGGING", "QNA", "ASSIGNMENT"]),
  );

  // 상세 패널 상태
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // 타입 토글
  const toggleType = (type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // UnifiedItem → FullCalendar EventInput
  const fcEvents: EventInput[] = items
    .filter((item) => visibleTypes.has(item.type))
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
      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(TYPE_LABELS).map(([type, label]) => {
          const active = visibleTypes.has(type);
          // 색상은 샘플 아이템으로 도출
          const sampleItem = items.find((i) => i.type === type);
          const color = sampleItem ? getUnifiedItemColor(sampleItem) : "#71717a";
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
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
      <div className="flex-1 min-h-0 [&_.fc]:h-full [&_.fc-view-harness]:flex-1">
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
