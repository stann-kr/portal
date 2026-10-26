import type { CalendarQuickCreateSelection } from "@/lib/calendar-quick-create";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";

const DAY_MS = 24 * 60 * 60 * 1_000;

function dayIndex(dateKey: string): number {
  return Math.round(Date.parse(`${dateKey}T00:00:00Z`) / DAY_MS);
}

/** 오늘·내일·어제만 말로 붙이고 나머지 날짜는 그대로 둔다. */
export function describeRelativeDay(dateKey: string, todayKey: string): string | null {
  const diff = dayIndex(dateKey) - dayIndex(todayKey);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff === -1) return "어제";
  return null;
}

/** 오늘 묶음이 없으면 오늘과 가장 가까운 날(같으면 앞으로 올 날)을 고른다. */
export function findClosestDayKey(dateKeys: readonly string[], todayKey: string): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const today = dayIndex(todayKey);
  for (const key of dateKeys) {
    const diff = dayIndex(key) - today;
    const distance = Math.abs(diff);
    if (distance < bestDistance || (distance === bestDistance && diff > 0)) {
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

/** 노트와 종일 일정은 시각 대신 "종일"로 보인다. 노트 날짜는 자정 UTC로 저장돼 시각이 의미 없다. */
export function isUnifiedItemAllDay(item: UnifiedItem): boolean {
  return item.type === "NOTE" || item.metadata.allDay === true;
}

/** 하루 안에서는 종일 항목을 먼저, 나머지는 이른 시각부터 놓는다. */
export function sortDayAgenda(items: readonly UnifiedItem[]): UnifiedItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      Number(isUnifiedItemAllDay(right.item)) - Number(isUnifiedItemAllDay(left.item))
      || left.item.date.getTime() - right.item.date.getTime()
      || left.index - right.index)
    .map(({ item }) => item);
}

/** 표·목록에서 하루짜리 항목을 만드는 빠른 만들기 선택. */
export function createDaySelection(dateKey: string): CalendarQuickCreateSelection {
  const next = new Date(Date.parse(`${dateKey}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  return { startStr: dateKey, endStr: next, allDay: true };
}

export type UnifiedItemSort = "date-desc" | "date-asc" | "title" | "type";

export const UNIFIED_ITEM_SORT_LABELS: Record<UnifiedItemSort, string> = {
  "date-desc": "날짜 · 최신순",
  "date-asc": "날짜 · 오래된순",
  title: "제목 · 가나다순",
  type: "유형별",
};

export function resolveUnifiedItemSort(value: unknown): UnifiedItemSort {
  return typeof value === "string" && Object.hasOwn(UNIFIED_ITEM_SORT_LABELS, value)
    ? value as UnifiedItemSort
    : "date-desc";
}

const titleCollator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

const TYPE_ORDER: readonly UnifiedItemType[] = ["EVENT", "NOTE", "ASSIGNMENT", "QNA", "DIGGING"];

/** 같은 값이면 최신순으로, 그래도 같으면 원래 순서를 지킨다. */
export function sortUnifiedItems(items: readonly UnifiedItem[], sort: UnifiedItemSort): UnifiedItem[] {
  const newest = (left: UnifiedItem, right: UnifiedItem) => right.date.getTime() - left.date.getTime();
  const primary = (left: UnifiedItem, right: UnifiedItem): number => {
    switch (sort) {
      case "date-desc":
        return newest(left, right);
      case "date-asc":
        return -newest(left, right);
      case "title":
        return titleCollator.compare(left.title, right.title);
      case "type":
        return TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type);
    }
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      primary(left.item, right.item) || newest(left.item, right.item) || left.index - right.index)
    .map(({ item }) => item);
}
