/**
 * @file src/components/student-portal/UnifiedCalendar.tsx
 * @description 통합 캘린더의 월·주 보기(캔버스 Calendar·CalendarWeek·AdminSchedule).
 * 칸을 누르거나 끌어 고르면 그 자리에서 만들고, 권한이 있는 일정·레슨·노트는 끌어서 옮긴다.
 * 항목을 누르면 상세 패널을 연다. 좁은 화면은 MobileSpec대로 작은 월 달력과 고른 날 목록을 그린다.
 */
"use client";

import { useState, useCallback, useEffect, useInsertionEffect, useRef, type ReactNode } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import koLocale from "@fullcalendar/core/locales/ko";
import type {
  DateSelectArg,
  DateSpanApi,
  DayCellContentArg,
  DayHeaderContentArg,
  DatesSetArg,
  EventApi,
  EventClickArg,
  EventDropArg,
  EventInput,
  EventMountArg,
  MoreLinkContentArg,
  SlotLabelContentArg,
} from "@fullcalendar/core";
import type { DateClickArg, EventResizeDoneArg } from "@fullcalendar/interaction";
import { ChevronLeft, ChevronRight, TriangleAlert, X } from "lucide-react";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import { getUnifiedItemColor, getUnifiedItemKey } from "@/lib/utils/unifiedItemUtils";
import { UnifiedItemDetailPanel, type UnifiedItemChangeHandlers } from "./UnifiedItemDetailPanel";
import { UNIFIED_ITEM_TYPES } from "@/components/ui/unified-item-type";
import { renderCalendarEventContent } from "@/components/calendar/CalendarEventChip";
import { MobileMonthView } from "@/components/calendar/MobileMonthView";
import {
  CalendarQuickCreate,
  canUseQuickCreate,
  type CalendarQuickCreateOptions,
} from "@/components/calendar/CalendarQuickCreate";
import { Button, ButtonSpinner } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

export type CalendarGridView = "dayGridMonth" | "timeGridWeek";

const ALL_TYPES: ReadonlySet<UnifiedItemType> = new Set(UNIFIED_ITEM_TYPES);

interface UnifiedCalendarProps extends UnifiedItemChangeHandlers {
  isActive?: boolean;
  items: UnifiedItem[];
  returnTo: string;
  showSpaceContext: boolean;
  /** 월·주 보기. 보기 전환은 CalendarSection의 "월·주·일별·전체" 세그먼트가 맡는다. */
  view?: CalendarGridView;
  /** 보기를 바꿔도 남도록 CalendarSection이 가진 유형 필터. 없으면 모두 보인다. */
  visibleTypes?: ReadonlySet<UnifiedItemType>;
  preset?: CalendarPreset | null;
  /** 기간 줄 오른쪽(좁은 화면은 기간 줄 아래)에 놓는 필터. */
  filters?: ReactNode;
  mobileFilters?: ReactNode;
  /** 보는 사람과 이 스페이스에서의 권한. 없으면 아무것도 끌 수 없다. */
  editContext?: CalendarEditContext;
  /** 칸을 눌러 바로 만들기. 없으면 칸 선택을 끈다. */
  quickCreate?: CalendarQuickCreateOptions;
}

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

// 한국어 locale은 "26일"처럼 붙이므로 숫자만 남긴다.
function renderDayCell(arg: DayCellContentArg) {
  return arg.dayNumberText.replace(/일$/u, "");
}

// 주 보기 머리는 요일과 날짜 숫자(오늘은 파랑 원)를 함께 둔다. 월 보기는 요일만.
function renderDayHeader(arg: DayHeaderContentArg) {
  if (!arg.view.type.startsWith("timeGrid")) return arg.text;
  return (
    <span className="calendar-dayhead">
      <span>{arg.text}</span>
      <span className="calendar-dayhead-num">{arg.date.getUTCDate()}</span>
    </span>
  );
}

function renderMoreLink(arg: MoreLinkContentArg) {
  return `+${arg.num}개 더`;
}

/** 캘린더는 UTC에 KST 벽시계를 넣으므로 UTC 값이 곧 화면 날짜다. */
function formatPeriodTitle(arg: DatesSetArg): string {
  const start = arg.view.currentStart;
  if (arg.view.type === "dayGridMonth") return `${start.getUTCFullYear()}년 ${start.getUTCMonth() + 1}월`;
  const last = new Date(arg.view.currentEnd.getTime() - 24 * 60 * 60 * 1_000);
  const startLabel = `${start.getUTCMonth() + 1}월 ${start.getUTCDate()}일`;
  const endLabel = last.getUTCMonth() === start.getUTCMonth()
    ? `${last.getUTCDate()}일`
    : `${last.getUTCMonth() + 1}월 ${last.getUTCDate()}일`;
  const thisYear = getCalendarNow().getUTCFullYear();
  const year = start.getUTCFullYear() !== thisYear || last.getUTCFullYear() !== thisYear ? `${start.getUTCFullYear()}년 ` : "";
  return `${year}${startLabel} – ${endLabel}`;
}

