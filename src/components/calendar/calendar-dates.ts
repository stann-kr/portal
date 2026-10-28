/**
 * @file src/components/calendar/calendar-dates.ts
 * @description 캘린더 화면의 날짜 key(YYYY-MM-DD, KST) 계산과 표시 문구. 시각 변환 규칙은 lib의 KST helper를 따른다.
 */
import { toKstDateInputValue, toKstDateTimeInputValue } from "@/lib/date-input";
import { formatKst } from "@/lib/kst-format";
import { getNoteCalendarDateKey } from "@/lib/calendar-interaction";
import { isUnifiedItemAllDay } from "@/lib/unified-item-views";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

const DAY_MS = 24 * 60 * 60 * 1_000;

/** 날짜 key 자체는 시간대가 없으므로 UTC 자정으로 계산한다. */
function keyToUtc(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

function utcToKey(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function shiftDateKey(dateKey: string, days: number): string {
  return utcToKey(keyToUtc(dateKey) + days * DAY_MS);
}

/** 0 = 일요일. */
export function weekdayOf(dateKey: string): number {
  return new Date(keyToUtc(dateKey)).getUTCDay();
}

/** 캔버스 보드처럼 일요일에서 시작하는 주. */
export function weekStartKey(dateKey: string): string {
  return shiftDateKey(dateKey, -weekdayOf(dateKey));
}

export function weekKeys(startKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftDateKey(startKey, index));
}

export type MonthCursor = { year: number; month: number };

export function monthOf(dateKey: string): MonthCursor {
  return { year: Number(dateKey.slice(0, 4)), month: Number(dateKey.slice(5, 7)) };
}

export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const index = cursor.year * 12 + (cursor.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 앞뒤 달 날짜로 채운 주 단위 달력(필요한 주만). */
export function monthGridWeeks(cursor: MonthCursor): string[][] {
  const first = `${cursor.year}-${String(cursor.month).padStart(2, "0")}-01`;
  const next = shiftMonth(cursor, 1);
  const nextFirst = `${next.year}-${String(next.month).padStart(2, "0")}-01`;
  const days = Math.round((keyToUtc(nextFirst) - keyToUtc(first)) / DAY_MS);
  const lead = weekdayOf(first);
  const weeks = Math.ceil((lead + days) / 7);
  const start = shiftDateKey(first, -lead);
  return Array.from({ length: weeks }, (_, week) => weekKeys(shiftDateKey(start, week * 7)));
}

export function isInMonth(dateKey: string, cursor: MonthCursor): boolean {
  const { year, month } = monthOf(dateKey);
  return year === cursor.year && month === cursor.month;
}

export function formatMonthTitle(cursor: MonthCursor): string {
  return `${cursor.year}년 ${cursor.month}월`;
}

/** 표시용 Date. 정오로 두어 어느 시간대에서도 같은 날짜로 읽힌다. */
export function dateKeyToDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00+09:00`);
}

/** "10월 31일 (토)" */
export function formatDayHeading(dateKey: string): string {
  const date = dateKeyToDate(dateKey);
  return `${formatKst(date, { month: "long", day: "numeric" })} (${formatKst(date, { weekday: "short" })})`;
}

/** "10월 31일 토요일" */
export function formatDayLong(dateKey: string): string {
  return formatKst(dateKeyToDate(dateKey), { month: "long", day: "numeric", weekday: "long" });
}

export function todayKey(): string {
  return toKstDateInputValue(new Date());
}

/** 항목이 놓이는 KST 날짜. 노트는 지정 날짜, 종일 일정은 시작 날짜를 쓴다. */
export function getItemDateKey(item: UnifiedItem): string {
  if (item.type === "NOTE") return getNoteCalendarDateKey(item);
  const allDayStart = item.metadata.allDayStartDate;
  if (item.metadata.allDay === true && typeof allDayStart === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(allDayStart)) {
    return allDayStart;
  }
  return toKstDateInputValue(new Date(item.date));
}

export function formatItemTime(item: UnifiedItem): string {
  return isUnifiedItemAllDay(item) ? "종일" : toKstDateTimeInputValue(new Date(item.date)).slice(11);
}

/** 표의 날짜 열: "2026.10.28 19:00", 좁은 화면은 연도를 뺀 "10.28 19:00". */
export function formatLedgerDate(item: UnifiedItem, { withYear }: { withYear: boolean }): string {
  const dateKey = getItemDateKey(item);
  const date = (withYear ? dateKey : dateKey.slice(5)).replaceAll("-", ".");
  return isUnifiedItemAllDay(item) ? date : `${date} ${formatItemTime(item)}`;
}

/** 상세의 시각: "10.26 (월) 14:00". 올해가 아니면 연도를 붙인다. */
export function formatDetailMoment(value: Date, { allDay = false }: { allDay?: boolean } = {}): string {
  const local = toKstDateTimeInputValue(value);
  const dateKey = local.slice(0, 10);
  const sameYear = dateKey.slice(0, 4) === todayKey().slice(0, 4);
  const day = `${(sameYear ? dateKey.slice(5) : dateKey).replaceAll("-", ".")} (${formatKst(dateKeyToDate(dateKey), { weekday: "short" })})`;
  return allDay ? day : `${day} ${local.slice(11)}`;
}

/** 상세의 날짜만: "2026년 10월 31일 (토)" */
export function formatDetailDate(dateKey: string): string {
  const date = dateKeyToDate(dateKey);
  return `${formatKst(date, { year: "numeric", month: "long", day: "numeric" })} (${formatKst(date, { weekday: "short" })})`;
}
