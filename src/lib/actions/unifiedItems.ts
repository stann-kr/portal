/**
 * @file src/lib/actions/unifiedItems.ts
 * @description 캘린더 통합 데이터베이스 집계 서버 액션.
 * calendarEvents / privateNotes / diggingTracks / qnaThreads / assignments
 * 5개 테이블을 병렬 조회하여 UnifiedItem[] 으로 정규화.
 */
"use server";

import { createDb } from "@/db/client";
import {
  calendarEvents,
  privateNotes,
  diggingTracks,
  diggingColumns,
  qnaThreads,
  assignments,
  feedbacks,
  lessons,
  profiles,
  externalCalendarSubscriptions,
} from "@/db/schema";
import { and, eq, desc, inArray, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { requireAuth, requireStudentTarget } from "@/lib/auth-guard";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { normalizeUnifiedItems } from "@/lib/unified-item-normalization";
import { decryptExternalCalendarUrl, fetchExternalCalendarIcs, parseExternalCalendarItems } from "@/lib/external-calendar";
import { getExternalCalendarEncryptionKey } from "@/lib/external-calendar-key";

// ─── 공통 조회 헬퍼 ──────────────────────────────

async function fetchUnifiedItemsForUser(userId: string): Promise<UnifiedItem[]> {
  const db = createDb();

  // 학생 profile + 날짜 기반 테이블 + 디깅 컬럼 병렬 조회
  const [
    profileRows,
    subscriptionRows,
    events,
    studentLessons,
    notes,
    tracks,
    columns,
    threads,
    myAssignments,
  ] = await Promise.all([
    db
      .select({
        id: profiles.id,
        email: profiles.email,
        displayName: profiles.displayName,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1),
    db.select().from(externalCalendarSubscriptions).where(eq(externalCalendarSubscriptions.studentId, userId)).limit(1),
    db.select().from(calendarEvents).where(eq(calendarEvents.userId, userId)).orderBy(desc(calendarEvents.startTime)) as Promise<InferSelectModel<typeof calendarEvents>[]>,
    db.select().from(lessons).where(eq(lessons.studentId, userId)).orderBy(desc(lessons.scheduledAt)) as Promise<InferSelectModel<typeof lessons>[]>,
    db
      .select()
      .from(privateNotes)
      .where(
        and(
          eq(privateNotes.studentId, userId),
          isNull(privateNotes.deletedAt),
        ),
      )
      .orderBy(desc(privateNotes.createdAt)) as Promise<InferSelectModel<typeof privateNotes>[]>,
    db.select().from(diggingTracks).where(eq(diggingTracks.userId, userId)).orderBy(desc(diggingTracks.createdAt)) as Promise<InferSelectModel<typeof diggingTracks>[]>,
    db.select().from(diggingColumns).where(eq(diggingColumns.userId, userId)) as Promise<InferSelectModel<typeof diggingColumns>[]>,
    db
      .select()
      .from(qnaThreads)
      .where(
        and(
          eq(qnaThreads.studentId, userId),
          isNull(qnaThreads.deletedAt),
        ),
      )
      .orderBy(desc(qnaThreads.createdAt)) as Promise<InferSelectModel<typeof qnaThreads>[]>,
    db.select().from(assignments).where(eq(assignments.studentId, userId)).orderBy(desc(assignments.submittedAt)) as Promise<InferSelectModel<typeof assignments>[]>,
  ]);

  const profile = profileRows[0];
  if (!profile) throw new Error("Student profile not found");

  const assignmentIds = myAssignments.map((assignment) => assignment.id);
  const scopedFeedbacks = assignmentIds.length
    ? await db
        .select({ assignmentId: feedbacks.assignmentId })
        .from(feedbacks)
        .where(inArray(feedbacks.assignmentId, assignmentIds))
    : [];

  // 과제별 피드백 카운트 맵
  const feedbackCountMap: Record<string, number> = {};
  for (const f of scopedFeedbacks) {
    feedbackCountMap[f.assignmentId] = (feedbackCountMap[f.assignmentId] ?? 0) + 1;
  }

  const internalItems = normalizeUnifiedItems({
    profile,
    events,
    lessons: studentLessons,
    notes,
    tracks,
    columns,
    threads,
    assignments: myAssignments,
    feedbackCounts: feedbackCountMap,
  });
  const subscription = subscriptionRows[0];
  if (!subscription) return internalItems;

  // 외부 공개 feed의 오류는 내부 일정 렌더를 막지 않는다.
  try {
    const url = await decryptExternalCalendarUrl({
      encryptedUrl: subscription.encryptedUrl,
      urlIv: subscription.urlIv,
      studentId: profile.id,
      provider: subscription.provider,
      key: getExternalCalendarEncryptionKey(),
    });
    const ics = await fetchExternalCalendarIcs(url);
    const externalItems = await parseExternalCalendarItems({
      ics,
      subscriptionId: subscription.id,
      studentId: profile.id,
      provider: subscription.provider,
      spaceLabel: profile.displayName?.trim() || profile.email,
    });
    return [...internalItems, ...externalItems].sort((a, b) => b.date.getTime() - a.date.getTime());
  } catch {
    return internalItems;
  }
}

// ─── 집계 서버 액션 ───────────────────────────────

/**
 * 학생 본인의 모든 날짜 기반 엔트리를 단일 UnifiedItem[] 로 반환.
 */
export async function getUnifiedItems(): Promise<UnifiedItem[]> {
  const session = await requireAuth();
  return fetchUnifiedItemsForUser(session.user.id!);
}

/**
 * 특정 학생의 모든 날짜 기반 엔트리를 단일 UnifiedItem[] 로 반환 (어드민 전용).
 * @param studentId 조회 대상 학생 ID
 */
export async function getUnifiedItemsForStudent(studentId: string): Promise<UnifiedItem[]> {
  await requireStudentTarget(studentId);
  return fetchUnifiedItemsForUser(studentId);
}
