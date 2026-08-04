/**
 * @file src/components/student-portal/AllItemsView.tsx
 * @description 전체 항목 플랫 리스트 뷰. 타입 필터 토글 + 최신순 카드 리스트.
 */
"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import { Input } from "@/components/ui/input";
import {
  UNIFIED_ITEM_TYPE_LABELS,
  UnifiedItemTypeBadge,
  UnifiedItemTypeIcon,
} from "@/components/ui/unified-item-type";
import { SlidePanel } from "./SlidePanel";
import { UnifiedItemDetail } from "./UnifiedItemDetail";

// ── 상수 ─────────────────────────────────────────

const ALL_TYPES: UnifiedItemType[] = ["EVENT", "NOTE", "DIGGING", "QNA", "ASSIGNMENT"];

// ── 날짜 포맷 ────────────────────────────────────

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}

// ── 컴포넌트 ─────────────────────────────────────

interface AllItemsViewProps {
  items: UnifiedItem[];
}

export function AllItemsView({ items }: AllItemsViewProps) {
  const [activeTypes, setActiveTypes] = useState<Set<UnifiedItemType>>(
    new Set(ALL_TYPES),
  );
  const [selectedItem, setSelectedItem] = useState<UnifiedItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggleType = (type: UnifiedItemType) => {
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
  const filtered = items.filter((i) => {
    if (!activeTypes.has(i.type)) return false;
    if (!normalizedQuery) return true;
    return i.title.toLowerCase().includes(normalizedQuery);
  });

  return (
    <>
      {/* 타입 필터 바 */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {ALL_TYPES.map((type) => {
          const active = activeTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-primary/20 bg-accent text-accent-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-muted"
              }`}
            >
              <UnifiedItemTypeIcon type={type} className={active ? "text-primary" : undefined} />
              {UNIFIED_ITEM_TYPE_LABELS[type]}
              <span className="ml-0.5 text-muted-foreground">
                ({items.filter((i) => i.type === type).length})
              </span>
            </button>
          );
        })}
      </div>

      {/* 검색 바 */}
      <div className="relative w-full sm:w-64 mb-4">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="제목 검색"
          className="h-8 pl-8 text-xs"
          aria-label="항목 검색"
        />
      </div>

      {/* 아이템 리스트 */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <p className="text-sm">
            {normalizedQuery ? "검색 결과가 없습니다." : "항목이 없습니다."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
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
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <UnifiedItemTypeBadge item={item} />
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    {formatDate(item.date)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 상세 패널 */}
      <SlidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={selectedItem?.title}
      >
        {selectedItem && (
          <UnifiedItemDetail item={selectedItem} onClose={() => setPanelOpen(false)} />
        )}
      </SlidePanel>
    </>
  );
}
