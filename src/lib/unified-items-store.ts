import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  assignments,
  calendarEvents,
  diggingColumns,
  diggingTracks,
  feedbacks,
  lessons,
  privateNotes,
  profiles,
  qnaThreads,
} from "@/db/schema";
import { normalizeUnifiedItems } from "@/lib/unified-item-normalization";
import {
  selectUnifiedItemsWithinQuery,
  type ResolvedUnifiedItemsQuery,
} from "@/lib/unified-items-query";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";

type CalendarEventRow = InferSelectModel<typeof calendarEvents>;
type LessonRow = InferSelectModel<typeof lessons>;
type NoteRow = InferSelectModel<typeof privateNotes>;
type DiggingTrackRow = InferSelectModel<typeof diggingTracks>;
type DiggingColumnRow = InferSelectModel<typeof diggingColumns>;
type QnaThreadRow = InferSelectModel<typeof qnaThreads>;
type AssignmentRow = InferSelectModel<typeof assignments>;

function wants(types: ReadonlySet<UnifiedItemType>, type: UnifiedItemType): boolean {
  return types.has(type);
}

/**
 * 통합 일정의 내부 소스만 기간·타입·소스별 상한을 적용해 읽는다.
 * 외부 provider fetch는 초기 내부 렌더와 분리된 action에서 처리한다.
 */
export async function queryInternalUnifiedItems(
  db: DrizzleDb,
  userId: string,
  query: ResolvedUnifiedItemsQuery,
): Promise<UnifiedItem[]> {
  const requestedTypes = new Set<UnifiedItemType>(query.types);
  const startEpoch = Math.floor(query.start.getTime() / 1_000);
  const endEpoch = Math.floor(query.end.getTime() / 1_000);
  const limit = query.perSourceLimit;

  const eventRows = wants(requestedTypes, "EVENT")
    ? db
        .select()
        .from(calendarEvents)
        .where(and(
          eq(calendarEvents.userId, userId),
          gte(calendarEvents.startTime, query.start),
          lte(calendarEvents.startTime, query.end),
        ))
        .orderBy(desc(calendarEvents.startTime))
        .limit(limit) as Promise<CalendarEventRow[]>
    : Promise.resolve([] as CalendarEventRow[]);
  const lessonRows = wants(requestedTypes, "EVENT")
    ? db
        .select()
        .from(lessons)
        .where(and(
          eq(lessons.studentId, userId),
          gte(lessons.scheduledAt, query.start),
          lte(lessons.scheduledAt, query.end),
        ))
        .orderBy(desc(lessons.scheduledAt))
        .limit(limit) as Promise<LessonRow[]>
    : Promise.resolve([] as LessonRow[]);
  const noteRows = wants(requestedTypes, "NOTE")
    ? db
        .select()
        .from(privateNotes)
        .where(and(
          eq(privateNotes.studentId, userId),
          isNull(privateNotes.deletedAt),
          sql<boolean>`coalesce(${privateNotes.noteDate}, ${privateNotes.createdAt}) BETWEEN ${startEpoch} AND ${endEpoch}`,
        ))
        .orderBy(desc(sql`coalesce(${privateNotes.noteDate}, ${privateNotes.createdAt})`))
        .limit(limit) as Promise<NoteRow[]>
    : Promise.resolve([] as NoteRow[]);
  const trackRows = wants(requestedTypes, "DIGGING")
    ? db
        .select()
        .from(diggingTracks)
        .where(and(
          eq(diggingTracks.userId, userId),
          or(
            isNull(diggingTracks.createdAt),
            and(
              gte(diggingTracks.createdAt, query.start),
              lte(diggingTracks.createdAt, query.end),
            ),
          ),
        ))
        .orderBy(desc(diggingTracks.createdAt))
        .limit(limit) as Promise<DiggingTrackRow[]>
    : Promise.resolve([] as DiggingTrackRow[]);
  const columnRows = wants(requestedTypes, "DIGGING")
    ? db
        .select()
        .from(diggingColumns)
        .where(eq(diggingColumns.userId, userId)) as Promise<DiggingColumnRow[]>
    : Promise.resolve([] as DiggingColumnRow[]);
  const threadRows = wants(requestedTypes, "QNA")
    ? db
        .select()
        .from(qnaThreads)
        .where(and(
          eq(qnaThreads.studentId, userId),
          isNull(qnaThreads.deletedAt),
          or(
            isNull(qnaThreads.createdAt),
            and(
              gte(qnaThreads.createdAt, query.start),
              lte(qnaThreads.createdAt, query.end),
            ),
          ),
        ))
        .orderBy(desc(qnaThreads.createdAt))
        .limit(limit) as Promise<QnaThreadRow[]>
    : Promise.resolve([] as QnaThreadRow[]);
  const assignmentRows = wants(requestedTypes, "ASSIGNMENT")
    ? db
        .select()
        .from(assignments)
        .where(and(
          eq(assignments.studentId, userId),
          or(
            isNull(assignments.submittedAt),
            and(
              gte(assignments.submittedAt, query.start),
              lte(assignments.submittedAt, query.end),
            ),
          ),
        ))
        .orderBy(desc(assignments.submittedAt))
        .limit(limit) as Promise<AssignmentRow[]>
    : Promise.resolve([] as AssignmentRow[]);

  const [profileRows, events, studentLessons, notes, tracks, columns, threads, myAssignments] =
    await Promise.all([
      db
        .select({
          id: profiles.id,
          email: profiles.email,
          displayName: profiles.displayName,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1),
      eventRows,
      lessonRows,
      noteRows,
      trackRows,
      columnRows,
      threadRows,
      assignmentRows,
    ]);

  const profile = profileRows[0];
  if (!profile) throw new Error("Student profile not found");

  const assignmentIds = myAssignments.map((assignment) => assignment.id);
  const scopedFeedbacks = assignmentIds.length
    ? await db
        .select({
          assignmentId: feedbacks.assignmentId,
          count: sql<number>`count(*)`,
        })
        .from(feedbacks)
        .where(inArray(feedbacks.assignmentId, assignmentIds))
        .groupBy(feedbacks.assignmentId)
    : [];
  const feedbackCounts: Record<string, number> = {};
  for (const row of scopedFeedbacks) {
    feedbackCounts[row.assignmentId] = Number(row.count);
  }

  return selectUnifiedItemsWithinQuery(normalizeUnifiedItems({
    profile,
    events,
    lessons: studentLessons,
    notes,
    tracks,
    columns,
    threads,
    assignments: myAssignments,
    feedbackCounts,
  }), query);
}
