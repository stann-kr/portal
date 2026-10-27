/**
 * @file src/components/calendar/MobileMonthView.tsx
 * @description 좁은 화면의 월 보기(캔버스 MobileCalendarMonth): 54px 날짜 버튼과 유형 점, 아래에 고른 날의 목록.
 * 넓은 화면은 FullCalendar 월 보기가 맡는다.
 */
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getUnifiedItemColor, getUnifiedItemKey, type UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { eventDayRange } from "@/lib/student-today";
import { describeRelativeDay, sortDayAgenda } from "@/lib/unified-item-views";
import { cn } from "@/lib/utils";
import { CalendarAgendaRow } from "./CalendarAgendaRow";
import {
  formatDayHeading,
  formatMonthTitle,
  getItemDateKey,
  isInMonth,
  monthGridWeeks,
  monthOf,
  shiftDateKey,
  shiftMonth,
  todayKey as readTodayKey,
  type MonthCursor,
} from "./calendar-dates";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 여러 날에 걸친 일정을 그 기간의 날마다 놓는다(월 보기 점·고른 날 목록). 노트·과제 등은 한 날짜다. */
const MAX_SPAN_DAYS = 366;
export function groupItemsBySpannedDay(items: readonly UnifiedItem[]): Map<string, UnifiedItem[]> {
  const groups = new Map<string, UnifiedItem[]>();
  const push = (key: string, item: UnifiedItem) => {
    const current = groups.get(key);
    if (current) current.push(item);
    else groups.set(key, [item]);
  };
  for (const item of items) {
    const start = getItemDateKey(item);
    if (item.type !== "EVENT") {
      push(start, item);
      continue;
    }
    const { end } = eventDayRange(item);
    let key = start;
    for (let day = 0; day < MAX_SPAN_DAYS && key <= end; day += 1) {
      push(key, item);
      key = shiftDateKey(key, 1);
    }
    if (!groups.get(start)?.includes(item)) push(start, item);
  }
  return groups;
}

export function groupItemsByDay(items: readonly UnifiedItem[]): Map<string, UnifiedItem[]> {
  const groups = new Map<string, UnifiedItem[]>();
  for (const item of items) {
    const key = getItemDateKey(item);
    const current = groups.get(key);
    if (current) current.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** 고른 날 머리: "오늘 · 10월 26일 (월)" */
export function formatAgendaHeading(dateKey: string, today: string): string {
  const relative = describeRelativeDay(dateKey, today);
  return relative ? `${relative} · ${formatDayHeading(dateKey)}` : formatDayHeading(dateKey);
}

export function MobilePeriodBar({
  title,
  unit,
  onPrev,
  onToday,
  onNext,
}: {
  title: string;
  unit: "달" | "주";
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
}) {
  const iconButton = "flex size-11 items-center justify-center rounded-touch text-secondary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex h-14 items-center justify-between pl-5 pr-1">
      <h2 className="text-lg/[26px] font-semibold tracking-title" aria-live="polite">{title}</h2>
      <div className="flex items-center">
        <button type="button" onClick={onPrev} aria-label={`이전 ${unit}`} className={iconButton}>
          <ChevronLeft className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="h-11 rounded-touch px-2.5 text-body font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          오늘
        </button>
        <button type="button" onClick={onNext} aria-label={`다음 ${unit}`} className={iconButton}>
          <ChevronRight className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function MobileMonthView({
  items,
  showSpaceContext,
  onOpenItem,
  filters,
}: {
  /** 필터와 저장 전 이동이 반영된 항목. */
  items: readonly UnifiedItem[];
  showSpaceContext: boolean;
  onOpenItem: (item: UnifiedItem) => void;
  filters?: ReactNode;
}) {
  const [today] = useState(readTodayKey);
  const [cursor, setCursor] = useState<MonthCursor>(() => monthOf(today));
  const [selected, setSelected] = useState(today);
  const byDay = useMemo(() => groupItemsBySpannedDay(items), [items]);
  const weeks = monthGridWeeks(cursor);
  const selectedItems = sortDayAgenda(byDay.get(selected) ?? []);

  const moveMonth = (delta: number) => {
    const next = shiftMonth(cursor, delta);
    setCursor(next);
    setSelected(isInMonth(today, next) ? today : `${next.year}-${String(next.month).padStart(2, "0")}-01`);
  };

  return (
    <div className="flex flex-col">
      <MobilePeriodBar
        title={formatMonthTitle(cursor)}
        unit="달"
        onPrev={() => moveMonth(-1)}
        onNext={() => moveMonth(1)}
        onToday={() => {
          setCursor(monthOf(today));
          setSelected(today);
        }}
      />
      {filters ? <div className="px-5 pb-1">{filters}</div> : null}

      <div className="border-b border-muted px-2 pb-2">
        <div className="grid h-6 grid-cols-7 items-center" aria-hidden="true">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday} className="text-center text-[11px] text-muted-foreground">{weekday}</span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7">
            {week.map((dateKey) => {
              const dayItems = byDay.get(dateKey) ?? [];
              const isToday = dateKey === today;
              const isSelected = dateKey === selected;
              const inMonth = isInMonth(dateKey, cursor);
              const colors = [...new Set(dayItems.map(getUnifiedItemColor))].slice(0, 3);
              const { month } = monthOf(dateKey);
              const label = `${month}월 ${Number(dateKey.slice(8))}일${isToday ? ", 오늘" : ""}${dayItems.length ? `, 항목 ${dayItems.length}개` : ""}`;
              return (
                <button
                  key={dateKey}
                  type="button"
                  aria-label={label}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelected(dateKey);
                    if (!inMonth) setCursor(monthOf(dateKey));
                  }}
                  className="flex h-[54px] flex-col items-center gap-[3px] rounded-touch pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "flex size-[30px] items-center justify-center rounded-full font-mono text-ui",
                      isToday
                        ? "bg-highlight font-medium text-highlight-foreground"
                        : inMonth ? "text-foreground" : "text-muted-foreground",
                      isSelected && !isToday && "font-medium shadow-[inset_0_0_0_1.5px_var(--color-foreground)]",
                    )}
                  >
                    {Number(dateKey.slice(8))}
                  </span>
                  <span className="flex h-[5px] gap-[3px]" aria-hidden="true">
                    {colors.map((color) => (
                      <span key={color} className="size-[5px] rounded-full" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <section aria-labelledby="mobile-month-agenda" className="flex flex-col px-5 pb-8 pt-4">
        <h2 id="mobile-month-agenda" className="mb-1 text-ui font-semibold text-secondary-foreground">
          {formatAgendaHeading(selected, today)}
        </h2>
        {selectedItems.length > 0 ? (
          <ul className="flex flex-col">
            {selectedItems.map((item) => (
              <CalendarAgendaRow key={getUnifiedItemKey(item)} item={item} showSpaceContext={showSpaceContext} onOpen={onOpenItem} />
            ))}
          </ul>
        ) : (
          <p className="py-3 text-ui text-muted-foreground">이 날에는 항목이 없습니다.</p>
        )}
      </section>
    </div>
  );
}