// 시각 열은 "10:00"(Mono 11). UTC 칸에 KST 벽시계를 넣으므로 UTC 시가 곧 화면 시각이다.
function renderSlotLabel(arg: SlotLabelContentArg) {
  return `${String(arg.date.getUTCHours()).padStart(2, "0")}:00`;
}

const DAY_HEADER_FORMAT = { weekday: "short" } as const;
const CALENDAR_PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin];
/** 주 보기는 12시간(48px × 12)이 한 화면에 들어오는 높이로 두고 안에서 넘긴다. */
const WEEK_CONTENT_HEIGHT = 680;

export function UnifiedCalendar({
  isActive = true,
  items,
  returnTo,
  showSpaceContext,
  view = "dayGridMonth",
  visibleTypes = ALL_TYPES,
  preset = null,
  filters,
  mobileFilters,
  editContext,
  quickCreate,
  canManageEvents,
  canManageLessons,
  onItemUpdated,
  onItemRemoved,
}: UnifiedCalendarProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [initialView] = useState<CalendarGridView>(view);
  // 서버 렌더에는 기간 제목을 모르므로 비워 두고, 달력이 알려 준 실제 기간으로 채운다.
  const [period, setPeriod] = useState<{ type: CalendarGridView | null; title: string }>({ type: null, title: "" });

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

  // 세그먼트에서 고른 월·주 보기를 달력에 맞춘다. 날짜는 그대로 둔다. FullCalendar는 보기를 바꿀 때
  // 동기 렌더(flushSync)를 쓰므로 React의 커밋이 끝난 뒤(microtask)에 바꾼다.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const api = calendarRef.current?.getApi();
      if (!cancelled && api && api.view.type !== view) api.changeView(view);
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

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
  const lockedPressRef = useRef<{ pointerId: number; x: number; y: number; reason: string } | null>(null);
  const withPendingMove = (item: UnifiedItem) => {
    const pending = pendingMoves.get(getUnifiedItemKey(item));
    return pending ? applyCalendarMoveToItem(item, pending.request) : item;
  };
  const displayedItems = pendingMoves.size === 0 ? items : items.map(withPendingMove);
  // 저장 응답을 기다리는 이동이 있으면 달력 위 알림 자리에 저장 중을 보인다.
  const savingMove = [...pendingMoves.values()].some((pending) => !pending.saved);
  const visibleItems = displayedItems.filter((item) => matchesCalendarPreset(item, preset) && visibleTypes.has(item.type));
  const selectedKey = panelOpen && selectedItem ? getUnifiedItemKey(selectedItem) : null;

  // UnifiedItem → FullCalendar EventInput
  const fcEvents: EventInput[] = visibleItems.map((item) => {
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
    const timeLabel = allDay ? null : formatKst(item.date, KST_TIME);
    return {
      id: key,
      // 관리자 일정은 늘 학생 한 명만 보이므로 칩에는 제목만 둔다(학생은 상세 패널 머리의 칩이 보인다).
      title,
      start: allDay && allDayStartDate ? allDayStartDate : toCalendarWallTime(item.date),
      end: allDay
        ? allDayEndDate ?? undefined
        : item.endDate ? toCalendarWallTime(new Date(item.endDate)) : undefined,
      allDay,
      startEditable: movable,
      durationEditable: movable && editing?.resizable === true && Boolean(item.endDate),
      backgroundColor: "transparent",
      borderColor: "transparent",
      textColor: "inherit",
      classNames: [
        "calendar-event",
        movable ? "calendar-event-movable" : "calendar-event-locked",
        ...(key === selectedKey ? ["calendar-event-selected"] : []),
      ],
      extendedProps: {
        itemType: item.type,
        movable,
        color,
        timeLabel,
        timeRangeLabel: timeLabel && item.endDate ? `${timeLabel}–${formatKst(item.endDate, KST_TIME)}` : timeLabel,
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

  const openItem = (item: UnifiedItem) => {
    setSelectedItem(withPendingMove(item));
    setPanelOpen(true);
  };

  // 이벤트 클릭 → 상세 패널
  const handleEventClick = (arg: EventClickArg) => {
    const found = items.find((item) => getUnifiedItemKey(item) === arg.event.id);
    if (!found) return;
    // 패널이 닫히면 누른 칩으로 초점을 돌려주도록 먼저 칩에 초점을 둔다.
    const trigger = arg.el.matches("a, button, [tabindex]")
      ? arg.el
      : arg.el.querySelector<HTMLElement>("a, button, [tabindex]");
    trigger?.focus({ preventScroll: true });
    openItem(found);
  };

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    const next = { type: arg.view.type as CalendarGridView, title: formatPeriodTitle(arg) };
    setPeriod((current) => (current.type === next.type && current.title === next.title ? current : next));
  }, []);

  const api = () => calendarRef.current?.getApi();
  const canQuickCreate = canUseQuickCreate(quickCreate);
  const isWeek = (period.type ?? view) === "timeGridWeek";
  const unit = isWeek ? "주" : "달";
  const hint = canQuickCreate && context
    ? isWeek
      ? "칸을 끌어서 시간을 정해 만들고, 항목을 끌어 날짜와 시간을 옮깁니다."
      : "칸을 누르거나 끌어서 만들고, 항목을 끌어 날짜를 옮깁니다."
    : canQuickCreate
      ? isWeek ? "칸을 끌어서 시간을 정해 만듭니다." : "칸을 누르거나 끌어서 만듭니다."
      : context
        ? isWeek ? "항목을 끌어 날짜와 시간을 옮깁니다." : "항목을 끌어 날짜를 옮깁니다."
        : null;
  const iconButton = "inline-flex size-8 items-center justify-center rounded-md text-secondary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

  return (
    <div
      ref={containerRef}
      className="flex flex-col md:gap-5"
      onPointerDownCapture={(event) => {
        const locked = (event.target as Element).closest<HTMLElement>(".calendar-event-locked");
        const reason = locked?.dataset.lockReason;
        lockedPressRef.current = reason
          ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, reason }
          : null;
      }}
      onPointerMoveCapture={(event) => {
        const press = lockedPressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return;
        lockedPressRef.current = null;
        setNotice({ tone: "status", message: press.reason });
      }}
      onPointerUpCapture={() => {
        lockedPressRef.current = null;
      }}
      onPointerCancelCapture={() => {
        lockedPressRef.current = null;
      }}
    >
      {/* 기간 줄: 제목 · 이전/오늘/다음 · 유형 필터 */}
      <div className="hidden flex-wrap items-center justify-between gap-3 md:flex">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="mr-3 min-w-0 truncate text-lg/[26px] font-semibold tracking-title" data-calendar-title aria-live="polite">
            {period.title}
          </h2>
          <button type="button" onClick={() => api()?.prev()} aria-label={`이전 ${unit}`} className={iconButton}>
            <ChevronLeft className="size-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <Button type="button" variant="outline" className="px-2.5" onClick={() => api()?.today()}>
            오늘
          </Button>
          <button type="button" onClick={() => api()?.next()} aria-label={`다음 ${unit}`} className={iconButton}>
            <ChevronRight className="size-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        {filters}
      </div>

      {!notice && savingMove ? (
        <div role="status" className="mx-5 mb-3 flex min-h-10 items-center gap-2 rounded-touch bg-sidebar px-3.5 py-1.5 text-ui text-secondary-foreground md:mx-0 md:mb-0">
          <ButtonSpinner />
          옮긴 자리를 저장하는 중…
        </div>
      ) : null}
      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "mx-5 mb-3 flex min-h-10 flex-wrap items-center gap-2 rounded-touch text-ui md:mx-0 md:mb-0",
            notice.tone === "error"
              ? "bg-destructive-muted px-3.5 py-2 text-destructive"
              : "justify-between bg-sidebar py-1.5 pl-3.5 pr-2 text-foreground",
          )}
        >
          {notice.tone === "error" ? <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" /> : null}
          <span className="min-w-0 flex-1 break-words">{notice.message}</span>
          <span className="flex items-center gap-1">
            {notice.tone === "status" && notice.undo ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const undo = notice.undo;
                  if (undo) void commitMove(undo.item, undo.request, { undoable: false });
                }}
              >
                되돌리기
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="알림 닫기"
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                notice.tone === "error" ? "hover:bg-background/60" : "text-secondary-foreground hover:bg-background hover:text-foreground",
              )}
            >
              <X className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : null}

      {/* 넓은 화면: FullCalendar 월·주 */}
      <div className={cn("fc-custom fc-notion hidden md:block", canQuickCreate && "calendar-can-create")} aria-label="통합 일정 달력">
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
          height={view === "timeGridWeek" ? undefined : "auto"}
          contentHeight={view === "timeGridWeek" ? WEEK_CONTENT_HEIGHT : undefined}
          eventDisplay="block"
          dayMaxEvents={3}
          moreLinkContent={renderMoreLink}
          dayCellContent={renderDayCell}
          dayHeaderContent={renderDayHeader}
          allDayText="종일"
          nowIndicator
          scrollTime="10:00:00"
          slotLabelContent={renderSlotLabel}
          dayHeaderFormat={DAY_HEADER_FORMAT}
          fixedWeekCount={false}
        />
      </div>
      {hint ? <p className="hidden text-xs text-muted-foreground md:block">{hint}</p> : null}

      {/* 좁은 화면: 작은 월 달력과 고른 날 목록(MobileCalendarMonth) */}
      <div className="md:hidden">
        <MobileMonthView
          items={visibleItems}
          showSpaceContext={showSpaceContext}
          onOpenItem={openItem}
          filters={mobileFilters}
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
        open={panelOpen && isActive}
        onOpenChange={setPanelOpen}
        onItemChange={setSelectedItem}
        returnTo={returnTo}
        showSpaceContext={showSpaceContext}
        canManageEvents={canManageEvents}
        canManageLessons={canManageLessons}
        onItemUpdated={onItemUpdated}
        onItemRemoved={onItemRemoved}
        viewer={editContext}
      />
    </div>
  );
}
