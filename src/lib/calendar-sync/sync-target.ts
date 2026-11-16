/**
 * 동기화 엔진의 대상(학생 한 명 또는 레슨 그룹 하나)과 그룹레슨 판정. DB 읽기만 한다.
 *
 * 그룹 캘린더(2026-11-16 사용자 결정):
 * - 그룹레슨 = 멤버(2명 이상) 모두에게 같은 시작 시각의 포탈 레슨이 있는 시각. 관리자 일정의 합쳐 보기와 같은 규칙이다.
 * - 그룹 캘린더의 그룹레슨 일정 하나는 첫 멤버(학생 id 순) 레슨 id를 기준(link local_id·portalRef)으로 삼는다.
 * - 그룹에 그룹 캘린더가 하나라도 있으면 그룹레슨과 그룹 일정 사본은 멤버 개인 캘린더에 올리지 않는다.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { calendarMappings, lessonGroupMembers, lessons } from "@/db/schema";

export type SyncTarget =
  | {
    kind: "student";
    studentId: string;
    /**
     * 학생이 속한 그룹에 그룹 캘린더가 있으면 그 그룹의 멤버 id(학생 id 순, 2명 이상). 이때 그룹레슨은 개인 캘린더에서 뺀다.
     * 없으면 null.
     */
    groupLessonMemberIds: string[] | null;
  }
  | { kind: "group"; groupId: string; memberIds: string[] };

export type MemberLesson = { id: string; studentId: string; start: Date };

export async function readGroupMemberIds(db: DrizzleDb, groupId: string): Promise<string[]> {
  const rows = await db
    .select({ studentId: lessonGroupMembers.studentId })
    .from(lessonGroupMembers)
    .where(eq(lessonGroupMembers.groupId, groupId))
    .orderBy(asc(lessonGroupMembers.studentId));
  return rows.map((row) => row.studentId);
}

/** 매핑 대상 읽기. 학생 매핑이면 그 학생 그룹에 그룹 캘린더가 있는지도 함께 본다. */
export async function loadSyncTarget(db: DrizzleDb, mapping: { studentId: string | null; groupId: string | null }): Promise<SyncTarget | null> {
  if (mapping.groupId) return { kind: "group", groupId: mapping.groupId, memberIds: await readGroupMemberIds(db, mapping.groupId) };
  if (!mapping.studentId) return null;
  const [membership] = await db
    .select({ groupId: lessonGroupMembers.groupId })
    .from(lessonGroupMembers)
    .where(eq(lessonGroupMembers.studentId, mapping.studentId))
    .limit(1);
  if (!membership) return { kind: "student", studentId: mapping.studentId, groupLessonMemberIds: null };
  const [groupMapping] = await db
    .select({ id: calendarMappings.id })
    .from(calendarMappings)
    .where(eq(calendarMappings.groupId, membership.groupId))
    .limit(1);
  if (!groupMapping) return { kind: "student", studentId: mapping.studentId, groupLessonMemberIds: null };
  const memberIds = await readGroupMemberIds(db, membership.groupId);
  return { kind: "student", studentId: mapping.studentId, groupLessonMemberIds: memberIds.length >= 2 ? memberIds : null };
}

/** 멤버들의 포탈 레슨(시각 필터 선택). 멤버는 적고(2~4명) 레슨도 학생당 수백 개 안이라 통째로 읽는다. */
export async function loadMemberLessons(db: DrizzleDb, memberIds: string[], start?: Date): Promise<MemberLesson[]> {
  if (memberIds.length === 0) return [];
  const rows = await db
    .select({ id: lessons.id, studentId: lessons.studentId, scheduledAt: lessons.scheduledAt })
    .from(lessons)
    .where(start ? and(inArray(lessons.studentId, memberIds), eq(lessons.scheduledAt, start)) : inArray(lessons.studentId, memberIds))
    .orderBy(asc(lessons.scheduledAt), asc(lessons.id));
  return rows.map((row) => ({ id: row.id, studentId: row.studentId, start: row.scheduledAt }));
}

/**
 * 시작 시각(ms) → 멤버 순서(memberIds)대로 그 시각의 레슨 하나씩. 멤버 모두에게 있는 시각만 담는다(2명 이상일 때만).
 * 한 학생이 같은 시각 레슨을 둘 가지면 id가 앞선 것 하나만 쓴다.
 */
export function sharedGroupLessons(rows: readonly MemberLesson[], memberIds: readonly string[]): Map<number, MemberLesson[]> {
  const result = new Map<number, MemberLesson[]>();
  if (memberIds.length < 2) return result;
  const byStart = new Map<number, Map<string, MemberLesson>>();
  for (const row of rows) {
    const key = row.start.getTime();
    const bucket = byStart.get(key) ?? new Map<string, MemberLesson>();
    const current = bucket.get(row.studentId);
    if (!current || row.id < current.id) bucket.set(row.studentId, row);
    byStart.set(key, bucket);
  }
  for (const [start, bucket] of byStart) {
    if (!memberIds.every((id) => bucket.has(id))) continue;
    result.set(start, memberIds.map((id) => bucket.get(id)!));
  }
  return result;
}
