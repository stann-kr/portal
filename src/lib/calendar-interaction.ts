import { toKstDateInputValue } from "@/lib/date-input";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

/** 캘린더를 보는 사람이 이 스페이스에서 바꿀 수 있는 범위. 서버가 같은 규칙을 다시 검사한다. */
export type CalendarEditContext = {
  actorId: string;
  role: "admin" | "student";
  /** 학생 본인 스페이스일 때만 개인 일정을 옮긴다. */
  canManageEvents: boolean;
  /** 관리자가 학생 스페이스를 볼 때만 레슨을 옮긴다. */
  canManageLessons: boolean;
};

export type CalendarItemEditing =
  | { kind: "event"; movable: true; resizable: true }
  | { kind: "lesson"; movable: true; resizable: false }
  | { kind: "note"; movable: true; resizable: false }
  | { kind: null; movable: false; resizable: false };

const READ_ONLY: CalendarItemEditing = { kind: null, movable: false, resizable: false };

export function getCalendarItemEditing(
  item: UnifiedItem,
  context: CalendarEditContext,
): CalendarItemEditing {
  if (item.source.kind !== "PORTAL") return READ_ONLY;
  switch (item.source.entity) {
    case "CALENDAR_EVENT":
      return context.canManageEvents ? { kind: "event", movable: true, resizable: true } : READ_ONLY;
    case "LESSON":
      return context.canManageLessons ? { kind: "lesson", movable: true, resizable: false } : READ_ONLY;
    case "PRIVATE_NOTE":
      // 노트 수정 권한과 같다: 관리자이거나 본인이 쓴 노트.
      return context.role === "admin" || item.metadata.authorId === context.actorId
        ? { kind: "note", movable: true, resizable: false }
        : READ_ONLY;
    default:
      return READ_ONLY;
  }
}

function readNoteDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

/**
 * 노트는 하루짜리 항목으로 놓는다. 지정 날짜는 UTC 자정으로 저장되므로 그 날짜 그대로,
 * 날짜가 없으면 작성 시각의 KST 날짜를 쓴다.
 */
export function getNoteCalendarDateKey(item: UnifiedItem): string {
  const noteDate = readNoteDate(item.metadata.noteDate);
  return noteDate ? noteDate.toISOString().slice(0, 10) : toKstDateInputValue(item.date);
}

export type CalendarMoveRequest =
  | { kind: "event"; startTime: string; endTime: string | null }
  | { kind: "lesson"; scheduledAt: string }
  | { kind: "note"; noteDate: string };

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * 캘린더가 알려 준 새 위치를 저장 요청으로 바꾼다. 하루짜리 칸과 시간 칸을 오가는 이동처럼
 * 이 항목이 표현할 수 없는 위치는 null을 돌려 원위치하게 한다.
 */
export function buildCalendarMoveRequest(
  editing: CalendarItemEditing,
  next: { start: Date | null; end: Date | null; allDay: boolean; startStr: string },
): CalendarMoveRequest | null {
  if (!editing.movable || !next.start || !Number.isFinite(next.start.getTime())) return null;
  if (editing.kind === "note") {
    const dateKey = next.startStr.slice(0, 10);
    return next.allDay && DATE_KEY_PATTERN.test(dateKey) ? { kind: "note", noteDate: dateKey } : null;
  }
  if (next.allDay) return null;
  if (editing.kind === "lesson") return { kind: "lesson", scheduledAt: next.start.toISOString() };
  const end = next.end && Number.isFinite(next.end.getTime()) ? next.end : null;
  if (end && end.getTime() <= next.start.getTime()) return null;
  return { kind: "event", startTime: next.start.toISOString(), endTime: end?.toISOString() ?? null };
}

/** 저장 전에 화면에 먼저 보여 줄 항목. 실패하면 원래 항목으로 되돌린다. */
export function applyCalendarMoveToItem(item: UnifiedItem, request: CalendarMoveRequest): UnifiedItem {
  switch (request.kind) {
    case "event":
      return {
        ...item,
        date: new Date(request.startTime),
        endDate: request.endTime ? new Date(request.endTime) : null,
      };
    case "lesson":
      return { ...item, date: new Date(request.scheduledAt) };
    case "note": {
      const noteDate = new Date(`${request.noteDate}T00:00:00.000Z`);
      return { ...item, date: noteDate, metadata: { ...item.metadata, noteDate } };
    }
  }
}
