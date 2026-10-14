/**
 * @file src/components/student-portal/DailyListView.tsx
 * @description UnifiedItem[] 날짜별 그룹핑 리스트 뷰.
 * 날짜 헤더 + 타입 아이콘·색상 도트 + 제목 카드.
 */
"use client";

import { useState } from "react";
import {
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
import { groupUnifiedItemsByKstDate } from "@/lib/unified-item-date-groups";
import { EmptyState } from "@/components/ui/empty-state";
import { formatKst } from "@/lib/kst-format";

// ── 날짜 포맷 ────────────────────────────────────

function formatGroupDate(date: Date): string {
  return formatKst(date, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

function formatTime(date: Date): string {
  return formatKst(date, { hour: "2-digit", minute: "2-digit" });
}

// ── 날짜별 그룹핑 ────────────────────────────────

// ── 컴포넌트 ─────────────────────────────────────

interface DailyListViewProps extends UnifiedItemChangeHandlers {
  items: UnifiedItem[];
  returnTo: string;
  showSpaceContext: boolean;
}

export function DailyListView({
  items,
  returnTo,
  showSpaceContext,
  canManageEvents,
  canManageLessons,
  onItemUpdated,
  onItemRemoved,
}: DailyListViewProps) {
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const grouped = groupUnifiedItemsByKstDate(items);
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));

  if (items.length === 0) {
    return (
      <EmptyState
        title="표시할 기록이 없습니다"
        description="상단의 추가 메뉴에서 일정·노트·디깅·질문을 기록하면 날짜별로 모입니다."
      />
    );
  }

  return (
    <>
      <div className="space-y-6">
        {sortedKeys.map((dateKey) => {
          const dayItems = grouped.get(dateKey)!;
          const sampleDate = dayItems[0].date;

          return (
            <div key={dateKey}>
              {/* 날짜 헤더 */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {formatGroupDate(sampleDate)}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* 아이템 카드 리스트 */}
              <div className="space-y-2 pl-1">
                {dayItems.map((item) => {
                  return (
                    <button
                      key={getUnifiedItemKey(item)}
                      type="button"
                      aria-label={describeUnifiedItemRow(item, formatTime(item.date), showSpaceContext)}
                      onClick={() => {
                        setSelectedItem(item);
                        setPanelOpen(true);
                      }}
                      className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors sm:flex-nowrap"
                    >
                      <UnifiedItemTypeIcon type={item.type} className="shrink-0 text-primary" />

                      {/* 제목 */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.title}
                        </p>
                      </div>

                      {/* 좁은 화면에서는 제목 아래 줄로 내려 제목이 잘리지 않게 한다. */}
                      <div className="flex w-full flex-wrap items-center gap-2 pl-7 sm:w-auto sm:flex-shrink-0 sm:flex-nowrap sm:pl-0">
                        <UnifiedItemTypeBadge item={item} />
                        {showSpaceContext && <UnifiedItemSpaceBadge item={item} />}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatTime(item.date)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

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
