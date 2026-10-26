/**
 * @file src/components/student-portal/AllItemsView.tsx
 * @description 전체 보기(캔버스 CalendarAll·MobileCalendarAll): 개수가 붙은 유형 알약, 제목 검색, 정렬과
 * 넓은 화면의 표(제목·유형·날짜), 좁은 화면의 두 줄 목록. 새 항목은 화면 머리의 "새로 만들기"가 맡는다.
 */
"use client";

import { useState } from "react";
import { ArrowDownUp, ChevronDown, Search } from "lucide-react";
import {
  getUnifiedItemKey,
  type UnifiedItem,
  type UnifiedItemType,
} from "@/lib/utils/unifiedItemUtils";
import {
  describeUnifiedItemRow,
  UNIFIED_ITEM_TYPE_DOT_CLASS,
  UNIFIED_ITEM_TYPE_LABELS,
  UNIFIED_ITEM_TYPES,
  UnifiedItemDot,
} from "@/components/ui/unified-item-type";
import { UnifiedItemDetailPanel, type UnifiedItemChangeHandlers } from "./UnifiedItemDetailPanel";
import { formatLedgerDate } from "@/components/calendar/calendar-dates";
import { Input } from "@/components/ui/input";
import {
  resolveUnifiedItemSort,
  sortUnifiedItems,
  UNIFIED_ITEM_SORT_LABELS,
  type UnifiedItemSort,
} from "@/lib/unified-item-views";
import { cn } from "@/lib/utils";

interface AllItemsViewProps extends UnifiedItemChangeHandlers {
  items: UnifiedItem[];
  returnTo: string;
  showSpaceContext: boolean;
  initialType?: UnifiedItemType | null;
  onInitialTypeCleared?: () => void;
}

function TypeLabel({ item }: { item: UnifiedItem }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <UnifiedItemDot item={item} />
      <span className="truncate">
        {UNIFIED_ITEM_TYPE_LABELS[item.type]}
        {item.source.kind !== "PORTAL" ? ` · ${item.source.label}` : null}
      </span>
    </span>
  );
}

