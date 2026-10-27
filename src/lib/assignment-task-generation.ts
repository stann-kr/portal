/**
 * 정기 과제 회차를 조회 시점에 만든다(cron 없음). server action이 아닌 서버 전용 모듈이다.
 *
 * - 규칙마다 assignment-recurrence.ts의 생성 계획을 따르고, 이미 있는 회차는 건너뛴다.
 * - 회차 id는 (규칙, 날짜)에서 결정되고 UNIQUE(recurrence_id, occurrence_date)가 있어
 *   동시에 여러 요청이 같은 회차를 만들어도 `ON CONFLICT DO NOTHING`으로 한 행만 남는다.
 * - 각 INSERT는 읽은 규칙 version이 그대로이고 멈추지 않았을 때만 행을 만든다. 관리자가 규칙을 바꾸는
 *   사이 옛 규칙으로 읽은 요청이 지운 회차를 다시 만들지 않게 하기 위해서다.
 * - D1은 statement당 bind 값이 100개로 제한되므로 행마다 statement를 나누고 한 batch로 보낸다.
 *   batch는 왕복을 줄이기 위한 것이고 중복 방지는 unique index가 맡는다.
 * - 렌더 중에도 부르므로 revalidatePath를 부르지 않는다.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbContext, DrizzleDb } from "@/db/client";
import { assignmentRecurrences, assignmentTasks } from "@/db/schema";
import {
  deriveAssignmentTaskId,
  planRecurrenceOccurrences,
  RECURRENCE_GENERATION_CAP,
} from "@/lib/assignment-recurrence";
import {
  executeDocumentStatementsAtomically,
  type DocumentAtomicStatement,
} from "@/lib/document-lifecycle-atomic";

type RecurrenceRow = typeof assignmentRecurrences.$inferSelect;

/** 한 번의 호출이 만드는 회차 수 상한(모든 규칙 합계). */
export const GENERATION_STATEMENT_CAP = 120;

function epochSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

function readDb(context: DbContext): DrizzleDb {
  return context.db as unknown as DrizzleDb;
}

const INSERT_OCCURRENCE_SQL =
  "INSERT INTO assignment_tasks " +
  "(id, student_id, recurrence_id, occurrence_date, title, description_html, submission_format, due_at, created_by_id, version, created_at, updated_at) " +
  "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ? " +
  "WHERE EXISTS (SELECT 1 FROM assignment_recurrences WHERE id = ? AND student_id = ? AND version = ? AND paused_at IS NULL) " +
  "ON CONFLICT DO NOTHING";

export function buildOccurrenceInsertStatements(
  rule: RecurrenceRow,
  existingDates: ReadonlySet<string>,
  now: Date,
): DocumentAtomicStatement[] {
  if (rule.pausedAt) return [];
  const nowSeconds = epochSeconds(now);
  return planRecurrenceOccurrences(rule, { now, floor: rule.updatedAt, cap: RECURRENCE_GENERATION_CAP })
    .filter((occurrence) => !existingDates.has(occurrence.occurrenceDate))
    .map((occurrence) => ({
      query: INSERT_OCCURRENCE_SQL,
      params: [
        deriveAssignmentTaskId(rule.id, occurrence.occurrenceDate),
        rule.studentId,
        rule.id,
        occurrence.occurrenceDate,
        rule.title,
        rule.descriptionHtml,
        rule.submissionFormat,
        epochSeconds(occurrence.dueAt),
        rule.createdById,
        nowSeconds,
        nowSeconds,
        rule.id,
        rule.studentId,
        rule.version,
      ],
    }));
}

/**
 * 학생의 진행 중인 규칙(또는 지정한 규칙 하나)에 대해 아직 없는 회차를 만든다.
 * @returns 실행한 INSERT statement 수(이미 있는 회차는 세지 않는다).
 */
export async function ensureRecurringAssignmentTasks(
  context: DbContext,
  studentId: string,
  now: Date,
  recurrenceId?: string,
): Promise<number> {
  const db = readDb(context);
  const rules = await db
    .select()
    .from(assignmentRecurrences)
    .where(and(
      eq(assignmentRecurrences.studentId, studentId),
      isNull(assignmentRecurrences.pausedAt),
      recurrenceId ? eq(assignmentRecurrences.id, recurrenceId) : undefined,
    ));
  if (rules.length === 0) return 0;

  const existing = await db
    .select({ recurrenceId: assignmentTasks.recurrenceId, occurrenceDate: assignmentTasks.occurrenceDate })
    .from(assignmentTasks)
    .where(and(
      eq(assignmentTasks.studentId, studentId),
      inArray(assignmentTasks.recurrenceId, rules.map((rule) => rule.id)),
    ));
  const existingByRule = new Map<string, Set<string>>();
  for (const row of existing) {
    if (!row.recurrenceId || !row.occurrenceDate) continue;
    const dates = existingByRule.get(row.recurrenceId) ?? new Set<string>();
    dates.add(row.occurrenceDate);
    existingByRule.set(row.recurrenceId, dates);
  }

  const statements = rules
    .flatMap((rule) => buildOccurrenceInsertStatements(rule, existingByRule.get(rule.id) ?? new Set(), now))
    .slice(0, GENERATION_STATEMENT_CAP);
  if (statements.length === 0) return 0;
  await executeDocumentStatementsAtomically(context, statements);
  return statements.length;
}
