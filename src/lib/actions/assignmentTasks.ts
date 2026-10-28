/**
 * @file src/lib/actions/assignmentTasks.ts
 * @description 관리자가 내는 과제(한 번·정기)와 학생의 과제별 제출 서버 액션.
 *
 * 경계
 * - 관리자 action은 requireStudentTarget으로 대상 학생을 검증하고, 모든 UPDATE·DELETE를 id와 student_id로 함께 좁힌다.
 * - 학생 action은 session 학생의 과제·제출만 읽고 쓴다.
 *
 * 결정
 * - 제출이 있는 과제는 제목·설명·마감만 바꿀 수 있고 제출 형식은 바꿀 수 없다(이미 낸 제출이 형식과 어긋나지 않게).
 * - 정기 과제 회차는 개별 삭제하지 않는다. 규칙을 멈추거나 바꾸거나 지우면 아직 마감 전이고 제출이 없는 회차만
 *   지우고 다시 만들며, 마감이 지났거나 제출된 회차는 그대로 둔다. 규칙을 지우면 남은 회차는 한 번 과제처럼 남는다.
 * - 과제를 지워도 제출은 자유 제출로 남는다(task_id ON DELETE SET NULL).
 * - 학생 제출 수정은 피드백이 달리기 전까지만 허용하고, 확인과 수정을 한 UPDATE로 처리한다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { and, asc, count, desc, eq, exists, isNull, notExists, sql } from "drizzle-orm";
import { createDbContext, type DbContext, type DrizzleDb } from "@/db/client";
import { assignmentRecurrences, assignmentTasks, assignments, feedbacks } from "@/db/schema";
import { requireAuth, requireStudentTarget, type AuthSession } from "@/lib/auth-guard";
import {
  CREATION_OPERATION_FIELD,
  deriveCreationResourceId,
  resolveCreationOperationId,
} from "@/lib/creation-operation";
import { parseKstDateTimeInput } from "@/lib/date-input";
import {
  validateRecurrenceSchedule,
  weekdayMaskFromList,
  type AssignmentSubmissionFormatValue,
} from "@/lib/assignment-recurrence";
import {
  ASSIGNMENT_DESCRIPTION_MAX_LENGTH,
  ASSIGNMENT_TITLE_MAX_LENGTH,
  normalizePlainTextField,
  parseSubmissionFormat,
  validateSubmissionPayload,
} from "@/lib/assignment-submission";
import { ensureRecurringAssignmentTasks } from "@/lib/assignment-task-generation";
import {
  DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  executeDocumentStatementsAtomically,
} from "@/lib/document-lifecycle-atomic";

// ───────────────────────────────────────────────
// 타입
// ───────────────────────────────────────────────

export type AssignmentTaskSubmission = {
  id: string;
  mediaUrl: string | null;
  textHtml: string | null;
  submittedAt: Date | null;
  updatedAt: Date | null;
  feedbackCount: number;
};

export type AssignmentTaskItem = {
  id: string;
  title: string;
  descriptionHtml: string;
  submissionFormat: AssignmentSubmissionFormatValue;
  dueAt: Date | null;
  occurrenceDate: string | null;
  recurrenceId: string | null;
  version: number;
  createdAt: Date;
  submission: AssignmentTaskSubmission | null;
};

export type AssignmentRecurrenceItem = {
  id: string;
  title: string;
  descriptionHtml: string;
  submissionFormat: AssignmentSubmissionFormatValue;
  startDate: string;
  intervalWeeks: number;
  weekdays: number;
  dueTime: string;
  endDate: string | null;
  maxOccurrences: number | null;
  pausedAt: Date | null;
  version: number;
};

export type AssignmentTaskActionState = { error?: string; success?: boolean; id?: string };
export type AssignmentTaskMutationResult = { success: true } | { success: false; error: string };

// ───────────────────────────────────────────────
// 공통
// ───────────────────────────────────────────────

function readDb(context: DbContext): DrizzleDb {
  return context.db as unknown as DrizzleDb;
}

function epochSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

function sameSecond(a: Date | null, b: Date | null): boolean {
  return (a === null ? null : epochSeconds(a)) === (b === null ? null : epochSeconds(b));
}

const TASK_CHANGED_MESSAGE = "과제가 바뀌었습니다. 목록을 새로고침해 바뀐 제출 형식을 확인한 뒤 다시 제출해 주세요.";

function revalidateAssignmentViews(studentId: string) {
  revalidatePath("/dashboard/student");
  revalidatePath("/dashboard/admin");
  revalidatePath(`/dashboard/admin/students/${studentId}`);
}

async function requireStudentSession(): Promise<AuthSession> {
  const session = await requireAuth();
  if (session.user.role !== "student") throw new Error("Student only");
  return session;
}

/** 아직 마감 전이고 제출이 없는 정기 회차를 지우는 statement. */
function deleteOpenUnsubmittedOccurrencesStatement(recurrenceId: string, studentId: string, now: Date) {
  return {
    query:
      "DELETE FROM assignment_tasks WHERE recurrence_id = ? AND student_id = ? AND due_at > ? " +
      "AND NOT EXISTS (SELECT 1 FROM assignments WHERE assignments.task_id = assignment_tasks.id)",
    params: [recurrenceId, studentId, epochSeconds(now)],
  };
}

