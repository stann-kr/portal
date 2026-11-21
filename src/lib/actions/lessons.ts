/**
 * @file src/lib/actions/lessons.ts
 * @description 레슨 일정 관련 서버 액션.
 * Admin: 레슨 생성/삭제.
 * Student: 본인 레슨 조회.
 * Calendar: .ics 생성용 데이터 조회.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb, createDbContext } from "@/db/client";
import { lessons } from "@/db/schema";
import {
  markLinksDeletedStatement,
  schedulePushStudentCalendarChanges,
} from "@/lib/calendar-sync/sync-runner";
import {
  DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  documentEpochSeconds,
  executeDocumentStatementsAtomically,
} from "@/lib/document-lifecycle-atomic";
import { listLessonGroups, readGroupLessonTargets, readLessonGroupMemberIds, readStudentLessonGroupId } from "@/lib/lesson-groups";
import { activeStudentSql } from "@/lib/student-status";
import { LESSON_WITH_GROUP_FIELD, sharedLessonStarts } from "@/lib/lesson-group-rules";
import { and, eq, gte, asc, desc } from "drizzle-orm";
import {
  requireAdmin,
  requireAuth,
  requireStudentOwnerOrAdmin,
  requireStudentTarget,
  type AuthSession,
} from "@/lib/auth-guard";
import { parseDateTimeInput } from "@/lib/date-input";
import { queryConnectedLessonsForStudent, type ConnectedLesson } from "@/lib/connected-next-lesson";
import { fetchExternalItemsForUser } from "@/lib/external-items";
import { pushMessages } from "@/lib/push/messages";
import { notifyPush } from "@/lib/push/notify";

// ───────────────────────────────────────────────
// 조회
// ───────────────────────────────────────────────

/**
 * 특정 학생의 모든 레슨 조회 (날짜 내림차순).
 */
export async function getLessonsByStudent(studentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  const db = createDb();
  return db
    .select()
    .from(lessons)
    .where(eq(lessons.studentId, studentId))
    .orderBy(desc(lessons.scheduledAt));
}

/**
 * 관리자 학생 상세: 학생에게 연결된 바깥 캘린더의 앞으로 일정(레슨으로 센다, 2026-11-03 사용자 결정).
 */
export async function getConnectedLessonsForStudent(studentId: string): Promise<ConnectedLesson[]> {
  await requireStudentTarget(studentId);
  return queryConnectedLessonsForStudent(createDb(), studentId, new Date(), fetchExternalItemsForUser);
}

/**
 * 학생 본인의 다음 예정 레슨 조회 (Student Dashboard용).
 */
