/**
 * @file src/lib/actions/lessonGroups.ts
 * @description 그룹레슨 묶음 server action. 만들기·고치기·해제는 관리자만, 학생은 본인 그룹의 이름과
 * 멤버 표시 이름만 읽는다(이메일·다른 학생의 기록은 주지 않는다). 규칙은 src/lib/lesson-groups.ts에 있다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb, createDbContext } from "@/db/client";
import { listActiveStudentProfiles } from "@/lib/active-profile";
import { requireAdmin, requireAuth, requireStudentOwnerOrAdmin, requireStudentTarget } from "@/lib/auth-guard";
import {
  restoreGroupCalendarChannels,
  schedulePushStudentsCalendarChanges,
  stopGroupCalendarChannels,
} from "@/lib/calendar-sync/sync-runner";
import {
  deleteLessonGroup,
  listLessonGroups,
  readLessonGroupMemberIds,
  readStudentHomeLessonGroup,
  readStudentLessonGroup,
  saveLessonGroup,
} from "@/lib/lesson-groups";
import {
  normalizeLessonGroupMemberIds,
  type LessonGroupSummary,
  type StudentHomeLessonGroup,
  type StudentLessonGroup,
} from "@/lib/lesson-group-rules";

export type LessonGroupWriteResult = { ok: true; id?: string; keptTrashedNotes?: number } | { ok: false; error: string };

function revalidateGroups(): void {
  revalidatePath("/dashboard", "layout");
}

export async function getLessonGroups(): Promise<LessonGroupSummary[]> {
  await requireAdmin();
  return listLessonGroups(createDbContext());
}

/** 학생 본인(또는 관리자가 그 학생으로) 보는 그룹. 그룹이 없으면 null. */
export async function getStudentLessonGroup(studentId: string): Promise<StudentLessonGroup | null> {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  return readStudentLessonGroup(createDbContext(), studentId);
}

/**
 * 관리자 학생 상세 개요: 이 학생의 레슨 중 그룹 멤버 모두 같은 시각인 레슨의 시작(epoch ms, 캔버스 UxReview1120Lessons ⑤).
 * 그룹이 없으면 빈 배열. 함께하는 학생의 레슨은 시각만 본다.
 */
export async function getStudentGroupLessonStarts(studentId: string): Promise<number[]> {
  await requireStudentTarget(studentId);
  const group = await readStudentHomeLessonGroup(createDbContext(), studentId, new Date(0));
  return group?.sharedLessonStarts ?? [];
}

/** 로그인한 학생 본인의 홈용 그룹 정보(지금 이후 레슨 기준). 학생이 아니거나 그룹이 없으면 null. */
export async function getMyHomeLessonGroup(now: Date = new Date()): Promise<StudentHomeLessonGroup | null> {
  const session = await requireAuth();
  if (session.user.role !== "student" || !session.user.id) return null;
  return readStudentHomeLessonGroup(createDbContext(), session.user.id, now);
}

export async function saveLessonGroupAction(input: {
  groupId: string | null;
  name: string;
  memberIds: string[];
}): Promise<LessonGroupWriteResult> {
  await requireAdmin();
  const memberIds = normalizeLessonGroupMemberIds(input?.memberIds);
  if (!memberIds) return { ok: false, error: "학생을 2명 이상 골라 주세요." };
  const activeStudents = await listActiveStudentProfiles(createDb());
  const activeIds = new Set(activeStudents.map((student) => student.id));
  if (memberIds.some((id) => !activeIds.has(id))) {
    return { ok: false, error: "고를 수 없는 학생이 있습니다. 목록을 새로 고쳐 주세요." };
  }
  const groupId = typeof input.groupId === "string" && input.groupId ? input.groupId : null;
  const previousMemberIds = groupId ? await readLessonGroupMemberIds(createDbContext(), groupId) : [];
  const result = await saveLessonGroup(createDbContext(), {
    groupId,
    name: input.name,
    memberIds,
    now: new Date(),
    newId: () => crypto.randomUUID(),
  });
  if (!result.ok) {
    const names = new Map(activeStudents.map((student) => [student.id, student.displayName?.trim() || student.email]));
    switch (result.error) {
      case "NAME": return { ok: false, error: "그룹 이름을 1–60자로 적어 주세요." };
      case "MEMBERS": return { ok: false, error: "학생을 2명 이상 골라 주세요." };
      case "NOT_STUDENT": return { ok: false, error: "고를 수 없는 학생이 있습니다. 목록을 새로 고쳐 주세요." };
      case "TAKEN": {
        const taken = (result.takenStudentIds ?? []).map((id) => names.get(id) ?? "학생").join(", ");
        return { ok: false, error: `${taken}은(는) 이미 다른 그룹에 있습니다.` };
      }
      case "NOT_FOUND": return { ok: false, error: "그룹이 이미 해제되었습니다." };
      case "CONFLICT": return { ok: false, error: "그 사이 그룹이 바뀌었습니다. 다시 시도해 주세요." };
    }
  }
  revalidateGroups();
  // 멤버가 바뀌면 그룹레슨(멤버 모두 같은 시각)이 달라진다. 그룹 캘린더와 빠지거나 들어온 학생의 개인 캘린더를 맞춘다.
  await schedulePushStudentsCalendarChanges([...previousMemberIds, ...memberIds]);
  return { ok: true, id: result.id };
}

export async function deleteLessonGroupAction(groupId: string): Promise<LessonGroupWriteResult> {
  await requireAdmin();
  if (typeof groupId !== "string" || !groupId) return { ok: false, error: "그룹을 찾지 못했습니다." };
  const memberIds = await readLessonGroupMemberIds(createDbContext(), groupId);
  // 그룹을 지우면 그룹 캘린더 매핑이 cascade로 지워진다. 그 전에 Google 변경 알림을 멈춘다.
  await stopGroupCalendarChannels(groupId);
  const result = await deleteLessonGroup(createDbContext(), groupId, new Date());
  if (!result.ok) {
    // 그룹과 그룹 캘린더 매핑이 남았으니 멈춘 Google 변경 알림을 되돌린다.
    if (result.error === "HAS_NOTES") await restoreGroupCalendarChannels(groupId);
    return result.error === "HAS_NOTES"
      ? { ok: false, error: `그룹 노트 ${result.noteCount}개가 아직 쓰이고 있어 해제할 수 없습니다. 그룹 노트를 휴지통에 넣은 뒤 해제해 주세요(휴지통 노트는 그대로 보존됩니다).` }
      : { ok: false, error: "그룹이 이미 해제되었습니다." };
  }
  revalidateGroups();
  // 그룹 캘린더가 없어졌으니 그룹레슨을 멤버 개인 캘린더로 다시 올린다.
  await schedulePushStudentsCalendarChanges(memberIds);
  return result.keptTrashedNotes ? { ok: true, keptTrashedNotes: result.keptTrashedNotes } : { ok: true };
}