type TaskContent = {
  title: string;
  descriptionHtml: string;
  submissionFormat: AssignmentSubmissionFormatValue;
};

function parseTaskContent(formData: FormData): { ok: true; value: TaskContent } | { ok: false; error: string } {
  const rawTitle = formData.get("title");
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (!title) return { ok: false, error: "과제 제목을 입력해 주세요." };
  if (title.length > ASSIGNMENT_TITLE_MAX_LENGTH) {
    return { ok: false, error: `과제 제목은 ${ASSIGNMENT_TITLE_MAX_LENGTH}자까지 쓸 수 있습니다.` };
  }
  const description = normalizePlainTextField(formData.get("description"), {
    maxLength: ASSIGNMENT_DESCRIPTION_MAX_LENGTH,
    label: "설명",
  });
  if (!description.ok) return description;
  const submissionFormat = parseSubmissionFormat(formData.get("submissionFormat"));
  if (!submissionFormat) return { ok: false, error: "제출 형식을 골라 주세요." };
  return { ok: true, value: { title, descriptionHtml: description.html, submissionFormat } };
}

/** 마감: 날짜만 고르면 그날 23:59, 시각까지 고르면 그 시각(KST). 둘 다 비우면 마감 없음. */
function parseOptionalDue(formData: FormData): { ok: true; value: Date | null } | { ok: false; error: string } {
  const rawDate = formData.get("dueDate");
  const rawTime = formData.get("dueTime");
  const date = typeof rawDate === "string" ? rawDate.trim() : "";
  const time = typeof rawTime === "string" ? rawTime.trim() : "";
  if (!date && !time) return { ok: true, value: null };
  if (!date) return { ok: false, error: "마감 시각을 정하려면 마감 날짜도 골라 주세요." };
  const parsed = parseKstDateTimeInput(`${date}T${time || "23:59"}`);
  return parsed ? { ok: true, value: parsed } : { ok: false, error: "마감 날짜와 시각을 확인해 주세요." };
}

