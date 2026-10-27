/**
 * @file src/lib/actions/feedbacks.ts
 * @description 과제 피드백 서버 액션. 재생 시점(타임스탬프) 피드백과 시점 없는 전체 피드백.
 * Admin: 피드백 작성/삭제.
 * 공통: 과제별 피드백 목록 조회.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { feedbacks, assignments } from "@/db/schema";
import { and, eq, asc, inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { CREATION_OPERATION_FIELD, deriveCreationResourceId, resolveCreationOperationId } from "@/lib/creation-operation";
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
 * @param formData - { timeMarker(분:초·정수 초, 비우면 전체 피드백), content, operationId (UUID v4) }
 */
export async function createFeedback(
  assignmentId: string,
  _prev: CreateFeedbackState,
  formData: FormData,
): Promise<CreateFeedbackState> {
  const session = await requireAdmin();

  const rawTimeMarker = formData.get("timeMarker");
  const timeMarkerStr = typeof rawTimeMarker === "string" ? rawTimeMarker.trim() : "";
  const rawContent = formData.get("content");
  const content = typeof rawContent === "string" ? rawContent.trim() : "";

  if (!content) return { error: "피드백 내용을 입력해주세요." };

  // 재생 시점을 비우면 과제 전체(글 제출 포함)에 대한 피드백이다.
  const minutesAndSeconds = /^(\d+):([0-5]\d)$/.exec(timeMarkerStr);
  const timeMarker: number | null = !timeMarkerStr
    ? null
    : minutesAndSeconds
      ? Number(minutesAndSeconds[1]) * 60 + Number(minutesAndSeconds[2])
      : /^\d+$/.test(timeMarkerStr) ? Number(timeMarkerStr) : NaN;
  if (timeMarker !== null && (!Number.isSafeInteger(timeMarker) || timeMarker < 0)) {
    return { error: "재생 시점은 01:30 같은 분:초 형식이나 0 이상의 정수 초로 입력해 주세요. 초는 00~59입니다." };
  }
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) return { error: "작성 정보를 확인하지 못했습니다. 입력 내용을 보관한 뒤 새로고침해 주세요." };
  const feedbackId = deriveCreationResourceId(operationId, JSON.stringify(["assignment-feedback", session.user.id, assignmentId]));

  const db = createDb();
  try {
    const [assignment] = await db.select({ id: assignments.id, mediaUrl: assignments.mediaUrl })
      .from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
    if (!assignment) return { error: "과제를 찾을 수 없습니다. 목록에서 다시 확인해 주세요." };
    if (timeMarker !== null && !assignment.mediaUrl) {
      return { error: "글 제출에는 재생 시점 없이 전체 피드백으로 남겨 주세요." };
    }
    const inserted = await db.insert(feedbacks).values({
      id: feedbackId,
      assignmentId,
      timeMarker,
      content,
    }).onConflictDoNothing({ target: feedbacks.id }).returning({ id: feedbacks.id });
    if (inserted.length === 0) {
      const [existing] = await db.select().from(feedbacks).where(eq(feedbacks.id, feedbackId)).limit(1);
      if (!existing || existing.assignmentId !== assignmentId || existing.timeMarker !== timeMarker || existing.content !== content) {
        return { error: "이 피드백은 수정 전 내용으로 이미 저장되었거나 상태가 바뀌었습니다. 목록을 확인한 뒤 내용을 편집해 새 피드백으로 등록해 주세요." };
      }
    }
  } catch {
    return { error: "피드백을 저장하지 못했습니다. 다시 시도해 주세요." };
  }

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
  await db.delete(feedbacks).where(and(
    eq(feedbacks.id, feedbackId),
    eq(feedbacks.assignmentId, assignmentId),
  ));
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
