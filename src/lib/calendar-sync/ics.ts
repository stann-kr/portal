import ICAL from "ical.js";
import {
  CALENDAR_SYNC_TIME_ZONE,
  CalendarProviderError,
  addDaysToDateOnly,
  allDayRange,
  dateOnlyToDate,
  isValidTimeZone,
  normalizeRemoteEventInput,
  sha256Hex,
  wallTimeInZone,
  zonedWallTimeToDate,
  type RemoteEvent,
  type RemoteEventInput,
} from "./types";

export const PORTAL_REF_PROPERTY = "X-STANNLUMO-PORTAL-REF";
export const ICS_PRODID = "-//Stann Lumo//Portal Calendar Sync//KO";
const UID_DOMAIN = "portal.stannlumo";
const FOLD_OCTETS = 75;

/** portalRef에서 안정적인 UID를 만든다(같은 로컬 항목은 항상 같은 UID). */
export async function derivePortalUid(portalRef: string): Promise<string> {
  return `${(await sha256Hex(`portal-uid:v1:${portalRef}`)).slice(0, 32)}@${UID_DOMAIN}`;
}

/** portalRef에서 안정적인 UUID 형식 리소스 이름(CalDAV `<uuid>.ics`)을 만든다. */
export async function derivePortalResourceName(portalRef: string): Promise<string> {
  const hex = (await sha256Hex(`portal-resource:v1:${portalRef}`)).slice(0, 32).split("");
  hex[12] = "5"; // version nibble
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // variant
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`.toUpperCase();
}

/** RFC 5545 TEXT escaping. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,")
    .replace(/\r\n|\r|\n/gu, "\\n");
}

/** 한 content line을 75 octet 단위로 접는다. UTF-8 multi-byte 문자는 쪼개지 않는다. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).byteLength <= FOLD_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  let limit = FOLD_OCTETS;
  for (const character of line) {
    const octets = encoder.encode(character).byteLength;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
      limit = FOLD_OCTETS - 1; // continuation line의 선행 공백 1 octet
    }
    current += character;
    currentOctets += octets;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function unfoldIcs(value: string): string {
  return value.replace(/\r?\n[ \t]/gu, "");
}

/** 전체 문서를 CRLF·75 octet folding으로 정규화한다. */
export function normalizeIcsLines(value: string): string {
  const lines = unfoldIcs(value).split(/\r\n|\r|\n/u).filter((line) => line.length > 0);
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function formatIcsUtc(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function formatIcsDate(dateOnly: string): string {
  return dateOnly.replaceAll("-", "");
}

function assertUid(uid: string): string {
  const trimmed = uid.trim();
  if (!trimmed || trimmed.length > 255 || /[\u0000-\u001F\u007F]/u.test(trimmed)) throw new CalendarProviderError("Event UID is invalid");
  return trimmed;
}

/** PUT용 단일 VEVENT VCALENDAR 문자열. 시간 지정은 UTC, 종일은 VALUE=DATE(KST 날짜, DTEND 배타적). */
export function buildIcsEvent(
  rawInput: RemoteEventInput,
  options: { uid: string; now?: Date; sequence?: number },
): string {
  const input = normalizeRemoteEventInput(rawInput);
  const uid = assertUid(options.uid);
  const now = options.now ?? new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICS_PRODID}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${formatIcsUtc(now)}`,
    `LAST-MODIFIED:${formatIcsUtc(now)}`,
  ];
  if (input.allDay) {
    const range = allDayRange(input);
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(range.startDate)}`, `DTEND;VALUE=DATE:${formatIcsDate(range.endDate)}`);
  } else {
    lines.push(`DTSTART:${formatIcsUtc(input.start)}`, `DTEND:${formatIcsUtc(input.end)}`);
  }
  if (options.sequence !== undefined && Number.isInteger(options.sequence) && options.sequence >= 0) {
    lines.push(`SEQUENCE:${options.sequence}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(input.title)}`);
  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  lines.push(`${PORTAL_REF_PROPERTY}:${input.portalRef}`, "END:VEVENT", "END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function parseCalendar(ics: string): ICAL.Component {
  let component: ICAL.Component;
  try {
    component = new ICAL.Component(ICAL.parse(ics));
  } catch {
    throw new CalendarProviderError("Calendar data is invalid");
  }
  if (component.name !== "vcalendar") throw new CalendarProviderError("Calendar data is invalid");
  return component;
}

function masterEvent(calendar: ICAL.Component): { master: ICAL.Component | null; events: ICAL.Component[] } {
  const events = calendar.getAllSubcomponents("vevent");
  const master = events.find((event) => !event.hasProperty("recurrence-id")) ?? events[0] ?? null;
  return { master, events };
}

function isRecurringSet(master: ICAL.Component, events: ICAL.Component[]): boolean {
  return master.hasProperty("rrule") || master.hasProperty("rdate") || events.some((event) => event.hasProperty("recurrence-id"));
}

type ResolvedTime = { date: Date; allDay: boolean; dateOnly?: string };

function resolveTime(property: ICAL.Property | null, timeZone: string): ResolvedTime | null {
  if (!property) return null;
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time)) return null;
  if (value.isDate) {
    const dateOnly = `${pad(value.year, 4)}-${pad(value.month)}-${pad(value.day)}`;
    return { date: dateOnlyToDate(dateOnly, timeZone), allDay: true, dateOnly };
  }
  const zone = value.zone;
  if (zone && zone.tzid !== "floating") {
    return { date: new Date(value.toUnixTime() * 1_000), allDay: false };
  }
  const tzidParameter = property.getParameter("tzid");
  const tzid = typeof tzidParameter === "string" ? tzidParameter : (value as unknown as { timezone?: string }).timezone;
  const effectiveZone = tzid && isValidTimeZone(tzid) ? tzid : timeZone;
  return {
    date: zonedWallTimeToDate(
      { year: value.year, month: value.month, day: value.day, hour: value.hour, minute: value.minute, second: value.second },
      effectiveZone,
    ),
    allDay: false,
  };
}

function stringProperty(component: ICAL.Component, name: string): string {
  const value = component.getFirstPropertyValue(name);
  return typeof value === "string" ? value : "";
}

/**
 * calendar-data를 RemoteEvent로 바꾼다. VEVENT가 없으면 null.
 * 반복 일정은 master(RECURRENCE-ID 없음)의 DTSTART를 쓰고 `recurring: true`로 표시한다.
 */
export function parseIcsEvent(
  ics: string,
  meta: { remoteId: string; etag: string; timeZone?: string },
): RemoteEvent | null {
  const timeZone = meta.timeZone ?? CALENDAR_SYNC_TIME_ZONE;
  const calendar = parseCalendar(ics);
  const { master, events } = masterEvent(calendar);
  if (!master) return null;
  const start = resolveTime(master.getFirstProperty("dtstart"), timeZone);
  if (!start) throw new CalendarProviderError("Calendar event has no start");
  let end = resolveTime(master.getFirstProperty("dtend"), timeZone);
  let allDayEndDate = end?.dateOnly;
  if (!end) {
    const duration = master.getFirstPropertyValue("duration");
    if (duration instanceof ICAL.Duration) {
      const seconds = duration.toSeconds();
      if (start.allDay && start.dateOnly) {
        allDayEndDate = addDaysToDateOnly(start.dateOnly, Math.max(1, Math.round(seconds / 86_400)));
        end = { date: dateOnlyToDate(allDayEndDate, timeZone), allDay: true, dateOnly: allDayEndDate };
      } else {
        end = { date: new Date(start.date.getTime() + seconds * 1_000), allDay: false };
      }
    } else if (start.allDay && start.dateOnly) {
      allDayEndDate = addDaysToDateOnly(start.dateOnly, 1);
      end = { date: dateOnlyToDate(allDayEndDate, timeZone), allDay: true, dateOnly: allDayEndDate };
    } else {
      end = { date: start.date, allDay: false };
    }
  }
  if (start.allDay && (!allDayEndDate || !start.dateOnly || allDayEndDate <= start.dateOnly)) {
    allDayEndDate = addDaysToDateOnly(start.dateOnly as string, 1);
    end = { date: dateOnlyToDate(allDayEndDate, timeZone), allDay: true, dateOnly: allDayEndDate };
  }
  const lastModified = resolveTime(master.getFirstProperty("last-modified"), "UTC");
  const portalRef = stringProperty(master, PORTAL_REF_PROPERTY.toLowerCase()).trim();
  const status = stringProperty(master, "status").toUpperCase() === "CANCELLED" ? "cancelled" : "confirmed";
  const recurring = isRecurringSet(master, events);
  const uid = stringProperty(master, "uid").trim();
  return {
    remoteId: meta.remoteId,
    etag: meta.etag,
    title: stringProperty(master, "summary"),
    description: stringProperty(master, "description"),
    start: start.date,
    end: end.date,
    allDay: start.allDay,
    ...(start.allDay ? { allDayStartDate: start.dateOnly, allDayEndDate } : {}),
    status,
    ...(lastModified ? { updatedAt: lastModified.date } : {}),
    ...(portalRef ? { portalRef } : {}),
    ...(recurring ? { recurring: true, seriesIcs: normalizeIcsLines(ics), ...(uid ? { seriesKey: uid } : {}) } : { recurring: false }),
  };
}

/** 리소스의 UID(없으면 null). */
export function readIcsUid(ics: string): string | null {
  const { master } = masterEvent(parseCalendar(ics));
  const uid = master ? stringProperty(master, "uid").trim() : "";
  return uid || null;
}

/**
 * 기존 리소스의 UID·알림·참석자 등 다른 속성을 보존한 채 제목·설명·시간·portalRef만 바꾼다.
 * 반복 일정은 시리즈 전체를 바꿀 위험이 있어 거부한다.
 */
export function patchIcsEvent(existingIcs: string, rawInput: RemoteEventInput, options: { now?: Date } = {}): string {
  const input = normalizeRemoteEventInput(rawInput);
  const calendar = parseCalendar(existingIcs);
  const { master, events } = masterEvent(calendar);
  if (!master) throw new CalendarProviderError("Calendar event is missing");
  if (isRecurringSet(master, events)) throw new CalendarProviderError("Recurring events are read-only", { reason: "recurring" });
  const now = ICAL.Time.fromJSDate(options.now ?? new Date(), true);

  master.removeAllProperties("dtstart");
  master.removeAllProperties("dtend");
  master.removeAllProperties("duration");
  if (input.allDay) {
    const range = allDayRange(input);
    master.addPropertyWithValue("dtstart", ICAL.Time.fromDateString(range.startDate));
    master.addPropertyWithValue("dtend", ICAL.Time.fromDateString(range.endDate));
  } else {
    master.addPropertyWithValue("dtstart", ICAL.Time.fromJSDate(input.start, true));
    master.addPropertyWithValue("dtend", ICAL.Time.fromJSDate(input.end, true));
  }
  master.updatePropertyWithValue("summary", input.title);
  if (input.description) master.updatePropertyWithValue("description", input.description);
  else master.removeAllProperties("description");
  master.updatePropertyWithValue(PORTAL_REF_PROPERTY.toLowerCase(), input.portalRef);
  master.updatePropertyWithValue("dtstamp", now);
  master.updatePropertyWithValue("last-modified", now);
  const sequence = master.getFirstPropertyValue("sequence");
  master.updatePropertyWithValue("sequence", (typeof sequence === "number" && Number.isFinite(sequence) ? sequence : 0) + 1);
  return normalizeIcsLines(calendar.toString());
}

// ── 반복 시리즈 합성(Google → VCALENDAR) ─────────────────────

/** 시리즈 VEVENT의 시간 값. dateTime은 timeZone(IANA)이 있으면 TZID+VTIMEZONE으로, 없으면 UTC로 쓴다. */
export type SeriesTime = { kind: "date"; date: string } | { kind: "dateTime"; instant: Date; timeZone?: string };

export type SeriesComponentInput = {
  uid: string;
  start: SeriesTime;
  end?: SeriesTime;
  /** master만: RRULE/EXRULE/RDATE/EXDATE content line 원문. 그 밖의 줄은 버린다. */
  recurrenceLines?: string[];
  /** 예외만: 원래 회차 시작. */
  recurrenceId?: SeriesTime;
  status?: "confirmed" | "cancelled";
  summary?: string;
  description?: string;
  dtstamp?: Date;
};

const RECURRENCE_LINE = /^(RRULE|EXRULE|RDATE|EXDATE)[;:]/iu;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function formatWall(date: Date, timeZone: string): string {
  const wall = wallTimeInZone(date, timeZone);
  return `${pad(wall.year, 4)}${pad(wall.month)}${pad(wall.day)}T${pad(wall.hour)}${pad(wall.minute)}${pad(wall.second)}`;
}

function offsetMinutes(date: Date, timeZone: string): number {
  const wall = wallTimeInZone(date, timeZone);
  return Math.round((Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(date.getTime() / 1_000) * 1_000) / 60_000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`;
}

