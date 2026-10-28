/**
 * @file src/components/calendar/CalendarAgendaRow.tsx
 * @description 일별 목록과 좁은 화면 월·일별 보기의 한 줄: 시각 Mono · 유형 점 · 제목 · 종류.
 * 넓은 화면 44px(CalendarDaily), 좁은 화면 48px(MobileCalendar·MobileCalendarMonth).
 */
"use client";

import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import {
  describeUnifiedItemRow,
  getUnifiedItemKindLabel,
  UnifiedItemDot,
} from "@/components/ui/unified-item-type";
import { toKstDateTimeInputValue } from "@/lib/date-input";
import { cn } from "@/lib/utils";
import { formatItemTime } from "./calendar-dates";

export function CalendarAgendaRow({
  item,
  showSpaceContext,
  showTimeRange = false,
  onOpen,
}: {
  item: UnifiedItem;
  showSpaceContext: boolean;
  /** 관리자 좁은 화면 일정(MobileAdminSchedule)은 "14:00–15:30"처럼 끝 시각까지 보인다. */
  showTimeRange?: boolean;
  onOpen: (item: UnifiedItem) => void;
}) {
  const start = formatItemTime(item);
  const end = showTimeRange && item.endDate && start !== "종일" ? toKstDateTimeInputValue(new Date(item.endDate)).slice(11) : null;
  const when = end ? `${start}–${end}` : start;
  const external = item.source.kind !== "PORTAL";
  return (
    <li>
      <button
        type="button"
        aria-label={describeUnifiedItemRow(item, when, showSpaceContext)}
        onClick={() => onOpen(item)}
        className="flex h-12 w-full items-center gap-3 border-b border-muted text-left text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:h-11 md:px-1"
      >
        <span className={cn("shrink-0 font-mono text-xs text-muted-foreground", showTimeRange ? "w-[88px]" : "w-10 md:w-12")}>{when}</span>
        <UnifiedItemDot item={item} />
        <span className="min-w-0 flex-1 truncate text-md md:text-body">{item.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {getUnifiedItemKindLabel(item)}
          {external ? ` · ${item.source.label}` : null}
        </span>
      </button>
    </li>
  );
}
