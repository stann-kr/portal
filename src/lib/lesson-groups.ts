/**
 * 그룹레슨(예: 2:1) 묶음. 과제·커리큘럼·레슨·제출·피드백은 학생별 행 그대로 두고 그룹은 묶어 보여 주기와
 * "한 번에 내기", 그룹 노트 권한에만 쓴다(2026-11-15 사용자 결정). 학생은 그룹 하나에만 속한다.
 * 관리자 권한 검사는 호출하는 server action이 먼저 한다.
 * 수강 종료한 학생은 그룹 자리(lesson_group_members)를 그대로 두지만 멤버 목록·인원·그룹 레슨 만들기·옮기기에서는 빠진다
 * (2026-11-18 사용자 결정). 복원하면 다시 멤버로 보인다.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import { lessonGroupMembers, lessonGroups, lessons, privateNotes, profiles } from "@/db/schema";
import {
  asDocumentReadDb,
  DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
  documentEpochSeconds,
  executeDocumentStatementsAtomically,
  type DocumentAtomicStatement,
} from "@/lib/document-lifecycle-atomic";
import {
  normalizeLessonGroupMemberIds,
  normalizeLessonGroupName,
  sharedLessonStarts,
  studentDisplayName,
  type DeleteLessonGroupResult,
  type LessonGroupSummary,
  type SaveLessonGroupResult,
  type StudentHomeLessonGroup,
  type StudentLessonGroup,
} from "@/lib/lesson-group-rules";
import { ACTIVE_ACCOUNT_STATUS, activeStudentSql, notArchivedStudentSql } from "@/lib/student-status";

export async function listLessonGroups(context: DbContext): Promise<LessonGroupSummary[]> {
  const db = asDocumentReadDb(context);
  const [groups, members] = await Promise.all([
    db.select({ id: lessonGroups.id, name: lessonGroups.name }).from(lessonGroups).where(isNull(lessonGroups.dissolvedAt)).orderBy(asc(lessonGroups.name), asc(lessonGroups.id)),
    db
      .select({ studentId: lessonGroupMembers.studentId, groupId: lessonGroupMembers.groupId })
      .from(lessonGroupMembers)
      .innerJoin(profiles, eq(profiles.id, lessonGroupMembers.studentId))
      .where(eq(profiles.accountStatus, ACTIVE_ACCOUNT_STATUS)),
  ]);
  const membersByGroup = new Map<string, string[]>();
  for (const member of members) {
    const list = membersByGroup.get(member.groupId) ?? [];
    list.push(member.studentId);
    membersByGroup.set(member.groupId, list);
  }
  return groups.map((group) => ({ ...group, memberIds: membersByGroup.get(group.id) ?? [] }));
}

/** 학생 한 명이 속한 그룹(없으면 null). 멤버 순서는 이름순이다. */
export async function readStudentLessonGroup(context: DbContext, studentId: string): Promise<StudentLessonGroup | null> {
  const db = asDocumentReadDb(context);
  const [membership] = await db
    .select({ groupId: lessonGroupMembers.groupId, name: lessonGroups.name })
    .from(lessonGroupMembers)
    .innerJoin(lessonGroups, eq(lessonGroups.id, lessonGroupMembers.groupId))
    .where(eq(lessonGroupMembers.studentId, studentId))
    .limit(1);
  if (!membership) return null;
  return { id: membership.groupId, name: membership.name, members: await readLessonGroupMembers(context, membership.groupId) };
}

