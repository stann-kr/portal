/**
 * @file src/lib/actions/feedbacks.ts
 * @description 타임스탬프 피드백 관련 서버 액션.
 * Admin: 피드백 작성/삭제.
 * 공통: 과제별 피드백 목록 조회.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { feedbacks, assignments } from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import {
  assertOwnerOrAdmin,
  requireAdmin,
  requireAuth,
} from "@/lib/auth-guard";

// ───────────────────────────────────────────────
// 조회
// ───────────────────────────────────────────────

/**
 * 과제별 피드백 목록 조회 (타임스탬프 오름차순).
 */
export async function getFeedbacksByAssignment(assignmentId: string) {
  const session = await requireAuth();
  const db = createDb();

  const [assignment] = await db
    .select({ studentId: assignments.studentId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  if (!assignment) return [];
  assertOwnerOrAdmin(session, assignment.studentId);

  return db
    .select()
    .from(feedbacks)
    .where(eq(feedbacks.assignmentId, assignmentId))
    .orderBy(asc(feedbacks.timeMarker));
}

// ───────────────────────────────────────────────
// Admin: 피드백 작성
// ───────────────────────────────────────────────

export type CreateFeedbackState = { error?: string; success?: boolean };

/**
 * 타임스탬프 피드백 작성 (Admin 전용).
 * @param assignmentId - 대상 과제 ID
 * @param _prev - useActionState 이전 상태
 * @param formData - { timeMarker(초 단위), content }
 */
export async function createFeedback(
  assignmentId: string,
  _prev: CreateFeedbackState,
  formData: FormData,
): Promise<CreateFeedbackState> {
  await requireAdmin();

  const timeMarkerStr = (formData.get("timeMarker") as string) ?? "";
  const content = (formData.get("content") as string)?.trim();

  if (!content) return { error: "피드백 내용을 입력해주세요." };

  // "MM:SS" 또는 "초" 입력 처리
  let timeMarker: number;
  if (timeMarkerStr.includes(":")) {
    const [m, s] = timeMarkerStr.split(":").map(Number);
    timeMarker = (m || 0) * 60 + (s || 0);
  } else {
    timeMarker = Number(timeMarkerStr) || 0;
  }

  const db = createDb();
  await db.insert(feedbacks).values({
    id: crypto.randomUUID(),
    assignmentId,
    timeMarker,
    content,
  });

  revalidatePath(`/dashboard/student/assignments/${assignmentId}`);
  return { success: true };
}

// ───────────────────────────────────────────────
// Admin: 피드백 삭제
// ───────────────────────────────────────────────

/**
 * 피드백 삭제 (Admin 전용).
 */
export async function deleteFeedback(feedbackId: string, assignmentId: string) {
  await requireAdmin();
  const db = createDb();
  await db.delete(feedbacks).where(eq(feedbacks.id, feedbackId));
  revalidatePath(`/dashboard/student/assignments/${assignmentId}`);
}

// ───────────────────────────────────────────────
// 학생 본인 과제별 피드백 카운트 맵
// ───────────────────────────────────────────────

/**
 * 현재 로그인 학생의 과제 ID → 피드백 수 맵 반환.
 * StudentPortalPage에서 assignment 목록과 병합하여 사용.
 */
export async function getMyFeedbacksMap(): Promise<Record<string, number>> {
  const session = await requireAuth();
  const db = createDb();

  const myAssignments: Pick<InferSelectModel<typeof assignments>, "id">[] =
    await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(eq(assignments.studentId, session.user.id!));

  if (!myAssignments.length) return {};

  const ids = myAssignments.map((a) => a.id);
  const rows: Pick<InferSelectModel<typeof feedbacks>, "assignmentId">[] =
    await db
      .select({ assignmentId: feedbacks.assignmentId })
      .from(feedbacks)
      .where(inArray(feedbacks.assignmentId, ids));

  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.assignmentId] = (map[row.assignmentId] ?? 0) + 1;
  }
  return map;
}

// ───────────────────────────────────────────────
// (종료)
// ───────────────────────────────────────────────
