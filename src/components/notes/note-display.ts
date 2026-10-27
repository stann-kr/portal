/**
 * 노트·변경 이력·휴지통 화면의 표시 문자열(캔버스 Notes·NoteDoc·NoteHistory·NotesTrash 보드).
 * 날짜 계산은 `formatKst`로만 하고, client가 받는 목록 행은 서버가 만든 label을 글자만 바꿔 hydration 차이를 피한다.
 */
import { formatKst, formatKstShortDate } from "@/lib/kst-format";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type DateValue = Date | number | null | undefined;

function toTime(value: DateValue): number | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : value;
  return Number.isFinite(time) ? time : null;
}

/** 서비스 시간대(KST, 일광 절약 없음)의 연도. */
function kstYear(time: number): number {
  return new Date(time + KST_OFFSET_MS).getUTCFullYear();
}

const KOREAN_DATE_PATTERN = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/u;

/**
 * 서버가 만든 "2026년 10월 31일" label을 목록의 Mono 날짜 "2026.10.31"로 바꾼다.
 * `now`가 있고 같은 해면 좁은 화면용으로 "10.31"까지 줄일 수 있다. 해석할 수 없는 label(날짜 없음 등)은 그대로 둔다.
 */
export function toLedgerDateLabel(label: string, options: { now?: number; omitSameYear?: boolean } = {}): string {
  const match = KOREAN_DATE_PATTERN.exec(label);
  if (!match) return label;
  const [, year, month, day] = match;
  const monthDay = `${month.padStart(2, "0")}.${day.padStart(2, "0")}`;
  if (options.omitSameYear && options.now !== undefined && Number(year) === kstYear(options.now)) return monthDay;
  return `${year}.${monthDay}`;
}

/** "방금 전 · 12분 전 · 3시간 전". 하루가 지났거나 미래 시각이면 null. */
function formatRecentDistance(time: number, now: number): string | null {
  const distance = now - time;
  if (distance < -MINUTE_MS || distance >= DAY_MS) return null;
  if (distance < MINUTE_MS) return "방금 전";
  if (distance < HOUR_MS) return `${Math.floor(distance / MINUTE_MS)}분 전`;
  return `${Math.floor(distance / HOUR_MS)}시간 전`;
}

/**
 * 목록 "수정" 열. 서버 기준 시각(`now`)이 있으면 하루 안은 상대 시각, 그보다 오래되면 "10월 22일"(다른 해는 연도 포함).
 * 기준 시각이 없으면 서버 label의 날짜 부분을 그대로 쓴다.
 */
export function formatListUpdatedLabel(row: { updatedValue: number | null; updatedLabel: string }, now?: number): string {
  if (row.updatedValue === null) return row.updatedLabel;
  if (now !== undefined) {
    const recent = formatRecentDistance(row.updatedValue, now);
    if (recent) return recent;
  }
  const match = KOREAN_DATE_PATTERN.exec(row.updatedLabel);
  if (!match) return row.updatedLabel;
  const [, year, month, day] = match;
  const monthDay = `${Number(month)}월 ${Number(day)}일`;
  return now !== undefined && Number(year) === kstYear(now) ? monthDay : `${year}년 ${monthDay}`;
}

/** 노트 문서 "수정" 속성: 하루 안은 상대 시각, 그 뒤는 짧은 날짜. */
export function formatNoteUpdated(value: DateValue, now: number): string {
  const time = toTime(value);
  if (time === null) return "—";
  return formatRecentDistance(time, now) ?? formatKstShortDate(time, "—", new Date(now));
}

/** 노트 문서 "날짜" 속성: "2026년 10월 26일 (월)". */
export function formatNoteLongDate(value: DateValue, fallback = "날짜 없음"): string {
  const time = toTime(value);
  if (time === null) return fallback;
  const date = formatKst(time, { year: "numeric", month: "long", day: "numeric" });
  const weekday = formatKst(time, { weekday: "short" });
  return weekday ? `${date} (${weekday})` : date;
}

const CLOCK_OPTIONS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

/** 휴지통 삭제 시각: "10월 25일 21:14", 다른 해는 연도 포함. */
export function formatTrashTime(value: DateValue, now: number): string {
  const time = toTime(value);
  if (time === null) return "시각 없음";
  return `${formatKstShortDate(time, "", new Date(now))} ${formatKst(time, CLOCK_OPTIONS)}`;
}

/** 휴지통 복원 기한: "11월 24일", 다른 해는 연도 포함. */
export function formatTrashDeadline(value: DateValue, now: number): string {
  const time = toTime(value);
  return time === null ? "기한 없음" : formatKstShortDate(time, "기한 없음", new Date(now));
}
