/**
 * 양방향 캘린더 동기화의 provider-agnostic 계약.
 *
 * 시간 계약(engine이 의존한다):
 * - 시간 지정 일정의 `start`/`end`는 실제 UTC 순간(Date)이다. 원격으로 보낼 때는 항상 UTC(`Z`)로 쓴다.
 * - 종일 일정(`allDay: true`)은 `CALENDAR_SYNC_TIME_ZONE`(Asia/Seoul) 기준 날짜다.
 *   읽을 때 `start`/`end`는 그 날짜의 KST 00:00 순간이며 `end`는 **배타적**(마지막 날 다음 날 00:00)이다.
 *   `allDayStartDate`/`allDayEndDate`(YYYY-MM-DD, end 배타적)도 함께 준다.
 *   쓸 때도 `start`/`end`의 KST 날짜를 쓰며 `end`는 배타적으로 해석한다(end <= start면 하루짜리).
 * - TZID 없는 floating 시각은 `CALENDAR_SYNC_TIME_ZONE`으로 해석한다.
 */
export const CALENDAR_SYNC_TIME_ZONE = "Asia/Seoul";

export type CalendarProviderKind = "GOOGLE" | "ICLOUD";

export type RemoteCalendar = {
  /** Google: calendarId. iCloud: collection의 절대 URL(끝 `/` 포함). */
  id: string;
  name: string;
  /** `#RRGGBB` */
  color?: string;
  readOnly: boolean;
};

export type RemoteEventInput = {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  /** 안정적인 로컬 키(예: `lesson:<id>`, `event:<id>`). Google extendedProperties.private.portalRef / ICS X-STANNLUMO-PORTAL-REF. */
  portalRef: string;
};

export type RemoteEvent = {
  /** Google: event id. iCloud: 리소스 href path(예: `/123/calendars/ABC/x.ics`). */
  remoteId: string;
  /** 다음 update/remove의 `ifMatchEtag`로 그대로 넘긴다(따옴표 포함 원문). */
  etag: string;
  title: string;
  description: string;
  start: Date;
  /** 시간 지정은 UTC 순간, 종일은 배타적 end. */
  end: Date;
  allDay: boolean;
  allDayStartDate?: string;
  allDayEndDate?: string;
  status: "confirmed" | "cancelled";
  updatedAt?: Date;
  portalRef?: string;
  /** 반복 master 또는 반복 instance/예외. engine은 읽기 전용으로 다룬다. master DTSTART를 start로 준다. */
  recurring?: boolean;
};

export type PullResult = {
  changed: RemoteEvent[];
  deletedRemoteIds: string[];
  /** 다음 pull에 넘길 cursor. `fullResync: true`면 항상 "". */
  nextCursor: string;
  /**
   * true면 cursor가 무효다(Google 410, CalDAV valid-sync-token). `changed`/`deletedRemoteIds`는 비어 있고
   * caller는 `pull(calendarId, null, window)`로 다시 시작해 전체 상태를 재대조해야 한다.
   */
  fullResync: boolean;
};

export type WriteResult = { remoteId: string; etag: string };

export type PullWindow = { from: Date; to: Date };

export type CalendarProviderClient = {
  readonly kind: CalendarProviderKind;
  listCalendars(): Promise<RemoteCalendar[]>;
  /**
   * cursor가 null이면 window 안의 전체 상태(초기 동기화)를, 아니면 cursor 이후 변경을 돌려준다.
   * 증분 결과는 window로 거르지 않는다(이동해 window 밖으로 나간 연결 항목도 보고된다).
   */
  pull(calendarId: string, cursor: string | null, window: PullWindow): Promise<PullResult>;
  create(calendarId: string, input: RemoteEventInput): Promise<WriteResult>;
  /** 412/etag 불일치 → CalendarConflictError. */
  update(calendarId: string, remoteId: string, input: RemoteEventInput, ifMatchEtag: string): Promise<WriteResult>;
  /** 이미 없으면 CalendarNotFoundError(engine은 성공으로 취급해도 된다). */
  remove(calendarId: string, remoteId: string, ifMatchEtag: string): Promise<void>;
  /** create 응답 유실 등 복구용: portalRef로 기존 원격 일정을 찾는다. */
  findByPortalRef(calendarId: string, portalRef: string): Promise<RemoteEvent | null>;
};

type CalendarErrorOptions = { status?: number; reason?: string };

