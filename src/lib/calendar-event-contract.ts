import type { CalendarEventType } from "@/db/schema";
import { parseDateTimeInput } from "@/lib/date-input";

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
      ? parseDateTimeInput(value.trim())
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

/** 상세 패널 수정 form이 고칠 수 있는 칸. */
export const CALENDAR_EVENT_EDIT_FIELDS = [
  "title",
  "eventType",
  "startTime",
  "endTime",
  "description",
] as const;

export type CalendarEventEditField = (typeof CALENDAR_EVENT_EDIT_FIELDS)[number];

/** 상세 패널 수정 form이 연 값을 함께 보내는 hidden input 이름. */
export function openedCalendarEventFieldName(field: CalendarEventEditField): string {
  return `opened.${field}`;
}

function parseOptionalDate(value: unknown, label: string): ValidationResult<Date | null> {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  return parseDate(value, label);
}

function sameOptionalTime(left: Date | null, right: Date | null): boolean {
  return left === null || right === null ? left === right : left.getTime() === right.getTime();
}

/**
 * 상세 패널 수정 form이 연 값(opened)과 보낸 값(submitted)을 같은 규칙으로 읽어 비교하고, 학생이 고친 칸만 patch로
 * 고른다. 손대지 않은 칸은 그 사이 다른 곳(관리자가 옮긴 시간·외부 캘린더 동기화)에서 바뀐 값을 덮지 않고, 같은 칸을
 * 둘이 고치면 나중 저장이 이긴다(2026-11-14 사용자 결정). 연 값을 읽을 수 없는 칸은 고친 칸으로 본다.
 * opened가 null이면(연 값을 보내지 않는 이전 화면) 보낸 값 전체를 patch로 쓴다.
 */
export function pickEditedCalendarEventFields(
  submitted: CalendarEventValues,
  opened: Record<CalendarEventEditField, unknown> | null,
): CalendarEventPatch {
  if (!opened) return { ...submitted };
  const patch: CalendarEventPatch = {};
  const title = parseTitle(opened.title);
  if (!title.ok || title.value !== submitted.title) patch.title = submitted.title;
  const eventType = parseEventType(opened.eventType || "NOTE");
  if (!eventType.ok || eventType.value !== submitted.eventType) patch.eventType = submitted.eventType;
  const startTime = parseDate(opened.startTime, "시작 시간");
  if (!startTime.ok || startTime.value.getTime() !== submitted.startTime.getTime()) {
    patch.startTime = submitted.startTime;
  }
  const endTime = parseOptionalDate(opened.endTime, "종료 시간");
  if (!endTime.ok || !sameOptionalTime(endTime.value, submitted.endTime)) patch.endTime = submitted.endTime;
  const description = parseDescription(opened.description);
  if (!description.ok || description.value !== submitted.description) patch.description = submitted.description;
  return patch;
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
