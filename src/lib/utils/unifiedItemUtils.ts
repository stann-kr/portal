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
  | "ASSIGNMENT";

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
  /** 현재 포털에서 생성·관리하는 항목의 출처. */
  source: {
    kind: "PORTAL";
    entity: UnifiedItemSourceEntity;
    label: string;
  };
};

/** 서로 다른 엔티티가 같은 raw ID를 가질 때도 안전한 UI 식별 키. */
export function getUnifiedItemKey(item: UnifiedItem): string {
  return `${item.source.kind}:${item.source.entity}:${item.id}`;
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
