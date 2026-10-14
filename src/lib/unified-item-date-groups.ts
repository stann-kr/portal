import { toKstDateInputValue } from "@/lib/date-input";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

/** 통합 항목을 화면 계약인 Asia/Seoul 날짜로 묶는다. */
export function groupUnifiedItemsByKstDate(items: readonly UnifiedItem[]): Map<string, UnifiedItem[]> {
  const groups = new Map<string, UnifiedItem[]>();
  for (const item of items) {
    const key = toKstDateInputValue(new Date(item.date));
    const current = groups.get(key);
    if (current) current.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
