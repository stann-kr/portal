/**
 * "검토 대기" 제출의 서버 쿼리 조건: 피드백이 없고 Stann이 확인함으로 표시하지 않은 제출.
 * 순수 판단(isSubmissionSettled)과 같은 규칙이며, 검토 대기열·대기 수와 학생 수정·삭제 잠금(UPDATE/DELETE WHERE)이 함께 쓴다.
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
