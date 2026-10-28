/**
 * 정기 과제 회차 계산(순수 함수). DB·시계에 의존하지 않고 호출한 쪽이 기준 시각을 넘긴다.
 *
 * 규칙
 * - 주는 일요일에 시작한다(weekdays bit 0 = 일요일 … bit 6 = 토요일).
 * - 0주차는 start_date가 들어 있는 주이고, 0·interval·2·interval… 주차의 선택 요일 가운데
 *   start_date 이후(포함) 날짜가 회차다. end_date는 포함, max_occurrences는 첫 실제 회차부터 센다.
 * - 회차 날짜의 due_time(KST, UTC+9·일광 절약 없음)이 마감 시각이다.
 *
 * 생성 정책(조회 시 생성, cron 없음)
 * - 오늘(KST)까지의 회차와 다음 회차 하나만 만든다.
 * - 규칙이 마지막으로 바뀐 시각(floor, 보통 updated_at) 이전에 이미 마감된 회차는 새로 만들지 않는다.
 *   요일을 바꾸거나 멈췄다 다시 시작했을 때 지난 날짜에 "마감 지남" 회차가 갑자기 생기지 않게 하기 위해서다.
 *   관리자 변경 전에는 옛 규칙으로 밀린 회차를 먼저 만들어 두므로 학생이 오래 접속하지 않아도 회차가 빠지지 않는다.
 * - 한 번에 최대 `cap`(기본 60)개만 고른다. 시작일이 아주 오래전이면 가장 최근 회차부터 남기고 오래된 회차는 버린다.
 */
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export type AssignmentSubmissionFormatValue = "MIX" | "TEXT" | "BOTH";

export const ASSIGNMENT_SUBMISSION_FORMATS: readonly AssignmentSubmissionFormatValue[] = ["MIX", "TEXT", "BOTH"];

export const ASSIGNMENT_FORMAT_LABELS: Record<AssignmentSubmissionFormatValue, string> = {
  MIX: "믹스셋 링크",
  TEXT: "글",
  BOTH: "링크와 글",
};

export type AssignmentRecurrenceSchedule = {
  startDate: string;
  intervalWeeks: number;
  weekdays: number;
  dueTime: string;
  endDate: string | null;
  maxOccurrences: number | null;
};

export type PlannedOccurrence = {
  occurrenceDate: string;
  dueAt: Date;
};

export const RECURRENCE_GENERATION_CAP = 60;
export const RECURRENCE_MAX_OCCURRENCES = 520;
export const RECURRENCE_MAX_INTERVAL_WEEKS = 12;

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/u;
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** YYYY-MM-DD를 1970-01-01 기준 일 번호로 바꾼다. 달력에 없는 날짜는 null. */
export function dayNumberFromKey(key: string): number | null {
  const match = DATE_KEY.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2100) return null;
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return Math.round(time / DAY_MS);
}

export function dayKeyFromNumber(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = 일요일 … 6 = 토요일. */
export function weekdayOfDayNumber(dayNumber: number): number {
  return (((dayNumber + 4) % 7) + 7) % 7;
}

/** 기준 시각의 KST 날짜 키. */
export function kstTodayKey(now: Date): string {
  return dayKeyFromNumber(Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS));
}

export function isValidDueTime(value: string): boolean {
  return TIME_KEY.test(value);
}

/** 회차 날짜와 마감 시각(KST)을 실제 시각으로 바꾼다. */
export function kstDueAt(occurrenceDate: string, dueTime: string): Date {
  const dayNumber = dayNumberFromKey(occurrenceDate);
  const time = TIME_KEY.exec(dueTime);
  if (dayNumber === null || !time) throw new Error("잘못된 회차 날짜 또는 마감 시각입니다.");
  return new Date(dayNumber * DAY_MS + (Number(time[1]) * 60 + Number(time[2])) * 60_000 - KST_OFFSET_MS);
}

export type RecurrenceValidation =
  | { ok: true; schedule: AssignmentRecurrenceSchedule }
  | { ok: false; error: string };

/** 관리자 입력을 저장 가능한 규칙으로 검증한다. DB CHECK와 같은 범위를 쓴다. */
export function validateRecurrenceSchedule(input: {
  startDate: string;
  intervalWeeks: number;
  weekdays: number;
  dueTime: string;
  endDate?: string | null;
  maxOccurrences?: number | null;
}): RecurrenceValidation {
  const start = dayNumberFromKey(input.startDate);
  if (start === null) return { ok: false, error: "시작일을 확인해 주세요." };
  if (!Number.isInteger(input.intervalWeeks) || input.intervalWeeks < 1 || input.intervalWeeks > RECURRENCE_MAX_INTERVAL_WEEKS) {
    return { ok: false, error: `반복 주기는 1~${RECURRENCE_MAX_INTERVAL_WEEKS}주 사이로 골라 주세요.` };
  }
  if (!Number.isInteger(input.weekdays) || input.weekdays < 1 || input.weekdays > 127) {
    return { ok: false, error: "요일을 하나 이상 골라 주세요." };
  }
  if (!isValidDueTime(input.dueTime)) return { ok: false, error: "마감 시각을 21:00 같은 형식으로 입력해 주세요." };
  const endDate = input.endDate || null;
  if (endDate !== null) {
    const end = dayNumberFromKey(endDate);
    if (end === null) return { ok: false, error: "종료일을 확인해 주세요." };
    if (end < start) return { ok: false, error: "종료일은 시작일과 같거나 뒤여야 합니다." };
  }
  const maxOccurrences = input.maxOccurrences ?? null;
  if (maxOccurrences !== null
    && (!Number.isInteger(maxOccurrences) || maxOccurrences < 1 || maxOccurrences > RECURRENCE_MAX_OCCURRENCES)) {
    return { ok: false, error: `횟수는 1~${RECURRENCE_MAX_OCCURRENCES}회 사이로 입력해 주세요.` };
  }
  return {
    ok: true,
    schedule: {
      startDate: input.startDate,
      intervalWeeks: input.intervalWeeks,
      weekdays: input.weekdays,
      dueTime: input.dueTime,
      endDate,
      maxOccurrences,
    },
  };
}

