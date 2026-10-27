import {
  calendarSelectionToKstDateKey,
  calendarSelectionToKstDateTimeInput,
} from "@/lib/date-input";

export type CalendarQuickCreateKind = "note" | "event" | "lesson";

/** 캘린더가 알려 준 선택 범위. 끝은 FullCalendar처럼 포함하지 않는다. */
export type CalendarQuickCreateSelection = {
  startStr: string;
  endStr: string;
  allDay: boolean;
};

export type CalendarQuickCreateDefaults = {
  kind: CalendarQuickCreateKind;
  /** 노트 날짜와 창 제목에 쓰는 KST 날짜. */
  dateKey: string;
  /** datetime-local 형식의 KST 시작·종료. */
  start: string;
  end: string;
  /** 여러 날·시간 범위를 고른 경우의 짧은 설명. */
  spanLabel: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1_000;

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

/**
 * 하루 칸은 노트를, 시간 칸은 일정(관리자는 레슨)을 먼저 고른다. 여러 날을 끌어 고르면
 * 첫날 오전 9시부터 마지막 날 오후 6시까지의 일정으로 채운다.
 */
export function getQuickCreateDefaults(
  selection: CalendarQuickCreateSelection,
  available: readonly CalendarQuickCreateKind[],
): CalendarQuickCreateDefaults {
  const order: CalendarQuickCreateKind[] = selection.allDay
    ? ["note", "event", "lesson"]
    : ["event", "lesson", "note"];
  const kind = order.find((candidate) => available.includes(candidate)) ?? "note";
  const dateKey = calendarSelectionToKstDateKey(selection.startStr) ?? selection.startStr.slice(0, 10);

  if (selection.allDay) {
    const endKey = calendarSelectionToKstDateKey(selection.endStr);
    const lastKey = endKey ? shiftDateKey(endKey, -1) : dateKey;
    const span = Math.max(daysBetween(dateKey, lastKey) + 1, 1);
    return span > 1
      ? { kind, dateKey, start: `${dateKey}T09:00`, end: `${lastKey}T18:00`, spanLabel: `${span}일` }
      : { kind, dateKey, start: `${dateKey}T09:00`, end: `${dateKey}T10:00`, spanLabel: null };
  }

  const start = calendarSelectionToKstDateTimeInput(selection.startStr) ?? `${dateKey}T09:00`;
  const end = calendarSelectionToKstDateTimeInput(selection.endStr) ?? start;
  const endDateKey = end.slice(0, 10);
  const spanLabel = endDateKey === dateKey
    ? `${start.slice(11)}–${end.slice(11)}`
    : `${start.slice(11)}–${end.slice(5, 10).replace("-", "/")} ${end.slice(11)}`;
  return { kind, dateKey, start, end, spanLabel };
}
