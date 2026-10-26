/**
 * @file src/components/student-portal/UnifiedCalendar.tsx
 * @description 노션 캘린더처럼 쓰는 통합 캘린더 뷰.
 * 칸을 누르거나 끌어 고르면 그 자리에서 만들고, 권한이 있는 일정·레슨·노트는 끌어서 옮긴다.
 * 항목을 누르면 SlidePanel 상세를 연다.
 */
"use client";

import { useState, useCallback, useEffect, useInsertionEffect, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import koLocale from "@fullcalendar/core/locales/ko";
import type {
  DateSelectArg,
  DateSpanApi,
  DayCellContentArg,
  DatesSetArg,
  EventApi,
  EventClickArg,
  EventDropArg,
  EventInput,
  EventMountArg,
  MoreLinkContentArg,
} from "@fullcalendar/core";
import type { DateClickArg, EventResizeDoneArg } from "@fullcalendar/interaction";
import { ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import { getUnifiedItemColor, getUnifiedItemKey } from "@/lib/utils/unifiedItemUtils";
import { UnifiedItemDetailPanel, type UnifiedItemChangeHandlers } from "./UnifiedItemDetailPanel";
import { UNIFIED_ITEM_TYPE_LABELS, UnifiedItemTypeIcon } from "@/components/ui/unified-item-type";
import { renderCalendarEventContent } from "@/components/calendar/CalendarEventChip";
import {
  CalendarQuickCreate,
  canUseQuickCreate,
  type CalendarQuickCreateOptions,
} from "@/components/calendar/CalendarQuickCreate";
import {
  matchesCalendarPreset,
  type CalendarPreset,
} from "@/lib/calendar-section-contract";
import {
  applyCalendarMoveToItem,
  buildCalendarMoveRequest,
  CALENDAR_TIME_ZONE,
  calendarWallStringToKst,
  createLatestMoveTracker,
  fromCalendarWallTime,
  getCalendarItemEditing,
  getCalendarItemLockReason,
  getCalendarNow,
  isCalendarMoveReflected,
  resolveSavedMove,
  toCalendarWallTime,
  getNoteCalendarDateKey,
  type CalendarEditContext,
  type CalendarMoveRequest,
} from "@/lib/calendar-interaction";
import type { CalendarQuickCreateSelection } from "@/lib/calendar-quick-create";
import { createDaySelection } from "@/lib/unified-item-views";
import { moveCalendarEvent } from "@/lib/actions/calendarEvents";
import { moveLesson } from "@/lib/actions/lessons";
import { movePrivateNoteDate } from "@/lib/actions/privateNotes";
import { createCreationOperationId } from "@/lib/creation-operation";
import { formatKst } from "@/lib/kst-format";

interface UnifiedCalendarProps extends UnifiedItemChangeHandlers {
  isActive?: boolean;
  items: UnifiedItem[];
  returnTo: string;
  showSpaceContext: boolean;
  preset?: CalendarPreset | null;
  onPresetChange?: (preset: CalendarPreset | null) => void;
  /** 보는 사람과 이 스페이스에서의 권한. 없으면 아무것도 끌 수 없다. */
  editContext?: CalendarEditContext;
  /** 칸을 눌러 바로 만들기. 없으면 칸 선택을 끈다. */
  quickCreate?: CalendarQuickCreateOptions;
}

type CalendarViewName = "dayGridMonth" | "timeGridWeek" | "listWeek";

const VIEW_OPTIONS: ReadonlyArray<{ value: CalendarViewName; label: string }> = [
  { value: "dayGridMonth", label: "월" },
  { value: "timeGridWeek", label: "주" },
  { value: "listWeek", label: "목록" },
];

type PendingMove = { request: CalendarMoveRequest; saved: boolean };

function isTouchEvent(event: Event | null | undefined): boolean {
  if (!event) return false;
  return event.type.startsWith("touch") || (event as PointerEvent).pointerType === "touch";
}

/** 마우스·포인터는 clientX/Y, 터치는 마지막 손가락 위치를 빠른 만들기 창의 기준점으로 쓴다. */
function getEventPoint(event: Event | null | undefined): { x: number; y: number } | null {
  if (!event) return null;
  const touch = (event as TouchEvent).changedTouches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };
  const pointer = event as MouseEvent;
  return typeof pointer.clientX === "number" ? { x: pointer.clientX, y: pointer.clientY } : null;
}

type MoveNotice =
  | { tone: "status"; message: string; undo?: { item: UnifiedItem; request: CalendarMoveRequest } }
  | { tone: "error"; message: string };

const KST_TIME = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;

const KST_MOVE_DATE = { month: "long", day: "numeric", weekday: "short" } as const;

// 조사가 앞말에 따라 바뀌지 않도록 "무엇 · 어디로" 형태로 알린다.
function describeMove(item: UnifiedItem, request: CalendarMoveRequest): string {
  const kind = item.type === "NOTE" ? "노트" : item.source.entity === "LESSON" ? "레슨" : "일정";
  const name = item.source.entity === "LESSON" ? "" : ` "${item.title}"`;
  let when: string;
  if (request.kind === "note") {
    when = formatKst(`${request.noteDate}T12:00:00+09:00`, KST_MOVE_DATE);
  } else if (request.kind === "lesson") {
    when = `${formatKst(request.scheduledAt, KST_MOVE_DATE)} ${formatKst(request.scheduledAt, KST_TIME)}`;
  } else {
    when = `${formatKst(request.startTime, KST_MOVE_DATE)} ${formatKst(request.startTime, KST_TIME)}`;
    if (request.endTime) when += `–${formatKst(request.endTime, KST_TIME)}`;
  }
  return `${kind}${name} → ${when}에 저장했습니다.`;
}

function reverseRequest(item: UnifiedItem, request: CalendarMoveRequest): CalendarMoveRequest {
  switch (request.kind) {
    case "event":
      return {
        kind: "event",
        startTime: item.date.toISOString(),
        endTime: item.endDate ? new Date(item.endDate).toISOString() : null,
      };
    case "lesson":
      return { kind: "lesson", scheduledAt: item.date.toISOString() };
    case "note":
      return { kind: "note", noteDate: getNoteCalendarDateKey(item) };
  }
}

async function sendMove(item: UnifiedItem, request: CalendarMoveRequest, operationId: string): Promise<string | null> {
  if (request.kind === "event") {
    const result = await moveCalendarEvent(item.id, request.startTime, request.endTime, item.space.studentId);
    return result.ok ? null : result.error;
  }
  if (request.kind === "lesson") {
    const result = await moveLesson(item.id, item.space.studentId, request.scheduledAt);
    return result.success ? null : result.error ?? "레슨을 옮기지 못했습니다.";
  }
  const result = await movePrivateNoteDate(item.id, request.noteDate, operationId);
  return result.ok ? null : result.error;
}

// 이동은 같은 값을 다시 보내도 결과가 같으므로, 응답을 잃으면 같은 작업 ID로 한 번 더 보낸다.
async function saveMove(item: UnifiedItem, request: CalendarMoveRequest): Promise<string | null> {
  const operationId = createCreationOperationId();
  try {
    return await sendMove(item, request, operationId);
  } catch {
    try {
      return await sendMove(item, request, operationId);
    } catch {
      return "저장 결과를 확인하지 못했습니다. 원래 자리로 되돌렸습니다. 새로고침해 실제 날짜를 확인해 주세요.";
    }
  }
}

// FullCalendar 옵션은 렌더마다 새로 만들면 다시 계산되므로 모듈 상수로 고정한다.
function handleEventDidMount(arg: EventMountArg) {
  const { color, lockReason } = arg.event.extendedProps as { color?: string; lockReason?: string | null };
  if (color) arg.el.style.setProperty("--chip-color", color);
  if (lockReason) {
    arg.el.dataset.lockReason = lockReason;
    arg.el.setAttribute("title", `${arg.event.title} · ${lockReason}`);
  }
}

function allowSameSlotKind(drop: DateSpanApi, dragged: EventApi | null) {
  return drop.allDay === Boolean(dragged?.allDay);
}

// 한국어 locale은 "26일"처럼 붙이므로 숫자만 남겨 칸을 가볍게 한다.
function renderDayCell(arg: DayCellContentArg) {
  return arg.dayNumberText.replace(/일$/u, "");
}

function renderMoreLink(arg: MoreLinkContentArg) {
  return `+${arg.num}개 더`;
}

const SLOT_LABEL_FORMAT = { hour: "numeric", hour12: false } as const;
const DAY_HEADER_FORMAT = { weekday: "short" } as const;
const CALENDAR_PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin];