/**
 * start_date부터 차례로 회차 날짜를 만든다. `untilDate`(포함)를 넘거나 `extraAfterUntil`개를 더 찾으면 멈춘다.
 * end_date·max_occurrences를 넘으면 그 전에 멈춘다.
 */
export function enumerateOccurrenceDates(
  schedule: AssignmentRecurrenceSchedule,
  untilDate: string,
  extraAfterUntil = 0,
): string[] {
  const start = dayNumberFromKey(schedule.startDate);
  const until = dayNumberFromKey(untilDate);
  if (start === null || until === null || (schedule.weekdays & 127) === 0 || schedule.intervalWeeks < 1) return [];
  const end = schedule.endDate ? dayNumberFromKey(schedule.endDate) : null;
  const max = schedule.maxOccurrences ?? Number.POSITIVE_INFINITY;
  const weekZero = start - weekdayOfDayNumber(start);
  const period = schedule.intervalWeeks * 7;
  const dates: string[] = [];
  let extra = 0;
  let produced = 0;

  for (let weekStart = weekZero; ; weekStart += period) {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      if ((schedule.weekdays & (1 << weekday)) === 0) continue;
      const day = weekStart + weekday;
      if (day < start) continue;
      if (end !== null && day > end) return dates;
      if (produced >= max) return dates;
      if (day > until) {
        if (extra >= extraAfterUntil) return dates;
        extra += 1;
      }
      dates.push(dayKeyFromNumber(day));
      produced += 1;
    }
  }
}

/**
 * 지금 만들어 둘 회차: 오늘까지의 회차 + 다음 회차 하나 중 floor 이후에 마감되는 것, 최근 순으로 최대 cap개.
 * 반환은 날짜 오름차순이다.
 */
export function planRecurrenceOccurrences(
  schedule: AssignmentRecurrenceSchedule,
  { now, floor = null, cap = RECURRENCE_GENERATION_CAP }: { now: Date; floor?: Date | null; cap?: number },
): PlannedOccurrence[] {
  const planned = enumerateOccurrenceDates(schedule, kstTodayKey(now), 1)
    .map((occurrenceDate) => ({ occurrenceDate, dueAt: kstDueAt(occurrenceDate, schedule.dueTime) }))
    .filter((occurrence) => floor === null || occurrence.dueAt.getTime() > floor.getTime());
  return cap > 0 ? planned.slice(-cap) : [];
}

/** 정기 과제 회차 id: 같은 규칙·날짜는 언제 만들어도 같은 id(UUID v8 모양)다. */
export function deriveAssignmentTaskId(recurrenceId: string, occurrenceDate: string): string {
  if (!recurrenceId || dayNumberFromKey(occurrenceDate) === null) {
    throw new Error("정기 과제 회차 식별자를 만들 수 없습니다.");
  }
  const bytes = sha256(utf8ToBytes(`assignment-task-occurrence\u0000${recurrenceId}\u0000${occurrenceDate}`)).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function weekdayMaskFromList(days: readonly number[]): number {
  let mask = 0;
  for (const day of days) if (Number.isInteger(day) && day >= 0 && day <= 6) mask |= 1 << day;
  return mask;
}

export function weekdayListFromMask(mask: number): number[] {
  return WEEKDAY_LABELS.map((_, day) => day).filter((day) => (mask & (1 << day)) !== 0);
}

function shortDateLabel(key: string): string {
  const match = DATE_KEY.exec(key);
  return match ? `${Number(match[2])}월 ${Number(match[3])}일` : key;
}

/** 규칙 요약: "매주 월·수 21:00 마감 · 10월 27일부터 · 12회". 월요일부터 읽히게 일요일을 뒤에 둔다. */
export function describeRecurrenceSchedule(schedule: AssignmentRecurrenceSchedule): string {
  const days = weekdayListFromMask(schedule.weekdays)
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((day) => WEEKDAY_LABELS[day])
    .join("·");
  const cadence = schedule.intervalWeeks === 1 ? "매주" : `${schedule.intervalWeeks}주마다`;
  const parts = [`${cadence} ${days} ${schedule.dueTime} 마감`, `${shortDateLabel(schedule.startDate)}부터`];
  if (schedule.endDate) parts.push(`${shortDateLabel(schedule.endDate)}까지`);
  if (schedule.maxOccurrences) parts.push(`${schedule.maxOccurrences}회`);
  return parts.join(" · ");
}
