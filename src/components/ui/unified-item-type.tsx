import {
  CalendarDays,
  FileText,
  HelpCircle,
  ListMusic,
  Radio,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";
import { getUnifiedItemColor } from "@/lib/utils/unifiedItemUtils";
import { cn } from "@/lib/utils";

export const UNIFIED_ITEM_TYPE_LABELS: Record<UnifiedItemType, string> = {
  EVENT: "일정",
  NOTE: "노트",
  DIGGING: "디깅",
  QNA: "Q&A",
  ASSIGNMENT: "과제",
};

const TYPE_ICONS: Record<UnifiedItemType, React.ElementType> = {
  EVENT: CalendarDays,
  NOTE: FileText,
  DIGGING: ListMusic,
  QNA: HelpCircle,
  ASSIGNMENT: Radio,
};

export function UnifiedItemTypeIcon({
  type,
  className,
  style,
}: {
  type: UnifiedItemType;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = TYPE_ICONS[type];
  return <Icon className={cn("size-4", className)} style={style} aria-hidden="true" />;
}

export function UnifiedItemTypeBadge({ item }: { item: UnifiedItem }) {
  const color = getUnifiedItemColor(item);

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
      <UnifiedItemTypeIcon type={item.type} className="size-3" style={{ color }} />
      {UNIFIED_ITEM_TYPE_LABELS[item.type]}
    </span>
  );
}
