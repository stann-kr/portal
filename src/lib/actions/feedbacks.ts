/**
 * @file src/lib/actions/feedbacks.ts
 * @description 과제 피드백 서버 액션. 재생 시점(타임스탬프) 피드백과 시점 없는 전체 피드백.
 * Admin: 피드백 작성/고치기/삭제.
 * 공통: 과제별 피드백 목록 조회.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { feedbacks, assignments, assignmentTasks } from "@/db/schema";
import { and, eq, asc, count, isNull } from "drizzle-orm";
import { CREATION_OPERATION_FIELD, deriveCreationResourceId, resolveCreationOperationId } from "@/lib/creation-operation";
import {
  assertOwnerOrAdmin,
  requireAdmin,
  requireAuth,
} from "@/lib/auth-guard";
import { pushMessages } from "@/lib/push/messages";
import { notifyPush } from "@/lib/push/notify";

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

const TIME_MARKER_ERROR = "재생 시점은 01:30 같은 분:초 형식이나 0 이상의 정수 초로 입력해 주세요. 초는 00~59입니다.";

/** 시점 글자(분:초·정수 초)를 초로 읽는다. 비우면 전체 피드백(null), 형식이 틀리면 NaN. */
function parseFeedbackTimeMarker(value: string): number | null {
  // 재생 시점을 비우면 과제 전체(글 제출 포함)에 대한 피드백이다.
  if (!value) return null;
  const minutesAndSeconds = /^(\d+):([0-5]\d)$/.exec(value);
  const seconds = minutesAndSeconds
    ? Number(minutesAndSeconds[1]) * 60 + Number(minutesAndSeconds[2])
    : /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : NaN;
}

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

  const timeMarker = parseFeedbackTimeMarker(timeMarkerStr);
  if (Number.isNaN(timeMarker)) return { error: TIME_MARKER_ERROR };
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) return { error: "작성 정보를 확인하지 못했습니다. 입력 내용을 보관한 뒤 새로고침해 주세요." };
  const feedbackId = deriveCreationResourceId(operationId, JSON.stringify(["assignment-feedback", session.user.id, assignmentId]));

  const db = createDb();
  try {
    const [assignment] = await db.select({
      id: assignments.id,
      mediaUrl: assignments.mediaUrl,
      studentId: assignments.studentId,
      title: assignmentTasks.title,
    })
      .from(assignments)
      .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
      .where(eq(assignments.id, assignmentId)).limit(1);
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
    } else {
      await notifyPush(
        { kind: "profiles", profileIds: [assignment.studentId] },
        pushMessages.feedbackAdded({ assignmentId, title: assignment.title }),
        { excludeProfileId: session.user.id },
      );
    }
  } catch {
    return { error: "피드백을 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  revalidatePath(`/dashboard/student/assignments/${assignmentId}`);
  return { success: true };
}

// ───────────────────────────────────────────────
// Admin: 피드백 고치기
// ───────────────────────────────────────────────

export type UpdateFeedbackResult = { success: true } | { success: false; error: string };

/**
 * 남긴 피드백의 내용·시점을 고친다 (Admin 전용, UsabilityBundle ⑫).
 * feedbacks에는 version·updated_at 열이 없어, 화면이 읽은 값(expected)과 지금 값이 같을 때만 바꾸는
 * compare-and-set으로 다른 탭·기기에서 먼저 고친 내용을 덮어쓰지 않는다.
 * @param next - { content, timeMarker(분:초·정수 초, 비우면 전체 피드백) }
 * @param expected - 고치기 시작할 때 화면에 보이던 { content, timeMarker }
 */
export async function updateFeedback(
  feedbackId: string,
  next: { content: string; timeMarker: string },
  expected: { content: string; timeMarker: number | null },
): Promise<UpdateFeedbackResult> {
  await requireAdmin();
  if (typeof feedbackId !== "string" || !feedbackId) return { success: false, error: FEEDBACK_NOT_FOUND_ERROR };
  const content = typeof next?.content === "string" ? next.content.trim() : "";
  if (!content) return { success: false, error: "피드백 내용을 입력해주세요." };
  const timeMarker = parseFeedbackTimeMarker(typeof next?.timeMarker === "string" ? next.timeMarker.trim() : "");
  if (Number.isNaN(timeMarker)) return { success: false, error: TIME_MARKER_ERROR };
  if (typeof expected?.content !== "string" || !(expected.timeMarker === null || Number.isSafeInteger(expected.timeMarker))) {
    return { success: false, error: FEEDBACK_CHANGED_ERROR };
  }

  const db = createDb();
  const [current] = await db
    .select({
      assignmentId: feedbacks.assignmentId,
      content: feedbacks.content,
      timeMarker: feedbacks.timeMarker,
      mediaUrl: assignments.mediaUrl,
    })
    .from(feedbacks)
    .innerJoin(assignments, eq(assignments.id, feedbacks.assignmentId))
    .where(eq(feedbacks.id, feedbackId))
    .limit(1);
  if (!current) return { success: false, error: FEEDBACK_NOT_FOUND_ERROR };
  if (timeMarker !== null && !current.mediaUrl) {
    return { success: false, error: "글 제출에는 재생 시점 없이 전체 피드백으로 남겨 주세요." };
  }
  // 같은 값으로 다시 보낸 요청(재시도)은 성공으로 본다.
  if (current.content === content && current.timeMarker === timeMarker) return { success: true };

  const updated = await db
    .update(feedbacks)
    .set({ content, timeMarker })
    .where(and(
      eq(feedbacks.id, feedbackId),
      eq(feedbacks.content, expected.content),
      expected.timeMarker === null ? isNull(feedbacks.timeMarker) : eq(feedbacks.timeMarker, expected.timeMarker),
    ))
    .returning({ id: feedbacks.id });
  if (updated.length === 0) return { success: false, error: FEEDBACK_CHANGED_ERROR };

  revalidatePath(`/dashboard/student/assignments/${current.assignmentId}`);
  return { success: true };
}

const FEEDBACK_NOT_FOUND_ERROR = "피드백을 찾을 수 없습니다. 목록을 새로고침해 주세요.";
const FEEDBACK_CHANGED_ERROR = "다른 화면에서 이 피드백이 먼저 바뀌었습니다. 새로고침한 뒤 다시 고쳐 주세요.";

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

  // 제출 id 목록을 bind하지 않고 join으로 센다(D1은 statement당 bind 100개 제한).
  const rows = await db
    .select({ assignmentId: feedbacks.assignmentId, count: count(feedbacks.id) })
    .from(feedbacks)
    .innerJoin(assignments, eq(assignments.id, feedbacks.assignmentId))
    .where(eq(assignments.studentId, session.user.id!))
    .groupBy(feedbacks.assignmentId);

  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.assignmentId] = Number(row.count);
  }
  return map;
}

// ───────────────────────────────────────────────
// (종료)
// ───────────────────────────────────────────────
