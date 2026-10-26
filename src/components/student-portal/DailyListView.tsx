/**
 * @file src/components/student-portal/DailyListView.tsx
 * @description 일별 보기. 넓은 화면은 날짜별 묶음(캔버스 CalendarDaily: 오늘·내일 표시, 개수, 그날 추가),
 * 좁은 화면은 주 띠와 그 주의 날짜별 목록(MobileCalendar)이다.
 */
"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { LocateFixed, Plus } from "lucide-react";
import {
  getUnifiedItemKey,
  type UnifiedItem,
  type UnifiedItemType,
} from "@/lib/utils/unifiedItemUtils";
import { UNIFIED_ITEM_TYPES } from "@/components/ui/unified-item-type";
import { UnifiedItemDetailPanel, type UnifiedItemChangeHandlers } from "./UnifiedItemDetailPanel";
import {
  CalendarQuickCreate,
  canUseQuickCreate,
  getQuickCreateAnchor,
  type CalendarQuickCreateOptions,
} from "@/components/calendar/CalendarQuickCreate";
import { CalendarAgendaRow } from "@/components/calendar/CalendarAgendaRow";
import { formatAgendaHeading, groupItemsByDay, MobilePeriodBar } from "@/components/calendar/MobileMonthView";
import {
  formatDayHeading,
  formatMonthTitle,
  monthOf,
  shiftDateKey,
  todayKey as readTodayKey,
  weekKeys,
  weekStartKey,
} from "@/components/calendar/calendar-dates";
import {
  createDaySelection,
  describeRelativeDay,
  findClosestDayKey,
  sortDayAgenda,
} from "@/lib/unified-item-views";
import { matchesCalendarPreset, type CalendarPreset } from "@/lib/calendar-section-contract";
import type { CalendarQuickCreateSelection } from "@/lib/calendar-quick-create";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatKst } from "@/lib/kst-format";
import { cn } from "@/lib/utils";

const ALL_TYPES: ReadonlySet<UnifiedItemType> = new Set(UNIFIED_ITEM_TYPES);

interface DailyListViewProps extends UnifiedItemChangeHandlers {
  items: UnifiedItem[];
  returnTo: string;
  showSpaceContext: boolean;
  /** 캘린더와 같은 빠른 만들기. 없으면 날짜별 추가를 숨긴다. */
  quickCreate?: CalendarQuickCreateOptions;
  /** 캘린더와 함께 쓰는 유형 필터. 없으면 모두 보인다. */
  visibleTypes?: ReadonlySet<UnifiedItemType>;
  preset?: CalendarPreset | null;
  filters?: ReactNode;
  mobileFilters?: ReactNode;
}

function yearOf(dateKey: string): string {
  return dateKey.slice(0, 4);
}

