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
} from "@/db/schema";
import type { CalendarEventType, QnaStatus } from "@/db/schema";
import { and, eq, desc, inArray, isNull } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { requireAuth } from "@/lib/auth-guard";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

// ─── 공통 조회 헬퍼 ──────────────────────────────

async function fetchUnifiedItemsForUser(userId: string): Promise<UnifiedItem[]> {
  const db = createDb();

  // 5개 테이블 + 디깅 컬럼 병렬 조회
  const [
    events,
    notes,
    tracks,
    columns,
    threads,
    myAssignments,
  ] = await Promise.all([
    db.select().from(calendarEvents).where(eq(calendarEvents.userId, userId)).orderBy(desc(calendarEvents.startTime)) as Promise<InferSelectModel<typeof calendarEvents>[]>,
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
    db.select().from(qnaThreads).where(eq(qnaThreads.studentId, userId)).orderBy(desc(qnaThreads.createdAt)) as Promise<InferSelectModel<typeof qnaThreads>[]>,
    db.select().from(assignments).where(eq(assignments.studentId, userId)).orderBy(desc(assignments.submittedAt)) as Promise<InferSelectModel<typeof assignments>[]>,
  ]);

  const assignmentIds = myAssignments.map((assignment) => assignment.id);
  const scopedFeedbacks = assignmentIds.length
    ? await db
        .select({ assignmentId: feedbacks.assignmentId })
        .from(feedbacks)
        .where(inArray(feedbacks.assignmentId, assignmentIds))
    : [];

  // 디깅 track name 컬럼 ID 탐색
  const trackNameColId = columns.find(
    (c) => c.name.toLowerCase() === "track name",
  )?.id;
  const artistColId = columns.find(
    (c) => c.name.toLowerCase() === "artist",
  )?.id;

  // 과제별 피드백 카운트 맵
  const feedbackCountMap: Record<string, number> = {};
  for (const f of scopedFeedbacks) {
    feedbackCountMap[f.assignmentId] = (feedbackCountMap[f.assignmentId] ?? 0) + 1;
  }

  const items: UnifiedItem[] = [];

  // ── EVENT ────────────────────────────────────────
  for (const e of events) {
    items.push({
      id: e.id,
      type: "EVENT",
      subType: e.eventType as CalendarEventType,
      title: e.title,
      description: e.description ?? undefined,
      date: new Date(e.startTime!),
      endDate: e.endTime ? new Date(e.endTime) : null,
      metadata: { eventType: e.eventType, description: e.description },
    });
  }

  // ── NOTE ─────────────────────────────────────────
  for (const n of notes) {
    items.push({
      id: n.id,
      type: "NOTE",
      title: n.title,
      date: new Date(n.noteDate ?? n.createdAt ?? Date.now()),
      metadata: { contentHtml: n.contentHtml, authorId: n.authorId, noteDate: n.noteDate },
    });
  }

  // ── DIGGING ──────────────────────────────────────
  for (const t of tracks) {
    let values: Record<string, unknown> = {};
    try {
      values = JSON.parse(t.values ?? "{}") as Record<string, unknown>;
    } catch { /* 손상된 JSON 무시 */ }

    // track name 컬럼 값 → 없으면 linkUrl → 없으면 기본 텍스트
    const trackName = trackNameColId
      ? (values[trackNameColId] as string | undefined)
      : undefined;
    const artistName = artistColId
      ? (values[artistColId] as string | undefined)
      : undefined;

    const title =
      trackName && artistName
        ? `${trackName} — ${artistName}`
        : trackName ?? t.linkUrl ?? "디깅 트랙";

    items.push({
      id: t.id,
      type: "DIGGING",
      title,
      date: new Date(t.createdAt ?? Date.now()),
      metadata: { values, linkUrl: t.linkUrl, columnIds: { trackName: trackNameColId, artist: artistColId } },
    });
  }

  // ── QNA ──────────────────────────────────────────
  for (const q of threads) {
    items.push({
      id: q.id,
      type: "QNA",
      subType: q.status as QnaStatus,
      title: q.title,
      date: new Date(q.createdAt ?? Date.now()),
      metadata: { status: q.status },
    });
  }

  // ── ASSIGNMENT ───────────────────────────────────
  for (const a of myAssignments) {
    const feedbackCount = feedbackCountMap[a.id] ?? 0;
    items.push({
      id: a.id,
      type: "ASSIGNMENT",
      title: a.mediaUrl,
      date: new Date(a.submittedAt ?? Date.now()),
      metadata: { mediaUrl: a.mediaUrl, feedbackCount },
    });
  }

  // date desc 정렬
  items.sort((a, b) => b.date.getTime() - a.date.getTime());

  return items;
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
  const session = await requireAuth();
  if (session.user.role !== "admin") throw new Error("Admin only");
  return fetchUnifiedItemsForUser(studentId);
}
