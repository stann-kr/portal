import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import {
  assignments,
  assignmentTasks,
  calendarEvents,
  diggingColumns,
  diggingTracks,
  feedbacks,
  lessons,
  privateNotes,
  profiles,
  qnaThreads,
} from "@/db/schema";
import { normalizeUnifiedItems, type ProfileContext } from "@/lib/unified-item-normalization";
import {
  selectUnifiedItemsWithinQuery,
  type ResolvedUnifiedItemsQuery,
} from "@/lib/unified-items-query";
import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";

type CalendarEventRow = InferSelectModel<typeof calendarEvents>;
type LessonRow = InferSelectModel<typeof lessons>;
type NoteRow = {
  id: string;
  studentId: string;
  title: string;
  contentHtml: string;
  authorId: string;
  noteDate: Date | null;
  createdAt: Date;
};

/** 통합 일정은 노트 미리보기만 쓰므로 본문 앞부분만 읽는다. 전체 본문은 상세에서 따로 불러온다. */
export const UNIFIED_NOTE_PREVIEW_SOURCE_CHARS = 4_096;
/** 피드백 수 조회 한 번에 bind하는 제출 id 수(D1 bind 100개 제한 아래). */
export const FEEDBACK_COUNT_CHUNK = 90;
/** 여러 학생을 한 번에 읽을 때 statement 하나에 bind하는 학생 id 수(D1 bind 100개 제한 아래, 기간·상한 bind 여유 포함). */
export const STUDENT_ID_CHUNK = 90;
type DiggingTrackRow = InferSelectModel<typeof diggingTracks>;
type DiggingColumnRow = InferSelectModel<typeof diggingColumns>;
type QnaThreadRow = InferSelectModel<typeof qnaThreads>;
type AssignmentRow = {
  id: string;
  studentId: string;
  mediaUrl: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  taskTitle: string | null;
};
type AssignmentTaskRow = {
  id: string;
  studentId: string;
  title: string;
  dueAt: Date | null;
  createdAt: Date;
  submissionFormat: string;
};

function wants(types: ReadonlySet<UnifiedItemType>, type: UnifiedItemType): boolean {
  return types.has(type);
}

type SourceRows = {
  profiles: ProfileContext[];
  events: CalendarEventRow[];
  lessons: LessonRow[];
  notes: NoteRow[];
  tracks: DiggingTrackRow[];
  columns: DiggingColumnRow[];
  threads: QnaThreadRow[];
  assignments: AssignmentRow[];
  tasks: AssignmentTaskRow[];
  feedbackCounts: Record<string, number>;
  /** 어느 소스든 소스별 상한까지 찼으면 그 기간의 항목 일부가 빠졌을 수 있다. */
  sourceLimitReached: boolean;
};

/**
 * 한 statement에 학생 id를 최대 STUDENT_ID_CHUNK개 bind해 내부 소스 행을 읽는다.
 * 한 명이면 기존과 같은 `=` 조건, 여러 명이면 `IN (...)` 조건이다. 소스별 상한은 이 묶음 전체에 걸린다.
 */