const vtimezoneCache = new Map<string, string[]>();

/**
 * Intl 시간대 정보로 VTIMEZONE을 만든다(ical.js에는 tz database가 없다).
 * 고정 offset(예: Asia/Seoul)은 STANDARD 하나, DST 시간대는 [fromYear, toYear] 구간의 실제 전환을 개별 observance로 쓴다.
 */
export function buildVTimezoneLines(timeZone: string, fromYear: number, toYear: number): string[] {
  const key = `${timeZone}|${fromYear}|${toYear}`;
  const cached = vtimezoneCache.get(key);
  if (cached) return cached;
  const rangeStart = Date.UTC(fromYear, 0, 1);
  const rangeEnd = Date.UTC(toYear + 1, 0, 1);
  const week = 7 * 86_400_000;
  const initial = offsetMinutes(new Date(rangeStart), timeZone);
  const transitions: Array<{ at: number; from: number; to: number }> = [];
  let previousTime = rangeStart;
  let previousOffset = initial;
  for (let time = rangeStart + week; time <= rangeEnd; time += week) {
    const offset = offsetMinutes(new Date(time), timeZone);
    if (offset !== previousOffset) {
      let low = previousTime;
      let high = time;
      while (high - low > 60_000) {
        const middle = low + Math.floor((high - low) / 2 / 60_000) * 60_000;
        if (offsetMinutes(new Date(middle), timeZone) === previousOffset) low = middle;
        else high = middle;
      }
      transitions.push({ at: high, from: previousOffset, to: offset });
      previousOffset = offset;
    }
    previousTime = time;
  }
  const minimum = Math.min(initial, ...transitions.map((transition) => transition.to));
  const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`];
  const kindOf = (offset: number) => (offset > minimum ? "DAYLIGHT" : "STANDARD");
  lines.push(`BEGIN:${kindOf(initial)}`, "DTSTART:19700101T000000", `TZOFFSETFROM:${formatOffset(initial)}`, `TZOFFSETTO:${formatOffset(initial)}`, `END:${kindOf(initial)}`);
  for (const transition of transitions) {
    const kind = kindOf(transition.to);
    const localStart = formatIcsUtc(new Date(transition.at + transition.from * 60_000)).slice(0, 15);
    lines.push(`BEGIN:${kind}`, `DTSTART:${localStart}`, `TZOFFSETFROM:${formatOffset(transition.from)}`, `TZOFFSETTO:${formatOffset(transition.to)}`, `END:${kind}`);
  }
  lines.push("END:VTIMEZONE");
  vtimezoneCache.set(key, lines);
  return lines;
}

function seriesTimeLine(name: string, time: SeriesTime, timeZones: Set<string>): string {
  if (time.kind === "date") {
    if (!DATE_ONLY_PATTERN.test(time.date)) throw new CalendarProviderError("Series date is invalid");
    return `${name};VALUE=DATE:${time.date.replaceAll("-", "")}`;
  }
  if (!Number.isFinite(time.instant.getTime())) throw new CalendarProviderError("Series time is invalid");
  if (time.timeZone && time.timeZone !== "UTC" && time.timeZone !== "Etc/UTC" && /^[A-Za-z0-9_+\-/]+$/u.test(time.timeZone) && isValidTimeZone(time.timeZone)) {
    timeZones.add(time.timeZone);
    return `${name};TZID=${time.timeZone}:${formatWall(time.instant, time.timeZone)}`;
  }
  return `${name}:${formatIcsUtc(time.instant)}`;
}

/** 반복 시리즈 구성 요소(master 또는 RECURRENCE-ID 예외)를 독립 VCALENDAR로 만든다. 같은 UID끼리 합쳐 펼칠 수 있다. */
export function buildSeriesIcs(input: SeriesComponentInput, options: { now?: Date } = {}): string {
  const uid = assertUid(input.uid);
  const now = options.now ?? new Date();
  const timeZones = new Set<string>();
  const body = [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${formatIcsUtc(input.dtstamp && Number.isFinite(input.dtstamp.getTime()) ? input.dtstamp : now)}`,
  ];
  if (input.recurrenceId) body.push(seriesTimeLine("RECURRENCE-ID", input.recurrenceId, timeZones));
  body.push(seriesTimeLine("DTSTART", input.start, timeZones));
  if (input.end) body.push(seriesTimeLine("DTEND", input.end, timeZones));
  for (const raw of input.recurrenceLines ?? []) {
    const line = String(raw).trim();
    if (!RECURRENCE_LINE.test(line) || /[\u0000-\u001F\u007F]/u.test(line)) continue;
    const tzid = /;TZID=([^;:]+)/iu.exec(line)?.[1];
    if (tzid && isValidTimeZone(tzid)) timeZones.add(tzid);
    body.push(line);
  }
  if (input.status === "cancelled") body.push("STATUS:CANCELLED");
  body.push(`SUMMARY:${escapeIcsText(input.summary ?? "")}`);
  if (input.description) body.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  body.push("END:VEVENT");

  const years = [input.start, input.recurrenceId]
    .filter((time): time is SeriesTime => Boolean(time))
    .map((time) => (time.kind === "date" ? Number(time.date.slice(0, 4)) : time.instant.getUTCFullYear()));
  const fromYear = Math.min(...years) - 1;
  const toYear = Math.max(Math.max(...years), now.getUTCFullYear()) + 3;
  const zones = [...timeZones].sort().flatMap((zone) => buildVTimezoneLines(zone, Math.max(fromYear, toYear - 20), toYear));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${ICS_PRODID}`, "CALSCALE:GREGORIAN", ...zones, ...body, "END:VCALENDAR"];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
