/**
 * @file src/components/calendar/PersonalCalendar.tsx
 * @description FullCalendar 기반 개인 캘린더 컴포넌트.
 * - 월간/주간/일간/목록 뷰 전환
 * - 날짜 클릭 → EventFormDialog 생성
 * - 이벤트 클릭 → 상세 팝오버 (삭제)
 * - 드래그&드롭 → updateCalendarEvent
 */
"use client";

import { useState, useCallback, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { EventClickArg, EventDropArg, EventInput } from "@fullcalendar/core";
import { EventFormDialog } from "./EventFormDialog";
import { updateCalendarEvent, deleteCalendarEvent } from "@/lib/actions/calendarEvents";
import type { CalendarEventType } from "@/db/schema";

// ─── 이벤트 타입별 색상 ──────────────────────────
const EVENT_COLORS: Record<CalendarEventType, string> = {
  LESSON: "var(--color-event-lesson)",
  PRACTICE: "var(--color-event-practice)",
  GIG: "var(--color-event-gig)",
  NOTE: "var(--color-event-note)",
};

const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  LESSON: "수업",
  PRACTICE: "연습",
  GIG: "공연",
  NOTE: "메모",
};

type CalendarEvent = {
  id: string;
  title: string;
  eventType: CalendarEventType;
  startTime: Date;
  endTime: Date | null | undefined;
  description: string | null | undefined;
};

interface PersonalCalendarProps {
  initialEvents: CalendarEvent[];
}

export function PersonalCalendar({ initialEvents }: PersonalCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedStart, setSelectedStart] = useState<string>("");
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);

  // FullCalendar용 이벤트 포맷 변환
  const fcEvents: EventInput[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.startTime,
    end: e.endTime ?? undefined,
    backgroundColor: EVENT_COLORS[e.eventType],
    borderColor: EVENT_COLORS[e.eventType],
    extendedProps: { eventType: e.eventType, description: e.description },
  }));

  // 날짜 클릭 → 다이얼로그 열기
  const handleDateClick = useCallback((arg: DateClickArg) => {
    setSelectedStart(arg.dateStr);
    setDialogOpen(true);
  }, []);

  // 이벤트 클릭 → 상세 표시
  const handleEventClick = useCallback(
    (arg: EventClickArg) => {
      const found = events.find((e) => e.id === arg.event.id);
      if (found) setDetailEvent(found);
    },
    [events],
  );

  // 드래그&드롭 날짜 변경
  const handleEventDrop = useCallback(async (arg: EventDropArg) => {
    const { event } = arg;
    try {
      await updateCalendarEvent(event.id, {
        startTime: event.start ?? undefined,
        endTime: event.end ?? null,
      });
      setEvents((prev) =>
        prev.map((e) =>
          e.id === event.id
            ? { ...e, startTime: event.start!, endTime: event.end }
            : e,
        ),
      );
    } catch {
      arg.revert();
    }
  }, []);

  // 이벤트 삭제
  const handleDelete = useCallback(async (eventId: string) => {
    try {
      await deleteCalendarEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setDetailEvent(null);
    } catch {
      // 삭제 실패 시 UI 상태 유지
    }
  }, []);

  // 생성 성공 후 새로고침 (revalidatePath가 서버 캐시를 정리하므로 router.refresh 필요)
  const handleSuccess = useCallback(() => {
    // 간단히 페이지 새로고침으로 새 이벤트 반영
    window.location.reload();
  }, []);

  return (
    <div className="relative">
      {/* FullCalendar */}
      <div className="fc-custom">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          buttonText={{
            today: "오늘",
            month: "월",
            week: "주",
            day: "일",
            list: "목록",
          }}
          locale="ko"
          events={fcEvents}
          editable
          selectable
          dateClick={handleDateClick}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          height="auto"
          dayMaxEvents={3}
          nowIndicator
        />
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-4 mt-4 px-1">
        {(Object.entries(EVENT_COLORS) as [CalendarEventType, string][]).map(
          ([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-muted-foreground">
                {EVENT_TYPE_LABELS[type]}
              </span>
            </div>
          ),
        )}
      </div>

      {/* 이벤트 상세 패널 */}
      {detailEvent && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={() => setDetailEvent(null)}>
          <div
            className="bg-card border border-border rounded-2xl p-5 w-80 shadow-xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: EVENT_COLORS[detailEvent.eventType] }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {EVENT_TYPE_LABELS[detailEvent.eventType]}
                  </span>
                </div>
                <p className="font-semibold text-foreground">{detailEvent.title}</p>
              </div>
              <button
                onClick={() => setDetailEvent(null)}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                🕒{" "}
                {new Date(detailEvent.startTime).toLocaleString("ko-KR", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {detailEvent.endTime && (
                  <>
                    {" "}~{" "}
                    {new Date(detailEvent.endTime).toLocaleString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </>
                )}
              </p>
              {detailEvent.description && (
                <p className="text-foreground/70">{detailEvent.description}</p>
              )}
            </div>

            <button
              onClick={() => handleDelete(detailEvent.id)}
              className="w-full text-center text-sm text-destructive hover:bg-destructive/10 py-1.5 rounded-lg transition-colors"
            >
              삭제
            </button>
          </div>
        </div>
      )}

      {/* 생성 다이얼로그 */}
      <EventFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultStart={selectedStart}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