/** 메시지에는 credential·token·본문을 넣지 않는다. */
export class CalendarSyncError extends Error {
  readonly status?: number;
  readonly reason?: string;
  constructor(message: string, options: CalendarErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.status = options.status;
    this.reason = options.reason;
  }
}
/** 폐기·무효 credential. caller는 연결을 broken으로 표시한다. */
export class CalendarAuthError extends CalendarSyncError {}
/** 412 / etag 불일치. caller는 다시 pull 후 결정한다. */
export class CalendarConflictError extends CalendarSyncError {}
export class CalendarNotFoundError extends CalendarSyncError {}
export class CalendarRateLimitError extends CalendarSyncError {
  readonly retryAfterSeconds?: number;
  constructor(message: string, options: CalendarErrorOptions & { retryAfterSeconds?: number } = {}) {
    super(message, options);
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
export class CalendarProviderError extends CalendarSyncError {}

export const CALENDAR_SYNC_TIMEOUT_MS = 5_000;
export const CALENDAR_SYNC_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const CALENDAR_SYNC_MAX_PAGES = 40;
export const CALENDAR_SYNC_DEFAULT_LESSON_MINUTES = 60;
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 8_000;
const MAX_PORTAL_REF_LENGTH = 200;
/** escaping 없이 X-prop·extended property에 그대로 넣을 수 있는 문자만 허용한다. */
export const PORTAL_REF_PATTERN = /^[A-Za-z0-9._:@-]+$/u;

export function buildPortalRef(kind: "lesson" | "event", id: string): string {
  return `${kind}:${id}`;
}

/** 레슨(start만 있음)을 원격 입력으로 바꾼다. */
export function lessonToRemoteInput(input: {
  lessonId: string;
  title: string;
  start: Date;
  description?: string;
  durationMinutes?: number;
}): RemoteEventInput {
  const minutes = input.durationMinutes ?? CALENDAR_SYNC_DEFAULT_LESSON_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
    throw new CalendarProviderError("Lesson duration is invalid");
  }
  return {
    title: input.title,
    description: input.description,
    start: input.start,
    end: new Date(input.start.getTime() + minutes * 60_000),
    portalRef: buildPortalRef("lesson", input.lessonId),
  };
}

/** 원격으로 보내기 전 입력을 검증·정리한다. */
export function normalizeRemoteEventInput(input: RemoteEventInput): RemoteEventInput {
  const startMs = input.start instanceof Date ? input.start.getTime() : Number.NaN;
  const endMs = input.end instanceof Date ? input.end.getTime() : Number.NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new CalendarProviderError("Event time is invalid");
  if (!input.allDay && endMs < startMs) throw new CalendarProviderError("Event end is before start");
  const portalRef = String(input.portalRef ?? "").trim();
  if (!portalRef || portalRef.length > MAX_PORTAL_REF_LENGTH || !PORTAL_REF_PATTERN.test(portalRef)) {
    throw new CalendarProviderError("Portal reference is invalid");
  }
  const title = String(input.title ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ").replace(/[\r\n]+/gu, " ").trim().slice(0, MAX_TITLE_LENGTH);
  const description = String(input.description ?? "").replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").slice(0, MAX_DESCRIPTION_LENGTH);
  return {
    title: title || "일정",
    description,
    start: new Date(startMs),
    end: new Date(endMs),
    allDay: Boolean(input.allDay),
    portalRef,
  };
}

export function assertPullWindow(window: PullWindow): void {
  const from = window?.from?.getTime?.();
  const to = window?.to?.getTime?.();
  if (!Number.isFinite(from) || !Number.isFinite(to) || (from as number) >= (to as number)) {
    throw new CalendarProviderError("Pull window is invalid");
  }
}

export function fullResyncResult(): PullResult {
  return { changed: [], deletedRemoteIds: [], nextCursor: "", fullResync: true };
}

// ── 시간대 유틸 ─────────────────────────────────────────────

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    zoneFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

type WallTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallTimeInZone(date: Date, timeZone: string): WallTime {
  const parts: Record<string, number> = {};
  for (const part of zoneFormatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

/** IANA 시간대의 벽시계 시각을 UTC Date로 바꾼다(DST 경계는 두 번 보정). */
export function zonedWallTimeToDate(wall: WallTime, timeZone: string): Date {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  let guess = asUtc;
  for (let index = 0; index < 2; index += 1) {
    const seen = wallTimeInZone(new Date(guess), timeZone);
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    guess += asUtc - seenUtc;
  }
  return new Date(guess);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** `YYYY-MM-DD`를 해당 시간대의 00:00 순간으로 바꾼다. */
export function dateOnlyToDate(value: string, timeZone = CALENDAR_SYNC_TIME_ZONE): Date {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new CalendarProviderError("All-day date is invalid");
  return zonedWallTimeToDate({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 0, minute: 0, second: 0 }, timeZone);
}

/** Date의 해당 시간대 날짜를 `YYYY-MM-DD`로 돌려준다. */
export function dateToDateOnly(date: Date, timeZone = CALENDAR_SYNC_TIME_ZONE): string {
  const wall = wallTimeInZone(date, timeZone);
  return `${String(wall.year).padStart(4, "0")}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}

export function addDaysToDateOnly(value: string, days: number): string {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new CalendarProviderError("All-day date is invalid");
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return utc.toISOString().slice(0, 10);
}

/** 종일 입력의 KST 시작일과 배타적 종료일을 계산한다. */
export function allDayRange(input: { start: Date; end: Date }, timeZone = CALENDAR_SYNC_TIME_ZONE): { startDate: string; endDate: string } {
  const startDate = dateToDateOnly(input.start, timeZone);
  let endDate = dateToDateOnly(input.end, timeZone);
  if (endDate <= startDate) endDate = addDaysToDateOnly(startDate, 1);
  return { startDate, endDate };
}

// ── 응답 읽기 유틸 ──────────────────────────────────────────

export async function readBoundedText(response: Response, maxBytes = CALENDAR_SYNC_MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new CalendarProviderError("Calendar response is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CalendarProviderError("Calendar response is too large");
    }
    chunks.push(next.value);
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.round((date - Date.now()) / 1_000));
  return undefined;
}

export type FetchedText = { status: number; headers: Headers; text: string };

/**
 * 제한 시간 안에 fetch하고 본문을 크기 제한 안에서 읽는다(redirect는 항상 manual).
 * network/abort 오류는 credential·URL 없는 CalendarProviderError로 바꾼다.
 */
export async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<FetchedText> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? CALENDAR_SYNC_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, redirect: "manual", signal: controller.signal });
    const text = await readBoundedText(response, options.maxBytes);
    return { status: response.status, headers: response.headers, text };
  } catch (error) {
    if (error instanceof CalendarSyncError) throw error;
    throw new CalendarProviderError("Calendar provider is unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
