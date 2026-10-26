/**
 * @file src/components/student-portal/DailyListView.tsx
 * @description UnifiedItem[]을 날짜별로 묶은 노션식 목록 뷰.
 * 날짜마다 오늘·내일 표시와 개수, 줄 단위 항목, 그날에 바로 추가하는 행을 둔다.
 */
"use client";

import { useRef, useState } from "react";
import { CalendarCheck, Plus } from "lucide-react";
import {
  getUnifiedItemColor,
  getUnifiedItemKey,
  type UnifiedItem,
} from "@/lib/utils/unifiedItemUtils";
import {
  describeUnifiedItemRow,
  UnifiedItemSpaceBadge,
  UnifiedItemTypeBadge,
  UnifiedItemTypeIcon,
} from "@/components/ui/unified-item-type";
import { UnifiedItemDetailPanel, type UnifiedItemChangeHandlers } from "./UnifiedItemDetailPanel";
import {
  CalendarQuickCreate,
  canUseQuickCreate,
  getQuickCreateAnchor,
  type CalendarQuickCreateOptions,
} from "@/components/calendar/CalendarQuickCreate";
import { groupUnifiedItemsByKstDate } from "@/lib/unified-item-date-groups";
import {
  createDaySelection,
  describeRelativeDay,
  findClosestDayKey,
  isUnifiedItemAllDay,
} from "@/lib/unified-item-views";
import type { CalendarQuickCreateSelection } from "@/lib/calendar-quick-create";
import { toKstDateInputValue } from "@/lib/date-input";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatKst } from "@/lib/kst-format";

function formatGroupDate(date: Date): string {
  return formatKst(date, { month: "long", day: "numeric", weekday: "short" });
}

function formatGroupYear(date: Date): string {
  return formatKst(date, { year: "numeric" });
}

function formatTime(date: Date): string {
  return formatKst(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function formatWhen(item: UnifiedItem): string {
  return isUnifiedItemAllDay(item) ? "종일" : formatTime(item.date);
}

interface DailyListViewProps extends UnifiedItemChangeHandlers {
  items: UnifiedItem[];
  returnTo: string;
  showSpaceContext: boolean;
  /** 캘린더와 같은 빠른 만들기. 없으면 추가 행을 숨긴다. */
  quickCreate?: CalendarQuickCreateOptions;
}

export function DailyListView({
  items,
  returnTo,
  showSpaceContext,
  quickCreate,
  canManageEvents,
  canManageLessons,
  onItemUpdated,
  onItemRemoved,
}: DailyListViewProps) {
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [todayKey] = useState(() => toKstDateInputValue(new Date()));
  const [quick, setQuick] = useState<{
    selection: CalendarQuickCreateSelection;
    anchor: { x: number; y: number } | null;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const canAdd = canUseQuickCreate(quickCreate);

  const grouped = groupUnifiedItemsByKstDate(items);
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));
  const jumpKey = findClosestDayKey(sortedKeys, todayKey);
  const currentYear = formatGroupYear(new Date(`${todayKey}T00:00:00+09:00`));

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

  if (items.length === 0) {
    return (
      <>
        <EmptyState
          title="표시할 기록이 없습니다"
          description="일정·노트·디깅·질문을 기록하면 날짜별로 모입니다."
          action={canAdd ? (
            <Button type="button" size="sm" variant="outline" onClick={(event) => openQuickCreate(todayKey, event.currentTarget)}>
              <Plus className="size-3.5" aria-hidden="true" />
              오늘 항목 만들기
            </Button>
          ) : undefined}
        />
        {quickCreatePanel}
      </>
    );
  }

  return (
    <>
      <div className="mx-auto flex max-w-3xl flex-col gap-1" ref={listRef}>
        {jumpKey ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                const target = listRef.current?.querySelector<HTMLElement>(`[data-day="${jumpKey}"]`);
                target?.scrollIntoView({ block: "start", behavior: "smooth" });
                target?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CalendarCheck className="size-3.5" aria-hidden="true" />
              {jumpKey === todayKey ? "오늘로 이동" : "가까운 날로 이동"}
            </button>
          </div>
        ) : null}

        {sortedKeys.map((dateKey) => {
          const dayItems = grouped.get(dateKey)!;
          const sampleDate = new Date(`${dateKey}T12:00:00+09:00`);
          const relative = describeRelativeDay(dateKey, todayKey);
          const year = formatGroupYear(sampleDate);
          const isToday = dateKey === todayKey;

          return (
            <section key={dateKey} data-day={dateKey} aria-labelledby={`day-${dateKey}`} className="scroll-mt-4 pb-4">
              {/* 날짜 머리: 오늘·내일 표시, 날짜, 개수 */}
              <div className="sticky top-0 z-[var(--z-sticky)] flex items-baseline gap-2 bg-background/95 py-2 backdrop-blur-sm">
                <h2
                  id={`day-${dateKey}`}
                  tabIndex={-1}
                  className="flex items-baseline gap-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {relative ? (
                    <span className={isToday ? "text-primary" : "text-foreground"}>{relative}</span>
                  ) : null}
                  <span className={relative ? "font-normal text-muted-foreground" : undefined}>
                    {formatGroupDate(sampleDate)}
                    {year !== currentYear ? ` · ${year}` : ""}
                  </span>
                </h2>
                <span className="text-xs text-muted-foreground">{dayItems.length}개</span>
              </div>

              {/* 줄 단위 항목 */}
              <ul className="flex flex-col">
                {dayItems.map((item) => (
                  <li key={getUnifiedItemKey(item)}>
                    <button
                      type="button"
                      aria-label={describeUnifiedItemRow(item, formatWhen(item), showSpaceContext)}
                      onClick={() => {
                        setSelectedItem(item);
                        setPanelOpen(true);
                      }}
                      className="group flex min-h-10 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-nowrap"
                    >
                      <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{formatWhen(item)}</span>
                      <UnifiedItemTypeIcon
                        type={item.type}
                        className="size-4 shrink-0"
                        style={{ color: getUnifiedItemColor(item) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.title}</span>
                      <span className="flex w-full flex-wrap items-center gap-2 pl-14 sm:w-auto sm:shrink-0 sm:flex-nowrap sm:pl-0">
                        <UnifiedItemTypeBadge item={item} />
                        {showSpaceContext && <UnifiedItemSpaceBadge item={item} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {canAdd ? (
                <button
                  type="button"
                  onClick={(event) => openQuickCreate(dateKey, event.currentTarget)}
                  aria-label={`${formatGroupDate(sampleDate)}에 항목 추가`}
                  className="mt-0.5 flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="w-11 shrink-0" aria-hidden="true" />
                  <Plus className="size-4 shrink-0" aria-hidden="true" />
                  추가
                </button>
              ) : null}
            </section>
          );
        })}
      </div>

      {quickCreatePanel}

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
      />
    </>
  );
}
