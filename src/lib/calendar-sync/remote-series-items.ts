/**
 * calendar_remote_series(원격 반복 일정 사본)를 읽기 전용 UnifiedItem으로 펼친다.
 * 같은 series_key의 VEVENT(master·예외)를 한 VCALENDAR로 합쳐 parseExternalCalendarItems에 넘긴다.
 */
import ICAL from "ical.js";
import { asc, eq } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { calendarConnections, calendarMappings, calendarRemoteSeries } from "@/db/schema";
import { parseExternalCalendarItems } from "@/lib/external-calendar";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

/** 같은 series의 VCALENDAR 조각들을 VEVENT·VTIMEZONE만 모아 하나로 합친다(TZID 중복 제거). */
export function mergeSeriesIcs(parts: string[]): string {
  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", "-//Stann Lumo Portal//Calendar Sync//KO");
  const timezones = new Set<string>();
  for (const part of parts) {
    const component = new ICAL.Component(ICAL.parse(part));
    for (const timezone of component.getAllSubcomponents("vtimezone")) {
      const tzid = String(timezone.getFirstPropertyValue("tzid") ?? "");
      if (!tzid || timezones.has(tzid)) continue;
      timezones.add(tzid);
      calendar.addSubcomponent(timezone);
    }
    for (const event of component.getAllSubcomponents("vevent")) calendar.addSubcomponent(event);
  }
  return calendar.toString();
}

/** 학생 매핑의 원격 반복 일정을 window 안 회차로 펼친다. 망가진 사본 하나는 건너뛴다. */
export async function loadRemoteSeriesItems(
  db: DrizzleDb,
  input: { studentId: string; spaceLabel: string; window: { start: Date; end: Date } },
): Promise<UnifiedItem[]> {
  const rows = await db
    .select({
      mappingId: calendarRemoteSeries.mappingId,
      seriesKey: calendarRemoteSeries.seriesKey,
      icsText: calendarRemoteSeries.icsText,
      provider: calendarConnections.provider,
    })
    .from(calendarRemoteSeries)
    .innerJoin(calendarMappings, eq(calendarMappings.id, calendarRemoteSeries.mappingId))
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
    .where(eq(calendarMappings.studentId, input.studentId))
    .orderBy(asc(calendarRemoteSeries.mappingId), asc(calendarRemoteSeries.seriesKey));
  const groups = new Map<string, { mappingId: string; provider: (typeof rows)[number]["provider"]; parts: string[] }>();
  for (const row of rows) {
    const key = `${row.mappingId}\u0000${row.seriesKey}`;
    const group = groups.get(key) ?? { mappingId: row.mappingId, provider: row.provider, parts: [] };
    group.parts.push(row.icsText);
    groups.set(key, group);
  }
  const items: UnifiedItem[] = [];
  for (const group of groups.values()) {
    try {
      items.push(...await parseExternalCalendarItems({
        ics: mergeSeriesIcs(group.parts),
        subscriptionId: `sync-${group.mappingId}`,
        studentId: input.studentId,
        provider: group.provider,
        spaceLabel: input.spaceLabel,
        window: input.window,
      }));
    } catch {
      // 원격 사본 하나가 망가져도 다른 일정 표시는 막지 않는다.
    }
  }
  return items.sort((left, right) => left.date.getTime() - right.date.getTime());
}
