/**
 * @file src/components/student-portal/AllItemsView.tsx
 * @description 전체 항목을 노션 데이터베이스 표처럼 보는 뷰. 유형 필터·제목 검색·정렬과 새 항목 만들기를 둔다.
 */
"use client";

import { useState } from "react";
import { ArrowDownUp, Plus, Search } from "lucide-react";
import {
  getUnifiedItemColor,
  getUnifiedItemKey,
  type UnifiedItem,
  type UnifiedItemType,
} from "@/lib/utils/unifiedItemUtils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  describeUnifiedItemRow,
  UNIFIED_ITEM_TYPE_LABELS,
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
import {
  createDaySelection,
  isUnifiedItemAllDay,
  resolveUnifiedItemSort,
  sortUnifiedItems,
  UNIFIED_ITEM_SORT_LABELS,
  type UnifiedItemSort,
} from "@/lib/unified-item-views";
import type { CalendarQuickCreateSelection } from "@/lib/calendar-quick-create";
import { toKstDateInputValue } from "@/lib/date-input";
import { formatKst, formatKstShortDate } from "@/lib/kst-format";

const ALL_TYPES: UnifiedItemType[] = ["EVENT", "NOTE", "DIGGING", "QNA", "ASSIGNMENT"];

function formatDate(item: UnifiedItem): string {
  const date = formatKstShortDate(item.date);
  return isUnifiedItemAllDay(item)
    ? date
    : `${date} ${formatKst(item.date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

interface AllItemsViewProps extends UnifiedItemChangeHandlers {
  items: UnifiedItem[];
  returnTo: string;
  showSpaceContext: boolean;
  initialType?: UnifiedItemType | null;
  onInitialTypeCleared?: () => void;
  /** 캘린더와 같은 빠른 만들기. 없으면 새 항목 버튼을 숨긴다. */
  quickCreate?: CalendarQuickCreateOptions;
}

export function AllItemsView({
  items,
  returnTo,
  showSpaceContext,
  initialType = null,
  onInitialTypeCleared,
  quickCreate,
  canManageEvents,
  canManageLessons,
  onItemUpdated,
  onItemRemoved,
}: AllItemsViewProps) {
  const [activeTypes, setActiveTypes] = useState<Set<UnifiedItemType>>(
    new Set(initialType ? [initialType] : ALL_TYPES),
  );
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<UnifiedItemSort>("date-desc");
  const [quick, setQuick] = useState<{
    selection: CalendarQuickCreateSelection;
    anchor: { x: number; y: number } | null;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const canAdd = canUseQuickCreate(quickCreate);

  // 바깥에서 다른 유형으로 바로 들어오면 그 유형만 보이게 맞춘다. 이전 값과 렌더 중에 비교한다.
  const [appliedInitialType, setAppliedInitialType] = useState(initialType);
  if (appliedInitialType !== initialType) {
    setAppliedInitialType(initialType);
    if (initialType) setActiveTypes(new Set([initialType]));
  }

  const toggleType = (type: UnifiedItemType) => {
    if (initialType) onInitialTypeCleared?.();
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size === 1) return prev; // 최소 1개 유지
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // 타입 토글 + 제목 검색 결합
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = sortUnifiedItems(
    items.filter((i) => {
      if (!activeTypes.has(i.type)) return false;
      if (!normalizedQuery) return true;
      return i.title.toLowerCase().includes(normalizedQuery);
    }),
    sort,
  );
  const gridColumns = showSpaceContext
    ? "sm:grid-cols-[minmax(0,1fr)_6rem_9rem_9rem]"
    : "sm:grid-cols-[minmax(0,1fr)_6rem_9rem]";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      {/* 툴바: 유형 필터 · 검색 · 정렬 · 새 항목 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="항목 유형 필터">
          {ALL_TYPES.map((type) => {
            const active = activeTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                aria-pressed={active}
                className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <UnifiedItemTypeIcon type={type} className="size-3.5" />
                {UNIFIED_ITEM_TYPE_LABELS[type]}
                <span className="text-muted-foreground tabular-nums">
                  {items.filter((i) => i.type === type).length}
                </span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="제목 검색"
              className="h-8 pl-8 text-xs"
              aria-label="항목 검색"
            />
          </div>
          <label className="relative inline-flex h-8 items-center">
            <span className="sr-only">정렬</span>
            <ArrowDownUp className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
            <select
              value={sort}
              onChange={(event) => setSort(resolveUnifiedItemSort(event.target.value))}
              className="h-8 appearance-none rounded-md border border-input bg-background pl-8 pr-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {(Object.entries(UNIFIED_ITEM_SORT_LABELS) as [UnifiedItemSort, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {canAdd ? (
            <Button
              type="button"
              size="sm"
              onClick={(event) => {
                const trigger = event.currentTarget;
                setQuick({
                  selection: createDaySelection(toKstDateInputValue(new Date())),
                  anchor: getQuickCreateAnchor(trigger),
                  returnFocus: trigger,
                });
              }}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              새 항목
            </Button>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {filtered.length === items.length ? `${items.length}개 항목` : `전체 ${items.length}개 중 ${filtered.length}개`}
      </p>

      {/* 표 */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border px-5 py-8 text-sm text-muted-foreground">
          <p>{normalizedQuery ? "검색 결과가 없습니다." : "항목이 없습니다."}</p>
          {normalizedQuery ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              검색어 지우기
            </button>
          ) : null}
        </div>
      ) : (
        <div className="border-y border-border">
          <div
            aria-hidden="true"
            className={`hidden h-9 items-center gap-3 border-b border-border px-2 text-xs text-muted-foreground sm:grid ${gridColumns}`}
          >
            <span>제목</span>
            <span>유형</span>
            <span>날짜</span>
            {showSpaceContext ? <span>스페이스</span> : null}
          </div>
          <ul className="divide-y divide-border">
            {filtered.map((item) => (
              <li key={getUnifiedItemKey(item)}>
                <button
                  type="button"
                  aria-label={describeUnifiedItemRow(item, formatDate(item), showSpaceContext)}
                  onClick={() => {
                    setSelectedItem(item);
                    setPanelOpen(true);
                  }}
                  className={`grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${gridColumns}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <UnifiedItemTypeIcon type={item.type} className="size-4 shrink-0" style={{ color: getUnifiedItemColor(item) }} />
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{item.title}</span>
                  </span>
                  <span className="hidden sm:block"><UnifiedItemTypeBadge item={item} /></span>
                  <span className="text-xs tabular-nums text-muted-foreground">{formatDate(item)}</span>
                  {showSpaceContext ? (
                    <span className="col-span-2 sm:col-span-1"><UnifiedItemSpaceBadge item={item} /></span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {quick && quickCreate ? (
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
      />
    </div>
  );
}
