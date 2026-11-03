/**
 * 학생에게 연결한 바깥 캘린더의 가장 가까운 일정을 학생별로 찾는다. 연결된 일정은 모두 레슨으로 센다(2026-11-03 사용자 결정).
 * - 관리자 양방향 동기화: 매핑에 연결된 학생 일정(calendar_events)과 원격 반복 일정 사본(calendar_remote_series)
 * - 학생 공개 iCal 구독: 저장하지 않으므로 그때 읽는다(실패하면 건너뛴다)
 */
import { and, eq, gte, min, ne } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  calendarEvents,
  calendarMappings,
  calendarRemoteSeries,
  calendarSyncLinks,
  externalCalendarSubscriptions,
} from "@/db/schema";
import { DELETED_FINGERPRINT } from "@/lib/calendar-sync/engine";
import { loadRemoteSeriesItems } from "@/lib/calendar-sync/remote-series-items";
import type { UnifiedItemsQueryInput } from "@/lib/unified-items-query";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

/** 이보다 먼 일정은 "다음 레슨"으로 보지 않는다. */
export const CONNECTED_NEXT_LESSON_WINDOW_DAYS = 90;

export type FetchSubscribedItems = (studentId: string, input: UnifiedItemsQueryInput) => Promise<UnifiedItem[]>;

function keepEarliest(target: Map<string, Date>, studentId: string, date: Date | null | undefined): void {
  if (!date || !Number.isFinite(date.getTime())) return;
  const current = target.get(studentId);
  if (!current || date.getTime() < current.getTime()) target.set(studentId, date);
}

function earliestFrom(items: UnifiedItem[], referenceTime: Date): Date | null {
  let earliest: Date | null = null;
  for (const item of items) {
    const date = new Date(item.date);
    if (date.getTime() < referenceTime.getTime()) continue;
    if (!earliest || date.getTime() < earliest.getTime()) earliest = date;
  }
  return earliest;
}

export async function queryConnectedNextEvents(
  db: DrizzleDb,
  referenceTime: Date,
  fetchSubscribedItems: FetchSubscribedItems,
): Promise<Map<string, Date>> {
  const windowEnd = new Date(referenceTime.getTime() + CONNECTED_NEXT_LESSON_WINDOW_DAYS * 86_400_000);
  const [syncedRows, seriesStudentRows, subscriptionRows] = await Promise.all([
    db
      .select({ studentId: calendarMappings.studentId, startTime: min(calendarEvents.startTime) })
      .from(calendarSyncLinks)
      .innerJoin(calendarMappings, eq(calendarMappings.id, calendarSyncLinks.mappingId))
      .innerJoin(
        calendarEvents,
        and(eq(calendarEvents.id, calendarSyncLinks.localId), eq(calendarEvents.userId, calendarMappings.studentId)),
      )
      .where(and(
        eq(calendarSyncLinks.localKind, "EVENT"),
        ne(calendarSyncLinks.localFingerprint, DELETED_FINGERPRINT),
        gte(calendarEvents.startTime, referenceTime),
      ))
      .groupBy(calendarMappings.studentId),
    db
      .selectDistinct({ studentId: calendarMappings.studentId })
      .from(calendarRemoteSeries)
      .innerJoin(calendarMappings, eq(calendarMappings.id, calendarRemoteSeries.mappingId)),
    db.selectDistinct({ studentId: externalCalendarSubscriptions.studentId }).from(externalCalendarSubscriptions),
  ]);

  const earliest = new Map<string, Date>();
  for (const row of syncedRows) keepEarliest(earliest, row.studentId, row.startTime);

  const window = { start: referenceTime, end: windowEnd };
  const [seriesResults, subscribedResults] = await Promise.all([
    Promise.all(seriesStudentRows.map(async ({ studentId }) => {
      try {
        return { studentId, items: await loadRemoteSeriesItems(db, { studentId, spaceLabel: "", window }) };
      } catch {
        return { studentId, items: [] };
      }
    })),
    Promise.all(subscriptionRows.map(async ({ studentId }) => {
      try {
        const items = await fetchSubscribedItems(studentId, {
          start: referenceTime.toISOString(),
          end: windowEnd.toISOString(),
          types: ["EVENT"],
        });
        return { studentId, items };
      } catch {
        return { studentId, items: [] };
      }
    })),
  ]);
  for (const { studentId, items } of [...seriesResults, ...subscribedResults]) {
    keepEarliest(earliest, studentId, earliestFrom(items, referenceTime));
  }
  return earliest;
}