async function readLessonGroupMembers(context: DbContext, groupId: string): Promise<StudentLessonGroup["members"]> {
  const rows = await asDocumentReadDb(context)
    .select({ id: profiles.id, displayName: profiles.displayName })
    .from(lessonGroupMembers)
    .innerJoin(profiles, eq(profiles.id, lessonGroupMembers.studentId))
    .where(and(eq(lessonGroupMembers.groupId, groupId), eq(profiles.accountStatus, ACTIVE_ACCOUNT_STATUS)));
  return rows
    .map((row) => ({ id: row.id, name: studentDisplayName(row.displayName) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko-KR") || a.id.localeCompare(b.id));
}

/**
 * 그룹 id로 이름과 멤버(이름순). 권한 확인은 부르는 쪽이 먼저 한다. 없으면 null.
 * 해제한 그룹은 `includeDissolved`일 때만 돌려준다(휴지통 노트 머리의 그룹 이름 등, 멤버는 비어 있다).
 */
export async function readLessonGroupById(
  context: DbContext,
  groupId: string,
  options: { includeDissolved?: boolean } = {},
): Promise<(StudentLessonGroup & { dissolved: boolean }) | null> {
  const [group] = await asDocumentReadDb(context)
    .select({ id: lessonGroups.id, name: lessonGroups.name, dissolvedAt: lessonGroups.dissolvedAt })
    .from(lessonGroups)
    .where(options.includeDissolved ? eq(lessonGroups.id, groupId) : and(eq(lessonGroups.id, groupId), isNull(lessonGroups.dissolvedAt)))
    .limit(1);
  if (!group) return null;
  return { id: group.id, name: group.name, dissolved: group.dissolvedAt !== null, members: await readLessonGroupMembers(context, group.id) };
}

/**
 * 학생 홈용 그룹 정보. 함께하는 학생은 이름만, 그 학생의 레슨은 시각만 읽어 "모두 같은 시각"인 레슨을 고른다
 * (다른 학생의 레슨 id·메모·외부 일정은 주지 않는다). `from` 이후 레슨만 본다.
 */
export async function readStudentHomeLessonGroup(
  context: DbContext,
  studentId: string,
  from: Date,
): Promise<StudentHomeLessonGroup | null> {
  const group = await readStudentLessonGroup(context, studentId);
  if (!group) return null;
  const memberIds = group.members.map((member) => member.id);
  const rows = await asDocumentReadDb(context)
    .select({ studentId: lessons.studentId, scheduledAt: lessons.scheduledAt })
    .from(lessons)
    .where(and(inArray(lessons.studentId, memberIds), gte(lessons.scheduledAt, from)));
  const startsByMember = new Map<string, number[]>(memberIds.map((id) => [id, []]));
  for (const row of rows) startsByMember.get(row.studentId)?.push(row.scheduledAt.getTime());
  return {
    name: group.name,
    partnerNames: group.members.filter((member) => member.id !== studentId).map((member) => member.name),
    sharedLessonStarts: sharedLessonStarts([...startsByMember.values()]),
  };
}

/** 수강 중인 그룹 멤버 id(이름순 아님, 없으면 빈 배열). */
export async function readLessonGroupMemberIds(context: DbContext, groupId: string): Promise<string[]> {
  const rows = await asDocumentReadDb(context)
    .select({ studentId: lessonGroupMembers.studentId })
    .from(lessonGroupMembers)
    .innerJoin(profiles, eq(profiles.id, lessonGroupMembers.studentId))
    .where(and(eq(lessonGroupMembers.groupId, groupId), eq(profiles.accountStatus, ACTIVE_ACCOUNT_STATUS)))
    .orderBy(asc(lessonGroupMembers.studentId));
  return rows.map((row) => row.studentId);
}

export type GroupLessonTarget = { lessonId: string; studentId: string };

/**
 * 관리자가 레슨 하나를 옮기거나 지울 때 함께 바꿀 레슨들. 그 학생의 그룹 멤버 모두에게 같은 시각 레슨이 있으면
 * 그룹레슨이라 멤버별 레슨을 하나씩 돌려주고, 아니면 그 레슨만 돌려준다(2026-11-15 사용자 결정: 관리자 이동은 모두,
 * 학생 이동은 본인만). 레슨이 없으면 null.
 */
export async function readGroupLessonTargets(
  context: DbContext,
  studentId: string,
  lessonId: string,
): Promise<{ scheduledAt: Date; targets: GroupLessonTarget[] } | null> {
  const db = asDocumentReadDb(context);
  const [lesson] = await db
    .select({ scheduledAt: lessons.scheduledAt })
    .from(lessons)
    .where(and(eq(lessons.id, lessonId), eq(lessons.studentId, studentId)))
    .limit(1);
  if (!lesson) return null;
  const self = { scheduledAt: lesson.scheduledAt, targets: [{ lessonId, studentId }] };
  const groupId = await readStudentLessonGroupId(context, studentId);
  if (!groupId) return self;
  // 수강 종료한 멤버는 빼고 본다(그 뒤에 만든 그룹 레슨에는 그 학생 몫이 없다).
  const members = await db
    .select({ studentId: lessonGroupMembers.studentId })
    .from(lessonGroupMembers)
    .innerJoin(profiles, eq(profiles.id, lessonGroupMembers.studentId))
    .where(and(eq(lessonGroupMembers.groupId, groupId), eq(profiles.accountStatus, ACTIVE_ACCOUNT_STATUS)));
  const others = members.map((member) => member.studentId).filter((id) => id !== studentId);
  if (others.length === 0) return self;
  const rows = await db
    .select({ id: lessons.id, studentId: lessons.studentId })
    .from(lessons)
    .where(and(inArray(lessons.studentId, others), eq(lessons.scheduledAt, lesson.scheduledAt)))
    .orderBy(asc(lessons.id));
  const byStudent = new Map<string, string>();
  for (const row of rows) if (!byStudent.has(row.studentId)) byStudent.set(row.studentId, row.id);
  if (others.some((id) => !byStudent.has(id))) return self;
  return {
    scheduledAt: lesson.scheduledAt,
    targets: [self.targets[0], ...others.map((id) => ({ lessonId: byStudent.get(id)!, studentId: id }))],
  };
}

/** 학생이 속한 그룹 id(없으면 null). 권한 판정용. */
export async function readStudentLessonGroupId(context: DbContext, studentId: string): Promise<string | null> {
  const [row] = await asDocumentReadDb(context)
    .select({ groupId: lessonGroupMembers.groupId })
    .from(lessonGroupMembers)
    .where(eq(lessonGroupMembers.studentId, studentId))
    .limit(1);
  return row?.groupId ?? null;
}

/**
 * 그룹을 만들거나(groupId null) 이름·멤버를 바꾼다. 다른 그룹에 이미 있는 학생이 섞이면 TAKEN으로 거절한다.
 * 미리 읽어 친절한 오류를 돌려주고, 사이에 바뀐 경우는 같은 batch의 조건 확인이 전체를 되돌린다(CONFLICT).
 */
export async function saveLessonGroup(
  context: DbContext,
  input: { groupId: string | null; name: string; memberIds: string[]; now: Date; newId: () => string },
): Promise<SaveLessonGroupResult> {
  const name = normalizeLessonGroupName(input.name);
  if (!name) return { ok: false, error: "NAME" };
  const memberIds = normalizeLessonGroupMemberIds(input.memberIds);
  if (!memberIds) return { ok: false, error: "MEMBERS" };

  const db = asDocumentReadDb(context);
  const [roles, membershipRows, existing] = await Promise.all([
    db
      .select({ id: profiles.id, role: profiles.role, accountStatus: profiles.accountStatus })
      .from(profiles)
      .where(inArray(profiles.id, memberIds)),
    db
      .select({ studentId: lessonGroupMembers.studentId, groupId: lessonGroupMembers.groupId })
      .from(lessonGroupMembers)
      .where(inArray(lessonGroupMembers.studentId, memberIds)),
    input.groupId
      ? db.select({ id: lessonGroups.id }).from(lessonGroups).where(and(eq(lessonGroups.id, input.groupId), isNull(lessonGroups.dissolvedAt))).limit(1)
      : Promise.resolve([]),
  ]);
  if (input.groupId && existing.length === 0) return { ok: false, error: "NOT_FOUND" };
  if (
    roles.length !== memberIds.length
    || roles.some((row) => row.role !== "student" || row.accountStatus !== ACTIVE_ACCOUNT_STATUS)
  ) {
    return { ok: false, error: "NOT_STUDENT" };
  }
  const taken = membershipRows.filter((row) => row.groupId !== input.groupId).map((row) => row.studentId);
  if (taken.length > 0) return { ok: false, error: "TAKEN", takenStudentIds: taken };

  const groupId = input.groupId ?? input.newId();
  const now = documentEpochSeconds(input.now);
  const statements: DocumentAtomicStatement[] = [];
  if (input.groupId) {
    statements.push(
      { query: "UPDATE lesson_groups SET name = ?, updated_at = ? WHERE id = ? AND dissolved_at IS NULL", params: [name, now, groupId] },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      {
        // 고르는 목록에 없는 수강 종료 멤버는 빠진 것이 아니므로 자리를 남긴다.
        query: `DELETE FROM lesson_group_members WHERE group_id = ? AND student_id NOT IN (${memberIds.map(() => "?").join(", ")})
          AND ${notArchivedStudentSql("student_id")}`,
        params: [groupId, ...memberIds],
      },
    );
  } else {
    statements.push({
      query: "INSERT INTO lesson_groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      params: [groupId, name, now, now],
    });
  }
  for (const studentId of memberIds) {
    // 이미 이 그룹 멤버면 그대로 두고, 아니면 학생 계정이고 다른 그룹에 없을 때만 넣는다.
    statements.push(
      {
        query: `
          INSERT INTO lesson_group_members (student_id, group_id, joined_at)
          SELECT profile.id, ?, ? FROM profiles AS profile
          WHERE profile.id = ? AND ${activeStudentSql("profile")}
            AND NOT EXISTS (SELECT 1 FROM lesson_group_members WHERE student_id = profile.id)
        `,
        params: [groupId, now, studentId],
      },
      {
        query:
          "INSERT INTO document_batch_abort_guard (reason) SELECT 'CONDITIONAL_WRITE' " +
          "WHERE NOT EXISTS (SELECT 1 FROM lesson_group_members WHERE student_id = ? AND group_id = ?)",
        params: [studentId, groupId],
      },
    );
  }
  if (input.groupId && now !== null) statements.push(...groupEventCopyStatements(groupId, memberIds, membershipRows, now));
  try {
    await executeDocumentStatementsAtomically(context, statements);
  } catch (error) {
    if (isConditionalAbort(error)) return { ok: false, error: "CONFLICT" };
    throw error;
  }
  return { ok: true, id: groupId };
}

/**
 * 그룹을 해제한다.
 * - 휴지통 밖 그룹 노트가 있으면 해제하지 않는다(멤버가 함께 쓰는 노트를 먼저 휴지통에 넣어야 한다).
 * - 휴지통에만 그룹 노트가 있으면 노트는 30일 보존 규칙대로 남기고(노트 FK restrict), 멤버·그룹 캘린더 원본·매핑을 지운 뒤
 *   `dissolved_at`만 채운다. 마지막 휴지통 노트를 영구 삭제하면 `deleteDissolvedLessonGroupIfEmpty`가 행을 지운다.
 * - 노트가 없으면 행을 지운다(멤버·캘린더는 FK cascade와 같은 batch의 DELETE로 함께 지운다).
 */
export async function deleteLessonGroup(context: DbContext, groupId: string, now: Date): Promise<DeleteLessonGroupResult> {
  const db = asDocumentReadDb(context);
  const [[group], noteRows] = await Promise.all([
    db.select({ id: lessonGroups.id }).from(lessonGroups).where(and(eq(lessonGroups.id, groupId), isNull(lessonGroups.dissolvedAt))).limit(1),
    db
      .select({ trashed: sql<number>`${privateNotes.deletedAt} IS NOT NULL`, value: sql<number>`count(*)` })
      .from(privateNotes)
      .where(eq(privateNotes.groupId, groupId))
      .groupBy(sql`${privateNotes.deletedAt} IS NOT NULL`),
  ]);
  if (!group) return { ok: false, error: "NOT_FOUND" };
  const activeNotes = Number(noteRows.find((row) => !Number(row.trashed))?.value ?? 0);
  const trashedNotes = Number(noteRows.find((row) => Number(row.trashed))?.value ?? 0);
  if (activeNotes > 0) return { ok: false, error: "HAS_NOTES", noteCount: activeNotes };
  const statements: DocumentAtomicStatement[] = trashedNotes > 0
    ? [
        {
          query: "UPDATE lesson_groups SET dissolved_at = ?, updated_at = MAX(updated_at, ?) WHERE id = ? AND dissolved_at IS NULL",
          params: [documentEpochSeconds(now), documentEpochSeconds(now), groupId],
        },
        DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
        {
          // 사이에 휴지통 노트가 복원됐으면 해제하지 않는다.
          query:
            "INSERT INTO document_batch_abort_guard (reason) SELECT 'CONDITIONAL_WRITE' " +
            "WHERE EXISTS (SELECT 1 FROM private_notes WHERE group_id = ? AND deleted_at IS NULL)",
          params: [groupId],
        },
        { query: "DELETE FROM lesson_group_members WHERE group_id = ?", params: [groupId] },
        { query: "DELETE FROM calendar_mappings WHERE group_id = ?", params: [groupId] },
        { query: "DELETE FROM calendar_group_events WHERE group_id = ?", params: [groupId] },
      ]
    : [
        { query: "DELETE FROM lesson_group_members WHERE group_id = ?", params: [groupId] },
        { query: "DELETE FROM lesson_groups WHERE id = ?", params: [groupId] },
      ];
  try {
    await executeDocumentStatementsAtomically(context, statements);
  } catch (error) {
    // 사이에 그룹 노트가 생기거나 복원되면 FK restrict·조건 guard가 막는다.
    if (isConditionalAbort(error) || /FOREIGN KEY/i.test(String((error as Error)?.message ?? error))) {
      return { ok: false, error: "HAS_NOTES", noteCount: Math.max(1, activeNotes) };
    }
    throw error;
  }
  return trashedNotes > 0 ? { ok: true, keptTrashedNotes: trashedNotes } : { ok: true };
}

/** 해제한 그룹에 노트가 하나도 남지 않았으면 행을 지운다(노트 영구 삭제 뒤 부른다). 해제하지 않은 그룹은 건드리지 않는다. */
export async function deleteDissolvedLessonGroupIfEmpty(context: DbContext, groupId: string): Promise<void> {
  await executeDocumentStatementsAtomically(context, [
    {
      query:
        "DELETE FROM lesson_groups WHERE id = ? AND dissolved_at IS NOT NULL " +
        "AND NOT EXISTS (SELECT 1 FROM private_notes WHERE group_id = ?)",
      params: [groupId, groupId],
    },
  ]);
}

/** 휴지통에 그룹 노트가 있는 그룹(해제한 그룹 포함). 관리자 노트 휴지통의 그룹 고르기에 쓴다. 권한 확인은 부르는 쪽이 한다. */
export async function listLessonGroupsWithTrashedNotes(
  context: DbContext,
): Promise<{ id: string; name: string; dissolved: boolean; trashedCount: number }[]> {
  const rows = await asDocumentReadDb(context)
    .select({
      id: lessonGroups.id,
      name: lessonGroups.name,
      dissolvedAt: lessonGroups.dissolvedAt,
      trashedCount: sql<number>`count(${privateNotes.id})`,
    })
    .from(lessonGroups)
    .innerJoin(privateNotes, and(eq(privateNotes.groupId, lessonGroups.id), isNotNull(privateNotes.deletedAt)))
    .groupBy(lessonGroups.id)
    .orderBy(asc(lessonGroups.name), asc(lessonGroups.id));
  return rows.map((row) => ({ id: row.id, name: row.name, dissolved: row.dissolvedAt !== null, trashedCount: Number(row.trashedCount) }));
}

/**
 * 그룹 캘린더에서 가져온 그룹 일정 사본을 멤버 변경에 맞춘다(그룹 캘린더, 2026-11-16).
 * - 빠진 멤버의 사본은 원본과의 연결만 끊어 개인 일정으로 남긴다(그룹 해제와 같은 규칙).
 * - 새 멤버에게는 아직 시작하지 않은 그룹 일정의 사본을 만든다. 원래 멤버가 지운 사본은 다시 만들지 않는다.
 */
function groupEventCopyStatements(
  groupId: string,
  memberIds: readonly string[],
  membershipRows: readonly { studentId: string; groupId: string }[],
  now: number,
): DocumentAtomicStatement[] {
  const existing = new Set(membershipRows.filter((row) => row.groupId === groupId).map((row) => row.studentId));
  const added = memberIds.filter((id) => !existing.has(id));
  const statements: DocumentAtomicStatement[] = [{
    query: `
      UPDATE calendar_events SET group_event_id = NULL
      WHERE group_event_id IN (SELECT id FROM calendar_group_events WHERE group_id = ?)
        AND user_id NOT IN (SELECT student_id FROM lesson_group_members WHERE group_id = ?)
    `,
    params: [groupId, groupId],
  }];
  for (const studentId of added) {
    statements.push({
      query: `
        INSERT INTO calendar_events (id, user_id, event_type, title, start_time, end_time, description, group_event_id, created_at)
        SELECT lower(hex(randomblob(16))), ?, 'NOTE', source.title, source.start_time, source.end_time, source.description, source.id, ?
        FROM calendar_group_events AS source
        WHERE source.group_id = ? AND source.start_time >= ?
          AND NOT EXISTS (SELECT 1 FROM calendar_events AS copy WHERE copy.group_event_id = source.id AND copy.user_id = ?)
      `,
      params: [studentId, now, groupId, now, studentId],
    });
  }
  return statements;
}

function isConditionalAbort(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? error) + String((error as { cause?: unknown })?.cause ?? "");
  return text.includes("DOCUMENT_BATCH_ABORT");
}
