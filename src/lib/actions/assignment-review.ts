/**
 * @file src/lib/actions/assignment-review.ts
 * @description Stann "확인함" 서버 액션. 피드백을 쓰지 않고 학생 제출을 확인했다고 표시하거나 그 표시를 취소한다.
 * 확인함으로 표시한 제출은 피드백이 달린 제출처럼 검토 대기열·대기 수에서 빠지고 학생이 고치거나 지울 수 없다.
 * 취소하면 다시 검토 대기·학생 수정 가능 상태로 돌아간다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { createDb } from "@/db/client";
import { assignments, assignmentTasks, feedbacks } from "@/db/schema";
import { findStudentTarget, requireAdmin } from "@/lib/auth-guard";
import { assignmentAwaitingReview } from "@/lib/assignment-review-query";
import { pushMessages } from "@/lib/push/messages";
import { notifyPush } from "@/lib/push/notify";

export type SetAssignmentReviewedResult =
  | { success: true; reviewedAt: Date | null }
  | { success: false; error: string };

const NOT_FOUND_ERROR = "제출을 찾을 수 없습니다. 목록을 새로고침해 주세요.";

/**
 * 관리자(Stann)가 제출을 확인함으로 표시(reviewed=true)하거나 취소(reviewed=false)한다.
 * 같은 값을 다시 보내면 바꾸지 않고 성공으로 돌려준다. 피드백이 이미 달린 제출은 확인함으로 표시하지 않는다.
 * 표시는 피드백 없음·미확인 조건을 UPDATE WHERE에 함께 걸어, 그 사이 달린 피드백이나 중복 요청과 겹쳐도 한 번만 바뀌고 알림도 한 번만 간다.
 */
export async function setAssignmentReviewed(
  assignmentId: string,
  reviewed: boolean,
): Promise<SetAssignmentReviewedResult> {
  const session = await requireAdmin();
  if (typeof assignmentId !== "string" || !assignmentId) return { success: false, error: NOT_FOUND_ERROR };
  const db = createDb();

  const [assignment] = await db
    .select({
      id: assignments.id,
      studentId: assignments.studentId,
      reviewedAt: assignments.reviewedAt,
      title: assignmentTasks.title,
    })
    .from(assignments)
    .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!assignment) return { success: false, error: NOT_FOUND_ERROR };
  // 비활성·삭제 중이거나 학생이 아닌 계정의 제출은 바꾸지 않는다(학생 대상 action과 같은 계약).
  if (!(await findStudentTarget(assignment.studentId))) return { success: false, error: NOT_FOUND_ERROR };

  if (reviewed) {
    const reviewedAt = new Date();
    const updated = await db
      .update(assignments)
      .set({ reviewedAt })
      .where(and(eq(assignments.id, assignmentId), assignmentAwaitingReview(db)))
      .returning({ reviewedAt: assignments.reviewedAt });
    if (updated.length === 0) {
      const [current] = await db
        .select({ reviewedAt: assignments.reviewedAt })
        .from(assignments)
        .where(eq(assignments.id, assignmentId))
        .limit(1);
      if (!current) return { success: false, error: NOT_FOUND_ERROR };
      if (current.reviewedAt) return { success: true, reviewedAt: current.reviewedAt };
      const [feedback] = await db
        .select({ value: count(feedbacks.id) })
        .from(feedbacks)
        .where(eq(feedbacks.assignmentId, assignmentId));
      return {
        success: false,
        error: Number(feedback?.value ?? 0) > 0
          ? "피드백이 달린 제출은 확인함으로 표시하지 않습니다."
          : "확인함으로 표시하지 못했습니다. 목록을 새로고침해 주세요.",
      };
    }
    await notifyPush(
      { kind: "profiles", profileIds: [assignment.studentId] },
      pushMessages.assignmentAcknowledged({ assignmentId, title: assignment.title }),
      { excludeProfileId: session.user.id },
    );
    revalidateReviewViews(assignmentId, assignment.studentId);
    return { success: true, reviewedAt: updated[0]!.reviewedAt };
  }

  const cleared = await db
    .update(assignments)
    .set({ reviewedAt: null })
    .where(and(eq(assignments.id, assignmentId), isNotNull(assignments.reviewedAt)))
    .returning({ id: assignments.id });
  if (cleared.length > 0) revalidateReviewViews(assignmentId, assignment.studentId);
  return { success: true, reviewedAt: null };
}

/** createFeedback이 갱신하는 상세 화면과 함께, 검토 대기열·대기 수·학생 과제 목록이 보이는 화면을 갱신한다. */
function revalidateReviewViews(assignmentId: string, studentId: string) {
  revalidatePath(`/dashboard/student/assignments/${assignmentId}`);
  revalidatePath("/dashboard/student/assignments");
  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/admin");
  revalidatePath(`/dashboard/admin/students/${studentId}`);
}