function SortSelect({ sort, onChange, variant }: { sort: UnifiedItemSort; onChange: (sort: UnifiedItemSort) => void; variant: "toolbar" | "touch" }) {
  return (
    <label className={cn("relative flex items-center", variant === "touch" && "-mr-2")}>
      <span className="sr-only">정렬</span>
      {variant === "touch" ? (
        <ArrowDownUp className="pointer-events-none absolute left-2 size-3.5 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
      ) : null}
      <select
        value={sort}
        onChange={(event) => onChange(resolveUnifiedItemSort(event.target.value))}
        className={cn(
          "appearance-none bg-background text-secondary-foreground field-sizing-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          variant === "touch"
            ? "h-11 rounded-touch pl-7 pr-2 text-ui"
            : "h-8 rounded-md border border-border pl-2.5 pr-7 text-ui",
        )}
      >
        {(Object.entries(UNIFIED_ITEM_SORT_LABELS) as [UnifiedItemSort, string][]).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      {variant === "touch" ? null : (
        <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-secondary-foreground" strokeWidth={1.6} aria-hidden="true" />
      )}
    </label>
  );
}

export function AllItemsView({
  items,
  returnTo,
  showSpaceContext,
  initialType = null,
  onInitialTypeCleared,
  canManageEvents,
  canManageLessons,
  onItemUpdated,
  onItemRemoved,
  viewer,
}: AllItemsViewProps) {
  const [activeTypes, setActiveTypes] = useState<Set<UnifiedItemType>>(
    new Set(initialType ? [initialType] : UNIFIED_ITEM_TYPES),
  );
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<UnifiedItemSort>("date-desc");

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

  const openItem = (item: UnifiedItem) => {
    setSelectedItem(item);
    setPanelOpen(true);
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
  const countLabel = filtered.length === items.length ? `${items.length}개 항목` : `전체 ${items.length}개 중 ${filtered.length}개`;
  const dateSort = sort === "date-desc" ? "descending" : sort === "date-asc" ? "ascending" : undefined;

  return (
    <div className="flex flex-col md:gap-5">
      {/* 유형 · 검색 · 정렬. 좁은 화면은 검색이 먼저, 유형은 가로로 넘긴다. */}
      <div className="flex flex-col gap-1 px-5 pt-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-3 md:border-b md:border-border md:px-0 md:pb-3 md:pt-0">
        <div
          role="group"
          aria-label="유형"
          className="order-2 -mr-5 flex gap-1 pr-5 scroll-row md:order-1 md:mr-0 md:flex-wrap md:overflow-visible md:pr-0"
        >
          {UNIFIED_ITEM_TYPES.map((type) => {
            const active = activeTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                aria-pressed={active}
                className="flex h-11 shrink-0 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7"
              >
                <span
                  className={cn(
                    "inline-flex h-8 items-center gap-[5px] rounded-full px-2.5 text-ui transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none md:h-7 md:gap-1.5 md:text-xs",
                    active ? "bg-muted text-foreground" : "text-muted-foreground line-through hover:bg-muted/60",
                  )}
                >
                  <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", UNIFIED_ITEM_TYPE_DOT_CLASS[type])} />
                  {UNIFIED_ITEM_TYPE_LABELS[type]}
                  <span className="font-mono text-muted-foreground">
                    {items.filter((i) => i.type === type).length}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="order-1 flex items-center gap-2 md:order-2">
          <label className="relative flex min-w-0 flex-1 items-center md:w-[220px] md:flex-none">
            <span className="sr-only">제목 검색</span>
            <Search className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground md:left-2.5 md:size-3.5" strokeWidth={1.8} aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="제목 검색"
              className="pl-10 pr-3.5 md:h-8 md:pl-8 md:pr-3 md:text-ui"
            />
          </label>
          <div className="hidden md:block">
            <SortSelect sort={sort} onChange={setSort} variant="toolbar" />
          </div>
        </div>
      </div>

      {/* 개수(좁은 화면은 정렬과 한 줄) */}
      <div className="mx-5 flex h-11 items-center justify-between border-b border-border md:hidden">
        <p className="text-ui text-muted-foreground" aria-live="polite">{countLabel}</p>
        <SortSelect sort={sort} onChange={setSort} variant="touch" />
      </div>
      <p className="hidden text-xs text-muted-foreground md:block" aria-live="polite">{countLabel}</p>

      {filtered.length === 0 ? (
        <div className="mx-5 flex flex-col items-start gap-2 py-8 text-body text-muted-foreground md:mx-0">
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
        <>
          {/* 넓은 화면: 표 */}
          <table className="hidden w-full max-w-[1080px] table-fixed border-collapse text-body md:table">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" aria-sort={sort === "title" ? "ascending" : undefined} className={cn("h-9 px-2 text-left text-xs", sort === "title" ? "font-medium text-foreground" : "font-normal text-muted-foreground")}>
                  제목{sort === "title" ? " ↑" : ""}
                </th>
                <th scope="col" className={cn("w-[140px] px-2 text-left text-xs", sort === "type" ? "font-medium text-foreground" : "font-normal text-muted-foreground")}>
                  유형
                </th>
                <th scope="col" aria-sort={dateSort} className={cn("w-40 px-2 text-left text-xs", dateSort ? "font-medium text-foreground" : "font-normal text-muted-foreground")}>
                  날짜{dateSort === "descending" ? " ↓" : dateSort === "ascending" ? " ↑" : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                // 행 어디를 눌러도 열리고, 키보드·보조기기는 제목 버튼을 쓴다(버튼 클릭이 행으로 올라와도 같은 동작).
                <tr
                  key={getUnifiedItemKey(item)}
                  onClick={() => openItem(item)}
                  className="cursor-pointer border-b border-muted transition-colors duration-[var(--duration-fast)] hover:bg-sidebar motion-reduce:transition-none"
                >
                  <td className="h-11 overflow-hidden px-2">
                    <button
                      type="button"
                      aria-label={describeUnifiedItemRow(item, formatLedgerDate(item, { withYear: true }), showSpaceContext)}
                      onClick={() => openItem(item)}
                      className="block w-full truncate rounded-sm text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.title}
                    </button>
                  </td>
                  <td className="px-2 text-ui text-secondary-foreground"><TypeLabel item={item} /></td>
                  <td className="px-2 font-mono text-xs text-secondary-foreground">{formatLedgerDate(item, { withYear: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 좁은 화면: 두 줄 목록 */}
          <ul className="flex flex-col px-5 pb-8 md:hidden">
            {filtered.map((item) => (
              <li key={getUnifiedItemKey(item)}>
                <button
                  type="button"
                  aria-label={describeUnifiedItemRow(item, formatLedgerDate(item, { withYear: true }), showSpaceContext)}
                  onClick={() => openItem(item)}
                  className="flex w-full flex-col gap-0.5 border-b border-muted py-[11px] text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="truncate text-md">{item.title}</span>
                  <span className="flex items-center gap-2 text-xs text-secondary-foreground">
                    <TypeLabel item={item} />
                    <span className="font-mono text-muted-foreground">{formatLedgerDate(item, { withYear: false })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

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
    </div>
  );
}
