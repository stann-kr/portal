/**
 * @file src/components/student-portal/AllItemsView.tsx
 * @description 전체 항목 플랫 리스트 뷰. 타입 필터 토글 + 최신순 카드 리스트.
 */
"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import { getUnifiedItemColor } from "@/lib/utils/unifiedItemUtils";
import { Input } from "@/components/ui/input";
import { SlidePanel } from "./SlidePanel";
import { UnifiedItemDetail } from "./UnifiedItemDetail";

// ── 상수 ─────────────────────────────────────────

const ALL_TYPES: UnifiedItemType[] = ["EVENT", "NOTE", "DIGGING", "QNA", "ASSIGNMENT"];

const TYPE_LABELS: Record<UnifiedItemType, string> = {
  EVENT: "일정",
  NOTE: "노트",
  DIGGING: "디깅",
  QNA: "Q&A",
  ASSIGNMENT: "과제",
};

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

  // 타입별 색상 샘플 맵
  const colorSamples = Object.fromEntries(
    ALL_TYPES.map((t) => {
      const sample = items.find((i) => i.type === t);
      return [t, sample ? getUnifiedItemColor(sample) : "#71717a"];
    }),
  );

  return (
    <>
      {/* 타입 필터 바 */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {ALL_TYPES.map((type) => {
          const active = activeTypes.has(type);
          const color = colorSamples[type];
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                active ? "border-transparent text-white" : "border-border text-muted-foreground"
              }`}
              style={active ? { backgroundColor: color } : undefined}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: active ? "white" : color }}
              />
              {TYPE_LABELS[type]}
              <span className={`ml-0.5 ${active ? "text-white/70" : "text-muted-foreground"}`}>
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
            const color = getUnifiedItemColor(item);
            return (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedItem(item);
                  setPanelOpen(true);
                }}
                className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded text-white"
                    style={{ backgroundColor: color }}
                  >
                    {TYPE_LABELS[item.type]}
                  </span>
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