export function UnifiedCalendar({
  isActive = true,
  items,
  returnTo,
  showSpaceContext,
  preset = null,
  onPresetChange,
  editContext,
  quickCreate,
  canManageEvents,
  canManageLessons,
  onItemUpdated,
  onItemRemoved,
}: UnifiedCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [initialView] = useState<CalendarViewName>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches
      ? "listWeek"
      : "dayGridMonth",
  );
  // 서버 렌더에는 화면 폭을 모르므로 보기를 비워 두고, 달력이 알려 준 실제 보기로 채운다(hydration 불일치 방지).
  const [view, setView] = useState<{ type: CalendarViewName | null; title: string }>({ type: null, title: "" });

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

  // 바깥에서 preset이 바뀌면 렌더 중 바로 따라간다(이전 값과 비교).
  const [syncedPreset, setSyncedPreset] = useState(preset);
  if (syncedPreset !== preset) {
    setSyncedPreset(preset);
    setActivePreset(preset);
  }

  // 상세 패널 상태
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // 저장을 기다리는 이동은 요청만 들고 있다가 최신 항목에 겹쳐 보여 주고, 실패하면 지워 원래 자리로 돌린다.
  // 저장된 이동(saved)은 서버에서 다시 받은 목록이 그 자리를 반영할 때까지 유지해 원위치로 깜빡이지 않게 한다.
  const [pendingMoves, setPendingMoves] = useState<ReadonlyMap<string, PendingMove>>(() => new Map());
  const [reconciledItems, setReconciledItems] = useState(items);
  if (reconciledItems !== items) {
    setReconciledItems(items);
    const settled = [...pendingMoves].filter(([key, pending]) => {
      if (!pending.saved) return false;
      const current = items.find((item) => getUnifiedItemKey(item) === key);
      return !current || isCalendarMoveReflected(current, pending.request);
    });
    if (settled.length > 0) {
      const next = new Map(pendingMoves);
      for (const [key] of settled) next.delete(key);
      setPendingMoves(next);
    }
  }
  // 저장이 끝났을 때 그 사이 바뀐 항목(제목·metadata)에 이동만 합치기 위해 최신 목록을 둔다.
  const latestItemsRef = useRef(items);
  const moveTrackerRef = useRef(createLatestMoveTracker());
  useInsertionEffect(() => {
    latestItemsRef.current = items;
  });
  const [notice, setNotice] = useState<MoveNotice | null>(null);
  const [quickSelection, setQuickSelection] = useState<{
    selection: CalendarQuickCreateSelection;
    anchor: { x: number; y: number } | null;
  } | null>(null);

  const context: CalendarEditContext | null = editContext ?? null;
  // 잠긴 칩을 끌려고 하면 이유를 알려 준다(끌기는 FullCalendar가 시작하지 않음).
  const lockedPressRef = useRef<{ x: number; y: number; reason: string } | null>(null);
  const withPendingMove = (item: UnifiedItem) => {
    const pending = pendingMoves.get(getUnifiedItemKey(item));
    return pending ? applyCalendarMoveToItem(item, pending.request) : item;
  };
  const displayedItems = pendingMoves.size === 0 ? items : items.map(withPendingMove);

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
  const fcEvents: EventInput[] = displayedItems
    .filter((item) => matchesCalendarPreset(item, activePreset) && visibleTypes.has(item.type))
    .map((item) => {
      const key = getUnifiedItemKey(item);
      const color = getUnifiedItemColor(item);
      const editing = context ? getCalendarItemEditing(item, context) : null;
      const movable = Boolean(editing?.movable) && pendingMoves.get(key)?.saved !== false;
      const isNote = item.type === "NOTE";
      const allDay = isNote || item.metadata.allDay === true;
      const allDayStartDate = isNote
        ? getNoteCalendarDateKey(item)
        : typeof item.metadata.allDayStartDate === "string" ? item.metadata.allDayStartDate : null;
      const allDayEndDate = !isNote && typeof item.metadata.allDayEndDate === "string"
        ? item.metadata.allDayEndDate
        : null;
      const title = item.title;
      return {
        id: key,
        title: showSpaceContext ? `${title} · ${item.space.label}` : title,
        start: allDay && allDayStartDate ? allDayStartDate : toCalendarWallTime(item.date),
        end: allDay
          ? allDayEndDate ?? undefined
          : item.endDate ? toCalendarWallTime(new Date(item.endDate)) : undefined,
        allDay,
        startEditable: movable,
        durationEditable: movable && editing?.resizable === true && Boolean(item.endDate),
        backgroundColor: "transparent",
        // 목록 보기의 유형 점은 FullCalendar가 borderColor를 inline으로 칠한다. 칩은 CSS가 테두리를 지운다.
        borderColor: color,
        textColor: "inherit",
        classNames: ["calendar-event", movable ? "calendar-event-movable" : "calendar-event-locked"],
        extendedProps: {
          itemType: item.type,
          movable,
          color,
          timeLabel: allDay ? null : formatKst(item.date, KST_TIME),
          lockReason: context ? getCalendarItemLockReason(item, context) : null,
          spaceLabel: item.space.label,
          sourceLabel: item.source.label,
        },
      };
    });

  const commitMove = useCallback(
    async (original: UnifiedItem, request: CalendarMoveRequest, options: { undoable: boolean }) => {
      const key = getUnifiedItemKey(original);
      const entry: PendingMove = { request, saved: false };
      const token = moveTrackerRef.current.start(key);
      setPendingMoves((current) => new Map(current).set(key, entry));
      setNotice(null);
      const error = await saveMove(original, request);
      // 그 사이 같은 항목을 다시 옮겼다면 이 응답은 목록·알림·되돌리기 어느 것도 바꾸지 않는다.
      if (!moveTrackerRef.current.isLatest(key, token)) return;
      moveTrackerRef.current.finish(key, token);
      setPendingMoves((current) => {
        if (current.get(key) !== entry) return current;
        const next = new Map(current);
        if (error) next.delete(key);
        else next.set(key, { request, saved: true });
        return next;
      });
      if (error) {
        setNotice({ tone: "error", message: error });
        return;
      }
      // 기다리는 동안 목록에서 빠진 항목은 되살리지 않고, 남아 있으면 최신 값에 이동만 합친다.
      const saved = resolveSavedMove(latestItemsRef.current, key, request);
      if (saved) onItemUpdated?.(saved);
      const moved = saved ?? applyCalendarMoveToItem(original, request);
      setNotice({
        tone: "status",
        message: describeMove(original, request),
        undo: options.undoable ? { item: moved, request: reverseRequest(original, request) } : undefined,
      });
    },
    [onItemUpdated],
  );

  const handleMove = (info: EventDropArg | EventResizeDoneArg) => {
    const listed = items.find((item) => getUnifiedItemKey(item) === info.event.id);
    // 저장됐지만 아직 목록에 반영되지 않은 이동이 있으면 그 자리를 출발점으로 삼는다.
    const original = listed ? withPendingMove(listed) : undefined;
    const editing = original && context ? getCalendarItemEditing(original, context) : null;
    const request = editing
      ? buildCalendarMoveRequest(editing, {
        start: info.event.start ? fromCalendarWallTime(info.event.start) : null,
        end: info.event.end ? fromCalendarWallTime(info.event.end) : null,
        allDay: info.event.allDay,
        startStr: info.event.startStr,
      })
      : null;
    if (!original || !request) {
      info.revert();
      return;
    }
    void commitMove(original, request, { undoable: true });
  };

  const handleSelect = useCallback(
    (arg: DateSelectArg) => {
      if (!quickCreate) return;
      setQuickSelection({
        selection: {
          startStr: calendarWallStringToKst(arg.startStr),
          endStr: calendarWallStringToKst(arg.endStr),
          allDay: arg.allDay,
        },
        anchor: getEventPoint(arg.jsEvent),
      });
    },
    [quickCreate],
  );

  // 터치는 칸을 길게 눌러야 선택이 시작되므로, 짧게 탭한 칸도 바로 만들기를 연다. 마우스는 select가 맡는다.
  const handleDateClick = useCallback(
    (arg: DateClickArg) => {
      if (!quickCreate || !isTouchEvent(arg.jsEvent)) return;
      const selection: CalendarQuickCreateSelection = arg.allDay
        ? createDaySelection(arg.dateStr.slice(0, 10))
        : {
          startStr: calendarWallStringToKst(arg.dateStr),
          endStr: calendarWallStringToKst(
            toCalendarWallTime(new Date(fromCalendarWallTime(arg.date).getTime() + 30 * 60 * 1_000)),
          ),
          allDay: false,
        };
      setQuickSelection((current) =>
        current?.selection.startStr === selection.startStr ? current : { selection, anchor: getEventPoint(arg.jsEvent) });
    },
    [quickCreate],
  );

  const closeQuickCreate = useCallback(() => {
    setQuickSelection(null);
    calendarRef.current?.getApi().unselect();
  }, []);

  // 이벤트 클릭 → 상세 패널
  const handleEventClick = (arg: EventClickArg) => {
    const found = items.find((item) => getUnifiedItemKey(item) === arg.event.id);
    if (!found) return;
    // List view's event element is a non-focusable table row.
    const trigger = arg.el.matches("a, button, [tabindex]")
      ? arg.el
      : arg.el.querySelector<HTMLElement>("a, button, [tabindex]");
    trigger?.focus({ preventScroll: true });
    setSelectedItem(withPendingMove(found));
    setPanelOpen(true);
  };

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    const next = { type: arg.view.type as CalendarViewName | null, title: arg.view.title };
    setView((current) => (current.type === next.type && current.title === next.title ? current : next));
  }, []);

  const api = () => calendarRef.current?.getApi();
  const canQuickCreate = canUseQuickCreate(quickCreate);

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col gap-3"
      onPointerDownCapture={(event) => {
        const locked = (event.target as Element).closest<HTMLElement>(".calendar-event-locked");
        const reason = locked?.dataset.lockReason;
        lockedPressRef.current = reason ? { x: event.clientX, y: event.clientY, reason } : null;
      }}
      onPointerMoveCapture={(event) => {
        const press = lockedPressRef.current;
        if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return;
        lockedPressRef.current = null;
        setNotice({ tone: "status", message: press.reason });
      }}
      onPointerUpCapture={() => {
        lockedPressRef.current = null;
      }}
    >
      {/* 노션식 툴바: 기간 이동 · 제목 · 보기 전환 */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="mr-2 min-w-0 truncate text-lg font-semibold tracking-[-0.01em]" data-calendar-title aria-live="polite">
            {view.title}
          </h2>
          <button
            type="button"
            onClick={() => api()?.prev()}
            aria-label="이전"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => api()?.today()}
            className="inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            오늘
          </button>
          <button
            type="button"
            onClick={() => api()?.next()}
            aria-label="다음"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div role="group" aria-label="달력 보기" className="flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {VIEW_OPTIONS.map((option) => {
            const active = view.type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => api()?.changeView(option.value)}
                className={`h-7 rounded-md px-2.5 text-xs transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 타입 필터 바 */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="캘린더 항목 필터">
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
              className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground line-through decoration-muted-foreground/60 hover:bg-muted/60"
              }`}
            >
              <UnifiedItemTypeIcon type={type} className="size-3.5" />
              {label}
            </button>
          );
        })}
        {canQuickCreate || context ? (
          <p className="ml-auto hidden text-xs text-muted-foreground sm:block">
            {canQuickCreate ? "칸을 누르거나 끌어서 바로 만들기" : null}
            {canQuickCreate && context ? " · " : null}
            {context ? "항목을 끌어 날짜 옮기기" : null}
          </p>
        ) : null}
      </div>

      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`flex min-h-9 flex-wrap items-center justify-between gap-2 rounded-md px-3 py-1.5 text-xs ${
            notice.tone === "error" ? "bg-destructive-muted text-destructive" : "bg-muted text-foreground"
          }`}
        >
          <span className="min-w-0 break-words">{notice.message}</span>
          <span className="flex items-center gap-1">
            {notice.tone === "status" && notice.undo ? (
              <button
                type="button"
                onClick={() => {
                  const undo = notice.undo;
                  if (undo) void commitMove(undo.item, undo.request, { undoable: false });
                }}
                className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 font-medium hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Undo2 className="size-3.5" aria-hidden="true" />
                되돌리기
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="inline-flex min-h-7 items-center rounded-md px-2 text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              닫기
            </button>
          </span>
        </div>
      ) : null}

      {/* FullCalendar */}
      <div className={`fc-custom fc-notion min-h-0 flex-1 [&_.fc]:h-full [&_.fc-view-harness]:flex-1 ${canQuickCreate ? "calendar-can-create" : ""}`} aria-label="통합 일정 달력">
        <FullCalendar
          ref={calendarRef}
          plugins={CALENDAR_PLUGINS}
          initialView={initialView}
          headerToolbar={false}
          locale={koLocale}
          timeZone={CALENDAR_TIME_ZONE}
          now={getCalendarNow}
          events={fcEvents}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          eventContent={renderCalendarEventContent}
          eventDidMount={handleEventDidMount}
          eventAllow={allowSameSlotKind}
          eventDrop={handleMove}
          eventResize={handleMove}
          eventLongPressDelay={350}
          selectable={canQuickCreate}
          selectMirror
          selectLongPressDelay={350}
          unselectAuto={false}
          select={handleSelect}
          dateClick={handleDateClick}
          height="100%"
          eventDisplay="block"
          dayMaxEvents={4}
          moreLinkContent={renderMoreLink}
          dayCellContent={renderDayCell}
          allDayText="종일"
          nowIndicator
          scrollTime="08:00:00"
          slotLabelFormat={SLOT_LABEL_FORMAT}
          dayHeaderFormat={DAY_HEADER_FORMAT}
          noEventsContent="이 기간에는 항목이 없습니다"
          fixedWeekCount={false}
        />
      </div>

      {quickSelection && quickCreate ? (
        <CalendarQuickCreate
          selection={quickSelection.selection}
          anchor={quickSelection.anchor}
          options={quickCreate}
          onCreated={(item) => onItemUpdated?.(item)}
          onClose={closeQuickCreate}
        />
      ) : null}

      {context ? (
        <p className="sr-only">
          권한이 있는 일정·레슨·노트는 끌어서 날짜를 옮길 수 있습니다. 키보드로는 항목을 열어 상세에서 날짜를 바꿉니다.
        </p>
      ) : null}

      {/* 상세 패널 */}
      <UnifiedItemDetailPanel
        item={selectedItem}
        open={panelOpen}
        onOpenChange={setPanelOpen}
        onItemChange={setSelectedItem}
        returnTo={returnTo}
        canManageEvents={canManageEvents}
        canManageLessons={canManageLessons}
        onItemUpdated={onItemUpdated}
        onItemRemoved={onItemRemoved}
        viewer={editContext}
      />
    </div>
  );
}
