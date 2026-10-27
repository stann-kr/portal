/**
 * 화면의 날짜·시각은 실행 환경과 무관하게 서비스 기준 시간대로 표시한다.
 * Worker SSR은 UTC로 실행되므로 timeZone 없는 Intl/toLocale 호출은 배포 환경에서 9시간 어긋난다.
 */
export const KST_TIME_ZONE = "Asia/Seoul";

export type KstDateInput = Date | string | number | null | undefined;

/** 연·월·일과 시·분. 휴지통·이력처럼 정확한 시점을 보여 줄 때 사용한다. */
export const KST_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("ko-KR", { ...options, timeZone: KST_TIME_ZONE });
    formatters.set(key, formatter);
  }
  return formatter;
}

function toValidDate(value: KstDateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** 값이 없거나 해석할 수 없으면 fallback을 반환한다. */
export function formatKst(
  value: KstDateInput,
  options: Intl.DateTimeFormatOptions = KST_DATE_TIME,
  fallback = "",
): string {
  const date = toValidDate(value);
  return date ? getFormatter(options).format(date) : fallback;
}

/** 현재 KST 연도와 다를 때만 연도를 붙인 짧은 날짜(예: 10월 9일, 2025년 3월 2일). */
export function formatKstShortDate(
  value: KstDateInput,
  fallback = "",
  referenceTime: Date = new Date(),
): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  const sameYear = getFormatter({ year: "numeric" }).format(date)
    === getFormatter({ year: "numeric" }).format(referenceTime);
  return getFormatter(sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" }).format(date);
}

const CLOCK_24H: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

/**
 * 캔버스 목록의 점 날짜(10.28, 10.28 (수) 19:00). 기준 시각과 연도가 다르면 앞에 연도를 붙인다.
 * 학생 홈·관리자 업무함·학생 관리가 함께 쓴다.
 */
export function formatKstDot(
  value: KstDateInput,
  { weekday = false, time = false, referenceTime }: { weekday?: boolean; time?: boolean; referenceTime?: Date } = {},
): string {
  const [year, month, day] = formatKst(value, { year: "numeric", month: "2-digit", day: "2-digit" }).match(/\d+/gu) ?? [];
  if (!year || !month || !day) return "";
  const sameYear = !referenceTime || formatKst(referenceTime, { year: "numeric" }).includes(year);
  let label = sameYear ? `${month}.${day}` : `${year}.${month}.${day}`;
  if (weekday) label += ` (${formatKst(value, { weekday: "short" })})`;
  if (time) label += ` ${formatKst(value, CLOCK_24H)}`;
  return label;
}

/** "10.24"처럼 월.일 숫자 날짜. 값이 없으면 fallback. */
export function formatKstMonthDay(value: KstDateInput, fallback = ""): string {
  const text = formatKst(value, { month: "2-digit", day: "2-digit" }, "");
  return text ? text.replace(/\.\s*/gu, ".").replace(/\.$/u, "") : fallback;
}

/** "10.24 14:20"처럼 월.일과 24시간 시각. 값이 없으면 fallback. */
export function formatKstMonthDayTime(value: KstDateInput, fallback = ""): string {
  const day = formatKstMonthDay(value);
  if (!day) return fallback;
  return `${day} ${formatKst(value, CLOCK_24H)}`;
}

/** 변경 이력 시각(Mono): "10.26 18:40", 다른 해는 "2025.10.26 18:40". */
export function formatRecordTime(value: KstDateInput, now: number): string {
  const date = toValidDate(value);
  if (!date) return "시각 없음";
  return `${formatKstDot(date, { referenceTime: new Date(now) })} ${formatKst(date, CLOCK_24H)}`;
}
