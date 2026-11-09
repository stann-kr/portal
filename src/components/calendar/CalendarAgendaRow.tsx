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
  UnifiedItemStudentChip,
} from "@/components/ui/unified-item-type";
import { toKstDateTimeInputValue } from "@/lib/date-input";
import { cn } from "@/lib/utils";
import { formatItemTime } from "./calendar-dates";

export function CalendarAgendaRow({
  item,
  showSpaceContext,
  showTimeRange = false,
  showStudentChip = false,
  onOpen,
}: {
  item: UnifiedItem;
  showSpaceContext: boolean;
  /** 관리자 일정 "전체 학생": 제목 앞에 학생 이름 칩. */
  showStudentChip?: boolean;
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
        className="flex min-h-12 w-full items-start gap-3 border-b py-2.5 md:h-11 md:min-h-0 md:items-center md:py-0 border-muted text-left text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:h-11 md:px-1"
      >
        {/* 좁은 화면(B 묶음 ⑥): 제목 두 줄까지, 종류는 시각 아래로. 넓은 화면은 한 줄 그대로. */}
        <span className={cn("flex shrink-0 flex-col gap-0.5", showTimeRange ? "w-[88px]" : "w-10 md:w-12")}>
          <span className="font-mono text-xs leading-[22px] text-muted-foreground md:leading-normal">{when}</span>
          <span className="truncate text-[11px] leading-4 text-muted-foreground md:hidden">{getUnifiedItemKindLabel(item)}</span>
        </span>
        <span className="mt-2 flex shrink-0 md:mt-0"><UnifiedItemDot item={item} /></span>
        {showStudentChip ? <UnifiedItemStudentChip label={item.space.label} /> : null}
        <span className="line-clamp-2 min-w-0 flex-1 text-md leading-[22px] md:line-clamp-none md:truncate md:text-body md:leading-normal">{item.title}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
          {getUnifiedItemKindLabel(item)}
          {external ? ` · ${item.source.label}` : null}
        </span>
      </button>
    </li>
  );
}
