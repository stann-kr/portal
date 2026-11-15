/**
 * 그룹레슨(예: 2:1) 묶음. 과제·커리큘럼·레슨·제출·피드백은 학생별 행 그대로 두고 그룹은 묶어 보여 주기와
 * "한 번에 내기", 그룹 노트 권한에만 쓴다(2026-11-15 사용자 결정). 학생은 그룹 하나에만 속한다.
 * 관리자 권한 검사는 호출하는 server action이 먼저 한다.
 */
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
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

export async function listLessonGroups(context: DbContext): Promise<LessonGroupSummary[]> {
  const db = asDocumentReadDb(context);
  const [groups, members] = await Promise.all([
    db.select({ id: lessonGroups.id, name: lessonGroups.name }).from(lessonGroups).orderBy(asc(lessonGroups.name), asc(lessonGroups.id)),
    db.select({ studentId: lessonGroupMembers.studentId, groupId: lessonGroupMembers.groupId }).from(lessonGroupMembers),
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
    .where(eq(lessonGroupMembers.groupId, groupId));
  return rows
    .map((row) => ({ id: row.id, name: studentDisplayName(row.displayName) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko-KR") || a.id.localeCompare(b.id));
}

/** 그룹 id로 이름과 멤버(이름순). 권한 확인은 부르는 쪽이 먼저 한다. 없으면 null. */
export async function readLessonGroupById(context: DbContext, groupId: string): Promise<StudentLessonGroup | null> {
  const [group] = await asDocumentReadDb(context)
    .select({ id: lessonGroups.id, name: lessonGroups.name })
    .from(lessonGroups)
    .where(eq(lessonGroups.id, groupId))
    .limit(1);
  if (!group) return null;
  return { ...group, members: await readLessonGroupMembers(context, group.id) };
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

/** 그룹 멤버 id(이름순 아님, 없으면 빈 배열). */
export async function readLessonGroupMemberIds(context: DbContext, groupId: string): Promise<string[]> {
  const rows = await asDocumentReadDb(context)
    .select({ studentId: lessonGroupMembers.studentId })
    .from(lessonGroupMembers)
    .where(eq(lessonGroupMembers.groupId, groupId))
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
  const members = await db
    .select({ studentId: lessonGroupMembers.studentId })
    .from(lessonGroupMembers)
    .where(eq(lessonGroupMembers.groupId, groupId));
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
    db.select({ id: profiles.id, role: profiles.role }).from(profiles).where(inArray(profiles.id, memberIds)),
    db
      .select({ studentId: lessonGroupMembers.studentId, groupId: lessonGroupMembers.groupId })
      .from(lessonGroupMembers)
      .where(inArray(lessonGroupMembers.studentId, memberIds)),
    input.groupId
      ? db.select({ id: lessonGroups.id }).from(lessonGroups).where(eq(lessonGroups.id, input.groupId)).limit(1)
      : Promise.resolve([]),
  ]);
  if (input.groupId && existing.length === 0) return { ok: false, error: "NOT_FOUND" };
  if (roles.length !== memberIds.length || roles.some((row) => row.role !== "student")) {
    return { ok: false, error: "NOT_STUDENT" };
  }
  const taken = membershipRows.filter((row) => row.groupId !== input.groupId).map((row) => row.studentId);
  if (taken.length > 0) return { ok: false, error: "TAKEN", takenStudentIds: taken };

  const groupId = input.groupId ?? input.newId();
  const now = documentEpochSeconds(input.now);
  const statements: DocumentAtomicStatement[] = [];
  if (input.groupId) {
    statements.push(
      { query: "UPDATE lesson_groups SET name = ?, updated_at = ? WHERE id = ?", params: [name, now, groupId] },
      DOCUMENT_CONDITIONAL_WRITE_SENTINEL,
      {
        query: `DELETE FROM lesson_group_members WHERE group_id = ? AND student_id NOT IN (${memberIds.map(() => "?").join(", ")})`,
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
          WHERE profile.id = ? AND profile.role = 'student'
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
  try {
    await executeDocumentStatementsAtomically(context, statements);
  } catch (error) {
    if (isConditionalAbort(error)) return { ok: false, error: "CONFLICT" };
    throw error;
  }
  return { ok: true, id: groupId };
}

/** 그룹 노트(휴지통 포함)가 남아 있으면 지우지 않는다. 멤버십은 FK cascade와 같은 batch의 DELETE로 함께 지운다. */
export async function deleteLessonGroup(context: DbContext, groupId: string): Promise<DeleteLessonGroupResult> {
  const db = asDocumentReadDb(context);
  const [[group], [notes]] = await Promise.all([
    db.select({ id: lessonGroups.id }).from(lessonGroups).where(eq(lessonGroups.id, groupId)).limit(1),
    db.select({ value: sql<number>`count(*)` }).from(privateNotes).where(eq(privateNotes.groupId, groupId)),
  ]);
  if (!group) return { ok: false, error: "NOT_FOUND" };
  const noteCount = Number(notes?.value ?? 0);
  if (noteCount > 0) return { ok: false, error: "HAS_NOTES", noteCount };
  try {
    await executeDocumentStatementsAtomically(context, [
      { query: "DELETE FROM lesson_group_members WHERE group_id = ?", params: [groupId] },
      { query: "DELETE FROM lesson_groups WHERE id = ?", params: [groupId] },
    ]);
  } catch (error) {
    // 사이에 그룹 노트가 생기면 FK restrict가 막는다.
    if (/FOREIGN KEY/i.test(String((error as Error)?.message ?? error))) {
      return { ok: false, error: "HAS_NOTES", noteCount: 1 };
    }
    throw error;
  }
  return { ok: true };
}

function isConditionalAbort(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? error) + String((error as { cause?: unknown })?.cause ?? "");
  return text.includes("DOCUMENT_BATCH_ABORT");
}
