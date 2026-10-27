/**
 * @file src/lib/utils/unifiedItemUtils.ts
 * @description UnifiedItem 타입 정의 및 클라이언트/서버 공용 유틸.
 * "use server" 없음 — Client Component에서 임포트 가능.
 */

// ─── 타입 정의 ────────────────────────────────────

export type UnifiedItemType = "EVENT" | "NOTE" | "DIGGING" | "QNA" | "ASSIGNMENT";

export type UnifiedItemSourceEntity =
  | "CALENDAR_EVENT"
  | "LESSON"
  | "PRIVATE_NOTE"
  | "DIGGING_TRACK"
  | "QNA_THREAD"
  | "ASSIGNMENT"
  | "ASSIGNMENT_TASK"
  | "EXTERNAL_CALENDAR_EVENT";

export type UnifiedItemSourceKind =
  | "PORTAL"
  | "GOOGLE_CALENDAR"
  | "ICLOUD_CALENDAR";

export type UnifiedItem = {
  id: string;
  type: UnifiedItemType;
  /** EVENT 의 CalendarEventType, QNA 의 QnaStatus */
  subType?: string;
  title: string;
  description?: string;
  /** 정렬·그룹핑 기준 날짜 */
  date: Date;
  endDate?: Date | null;
  metadata: Record<string, unknown>;
  /** 이 항목이 속한 학생 워크스페이스. */
  space: {
    studentId: string;
    label: string;
  };
  /** 항목을 제공한 포털 또는 외부 캘린더 출처. */
  source: {
    kind: UnifiedItemSourceKind;
    entity: UnifiedItemSourceEntity;
    label: string;
  };
};

/** 아직 제출하지 않은 관리자 과제 항목의 subType(source.entity는 ASSIGNMENT_TASK). 제출 항목은 subType이 없다. */
export const ASSIGNMENT_TASK_SUBTYPE = "TASK";

/** 서로 다른 엔티티가 같은 raw ID를 가질 때도 안전한 UI 식별 키. */
export function getUnifiedItemKey(item: UnifiedItem): string {
  return `${item.source.kind}:${item.source.entity}:${item.id}`;
}

/** 생성 응답 재전송이나 refresh가 겹쳐도 같은 source item은 정확히 한 번만 유지한다. */
export function upsertUnifiedItem(items: readonly UnifiedItem[], item: UnifiedItem): UnifiedItem[] {
  const itemKey = getUnifiedItemKey(item);
  return [item, ...items.filter((candidate) => getUnifiedItemKey(candidate) !== itemKey)]
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** 여러 source item을 기존 목록에 exact-once로 병합한다. */
export function upsertUnifiedItems(
  items: readonly UnifiedItem[],
  incoming: readonly UnifiedItem[],
): UnifiedItem[] {
  if (incoming.length === 0) return [...items];
  const incomingKeys = new Set(incoming.map(getUnifiedItemKey));
  return [
    ...incoming,
    ...items.filter((candidate) => !incomingKeys.has(getUnifiedItemKey(candidate))),
  ].sort((left, right) => right.date.getTime() - left.date.getTime());
}

// ─── 색상 맵 ──────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  EVENT_LESSON:   "var(--color-event-lesson)",
  EVENT_PRACTICE: "var(--color-event-practice)",
  EVENT_GIG:      "var(--color-event-gig)",
  EVENT_NOTE:     "var(--color-event-note)",
  NOTE:           "var(--color-item-note)",
  DIGGING:        "var(--color-item-digging)",
  QNA:            "var(--color-item-qna)",
  ASSIGNMENT:     "var(--color-item-assignment)",
};

/**
 * UnifiedItem 의 타입·서브타입에 따른 표시 색상 반환.
 */
export function getUnifiedItemColor(item: UnifiedItem): string {
  if (item.type === "EVENT" && item.subType) {
    return TYPE_COLORS[`EVENT_${item.subType}`] ?? TYPE_COLORS["EVENT_NOTE"];
  }
  return TYPE_COLORS[item.type] ?? "var(--color-muted-foreground)";
}
