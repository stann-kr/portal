const KST_TIME_ZONE = "Asia/Seoul";
const KST_OFFSET_HOURS = 9;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATE_TIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;

function getKstParts(value: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** Asia/Seoul 기준 날짜를 HTML date input 형식으로 반환한다. */
export function toKstDateInputValue(value = new Date()): string {
  const parts = getKstParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Asia/Seoul 기준 시각을 HTML datetime-local 형식으로 반환한다. */
export function toKstDateTimeInputValue(value: Date): string {
  const parts = getKstParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * timezone 정보가 없는 datetime-local 값을 실행 환경의 timezone과 무관하게 KST로 해석한다.
 * ISO offset/Z가 있는 값은 이 함수가 아니라 일반 Date parser를 사용한다.
 */
export function parseKstDateTimeInput(value: string): Date | null {
  const match = DATE_TIME_LOCAL_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, hour - KST_OFFSET_HOURS, minute, second));
  const expected = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}`;
  return toKstDateTimeInputValue(parsed) === expected ? parsed : null;
}

/** FullCalendar의 date-only 또는 offset 포함 선택값을 KST 날짜 key로 정규화한다. */
export function calendarSelectionToKstDateKey(value: string): string | null {
  if (DATE_ONLY_PATTERN.test(value)) {
    const parsed = parseKstDateTimeInput(`${value}T00:00`);
    return parsed ? value : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? toKstDateInputValue(parsed) : null;
}

/** 선택 날짜는 오전 9시, 시간 칸 선택은 해당 KST 시각으로 일정 폼을 채운다. */
export function calendarSelectionToKstDateTimeInput(value: string): string | null {
  if (DATE_ONLY_PATTERN.test(value)) {
    return parseKstDateTimeInput(`${value}T09:00`) ? `${value}T09:00` : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? toKstDateTimeInputValue(parsed) : null;
}

export function formatKstDateLabel(value: string): string {
  const parsed = parseKstDateTimeInput(`${value}T00:00`);
  if (!parsed) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parsed);
}
