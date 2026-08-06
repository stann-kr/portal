/**
 * @file src/components/student-portal/DailyListView.tsx
 * @description UnifiedItem[] 날짜별 그룹핑 리스트 뷰.
 * 날짜 헤더 + 타입 아이콘·색상 도트 + 제목 카드.
 */
"use client";

import { useState } from "react";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import {
  UnifiedItemTypeBadge,
  UnifiedItemTypeIcon,
} from "@/components/ui/unified-item-type";
import { SlidePanel } from "./SlidePanel";
import { UnifiedItemDetail } from "./UnifiedItemDetail";

// ── 날짜 포맷 ────────────────────────────────────

function formatGroupDate(date: Date): string {
  return new Date(date).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── 날짜별 그룹핑 ────────────────────────────────

function groupByDate(items: UnifiedItem[]): Map<string, UnifiedItem[]> {
  const map = new Map<string, UnifiedItem[]>();
  for (const item of items) {
    const key = new Date(item.date).toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

// ── 컴포넌트 ─────────────────────────────────────

interface DailyListViewProps {
  items: UnifiedItem[];
  returnTo: string;
}

export function DailyListView({ items, returnTo }: DailyListViewProps) {
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const grouped = groupByDate(items);
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
        <p className="text-sm">등록된 항목이 없습니다.</p>
      </div>
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
                      key={item.id}
                      onClick={() => {
                        setSelectedItem(item);
                        setPanelOpen(true);
                      }}
                      className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors"
                    >
                      <UnifiedItemTypeIcon type={item.type} className="shrink-0 text-primary" />

                      {/* 제목 + 타입 */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.title}
                        </p>
                      </div>

                      {/* 타입 라벨 + 시간 */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <UnifiedItemTypeBadge item={item} />
                        <span className="text-xs text-muted-foreground hidden sm:block">
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
      <SlidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={selectedItem?.title}
      >
        {selectedItem && (
          <UnifiedItemDetail item={selectedItem} onClose={() => setPanelOpen(false)} returnTo={returnTo} />
        )}
      </SlidePanel>
    </>
  );
}
