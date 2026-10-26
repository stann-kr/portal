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

export const UNIFIED_ITEM_TYPES: readonly UnifiedItemType[] = ["EVENT", "NOTE", "DIGGING", "QNA", "ASSIGNMENT"];

/** 유형 필터·개수 칩의 점. 일정 묶음은 레슨 점으로 대표한다(캔버스 Calendar 보드). */
export const UNIFIED_ITEM_TYPE_DOT_CLASS: Record<UnifiedItemType, string> = {
  EVENT: "bg-event-lesson",
  NOTE: "bg-item-note",
  DIGGING: "bg-item-digging",
  QNA: "bg-item-qna",
  ASSIGNMENT: "bg-item-assignment",
};

const EVENT_KIND_LABELS: Record<string, string> = {
  LESSON: "레슨",
  PRACTICE: "연습",
  GIG: "공연",
  NOTE: "메모",
};

/** 목록 행 오른쪽의 종류: 일정은 레슨·연습·공연·메모, 나머지는 유형 이름. */
export function getUnifiedItemKindLabel(item: UnifiedItem): string {
  if (item.type === "EVENT") return EVENT_KIND_LABELS[item.subType ?? ""] ?? UNIFIED_ITEM_TYPE_LABELS.EVENT;
  return UNIFIED_ITEM_TYPE_LABELS[item.type];
}

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
  return <Icon className={cn("size-4", className)} style={style} strokeWidth={1.6} aria-hidden="true" />;
}

/** 항목 유형·일정 종류를 6px 점으로 구분한다. 글자는 먹색을 유지한다. */
export function UnifiedItemDot({ item, className }: { item: UnifiedItem; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: getUnifiedItemColor(item) }}
    />
  );
}

/** 상세 머리의 유형 표시: 점과 유형 이름, 레슨만 "레슨"(캔버스 CalendarDialogs). */
export function UnifiedItemTypeBadge({ item }: { item: UnifiedItem }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-secondary-foreground">
      <UnifiedItemDot item={item} />
      {item.type === "EVENT" && item.subType === "LESSON" ? EVENT_KIND_LABELS.LESSON : UNIFIED_ITEM_TYPE_LABELS[item.type]}
    </span>
  );
}

/** 목록 행 button의 이름: 제목·유형·시각과(관리자) 학생 스페이스, 외부 출처만 읽는다. */
export function describeUnifiedItemRow(item: UnifiedItem, when: string, showSpaceContext: boolean): string {
  const parts = [item.title, UNIFIED_ITEM_TYPE_LABELS[item.type], when];
  if (showSpaceContext) parts.push(`${item.space.label} 학생 스페이스`);
  if (item.source.kind !== "PORTAL") parts.push(`${item.source.label} 출처`);
  return parts.filter(Boolean).join(", ");
}

/** 통합 항목의 학생 스페이스와 외부 출처를 작은 칩으로 표시한다(레슨 상세의 학생 칩). */
export function UnifiedItemSpaceBadge({ item }: { item: UnifiedItem }) {
  const external = item.source.kind !== "PORTAL";
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center rounded-sm bg-muted px-1.5 text-[11px] text-secondary-foreground"
      aria-label={`${item.space.label} 학생 스페이스, ${item.source.label} 출처`}
    >
      {item.space.label}
      {external ? ` · ${item.source.label}` : null}
    </span>
  );
}
