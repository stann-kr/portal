/**
 * @file src/components/calendar/CalendarTypeFilter.tsx
 * @description 캘린더 월·주·일별 보기가 함께 쓰는 유형 필터(캔버스 Calendar 보드의 28px 알약).
 * 좁은 화면은 가로로 넘기는 44px 누름 영역 안의 32px 알약(MobileCalendarAll과 같은 모양)이다.
 */
"use client";

import type { UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import {
  UNIFIED_ITEM_TYPE_DOT_CLASS,
  UNIFIED_ITEM_TYPE_LABELS,
  UNIFIED_ITEM_TYPES,
} from "@/components/ui/unified-item-type";
import { cn } from "@/lib/utils";

export function CalendarTypeFilter({
  visibleTypes,
  onToggle,
  presetActive = false,
  onClearPreset,
  variant = "toolbar",
  className,
}: {
  visibleTypes: ReadonlySet<UnifiedItemType>;
  onToggle: (type: UnifiedItemType) => void;
  /** 홈의 "노트 + 레슨" 바로가기로 들어온 상태. */
  presetActive?: boolean;
  onClearPreset?: () => void;
  variant?: "toolbar" | "touch";
  className?: string;
}) {
  const touch = variant === "touch";
  const pill = touch
    ? "inline-flex h-8 items-center gap-[5px] rounded-full px-2.5 text-ui"
    : "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs";

  return (
    <div
      role="group"
      aria-label="캘린더 항목 필터"
      className={cn(touch ? "scroll-row flex gap-1" : "flex flex-wrap gap-1", className)}
    >
      {presetActive ? (
        <button
          type="button"
          onClick={onClearPreset}
          aria-label="노트와 레슨 필터 해제"
          className={cn(
            touch ? "flex h-11 shrink-0 items-center" : pill,
            !touch && "bg-accent font-medium text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {touch ? <span className={cn(pill, "bg-accent font-medium text-accent-foreground")}>노트 + 레슨 · 해제</span> : "노트 + 레슨 보기 · 해제"}
        </button>
      ) : null}
      {UNIFIED_ITEM_TYPES.map((type) => {
        const active = visibleTypes.has(type);
        const label = UNIFIED_ITEM_TYPE_LABELS[type];
        const face = cn(
          pill,
          "transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none",
          active ? "bg-muted text-foreground" : "text-muted-foreground line-through hover:bg-muted/60",
        );
        const content = (
          <>
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", UNIFIED_ITEM_TYPE_DOT_CLASS[type])} />
            {label}
          </>
        );
        return (
          <button
            key={type}
            type="button"
            onClick={() => onToggle(type)}
            aria-pressed={active}
            aria-label={`${label} ${active ? "숨기기" : "표시하기"}`}
            className={cn(
              touch ? "flex h-11 shrink-0 items-center rounded-full" : face,
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {touch ? <span className={face}>{content}</span> : content}
          </button>
        );
      })}
    </div>
  );
}
