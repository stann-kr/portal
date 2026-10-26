/**
 * @file src/components/calendar/CalendarEventChip.tsx
 * @description 통합 캘린더 칸 안의 항목 칩. 타입 아이콘·시각·제목을 한 줄로 보여 준다.
 */
import type { EventContentArg } from "@fullcalendar/core";
import { UNIFIED_ITEM_TYPE_LABELS, UnifiedItemTypeIcon } from "@/components/ui/unified-item-type";
import type { UnifiedItemType } from "@/lib/utils/unifiedItemUtils";

type ChipProps = {
  itemType?: unknown;
  movable?: unknown;
  timeLabel?: unknown;
};

function isUnifiedItemType(value: unknown): value is UnifiedItemType {
  return typeof value === "string" && Object.hasOwn(UNIFIED_ITEM_TYPE_LABELS, value);
}

function CalendarEventChip({ arg }: { arg: EventContentArg }) {
  const props = arg.event.extendedProps as ChipProps;
  const itemType = isUnifiedItemType(props.itemType) ? props.itemType : null;
  const timeLabel = typeof props.timeLabel === "string" ? props.timeLabel : null;
  return (
    <span className="calendar-chip" data-movable={props.movable === true ? "true" : undefined}>
      {itemType ? <UnifiedItemTypeIcon type={itemType} className="calendar-chip-icon" /> : null}
      {timeLabel && !arg.event.allDay ? <span className="calendar-chip-time">{timeLabel}</span> : null}
      <span className="calendar-chip-title">{arg.event.title}</span>
    </span>
  );
}

/**
 * 목록 보기는 기본 렌더(true)로 제목 링크와 표 의미를 그대로 둔다. 주 보기에서 칸을 고를 때
 * FullCalendar가 그리는 선택 미리보기(mirror)는 항목 정보가 없으므로 기본 렌더를 쓴다.
 */
export function renderCalendarEventContent(arg: EventContentArg) {
  if (arg.view.type.startsWith("list")) return true;
  if (arg.isMirror && !isUnifiedItemType((arg.event.extendedProps as ChipProps).itemType)) return true;
  return <CalendarEventChip arg={arg} />;
}
