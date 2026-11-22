/**
 * 과제 글 계정 사본(0035 `assignment_drafts`)의 조회·정리 query. 서버 action에서만 부른다.
 * 제출 action은 성공한 뒤 같은 글의 사본을 지워 다른 기기가 제출 전 글을 다시 살리지 않게 한다.
 */
import { and, eq, isNotNull, max } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { assignmentDrafts } from "@/db/schema";

/** 받은 과제 하나의 사본(제출 글·분석 모두). 제출·제출 수정이 성공한 뒤 부른다. */
export async function deleteTaskAssignmentDrafts(db: DrizzleDb, ownerId: string, taskId: string): Promise<void> {
  try {
    await db.delete(assignmentDrafts).where(and(eq(assignmentDrafts.ownerId, ownerId), eq(assignmentDrafts.taskId, taskId)));
  } catch {
    // 제출은 이미 저장됐다. 남은 사본은 화면이 제출 시각보다 오래된 것으로 보고 버린다(useAccountDraftSync).
  }
}

/** key 하나의 사본(자유 제출). */
export async function deleteAssignmentDraftByKey(db: DrizzleDb, ownerId: string, draftKey: string): Promise<void> {
  try {
    await db.delete(assignmentDrafts).where(and(eq(assignmentDrafts.ownerId, ownerId), eq(assignmentDrafts.draftKey, draftKey)));
  } catch {
    // 위와 같다.
  }
}

/** 학생 본인의 과제별 마지막 사본 시각(과제 목록의 "작성 중"). 본인 owner_id로만 좁힌다. */
export async function loadTaskDraftTimes(db: DrizzleDb, ownerId: string): Promise<Map<string, Date>> {
  const rows = await db
    .select({ taskId: assignmentDrafts.taskId, updatedAt: max(assignmentDrafts.updatedAt) })
    .from(assignmentDrafts)
    .where(and(eq(assignmentDrafts.ownerId, ownerId), isNotNull(assignmentDrafts.taskId)))
    .groupBy(assignmentDrafts.taskId);
  const times = new Map<string, Date>();
  for (const row of rows) {
    if (row.taskId && row.updatedAt) times.set(row.taskId, row.updatedAt);
  }
  return times;
}
