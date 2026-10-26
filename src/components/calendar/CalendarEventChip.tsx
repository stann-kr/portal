/**
 * @file src/components/calendar/CalendarEventChip.tsx
 * @description 통합 캘린더 칸 안의 항목. 월 칸은 점·시각·제목 한 줄(24px), 주 칸 시간 블록은
 * 점·시간 범위 줄과 제목 줄(캔버스 Calendar·CalendarWeek 보드).
 */
import type { EventContentArg } from "@fullcalendar/core";
import { UNIFIED_ITEM_TYPE_LABELS } from "@/components/ui/unified-item-type";
import type { UnifiedItemType } from "@/lib/utils/unifiedItemUtils";

type ChipProps = {
  itemType?: unknown;
  movable?: unknown;
  timeLabel?: unknown;
  timeRangeLabel?: unknown;
};

function isUnifiedItemType(value: unknown): value is UnifiedItemType {
  return typeof value === "string" && Object.hasOwn(UNIFIED_ITEM_TYPE_LABELS, value);
}

function CalendarEventChip({ arg }: { arg: EventContentArg }) {
  const props = arg.event.extendedProps as ChipProps;
  const itemType = isUnifiedItemType(props.itemType) ? props.itemType : null;
  const timeLabel = typeof props.timeLabel === "string" ? props.timeLabel : null;
  const timeRange = typeof props.timeRangeLabel === "string" ? props.timeRangeLabel : timeLabel;
  const dot = itemType ? <span className="calendar-chip-dot" aria-hidden="true" /> : null;
  const movable = props.movable === true ? "true" : undefined;

  // 주 보기의 시간 블록: 첫 줄에 점과 시간 범위, 둘째 줄에 제목.
  if (arg.view.type.startsWith("timeGrid") && !arg.event.allDay) {
    return (
      <span className="calendar-chip calendar-chip-block" data-movable={movable}>
        <span className="calendar-chip-line">
          {dot}
          {timeRange ? <span className="calendar-chip-time">{timeRange}</span> : null}
        </span>
        <span className="calendar-chip-title">{arg.event.title}</span>
      </span>
    );
  }

  return (
    <span className="calendar-chip" data-movable={movable}>
      {dot}
      {timeLabel && !arg.event.allDay ? <span className="calendar-chip-time">{timeLabel}</span> : null}
      <span className="calendar-chip-title">{arg.event.title}</span>
    </span>
  );
}

/**
 * 주 보기에서 칸을 고를 때 FullCalendar가 그리는 선택 미리보기(mirror)는 항목 정보가 없으므로
 * 기본 렌더를 쓰고, CSS가 점선 선택 블록으로 그린다.
 */
export function renderCalendarEventContent(arg: EventContentArg) {
  if (arg.isMirror && !isUnifiedItemType((arg.event.extendedProps as ChipProps).itemType)) return true;
  return <CalendarEventChip arg={arg} />;
}
