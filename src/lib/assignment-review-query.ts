/**
 * "검토 대기" 제출의 서버 쿼리 조건: 피드백이 없고 Stann이 확인함으로 표시하지 않은 제출.
 * 순수 판단(isSubmissionSettled)과 같은 규칙이며, 검토 대기열·대기 수와 학생 삭제 잠금(DELETE WHERE)이 함께 쓴다. 학생 수정 잠금은 피드백만 보는 assignmentHasNoFeedback이다.
 * 대상 제출을 바깥 쿼리의 `assignments` 행과 상관(correlated)시키므로 assignments를 FROM/UPDATE/DELETE 대상으로 둔 쿼리에서만 쓴다.
 */
import { and, eq, isNull, notExists, type SQL } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { assignments, feedbacks } from "@/db/schema";

export function assignmentAwaitingReview(db: DrizzleDb): SQL {
  return and(
    notExists(
      db
        .select({ id: feedbacks.id })
        .from(feedbacks)
        .where(eq(feedbacks.assignmentId, assignments.id)),
    ),
    isNull(assignments.reviewedAt),
  )!;
}

/**
 * 피드백이 없는 제출: 학생 수정 잠금(UPDATE WHERE)의 조건. 순수 판단 `isSubmissionEditLocked`와 같은 규칙이다.
 * 확인함(reviewed_at)은 보지 않는다. 고치는 UPDATE가 reviewed_at을 비워 다시 검토 대기로 돌린다.
 */
export function assignmentHasNoFeedback(db: DrizzleDb): SQL {
  return notExists(
    db
      .select({ id: feedbacks.id })
      .from(feedbacks)
      .where(eq(feedbacks.assignmentId, assignments.id)),
  );
}