export async function getNextLesson(studentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  const db = createDb();
  const now = new Date();
  const rows = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.studentId, studentId), gte(lessons.scheduledAt, now)))
    .orderBy(asc(lessons.scheduledAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Admin Dashboard: 전체 예정 레슨 수 조회.
 */
export async function getUpcomingLessonCount(): Promise<number> {
  await requireAdmin();
  const db = createDb();
  const now = new Date();
  const [rows, groups] = await Promise.all([
    db
      .select({ studentId: lessons.studentId, scheduledAt: lessons.scheduledAt })
      .from(lessons)
      .where(gte(lessons.scheduledAt, now)),
    listLessonGroups(createDbContext()),
  ]);
  // 그룹레슨(같은 그룹 + 같은 시각, 멤버 모두)은 한 번으로 센다.
  let merged = 0;
  for (const group of groups) {
    const starts = group.memberIds.map((id) =>
      rows.filter((row) => row.studentId === id).map((row) => row.scheduledAt.getTime()));
    merged += sharedLessonStarts(starts).length * (group.memberIds.length - 1);
  }
  return rows.length - merged;
}

/**
 * .ics 생성용: 특정 학생의 미래 레슨 전체 조회.
 */
export async function getLessonsForCalendar(studentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  const db = createDb();
  const now = new Date();
  return db
    .select()
    .from(lessons)
    .where(and(eq(lessons.studentId, studentId), gte(lessons.scheduledAt, now)))
    .orderBy(asc(lessons.scheduledAt));
}

// ───────────────────────────────────────────────
// Admin: 레슨 생성
// ───────────────────────────────────────────────

export type ScheduledLesson = { id: string; scheduledAt: string };

export type CreateLessonState = { error?: string; success?: boolean; lesson?: ScheduledLesson };

function parseLessonScheduleInput(formData: FormData): { ok: true; value: Date } | { ok: false; error: string } {
  const scheduledAtStr = formData.get("scheduledAt");
  if (typeof scheduledAtStr !== "string" || !scheduledAtStr) {
    return { ok: false, error: "날짜와 시간을 입력해주세요." };
  }
  const scheduledAt = parseDateTimeInput(scheduledAtStr);
  if (!scheduledAt) return { ok: false, error: "유효하지 않은 날짜입니다." };
  return { ok: true, value: scheduledAt };
}

function revalidateLessonPaths(studentId: string): void {
  revalidatePath(`/dashboard/admin/students/${studentId}`);
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/student");
}

/**
 * 레슨 일정 생성 (Admin 전용).
 * @param studentId - 대상 학생 ID
 * @param _prev - useActionState 이전 상태
 * @param formData - { scheduledAt: ISO datetime string }
 */
export async function createLesson(
  studentId: string,
  _prev: CreateLessonState,
  formData: FormData,
): Promise<CreateLessonState> {
  await requireStudentTarget(studentId);
  const session = await requireAuth();

  const parsed = parseLessonScheduleInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  // "그룹 전체"(캔버스 UxReview1120Lessons ⑥): 그룹은 화면이 보낸 값이 아니라 이 학생의 지금 소속으로 정한다.
  if (formData.get(LESSON_WITH_GROUP_FIELD) === "1") {
    const groupId = await readStudentLessonGroupId(createDbContext(), studentId);
    if (!groupId) return { error: GROUP_CHANGED_ERROR };
    const created = await insertGroupLessons(session.user.id, groupId, parsed.value);
    if ("error" in created) return { error: created.error };
    const own = created.lessons.find((lesson) => lesson.studentId === studentId);
    if (!own) return { error: GROUP_CHANGED_ERROR };
    return { success: true, lesson: { id: own.id, scheduledAt: own.scheduledAt } };
  }

  const db = createDb();
  const id = crypto.randomUUID();
  await db.insert(lessons).values({
    id,
    studentId,
    scheduledAt: parsed.value,
  });
  await notifyPush(
    { kind: "profiles", profileIds: [studentId] },
    pushMessages.lessonScheduled({ lessonId: id, scheduledAt: parsed.value, changed: false }),
    { excludeProfileId: session.user.id },
  );

  // 연결된 원격 캘린더에 best-effort로 보낸다(실패해도 레슨 생성은 성공).
  await schedulePushStudentCalendarChanges(studentId);
  revalidateLessonPaths(studentId);
  return { success: true, lesson: { id, scheduledAt: parsed.value.toISOString() } };
}

export type CreateGroupLessonState = {
  error?: string;
  success?: boolean;
  lessons?: (ScheduledLesson & { studentId: string })[];
};

/**
 * 그룹레슨 만들기 (Admin 전용). 멤버마다 같은 시각 레슨을 하나씩 만든다(일정은 학생별 행, 2026-11-15 사용자 결정).
 */
export async function createGroupLesson(
  groupId: string,
  _prev: CreateGroupLessonState,
  formData: FormData,
): Promise<CreateGroupLessonState> {
  const session = await requireAdmin();
  const parsed = parseLessonScheduleInput(formData);
  if (!parsed.ok) return { error: parsed.error };
  const created = typeof groupId === "string" && groupId
    ? await insertGroupLessons(session.user.id, groupId, parsed.value)
    : { error: GROUP_NOT_FOUND_ERROR };
  if ("error" in created) return { error: created.error };
  return { success: true, lessons: created.lessons };
}

const GROUP_NOT_FOUND_ERROR = "그룹을 찾지 못했습니다. 목록을 새로고침해 주세요.";
const GROUP_CHANGED_ERROR = "그 사이 그룹이 바뀌었습니다. 목록을 새로고침해 주세요.";

/** 수강 중인 그룹 멤버마다 같은 시각 레슨을 하나씩 만든다. 호출 전에 관리자 권한을 확인한다. */
async function insertGroupLessons(
  actorId: string | undefined,
  groupId: string,
  scheduledAtValue: Date,
): Promise<{ lessons: (ScheduledLesson & { studentId: string })[] } | { error: string }> {
  const memberIds = await readLessonGroupMemberIds(createDbContext(), groupId);
  if (memberIds.length === 0) return { error: GROUP_NOT_FOUND_ERROR };

  const scheduledAt = documentEpochSeconds(scheduledAtValue);
  const created = memberIds.map((studentId) => ({ id: crypto.randomUUID(), studentId }));
  try {
    // 그 사이 멤버가 빠졌거나 학생이 아니게 되면 하나도 만들지 않는다.
    await executeDocumentStatementsAtomically(createDbContext(), created.flatMap((lesson) => [
      {
        query: `
          INSERT INTO lessons (id, student_id, scheduled_at)
          SELECT ?, member.student_id, ? FROM lesson_group_members AS member
          JOIN profiles AS profile ON profile.id = member.student_id AND ${activeStudentSql("profile")}
          WHERE member.student_id = ? AND member.group_id = ?
        `,
        params: [lesson.id, scheduledAt, lesson.studentId, groupId],
      },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
    ]));
  } catch (error) {
    if (String((error as Error)?.message ?? error).includes("DOCUMENT_BATCH_ABORT")) {
      return { error: GROUP_CHANGED_ERROR };
    }
    throw error;
  }
  for (const lesson of created) {
    await notifyPush(
      { kind: "profiles", profileIds: [lesson.studentId] },
      pushMessages.lessonScheduled({ lessonId: lesson.id, scheduledAt: scheduledAtValue, changed: false }),
      { excludeProfileId: actorId },
    );
    await schedulePushStudentCalendarChanges(lesson.studentId);
    revalidateLessonPaths(lesson.studentId);
  }
  return { lessons: created.map((lesson) => ({ ...lesson, scheduledAt: scheduledAtValue.toISOString() })) };
}

/**
 * 레슨 시간 변경 (Admin 전용). 대상 학생의 레슨만 바꾸고 결과를 상태로 돌려준다.
 */
export async function rescheduleLesson(
  lessonId: string,
  studentId: string,
  _prev: CreateLessonState,
  formData: FormData,
): Promise<CreateLessonState> {
  await requireStudentTarget(studentId);
  return writeLessonSchedule(lessonId, studentId, formData, await requireAuth());
}

/** 권한 확인을 마친 호출만 쓴다. 대상 학생의 레슨일 때만 시간을 바꾼다. */
async function writeLessonSchedule(
  lessonId: string,
  studentId: string,
  formData: FormData,
  actor: AuthSession,
): Promise<CreateLessonState> {
  const parsed = parseLessonScheduleInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  const movedByAdmin = actor.user.role === "admin";
  // 관리자가 그룹레슨을 옮기면 멤버 모두의 같은 시각 레슨을 함께, 학생은 본인 레슨만 옮긴다(2026-11-15 사용자 결정).
  const group = movedByAdmin ? await readGroupLessonTargets(createDbContext(), studentId, lessonId) : null;
  if (group && group.targets.length > 1) {
    const from = documentEpochSeconds(group.scheduledAt);
    const to = documentEpochSeconds(parsed.value);
    try {
      await executeDocumentStatementsAtomically(createDbContext(), group.targets.flatMap((target) => [
        {
          query: "UPDATE lessons SET scheduled_at = ? WHERE id = ? AND student_id = ? AND scheduled_at = ?",
          params: [to, target.lessonId, target.studentId, from],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      ]));
    } catch (error) {
      if (String((error as Error)?.message ?? error).includes("DOCUMENT_BATCH_ABORT")) {
        return { error: "그 사이 그룹레슨이 바뀌었습니다. 목록을 새로고침해 주세요." };
      }
      throw error;
    }
    for (const target of group.targets) {
      await notifyPush(
        { kind: "profiles", profileIds: [target.studentId] },
        pushMessages.lessonScheduled({ lessonId: target.lessonId, scheduledAt: parsed.value, changed: true }),
        { excludeProfileId: actor.user.id },
      );
      await schedulePushStudentCalendarChanges(target.studentId);
      revalidateLessonPaths(target.studentId);
    }
    return { success: true, lesson: { id: lessonId, scheduledAt: parsed.value.toISOString() } };
  }

  const db = createDb();
  const updated = await db
    .update(lessons)
    .set({ scheduledAt: parsed.value })
    .where(and(eq(lessons.id, lessonId), eq(lessons.studentId, studentId)))
    .returning({ id: lessons.id });
  if (updated.length === 0) return { error: "레슨을 찾을 수 없습니다. 목록을 새로고침해 주세요." };
  // 관리자가 옮기면 학생에게, 학생이 옮기면 관리자에게 알린다.
  await notifyPush(
    movedByAdmin ? { kind: "profiles", profileIds: [studentId] } : { kind: "role", role: "admin" },
    pushMessages.lessonScheduled({
      lessonId,
      scheduledAt: parsed.value,
      changed: true,
      toAdmin: !movedByAdmin,
      studentId,
      studentName: actor.user.name ?? null,
    }),
    { excludeProfileId: actor.user.id },
  );

  await schedulePushStudentCalendarChanges(studentId);
  revalidateLessonPaths(studentId);
  return { success: true, lesson: { id: lessonId, scheduledAt: parsed.value.toISOString() } };
}

/**
 * 캘린더에서 끌어 옮긴 레슨 시간을 저장한다. 관리자는 대상 학생의 레슨을, 학생은 본인 레슨을
 * 옮긴다(2026-10-26 사용자 결정). 실패는 상태로 돌려 화면이 원위치하게 한다.
 */
export async function moveLesson(
  lessonId: string,
  studentId: string,
  scheduledAt: string,
): Promise<CreateLessonState> {
  const session = await requireAuth();
  try {
    await requireStudentOwnerOrAdmin(session, studentId);
  } catch {
    return { error: "레슨을 찾을 수 없거나 권한이 없습니다." };
  }
  const formData = new FormData();
  formData.set("scheduledAt", scheduledAt);
  return writeLessonSchedule(lessonId, studentId, formData, session);
}

// ───────────────────────────────────────────────
// Admin: 레슨 삭제
// ───────────────────────────────────────────────

/**
 * 레슨 일정 삭제 (Admin 전용).
 */
export async function deleteLesson(lessonId: string, studentId: string) {
  await requireStudentTarget(studentId);
  // 그룹레슨이면 멤버 모두의 같은 시각 레슨을 함께 지운다(관리자 전용 경로).
  const group = await readGroupLessonTargets(createDbContext(), studentId, lessonId);
  const targets = group?.targets ?? [{ lessonId, studentId }];
  // 원격 사본을 지울 수 있게 link를 DELETED로 남기는 것과 레슨 삭제를 함께 commit한다.
  await executeDocumentStatementsAtomically(createDbContext(), targets.flatMap((target) => [
    markLinksDeletedStatement("LESSON", target.lessonId, target.studentId),
    { query: "DELETE FROM lessons WHERE id = ? AND student_id = ?", params: [target.lessonId, target.studentId] },
  ]));
  for (const target of targets) {
    await schedulePushStudentCalendarChanges(target.studentId);
    revalidateLessonPaths(target.studentId);
  }
}