async function querySourceRows(
  db: DrizzleDb,
  ownerIds: readonly string[],
  query: ResolvedUnifiedItemsQuery,
): Promise<SourceRows> {
  if (ownerIds.length === 0 || ownerIds.length > STUDENT_ID_CHUNK) {
    throw new RangeError(`학생 id는 한 번에 1~${STUDENT_ID_CHUNK}개까지 조회합니다.`);
  }
  const owner = (column: Parameters<typeof eq>[0]) => ownerIds.length === 1
    ? eq(column, ownerIds[0]!)
    : inArray(column, [...ownerIds]);
  const requestedTypes = new Set<UnifiedItemType>(query.types);
  const startEpoch = Math.floor(query.start.getTime() / 1_000);
  const endEpoch = Math.floor(query.end.getTime() / 1_000);
  const limit = query.perSourceLimit;

  const eventRows = wants(requestedTypes, "EVENT")
    ? db
        .select()
        .from(calendarEvents)
        .where(and(
          owner(calendarEvents.userId),
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
          owner(lessons.studentId),
          gte(lessons.scheduledAt, query.start),
          lte(lessons.scheduledAt, query.end),
        ))
        .orderBy(desc(lessons.scheduledAt))
        .limit(limit) as Promise<LessonRow[]>
    : Promise.resolve([] as LessonRow[]);
  const noteRows = wants(requestedTypes, "NOTE")
    ? db
        .select({
          id: privateNotes.id,
          studentId: privateNotes.studentId,
          title: privateNotes.title,
          contentHtml: sql<string>`substr(${privateNotes.contentHtml}, 1, ${UNIFIED_NOTE_PREVIEW_SOURCE_CHARS})`,
          authorId: privateNotes.authorId,
          noteDate: privateNotes.noteDate,
          createdAt: privateNotes.createdAt,
        })
        .from(privateNotes)
        .where(and(
          owner(privateNotes.studentId),
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
          owner(diggingTracks.userId),
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
        .where(owner(diggingColumns.userId)) as Promise<DiggingColumnRow[]>
    : Promise.resolve([] as DiggingColumnRow[]);
  const threadRows = wants(requestedTypes, "QNA")
    ? db
        .select()
        .from(qnaThreads)
        .where(and(
          owner(qnaThreads.studentId),
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
        .select({
          id: assignments.id,
          studentId: assignments.studentId,
          mediaUrl: assignments.mediaUrl,
          submittedAt: assignments.submittedAt,
          reviewedAt: assignments.reviewedAt,
          taskTitle: assignmentTasks.title,
        })
        .from(assignments)
        .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
        .where(and(
          owner(assignments.studentId),
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
  // 아직 제출하지 않은 관리자 과제는 마감 시각(마감이 없으면 낸 시각)에 놓는다. 회차 생성은 과제 화면 조회가 맡는다.
  const taskPlacement = sql`coalesce(${assignmentTasks.dueAt}, ${assignmentTasks.createdAt})`;
  const taskRows = wants(requestedTypes, "ASSIGNMENT")
    ? db
        .select({
          id: assignmentTasks.id,
          studentId: assignmentTasks.studentId,
          title: assignmentTasks.title,
          dueAt: assignmentTasks.dueAt,
          createdAt: assignmentTasks.createdAt,
          submissionFormat: assignmentTasks.submissionFormat,
          analysisForm: assignmentTasks.analysisForm,
        })
        .from(assignmentTasks)
        .where(and(
          owner(assignmentTasks.studentId),
          sql<boolean>`${taskPlacement} BETWEEN ${startEpoch} AND ${endEpoch}`,
          notExists(
            db.select({ id: assignments.id }).from(assignments).where(eq(assignments.taskId, assignmentTasks.id)),
          ),
        ))
        .orderBy(desc(taskPlacement))
        .limit(limit) as Promise<AssignmentTaskRow[]>
    : Promise.resolve([] as AssignmentTaskRow[]);

  const [profileRows, events, studentLessons, notes, tracks, columns, threads, myAssignments, openTasks] =
    await Promise.all([
      db
        .select({
          id: profiles.id,
          email: profiles.email,
          displayName: profiles.displayName,
        })
        .from(profiles)
        .where(owner(profiles.id))
        .limit(ownerIds.length),
      eventRows,
      lessonRows,
      noteRows,
      trackRows,
      columnRows,
      threadRows,
      assignmentRows,
      taskRows,
    ]);

  const assignmentIds = myAssignments.map((assignment) => assignment.id);
  // D1은 statement당 bind 100개까지라 제출 id를 나눠 센다(소스 상한 200개).
  const idChunks = chunkIds(assignmentIds, FEEDBACK_COUNT_CHUNK);
  const scopedFeedbacks = (await Promise.all(idChunks.map((ids) => db
    .select({
      assignmentId: feedbacks.assignmentId,
      count: sql<number>`count(*)`,
    })
    .from(feedbacks)
    .where(inArray(feedbacks.assignmentId, ids))
    .groupBy(feedbacks.assignmentId)))).flat();
  const feedbackCounts: Record<string, number> = {};
  for (const row of scopedFeedbacks) {
    feedbackCounts[row.assignmentId] = Number(row.count);
  }

  const sourceLimitReached = [events, studentLessons, notes, tracks, threads, myAssignments, openTasks]
    .some((rows) => rows.length >= limit);
  return {
    profiles: profileRows,
    events,
    lessons: studentLessons,
    notes,
    tracks,
    columns,
    threads,
    assignments: myAssignments,
    tasks: openTasks,
    feedbackCounts,
    sourceLimitReached,
  };
}

function chunkIds<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/** 한 학생의 행만 골라 정규화한다. 소유 열이 없는 소스(행 전체 select)는 각 테이블의 소유 열로 고른다. */
function normalizeOwnerRows(rows: SourceRows, profile: ProfileContext): UnifiedItem[] {
  const ownerId = profile.id;
  return normalizeUnifiedItems({
    profile,
    events: rows.events.filter((row) => row.userId === ownerId),
    lessons: rows.lessons.filter((row) => row.studentId === ownerId),
    notes: rows.notes.filter((row) => row.studentId === ownerId),
    tracks: rows.tracks.filter((row) => row.userId === ownerId),
    columns: rows.columns.filter((row) => row.userId === ownerId),
    threads: rows.threads.filter((row) => row.studentId === ownerId),
    assignments: rows.assignments.filter((row) => row.studentId === ownerId),
    feedbackCounts: rows.feedbackCounts,
    tasks: rows.tasks.filter((row) => row.studentId === ownerId),
  });
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
  const rows = await querySourceRows(db, [userId], query);
  const profile = rows.profiles[0];
  if (!profile) throw new Error("Student profile not found");
  return selectUnifiedItemsWithinQuery(normalizeOwnerRows(rows, profile), query);
}

export type MultiStudentUnifiedItems = {
  items: UnifiedItem[];
  /** 소스별 상한이나 전체 상한에 닿아 기간 안 항목 일부가 빠졌을 수 있다. */
  truncated: boolean;
};

/**
 * 여러 학생(관리자 일정 "전체 학생")의 내부 소스를 한 번에 읽는다. 호출자가 대상 학생 id를 서버에서 확정해 넘긴다.
 * 학생 id는 STUDENT_ID_CHUNK개씩 나눠 묶음마다 소스별 statement를 하나씩 보내고, 합친 뒤 기간·전체 상한을 적용한다.
 * profile이 없는 id(그 사이 삭제된 계정)의 행은 버린다.
 */
export async function queryInternalUnifiedItemsForStudents(
  db: DrizzleDb,
  studentIds: readonly string[],
  query: ResolvedUnifiedItemsQuery,
): Promise<MultiStudentUnifiedItems> {
  const ids = [...new Set(studentIds)];
  const merged: UnifiedItem[] = [];
  let sourceLimitReached = false;
  // 묶음은 차례로 보내 D1 동시 statement 수를 묶음 하나(소스 수)로 묶어 둔다.
  for (const chunk of chunkIds(ids, STUDENT_ID_CHUNK)) {
    const rows = await querySourceRows(db, chunk, query);
    sourceLimitReached ||= rows.sourceLimitReached;
    for (const profile of rows.profiles) merged.push(...normalizeOwnerRows(rows, profile));
  }
  const items = selectUnifiedItemsWithinQuery(merged, query);
  return { items, truncated: sourceLimitReached || merged.length > items.length };
}
