import type { CalendarEventType } from "@/db/schema";
import { parseKstDateTimeInput } from "@/lib/date-input";

export const CALENDAR_EVENT_TITLE_MAX_LENGTH = 120;
export const CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH = 2_000;
export const CALENDAR_EVENT_MAX_DURATION_MS = 31 * 24 * 60 * 60 * 1_000;

const CALENDAR_EVENT_TYPES = new Set<CalendarEventType>([
  "LESSON",
  "PRACTICE",
  "GIG",
  "NOTE",
]);

export type CalendarEventValues = {
  title: string;
  eventType: CalendarEventType;
  startTime: Date;
  endTime: Date | null;
  description: string | null;
};

export type CalendarEventPatch = Partial<CalendarEventValues>;

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function parseDate(value: unknown, label: string): ValidationResult<Date> {
  const parsed = value instanceof Date
    ? new Date(value.getTime())
    : typeof value === "string" && value.trim()
      ? parseKstDateTimeInput(value.trim()) ?? new Date(value)
      : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    return { ok: false, error: `${label} 형식이 올바르지 않습니다.` };
  }
  return { ok: true, value: parsed };
}

function parseTitle(value: unknown): ValidationResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "제목을 입력해주세요." };
  }
  const title = value.trim();
  if (title.length > CALENDAR_EVENT_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      error: `제목은 ${CALENDAR_EVENT_TITLE_MAX_LENGTH}자까지 입력할 수 있습니다.`,
    };
  }
  return { ok: true, value: title };
}

function parseEventType(value: unknown): ValidationResult<CalendarEventType> {
  if (typeof value !== "string" || !CALENDAR_EVENT_TYPES.has(value as CalendarEventType)) {
    return { ok: false, error: "일정 유형이 올바르지 않습니다." };
  }
  return { ok: true, value: value as CalendarEventType };
}

function parseDescription(value: unknown): ValidationResult<string | null> {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "메모 형식이 올바르지 않습니다." };
  }
  const description = value.trim();
  if (description.length > CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      error: `메모는 ${CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH}자까지 입력할 수 있습니다.`,
    };
  }
  return { ok: true, value: description || null };
}

function validateTimeRange(
  startTime: Date,
  endTime: Date | null,
): ValidationResult<true> {
  if (!endTime) return { ok: true, value: true };
  if (endTime.getTime() <= startTime.getTime()) {
    return { ok: false, error: "종료 시간은 시작 시간 이후여야 합니다." };
  }
  if (endTime.getTime() - startTime.getTime() > CALENDAR_EVENT_MAX_DURATION_MS) {
    return { ok: false, error: "일정 기간은 31일을 넘을 수 없습니다." };
  }
  return { ok: true, value: true };
}

export function parseCalendarEventCreateInput(input: {
  title: unknown;
  eventType: unknown;
  startTime: unknown;
  endTime: unknown;
  description: unknown;
}): ValidationResult<CalendarEventValues> {
  const title = parseTitle(input.title);
  if (!title.ok) return title;
  const eventType = parseEventType(input.eventType || "NOTE");
  if (!eventType.ok) return eventType;
  const startTime = parseDate(input.startTime, "시작 시간");
  if (!startTime.ok) return startTime;

  let endTime: Date | null = null;
  if (input.endTime !== null && input.endTime !== undefined && input.endTime !== "") {
    const parsedEnd = parseDate(input.endTime, "종료 시간");
    if (!parsedEnd.ok) return parsedEnd;
    endTime = parsedEnd.value;
  }

  const description = parseDescription(input.description);
  if (!description.ok) return description;
  const range = validateTimeRange(startTime.value, endTime);
  if (!range.ok) return range;

  return {
    ok: true,
    value: {
      title: title.value,
      eventType: eventType.value,
      startTime: startTime.value,
      endTime,
      description: description.value,
    },
  };
}

export function parseCalendarEventUpdateInput(
  input: unknown,
  current: CalendarEventValues,
): ValidationResult<CalendarEventPatch> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "변경할 일정 정보가 올바르지 않습니다." };
  }

  const record = input as Record<string, unknown>;
  const allowedKeys = new Set([
    "title",
    "eventType",
    "startTime",
    "endTime",
    "description",
  ]);
  const keys = Object.keys(record);
  if (!keys.length || keys.some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "변경할 일정 정보가 올바르지 않습니다." };
  }

  const patch: CalendarEventPatch = {};
  if (Object.hasOwn(record, "title")) {
    const title = parseTitle(record.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if (Object.hasOwn(record, "eventType")) {
    const eventType = parseEventType(record.eventType);
    if (!eventType.ok) return eventType;
    patch.eventType = eventType.value;
  }
  if (Object.hasOwn(record, "startTime")) {
    const startTime = parseDate(record.startTime, "시작 시간");
    if (!startTime.ok) return startTime;
    patch.startTime = startTime.value;
  }
  if (Object.hasOwn(record, "endTime")) {
    if (record.endTime === null || record.endTime === "") {
      patch.endTime = null;
    } else {
      const endTime = parseDate(record.endTime, "종료 시간");
      if (!endTime.ok) return endTime;
      patch.endTime = endTime.value;
    }
  }
  if (Object.hasOwn(record, "description")) {
    const description = parseDescription(record.description);
    if (!description.ok) return description;
    patch.description = description.value;
  }

  const range = validateTimeRange(
    patch.startTime ?? current.startTime,
    patch.endTime === undefined ? current.endTime : patch.endTime,
  );
  if (!range.ok) return range;
  return { ok: true, value: patch };
}