export function DailyListView({
  items,
  returnTo,
  showSpaceContext,
  quickCreate,
  visibleTypes = ALL_TYPES,
  preset = null,
  filters,
  mobileFilters,
  canManageEvents,
  canManageLessons,
  onItemUpdated,
  onItemRemoved,
  viewer,
}: DailyListViewProps) {
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [todayKey] = useState(readTodayKey);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [quick, setQuick] = useState<{
    selection: CalendarQuickCreateSelection;
    anchor: { x: number; y: number } | null;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const mobileListRef = useRef<HTMLDivElement>(null);
  const canAdd = canUseQuickCreate(quickCreate);

  const visible = useMemo(
    () => items.filter((item) => visibleTypes.has(item.type) && matchesCalendarPreset(item, preset)),
    [items, preset, visibleTypes],
  );
  const grouped = useMemo(() => groupItemsByDay(visible), [visible]);
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));
  const jumpKey = findClosestDayKey(sortedKeys, todayKey);
  const currentYear = yearOf(todayKey);

  const openItem = (item: UnifiedItem) => {
    setSelectedItem(item);
    setPanelOpen(true);
  };

  const openQuickCreate = (dateKey: string, trigger: HTMLElement) => {
    setQuick({ selection: createDaySelection(dateKey), anchor: getQuickCreateAnchor(trigger), returnFocus: trigger });
  };

  const quickCreatePanel = quick && quickCreate ? (
    <CalendarQuickCreate
      selection={quick.selection}
      anchor={quick.anchor}
      options={quickCreate}
      onCreated={(item) => onItemUpdated?.(item)}
      onClose={() => {
        const target = quick.returnFocus;
        setQuick(null);
        target?.focus({ preventScroll: true });
      }}
    />
  ) : null;

  // 좁은 화면: 고른 날이 속한 주(일요일 시작). 항목이 있는 날과 고른 날만 묶음으로 보인다.
  const weekStart = weekStartKey(selectedDay);
  const week = weekKeys(weekStart);
  const weekEnd = week[6];
  const mobileDays = week.filter((dateKey) => grouped.has(dateKey) || dateKey === selectedDay);
  const weekLabel = `${formatKst(new Date(`${weekStart}T12:00:00+09:00`), { month: "long", day: "numeric" })}부터 ${
    monthOf(weekEnd).month === monthOf(weekStart).month ? `${Number(weekEnd.slice(8))}일` : formatKst(new Date(`${weekEnd}T12:00:00+09:00`), { month: "long", day: "numeric" })
  }까지`;

  // 관리자 좁은 화면 일정은 기간 줄에 그 주를 보인다(MobileAdminSchedule "10월 25일 – 31일").
  const weekRangeTitle = `${formatKst(new Date(`${weekStart}T12:00:00+09:00`), { month: "long", day: "numeric" })} – ${
    monthOf(weekEnd).month === monthOf(weekStart).month ? `${Number(weekEnd.slice(8))}일` : formatKst(new Date(`${weekEnd}T12:00:00+09:00`), { month: "long", day: "numeric" })
  }`;

  const selectMobileDay = (dateKey: string) => {
    setSelectedDay(dateKey);
    requestAnimationFrame(() => {
      mobileListRef.current
        ?.querySelector<HTMLElement>(`[data-day="${dateKey}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  return (
    <>
      {/* 넓은 화면: 날짜별 묶음 */}
      <div className="hidden md:flex md:flex-col md:gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {jumpKey ? (
            <Button
              type="button"
              variant="outline"
              className="px-2.5"
              onClick={() => {
                const target = listRef.current?.querySelector<HTMLElement>(`[data-day="${jumpKey}"]`);
                target?.scrollIntoView({ block: "start", behavior: "smooth" });
                target?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
              }}
            >
              <LocateFixed className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              {jumpKey === todayKey ? "오늘로 이동" : "가까운 날로 이동"}
            </Button>
          ) : <span />}
          {filters}
        </div>

        {sortedKeys.length === 0 ? (
          <EmptyState
            className="max-w-[880px]"
            title={items.length === 0 ? "표시할 기록이 없습니다" : "필터에 맞는 기록이 없습니다"}
            description={items.length === 0
              ? "일정·노트·디깅·질문을 기록하면 날짜별로 모입니다."
              : "위의 유형 필터에서 숨긴 유형을 다시 켜 보세요."}
            action={canAdd && items.length === 0 ? (
              <Button type="button" variant="outline" onClick={(event) => openQuickCreate(todayKey, event.currentTarget)}>
                <Plus className="size-3.5" aria-hidden="true" />
                오늘 항목 만들기
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="flex max-w-[880px] flex-col gap-3" ref={listRef}>
            {sortedKeys.map((dateKey) => {
              const dayItems = sortDayAgenda(grouped.get(dateKey)!);
              const relative = describeRelativeDay(dateKey, todayKey);
              const heading = `${yearOf(dateKey) !== currentYear ? `${yearOf(dateKey)}년 ` : ""}${formatDayHeading(dateKey)}`;
              return (
                <section key={dateKey} data-day={dateKey} aria-labelledby={`day-${dateKey}`} className="flex scroll-mt-4 flex-col">
                  <div className="flex h-10 items-center justify-between gap-3 border-b border-border">
                    <h2
                      id={`day-${dateKey}`}
                      tabIndex={-1}
                      className="flex items-center gap-2 text-ui font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {relative ? (
                        <span
                          className={cn(
                            "inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-medium",
                            relative === "오늘" ? "bg-highlight text-highlight-foreground" : "bg-muted text-secondary-foreground",
                          )}
                        >
                          {relative}
                        </span>
                      ) : null}
                      {heading}
                      <span className="font-mono font-normal text-muted-foreground">{dayItems.length}개</span>
                    </h2>
                    {canAdd ? (
                      <button
                        type="button"
                        onClick={(event) => openQuickCreate(dateKey, event.currentTarget)}
                        aria-label={`${heading}에 추가`}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                      >
                        <Plus className="size-3" strokeWidth={1.8} aria-hidden="true" />
                        추가
                      </button>
                    ) : null}
                  </div>
                  <ul className="flex flex-col">
                    {dayItems.map((item) => (
                      <CalendarAgendaRow key={getUnifiedItemKey(item)} item={item} showSpaceContext={showSpaceContext} onOpen={openItem} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* 좁은 화면: 주 띠와 그 주의 날짜별 목록 */}
      <div className="md:hidden">
        <MobilePeriodBar
          title={showSpaceContext ? weekRangeTitle : formatMonthTitle(monthOf(selectedDay))}
          unit="주"
          onPrev={() => setSelectedDay(shiftDateKey(selectedDay, -7))}
          onNext={() => setSelectedDay(shiftDateKey(selectedDay, 7))}
          onToday={() => selectMobileDay(todayKey)}
        />
        {mobileFilters ? <div className="px-5 pb-1">{mobileFilters}</div> : null}
        <div role="group" aria-label={weekLabel} className="grid grid-cols-7 border-b border-muted px-2 pb-2.5">
          {week.map((dateKey) => {
            const isToday = dateKey === todayKey;
            const isSelected = dateKey === selectedDay;
            const hasItems = grouped.has(dateKey);
            const date = new Date(`${dateKey}T12:00:00+09:00`);
            const weekday = formatKst(date, { weekday: "short" });
            return (
              <button
                key={dateKey}
                type="button"
                aria-label={`${formatKst(date, { month: "long", day: "numeric", weekday: "long" })}${isToday ? ", 오늘" : ""}${hasItems ? ", 항목 있음" : ""}`}
                aria-pressed={isSelected}
                onClick={() => selectMobileDay(dateKey)}
                className="flex h-[68px] flex-col items-center gap-1 rounded-touch pt-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className={cn("text-[11px] leading-4", isToday ? "text-highlight" : "text-muted-foreground")}>{weekday}</span>
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full font-mono text-body",
                    isToday && "bg-highlight font-medium text-highlight-foreground",
                    isSelected && !isToday && "font-medium shadow-[inset_0_0_0_1.5px_var(--color-foreground)]",
                  )}
                >
                  {Number(dateKey.slice(8))}
                </span>
                <span aria-hidden="true" className={cn("size-1 rounded-full", hasItems ? "bg-event-note" : "bg-transparent")} />
              </button>
            );
          })}
        </div>
        <div ref={mobileListRef} className="flex flex-col px-5 pb-8">
          {mobileDays.map((dateKey) => {
            const dayItems = sortDayAgenda(grouped.get(dateKey) ?? []);
            return (
              <section key={dateKey} data-day={dateKey} aria-labelledby={`mobile-day-${dateKey}`} className="flex scroll-mt-4 flex-col pt-5">
                <h2 id={`mobile-day-${dateKey}`} className="mb-1 text-ui font-semibold text-secondary-foreground">
                  {formatAgendaHeading(dateKey, todayKey)}
                </h2>
                {dayItems.length > 0 ? (
                  <ul className="flex flex-col">
                    {dayItems.map((item) => (
                      <CalendarAgendaRow key={getUnifiedItemKey(item)} item={item} showSpaceContext={showSpaceContext} showTimeRange={showSpaceContext} onOpen={openItem} />
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-ui text-muted-foreground">이 날에는 항목이 없습니다.</p>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {quickCreatePanel}

      {/* 상세 패널 */}
      <UnifiedItemDetailPanel
        item={selectedItem}
        open={panelOpen}
        onOpenChange={setPanelOpen}
        onItemChange={setSelectedItem}
        returnTo={returnTo}
        showSpaceContext={showSpaceContext}
        canManageEvents={canManageEvents}
        canManageLessons={canManageLessons}
        onItemUpdated={onItemUpdated}
        onItemRemoved={onItemRemoved}
        viewer={viewer}
      />
    </>
  );
}