function parseVersion(formData: FormData): number | null {
  const raw = formData.get("version");
  const value = typeof raw === "string" ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function parseIntegerField(formData: FormData, name: string): number | null {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : NaN;
}

function parseRecurrenceForm(formData: FormData) {
  const content = parseTaskContent(formData);
  if (!content.ok) return content;
  const weekdays = weekdayMaskFromList(formData.getAll("weekdays").map((value) => Number(value)));
  const intervalWeeks = parseIntegerField(formData, "intervalWeeks") ?? 1;
  const maxOccurrences = parseIntegerField(formData, "maxOccurrences");
  const text = (name: string) => {
    const raw = formData.get(name);
    return typeof raw === "string" ? raw.trim() : "";
  };
  const schedule = validateRecurrenceSchedule({
    startDate: text("startDate"),
    intervalWeeks,
    weekdays,
    dueTime: text("dueTime"),
    endDate: text("endDate") || null,
    maxOccurrences,
  });
  if (!schedule.ok) return schedule;
  return { ok: true as const, value: { ...content.value, ...schedule.schedule } };
}

async function loadTasksWithSubmissions(db: DrizzleDb, studentId: string): Promise<AssignmentTaskItem[]> {
  const tasks = await db
    .select()
    .from(assignmentTasks)
    .where(eq(assignmentTasks.studentId, studentId))
    .orderBy(desc(assignmentTasks.dueAt), desc(assignmentTasks.createdAt));
  if (tasks.length === 0) return [];

  const submissionRows = await db
    .select({
      id: assignments.id,
      taskId: assignments.taskId,
      mediaUrl: assignments.mediaUrl,
      textHtml: assignments.textHtml,
      submittedAt: assignments.submittedAt,
      updatedAt: assignments.updatedAt,
      feedbackCount: count(feedbacks.id),
    })
    .from(assignments)
    // 과제 id 목록을 bind하지 않고 join으로 좁힌다(D1은 statement당 bind 100개 제한).
    .innerJoin(assignmentTasks, and(eq(assignmentTasks.id, assignments.taskId), eq(assignmentTasks.studentId, studentId)))
    .leftJoin(feedbacks, eq(feedbacks.assignmentId, assignments.id))
    .where(eq(assignments.studentId, studentId))
    .groupBy(assignments.id);
  const byTask = new Map(submissionRows.map((row) => [row.taskId, row]));

  return tasks.map((task) => {
    const submission = byTask.get(task.id);
    return {
      id: task.id,
      title: task.title,
      descriptionHtml: task.descriptionHtml,
      submissionFormat: task.submissionFormat,
      dueAt: task.dueAt,
      occurrenceDate: task.occurrenceDate,
      recurrenceId: task.recurrenceId,
      version: task.version,
      createdAt: task.createdAt,
      submission: submission
        ? {
            id: submission.id,
            mediaUrl: submission.mediaUrl,
            textHtml: submission.textHtml,
            submittedAt: submission.submittedAt,
            updatedAt: submission.updatedAt,
            feedbackCount: Number(submission.feedbackCount),
          }
        : null,
    };
  });
}

/**
 * 목록 순서: 마감 전 과제는 마감이 가까운 순, 그 뒤 마감 없는 과제, 마감이 지난 과제는 최근 순.
 * 아직 오지 않은 회차(다음 회차)도 마감 전 과제로 앞에 놓인다.
 */
function sortTasks(tasks: AssignmentTaskItem[], now: Date): AssignmentTaskItem[] {
  const nowTime = now.getTime();
  const rank = (task: AssignmentTaskItem) => (task.dueAt === null ? 1 : task.dueAt.getTime() >= nowTime ? 0 : 2);
  return [...tasks].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.dueAt && b.dueAt) {
      return rank(a) === 0 ? a.dueAt.getTime() - b.dueAt.getTime() : b.dueAt.getTime() - a.dueAt.getTime();
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

function toRecurrenceItem(row: typeof assignmentRecurrences.$inferSelect): AssignmentRecurrenceItem {
  return {
    id: row.id,
    title: row.title,
    descriptionHtml: row.descriptionHtml,
    submissionFormat: row.submissionFormat,
    startDate: row.startDate,
    intervalWeeks: row.intervalWeeks,
    weekdays: row.weekdays,
    dueTime: row.dueTime,
    endDate: row.endDate,
    maxOccurrences: row.maxOccurrences,
    pausedAt: row.pausedAt,
    version: row.version,
  };
}

// ───────────────────────────────────────────────
// 조회
// ───────────────────────────────────────────────

/** 학생 본인의 받은 과제. 진행 중인 정기 과제의 회차를 먼저 만든다. */
export async function getMyAssignmentTasks(): Promise<AssignmentTaskItem[]> {
  const session = await requireStudentSession();
  const context = createDbContext();
  const now = new Date();
  await ensureRecurringAssignmentTasks(context, session.user.id, now);
  return sortTasks(await loadTasksWithSubmissions(readDb(context), session.user.id), now);
}

/** 관리자 학생 상세: 그 학생의 과제와 정기 과제 규칙. */
export async function getAssignmentTasksForStudent(studentId: string): Promise<{
  tasks: AssignmentTaskItem[];
  recurrences: AssignmentRecurrenceItem[];
}> {
  await requireStudentTarget(studentId);
  const context = createDbContext();
  const db = readDb(context);
  const now = new Date();
  await ensureRecurringAssignmentTasks(context, studentId, now);
  const [tasks, rules] = await Promise.all([
    loadTasksWithSubmissions(db, studentId),
    db
      .select()
      .from(assignmentRecurrences)
      .where(eq(assignmentRecurrences.studentId, studentId))
      .orderBy(asc(assignmentRecurrences.createdAt)),
  ]);
  return { tasks: sortTasks(tasks, now), recurrences: rules.map(toRecurrenceItem) };
}

// ───────────────────────────────────────────────
// 관리자: 한 번 과제
// ───────────────────────────────────────────────

export async function createAssignmentTask(
  studentId: string,
  _prev: AssignmentTaskActionState,
  formData: FormData,
): Promise<AssignmentTaskActionState> {
  await requireStudentTarget(studentId);
  const session = await requireAuth();
  const content = parseTaskContent(formData);
  if (!content.ok) return { error: content.error };
  const due = parseOptionalDue(formData);
  if (!due.ok) return { error: due.error };
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) return { error: "작성 정보를 확인하지 못했습니다. 입력 내용을 보관한 뒤 새로고침해 주세요." };
  const id = deriveCreationResourceId(operationId, JSON.stringify(["assignment-task", session.user.id, studentId]));

  const db = readDb(createDbContext());
  try {
    const inserted = await db
      .insert(assignmentTasks)
      .values({ id, studentId, ...content.value, dueAt: due.value, createdById: session.user.id })
      .onConflictDoNothing({ target: assignmentTasks.id })
      .returning({ id: assignmentTasks.id });
    if (inserted.length === 0) {
      const [existing] = await db.select().from(assignmentTasks).where(eq(assignmentTasks.id, id)).limit(1);
      // 같은 operationId 재전송은 정규화한 내용 전체가 같을 때만 성공으로 본다.
      const same = existing
        && existing.studentId === studentId
        && existing.recurrenceId === null
        && existing.title === content.value.title
        && existing.descriptionHtml === content.value.descriptionHtml
        && existing.submissionFormat === content.value.submissionFormat
        && sameSecond(existing.dueAt, due.value);
      if (!same) {
        return { error: "이 과제는 수정 전 내용으로 이미 저장되었습니다. 목록을 확인한 뒤 새 과제로 다시 내 주세요." };
      }
    }
  } catch {
    return { error: "과제를 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  revalidateAssignmentViews(studentId);
  return { success: true, id };
}

export async function updateAssignmentTask(
  studentId: string,
  taskId: string,
  _prev: AssignmentTaskActionState,
  formData: FormData,
): Promise<AssignmentTaskActionState> {
  await requireStudentTarget(studentId);
  const content = parseTaskContent(formData);
  if (!content.ok) return { error: content.error };
  const due = parseOptionalDue(formData);
  if (!due.ok) return { error: due.error };
  const version = parseVersion(formData);
  if (!version) return { error: "과제 정보를 확인하지 못했습니다. 새로고침해 주세요." };

  const db = readDb(createDbContext());
  const scope = and(eq(assignmentTasks.id, taskId), eq(assignmentTasks.studentId, studentId));
  const [current] = await db.select().from(assignmentTasks).where(scope).limit(1);
  if (!current) return { error: "과제를 찾을 수 없습니다. 목록을 새로고침해 주세요." };
  const formatChanged = current.submissionFormat !== content.value.submissionFormat;

  const updated = await db
    .update(assignmentTasks)
    .set({ ...content.value, dueAt: due.value, version: version + 1, updatedAt: new Date() })
    .where(and(
      scope,
      eq(assignmentTasks.version, version),
      formatChanged
        ? notExists(db.select({ id: assignments.id }).from(assignments).where(eq(assignments.taskId, assignmentTasks.id)))
        : undefined,
    ))
    .returning({ id: assignmentTasks.id });
  if (updated.length === 0) {
    if (current.version !== version) {
      return { error: "다른 곳에서 이 과제를 먼저 고쳤습니다. 새로고침한 뒤 다시 고쳐 주세요." };
    }
    return { error: "학생이 이미 제출한 과제는 제출 형식을 바꿀 수 없습니다. 제목·설명·마감만 고칠 수 있습니다." };
  }
  revalidateAssignmentViews(studentId);
  return { success: true, id: taskId };
}

/** 한 번 과제 삭제. 제출은 자유 제출로 남는다. 정기 과제 회차는 규칙에서 관리한다. */
export async function deleteAssignmentTask(studentId: string, taskId: string): Promise<AssignmentTaskMutationResult> {
  await requireStudentTarget(studentId);
  const db = readDb(createDbContext());
  const deleted = await db
    .delete(assignmentTasks)
    .where(and(
      eq(assignmentTasks.id, taskId),
      eq(assignmentTasks.studentId, studentId),
      isNull(assignmentTasks.recurrenceId),
    ))
    .returning({ id: assignmentTasks.id });
  if (deleted.length === 0) {
    const [remaining] = await db
      .select({ recurrenceId: assignmentTasks.recurrenceId })
      .from(assignmentTasks)
      .where(and(eq(assignmentTasks.id, taskId), eq(assignmentTasks.studentId, studentId)))
      .limit(1);
    return {
      success: false,
      error: remaining
        ? "정기 과제 회차는 따로 지울 수 없습니다. 정기 과제를 멈추거나 고쳐 주세요."
        : "이미 삭제됐거나 찾을 수 없는 과제입니다. 목록을 새로고침해 주세요.",
    };
  }
  revalidateAssignmentViews(studentId);
  return { success: true };
}

// ───────────────────────────────────────────────
// 관리자: 정기 과제
// ───────────────────────────────────────────────

export async function createAssignmentRecurrence(
  studentId: string,
  _prev: AssignmentTaskActionState,
  formData: FormData,
): Promise<AssignmentTaskActionState> {
  await requireStudentTarget(studentId);
  const session = await requireAuth();
  const parsed = parseRecurrenceForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) return { error: "작성 정보를 확인하지 못했습니다. 입력 내용을 보관한 뒤 새로고침해 주세요." };
  const id = deriveCreationResourceId(operationId, JSON.stringify(["assignment-recurrence", session.user.id, studentId]));

  const context = createDbContext();
  const db = readDb(context);
  try {
    const inserted = await db
      .insert(assignmentRecurrences)
      .values({ id, studentId, ...parsed.value, createdById: session.user.id })
      .onConflictDoNothing({ target: assignmentRecurrences.id })
      .returning({ id: assignmentRecurrences.id });
    if (inserted.length === 0) {
      const [existing] = await db.select().from(assignmentRecurrences).where(eq(assignmentRecurrences.id, id)).limit(1);
      const value = parsed.value;
      const same = existing
        && existing.studentId === studentId
        && existing.title === value.title
        && existing.descriptionHtml === value.descriptionHtml
        && existing.submissionFormat === value.submissionFormat
        && existing.startDate === value.startDate
        && existing.intervalWeeks === value.intervalWeeks
        && existing.weekdays === value.weekdays
        && existing.dueTime === value.dueTime
        && existing.endDate === value.endDate
        && existing.maxOccurrences === value.maxOccurrences;
      if (!same) {
        return { error: "이 정기 과제는 수정 전 내용으로 이미 저장되었습니다. 목록을 확인한 뒤 고쳐 주세요." };
      }
    }
    await ensureRecurringAssignmentTasks(context, studentId, new Date(), id);
  } catch {
    return { error: "정기 과제를 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  revalidateAssignmentViews(studentId);
  return { success: true, id };
}

async function loadScopedRecurrence(db: DrizzleDb, studentId: string, recurrenceId: string) {
  const [rule] = await db
    .select()
    .from(assignmentRecurrences)
    .where(and(eq(assignmentRecurrences.id, recurrenceId), eq(assignmentRecurrences.studentId, studentId)))
    .limit(1);
  return rule ?? null;
}

const RECURRENCE_CONFLICT = "다른 곳에서 이 정기 과제를 먼저 바꿨습니다. 새로고침한 뒤 다시 시도해 주세요.";

/**
 * 규칙 수정: 옛 규칙으로 밀린 회차를 먼저 만든 뒤, version이 맞을 때만 규칙을 바꾸고
 * 마감 전·미제출 회차를 지운다(한 batch). 그 다음 새 규칙으로 회차를 만든다.
 */
export async function updateAssignmentRecurrence(
  studentId: string,
  recurrenceId: string,
  _prev: AssignmentTaskActionState,
  formData: FormData,
): Promise<AssignmentTaskActionState> {
  await requireStudentTarget(studentId);
  const parsed = parseRecurrenceForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const version = parseVersion(formData);
  if (!version) return { error: "정기 과제 정보를 확인하지 못했습니다. 새로고침해 주세요." };

  const context = createDbContext();
  const db = readDb(context);
  const rule = await loadScopedRecurrence(db, studentId, recurrenceId);
  if (!rule) return { error: "정기 과제를 찾을 수 없습니다. 목록을 새로고침해 주세요." };
  if (rule.version !== version) return { error: RECURRENCE_CONFLICT };

  const now = new Date();
  try {
    await ensureRecurringAssignmentTasks(context, studentId, now, recurrenceId);
    const value = parsed.value;
    await executeDocumentStatementsAtomically(context, [
      {
        query:
          "UPDATE assignment_recurrences SET title = ?, description_html = ?, submission_format = ?, start_date = ?, " +
          "interval_weeks = ?, weekdays = ?, due_time = ?, end_date = ?, max_occurrences = ?, version = version + 1, updated_at = ? " +
          "WHERE id = ? AND student_id = ? AND version = ?",
        params: [
          value.title, value.descriptionHtml, value.submissionFormat, value.startDate,
          value.intervalWeeks, value.weekdays, value.dueTime, value.endDate, value.maxOccurrences, epochSeconds(now),
          recurrenceId, studentId, version,
        ],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      deleteOpenUnsubmittedOccurrencesStatement(recurrenceId, studentId, now),
    ]);
  } catch {
    return { error: RECURRENCE_CONFLICT };
  }
  await ensureRecurringAssignmentTasks(context, studentId, now, recurrenceId).catch(() => 0);
  revalidateAssignmentViews(studentId);
  return { success: true, id: recurrenceId };
}

/** 멈춤: 마감 전·미제출 회차를 지우고 새 회차를 만들지 않는다. 다시 시작: 지금부터 회차를 만든다. */
export async function setAssignmentRecurrencePaused(
  studentId: string,
  recurrenceId: string,
  paused: boolean,
  version: number,
): Promise<AssignmentTaskMutationResult> {
  await requireStudentTarget(studentId);
  const context = createDbContext();
  const db = readDb(context);
  const rule = await loadScopedRecurrence(db, studentId, recurrenceId);
  if (!rule) return { success: false, error: "정기 과제를 찾을 수 없습니다. 목록을 새로고침해 주세요." };
  if (rule.version !== version) return { success: false, error: RECURRENCE_CONFLICT };
  if (Boolean(rule.pausedAt) === paused) return { success: true };

  const now = new Date();
  try {
    if (paused) await ensureRecurringAssignmentTasks(context, studentId, now, recurrenceId);
    await executeDocumentStatementsAtomically(context, [
      {
        query:
          "UPDATE assignment_recurrences SET paused_at = ?, version = version + 1, updated_at = ? " +
          "WHERE id = ? AND student_id = ? AND version = ?",
        params: [paused ? epochSeconds(now) : null, epochSeconds(now), recurrenceId, studentId, version],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ...(paused ? [deleteOpenUnsubmittedOccurrencesStatement(recurrenceId, studentId, now)] : []),
    ]);
  } catch {
    return { success: false, error: RECURRENCE_CONFLICT };
  }
  if (!paused) await ensureRecurringAssignmentTasks(context, studentId, now, recurrenceId).catch(() => 0);
  revalidateAssignmentViews(studentId);
  return { success: true };
}

/** 규칙 삭제: 마감 전·미제출 회차는 지우고, 지난 회차와 제출된 회차는 한 번 과제로 남긴다. */
export async function deleteAssignmentRecurrence(
  studentId: string,
  recurrenceId: string,
): Promise<AssignmentTaskMutationResult> {
  await requireStudentTarget(studentId);
  const context = createDbContext();
  const db = readDb(context);
  const rule = await loadScopedRecurrence(db, studentId, recurrenceId);
  if (!rule) return { success: false, error: "이미 삭제됐거나 찾을 수 없는 정기 과제입니다. 목록을 새로고침해 주세요." };

  const now = new Date();
  try {
    await ensureRecurringAssignmentTasks(context, studentId, now, recurrenceId);
    await executeDocumentStatementsAtomically(context, [
      deleteOpenUnsubmittedOccurrencesStatement(recurrenceId, studentId, now),
      { query: "DELETE FROM assignment_recurrences WHERE id = ? AND student_id = ?", params: [recurrenceId, studentId] },
    ]);
  } catch {
    return { success: false, error: "정기 과제를 삭제하지 못했습니다. 다시 시도해 주세요." };
  }
  revalidateAssignmentViews(studentId);
  return { success: true };
}

// ───────────────────────────────────────────────
// 학생: 과제 제출·수정
// ───────────────────────────────────────────────

/** 받은 과제에 형식에 맞게 제출한다. 과제마다 제출은 하나이며, 같은 내용 재전송은 성공으로 본다. */
export async function submitAssignmentTask(
  taskId: string,
  _prev: AssignmentTaskActionState,
  formData: FormData,
): Promise<AssignmentTaskActionState> {
  const session = await requireAuth();
  if (session.user.role !== "student") return { error: "학생만 과제를 제출할 수 있습니다." };
  const studentId = session.user.id;
  const db = readDb(createDbContext());
  const [task] = await db
    .select({ id: assignmentTasks.id, submissionFormat: assignmentTasks.submissionFormat, dueAt: assignmentTasks.dueAt })
    .from(assignmentTasks)
    .where(and(eq(assignmentTasks.id, taskId), eq(assignmentTasks.studentId, studentId)))
    .limit(1);
  if (!task) return { error: "과제를 찾을 수 없습니다. 목록을 새로고침해 주세요." };
  const payload = validateSubmissionPayload(task.submissionFormat, {
    mediaUrl: formData.get("mediaUrl"),
    text: formData.get("text"),
  });
  if (!payload.ok) return { error: payload.error };

  try {
    // 읽은 뒤 관리자가 형식을 바꾸거나 과제를 지웠을 수 있으므로, INSERT 자체가 과제 소유와 읽은 형식을 다시 확인한다.
    const inserted = await db.all<{ id: string }>(sql`
      INSERT INTO assignments (id, student_id, task_id, media_url, text_html)
      SELECT ${crypto.randomUUID()}, ${studentId}, ${taskId}, ${payload.mediaUrl}, ${payload.textHtml}
      WHERE EXISTS (
        SELECT 1 FROM assignment_tasks
        WHERE id = ${taskId} AND student_id = ${studentId} AND submission_format = ${task.submissionFormat}
      )
      ON CONFLICT (task_id) DO NOTHING
      RETURNING id`);
    if (inserted.length === 0) {
      const [existing] = await db
        .select({ id: assignments.id, studentId: assignments.studentId, mediaUrl: assignments.mediaUrl, textHtml: assignments.textHtml })
        .from(assignments)
        .where(eq(assignments.taskId, taskId))
        .limit(1);
      if (!existing) return { error: TASK_CHANGED_MESSAGE };
      if (existing.studentId === studentId && existing.mediaUrl === payload.mediaUrl && existing.textHtml === payload.textHtml) {
        return { success: true, id: existing.id };
      }
      return { error: "이 과제는 이미 제출했습니다. 내용을 바꾸려면 제출 수정을 눌러 주세요." };
    }
    revalidateAssignmentViews(studentId);
    return { success: true, id: inserted[0]!.id };
  } catch {
    return { error: "제출하지 못했습니다. 과제가 삭제됐을 수 있으니 목록을 새로고침해 주세요." };
  }
}

/** 피드백이 달리기 전까지 본인 과제 제출을 고친다. 피드백 확인과 수정을 한 UPDATE로 처리한다. */
export async function updateMyTaskSubmission(
  assignmentId: string,
  _prev: AssignmentTaskActionState,
  formData: FormData,
): Promise<AssignmentTaskActionState> {
  const session = await requireAuth();
  if (session.user.role !== "student") return { error: "제출한 학생만 고칠 수 있습니다." };
  const studentId = session.user.id;
  const db = readDb(createDbContext());
  const own = and(eq(assignments.id, assignmentId), eq(assignments.studentId, studentId));
  const [row] = await db
    .select({ id: assignments.id, submissionFormat: assignmentTasks.submissionFormat })
    .from(assignments)
    .innerJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
    .where(and(own, eq(assignmentTasks.studentId, studentId)))
    .limit(1);
  if (!row) return { error: "고칠 제출을 찾을 수 없습니다. 목록을 새로고침해 주세요." };
  const payload = validateSubmissionPayload(row.submissionFormat, {
    mediaUrl: formData.get("mediaUrl"),
    text: formData.get("text"),
  });
  if (!payload.ok) return { error: payload.error };

  const updated = await db
    .update(assignments)
    .set({ mediaUrl: payload.mediaUrl, textHtml: payload.textHtml, updatedAt: new Date() })
    .where(and(
      own,
      notExists(db.select({ id: feedbacks.id }).from(feedbacks).where(eq(feedbacks.assignmentId, assignments.id))),
      // 검증한 형식이 그대로일 때만 고친다(그 사이 관리자가 형식을 바꿨으면 0행).
      exists(db.select({ id: assignmentTasks.id }).from(assignmentTasks).where(and(
        eq(assignmentTasks.id, assignments.taskId),
        eq(assignmentTasks.studentId, studentId),
        eq(assignmentTasks.submissionFormat, row.submissionFormat),
      ))),
    ))
    .returning({ id: assignments.id });
  if (updated.length === 0) {
    const [feedback] = await db
      .select({ id: feedbacks.id })
      .from(feedbacks)
      .where(eq(feedbacks.assignmentId, assignmentId))
      .limit(1);
    return {
      error: feedback
        ? "피드백이 등록된 제출은 고칠 수 없습니다. 필요하면 강사에게 문의해 주세요."
        : TASK_CHANGED_MESSAGE,
    };
  }
  revalidateAssignmentViews(studentId);
  revalidatePath(`/dashboard/student/assignments/${assignmentId}`);
  return { success: true, id: assignmentId };
}
