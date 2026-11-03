/**
 * 학생에게 연결한 바깥 캘린더의 가장 가까운 일정을 학생별로 찾는다. 연결된 일정은 모두 레슨으로 센다(2026-11-03 사용자 결정).
 * - 관리자 양방향 동기화: 매핑에 연결된 학생 일정(calendar_events)과 원격 반복 일정 사본(calendar_remote_series)
 * - 학생 공개 iCal 구독: 저장하지 않으므로 그때 읽는다(실패하면 건너뛴다)
 */
import { and, asc, eq, gte, lt, min, ne } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  calendarConnections,
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

/** 학생 상세 레슨 일정에 함께 보이는 연결된 캘린더 일정(읽기 전용). */
export type ConnectedLesson = { id: string; title: string; scheduledAt: Date; sourceLabel: string };

const PROVIDER_LABEL = { GOOGLE: "Google Calendar", ICLOUD: "iCloud Calendar" } as const;

/** 한 학생의 연결된 캘린더에서 앞으로 90일 일정을 가까운 순서로 모은다. */
export async function queryConnectedLessonsForStudent(
  db: DrizzleDb,
  studentId: string,
  referenceTime: Date,
  fetchSubscribedItems: FetchSubscribedItems,
): Promise<ConnectedLesson[]> {
  const windowEnd = new Date(referenceTime.getTime() + CONNECTED_NEXT_LESSON_WINDOW_DAYS * 86_400_000);
  const [syncedRows, subscriptionRows] = await Promise.all([
    db
      .select({
        id: calendarEvents.id,
        title: calendarEvents.title,
        startTime: calendarEvents.startTime,
        provider: calendarConnections.provider,
      })
      .from(calendarSyncLinks)
      .innerJoin(calendarMappings, eq(calendarMappings.id, calendarSyncLinks.mappingId))
      .innerJoin(calendarConnections, eq(calendarConnections.id, calendarMappings.connectionId))
      .innerJoin(
        calendarEvents,
        and(eq(calendarEvents.id, calendarSyncLinks.localId), eq(calendarEvents.userId, calendarMappings.studentId)),
      )
      .where(and(
        eq(calendarMappings.studentId, studentId),
        eq(calendarSyncLinks.localKind, "EVENT"),
        ne(calendarSyncLinks.localFingerprint, DELETED_FINGERPRINT),
        gte(calendarEvents.startTime, referenceTime),
        lt(calendarEvents.startTime, windowEnd),
      ))
      .orderBy(asc(calendarEvents.startTime)),
    db
      .select({ id: externalCalendarSubscriptions.id })
      .from(externalCalendarSubscriptions)
      .where(eq(externalCalendarSubscriptions.studentId, studentId))
      .limit(1),
  ]);
  const window = { start: referenceTime, end: windowEnd };
  const [seriesItems, subscribedItems] = await Promise.all([
    loadRemoteSeriesItems(db, { studentId, spaceLabel: "", window }).catch(() => []),
    subscriptionRows.length > 0
      ? fetchSubscribedItems(studentId, {
          start: referenceTime.toISOString(),
          end: windowEnd.toISOString(),
          types: ["EVENT"],
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const seen = new Set<string>();
  const lessons: ConnectedLesson[] = [];
  const add = (lesson: ConnectedLesson) => {
    if (!Number.isFinite(lesson.scheduledAt.getTime()) || lesson.scheduledAt.getTime() < referenceTime.getTime()) return;
    if (lesson.scheduledAt.getTime() >= windowEnd.getTime() || seen.has(lesson.id)) return;
    seen.add(lesson.id);
    lessons.push(lesson);
  };
  for (const row of syncedRows) {
    add({ id: `event:${row.id}`, title: row.title, scheduledAt: row.startTime, sourceLabel: PROVIDER_LABEL[row.provider] });
  }
  for (const item of [...seriesItems, ...subscribedItems]) {
    add({ id: `${item.source.kind}:${item.id}`, title: item.title, scheduledAt: new Date(item.date), sourceLabel: item.source.label });
  }
  return lessons.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
