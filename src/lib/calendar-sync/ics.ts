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
    recurring: isRecurringSet(master, events),
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
