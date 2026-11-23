/**
 * @file src/lib/actions/guideNoteQuote.ts
 * @description 가이드 글을 학생 노트에 인용으로 담는 server action(2026-11-16 사용자 결정).
 *
 * - 담을 노트 고르기: 학생은 내가 고칠 수 있는 노트(내가 쓴 내 노트·내 그룹 노트)만, 관리자는 학생 또는 그룹을 고르고
 *   그 공간의 노트를 받는다. 휴지통 노트는 빠진다.
 * - 관리자가 고른 페이지를 학생(그룹은 멤버 일부)이 볼 수 없으면 그 학생들을 알려 주고, 원하면 함께 연다(결정 C).
 * - 노트 편집기의 "가이드 인용" 패널: 노트의 학생(그룹 노트는 멤버 모두)에게 열린 페이지만 준다.
 *
 * 인용 글 자체는 노트 편집기(공동 편집 문서)에 넣는다. 열린 편집기의 문서가 원본이라 서버가 노트 HTML을 직접 고치지 않는다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { createDb, createDbContext, type DbContext } from "@/db/client";
import { privateNotes } from "@/db/schema";
import { listActiveStudentProfiles } from "@/lib/active-profile";
import { requireAdmin, requireAuth, requireStudentOwnerOrAdmin, requireStudentTarget, type AuthSession } from "@/lib/auth-guard";
import {
  canViewGuidePage,
  readStudentGuideAccess,
  resolveGuideViewerAccess,
  writeGuideAccessPage,
  writeGuideAccessSetting,
  type GuideViewerAccess,
} from "@/lib/guide-access";
import { parseGuidePageId } from "@/lib/guide-content";
import { planGuideQuoteOpen } from "@/lib/guide-note-quote";
import { formatKst } from "@/lib/kst-format";
import { findGuidePage, listGuidePageSummaries } from "@/lib/guide-store";
import { listLessonGroups, readLessonGroupById, readLessonGroupMemberIds, readStudentLessonGroup } from "@/lib/lesson-groups";
import { readNoteAccess } from "@/lib/note-access";
import { studentDisplayName } from "@/lib/lesson-group-rules";

/** 인용을 담을 공간: 학생 한 명의 개인 노트, 또는 그룹 노트. */
export type GuideQuoteSpace = { kind: "student"; id: string } | { kind: "group"; id: string };

export type GuideQuoteNoteOption = {
  id: string;
  title: string;
  /** "11월 11일" (KST). */
  dateLabel: string;
  group: boolean;
};

export type GuideQuoteDestinations = {
  /** 관리자만: 고를 수 있는 학생·그룹. */
  spaces: { students: { id: string; name: string }[]; groups: { id: string; name: string; studentId: string | null }[] } | null;
  /** 지금 고른 공간(관리자) 또는 학생 본인의 개인 공간. */
  space: GuideQuoteSpace;
  /** 새 노트를 만들 학생 공간(그룹은 그 그룹 멤버 한 명의 화면에서 그룹 노트로 만든다). 없으면 새 노트를 만들 수 없다. */
  newNoteStudentId: string | null;
  notes: GuideQuoteNoteOption[];
  /** 이 페이지를 볼 수 없는 공간 학생(관리자에게만 채운다). */
  closedStudents: { id: string; name: string }[];
  /** 학생: 그룹 멤버 중 이 페이지를 볼 수 없는 사람이 있어 그룹 노트에 담을 수 없다. */
  groupBlocked: boolean;
};

export type GuideQuoteResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PAGE_MISSING = "가이드 페이지를 찾을 수 없습니다. 이미 삭제되었거나 열리지 않은 페이지입니다.";

function actorOf(session: AuthSession) {
  return { id: session.user.id, isAdmin: session.user.role === "admin" };
}

function noteDateLabel(note: { noteDate: Date | null; createdAt: Date | null }): string {
  return formatKst(note.noteDate ?? note.createdAt, { month: "long", day: "numeric" });
}

function parseSpace(value: unknown): GuideQuoteSpace | null {
  if (!value || typeof value !== "object") return null;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  if ((kind !== "student" && kind !== "group") || typeof id !== "string" || !id.trim()) return null;
  return { kind, id: id.trim() };
}

/** 보는 사람에게 열린 페이지인지. 열리지 않았거나 없는 페이지면 null. */
async function readViewablePage(context: DbContext, session: AuthSession, pageId: unknown) {
  const id = parseGuidePageId(pageId);
  if (!id) return null;
  const access = await resolveGuideViewerAccess(context, actorOf(session));
  if (!canViewGuidePage(access, id)) return null;
  return findGuidePage(context, id);
}

async function accessOfStudents(context: DbContext, studentIds: readonly string[]): Promise<Map<string, GuideViewerAccess>> {
  const entries = await Promise.all(
    studentIds.map(async (id) => [id, await resolveGuideViewerAccess(context, { id, isAdmin: false })] as const),
  );
  return new Map(entries);
}

async function closedStudentsFor(
  context: DbContext,
  pageId: string,
  studentIds: readonly string[],
): Promise<{ id: string; name: string }[]> {
  if (studentIds.length === 0) return [];
  const [access, students] = await Promise.all([accessOfStudents(context, studentIds), listActiveStudentProfiles(createDb())]);
  const names = new Map(students.map((student) => [student.id, studentDisplayName(student.displayName)]));
  return studentIds
    .filter((id) => !canViewGuidePage(access.get(id) ?? { kind: "closed" }, pageId))
    .map((id) => ({ id, name: names.get(id) ?? "학생" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko-KR") || a.id.localeCompare(b.id));
}

const noteOptionColumns = {
  id: privateNotes.id,
  title: privateNotes.title,
  noteDate: privateNotes.noteDate,
  createdAt: privateNotes.createdAt,
  groupId: privateNotes.groupId,
};

/**
 * 학생이 담을 수 있는 노트만: Stann이 읽기 전용으로 둔 노트(0036)는 작성자 본인이 아니면 뺀다. 관리자(`writerId` null)는 거르지 않는다.
 */
function writableByStudent(writerId: string | null) {
  return writerId ? or(eq(privateNotes.studentReadOnly, false), eq(privateNotes.authorId, writerId)) : undefined;
}

/** 그 학생의 개인 노트. 학생도 Stann이 만든 자기 노트에 쓸 수 있으므로(2026-11-23) 작성자로 거르지 않는다(읽기 전용은 뺀다). */
async function personalNotes(studentId: string, writerId: string | null): Promise<GuideQuoteNoteOption[]> {
  const rows = await createDb()
    .select(noteOptionColumns)
    .from(privateNotes)
    .where(
      and(
        eq(privateNotes.studentId, studentId),
        isNull(privateNotes.groupId),
        isNull(privateNotes.deletedAt),
        writableByStudent(writerId),
      ),
    )
    .orderBy(desc(privateNotes.updatedAt));
  return rows.map((row) => ({ id: row.id, title: row.title, dateLabel: noteDateLabel(row), group: false }));
}

async function groupNotes(groupId: string, writerId: string | null): Promise<GuideQuoteNoteOption[]> {
  const rows = await createDb()
    .select(noteOptionColumns)
    .from(privateNotes)
    .where(and(eq(privateNotes.groupId, groupId), isNull(privateNotes.deletedAt), writableByStudent(writerId)))
    .orderBy(desc(privateNotes.updatedAt));
  return rows.map((row) => ({ id: row.id, title: row.title, dateLabel: noteDateLabel(row), group: true }));
}

/** 공간의 학생 id. 학생은 본인 공간 또는 지금 속한 그룹만, 관리자는 활성 학생·있는 그룹만. 없거나 권한이 없으면 null. */
async function resolveSpaceStudents(context: DbContext, session: AuthSession, space: GuideQuoteSpace): Promise<string[] | null> {
  if (space.kind === "student") {
    try {
      await requireStudentOwnerOrAdmin(session, space.id);
    } catch {
      return null;
    }
    return [space.id];
  }
  if (session.user.role !== "admin") {
    const group = await readStudentLessonGroup(context, session.user.id);
    if (!group || group.id !== space.id) return null;
    return group.members.map((member) => member.id);
  }
  const group = await readLessonGroupById(context, space.id);
  return group ? group.members.map((member) => member.id) : null;
}

/** "노트에 담기" 패널 내용. 관리자는 `space`로 학생·그룹을 고르고, 주지 않으면 첫 학생을 고른다. */
export async function getGuideQuoteDestinations(
  pageId: string,
  requestedSpace?: GuideQuoteSpace | null,
): Promise<GuideQuoteResult<GuideQuoteDestinations>> {
  const session = await requireAuth();
  const context = createDbContext();
  const page = await readViewablePage(context, session, pageId);
  if (!page) return { ok: false, error: PAGE_MISSING };

  if (session.user.role !== "admin") {
    const studentId = session.user.id;
    const group = await readStudentLessonGroup(context, studentId);
    const [own, shared, closedMembers] = await Promise.all([
      personalNotes(studentId, studentId),
      group ? groupNotes(group.id, studentId) : Promise.resolve([]),
      group ? closedStudentsFor(context, page.id, group.members.map((member) => member.id)) : Promise.resolve([]),
    ]);
    return {
      ok: true,
      value: {
        spaces: null,
        space: { kind: "student", id: studentId },
        newNoteStudentId: studentId,
        notes: [...own, ...shared],
        closedStudents: [],
        groupBlocked: closedMembers.length > 0,
      },
    };
  }

  const [students, groups] = await Promise.all([listActiveStudentProfiles(createDb()), listLessonGroups(context)]);
  const studentOptions = students
    .map((student) => ({ id: student.id, name: studentDisplayName(student.displayName) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko-KR") || a.id.localeCompare(b.id));
  const activeIds = new Set(studentOptions.map((student) => student.id));
  const groupOptions = groups.map((group) => ({
    id: group.id,
    name: group.name,
    studentId: group.memberIds.find((id) => activeIds.has(id)) ?? null,
  }));
  const parsed = parseSpace(requestedSpace);
  const space: GuideQuoteSpace | null = parsed ?? (studentOptions[0] ? { kind: "student", id: studentOptions[0].id } : null);
  const spaces = { students: studentOptions, groups: groupOptions };
  if (!space) {
    return {
      ok: true,
      value: { spaces, space: { kind: "student", id: "" }, newNoteStudentId: null, notes: [], closedStudents: [], groupBlocked: false },
    };
  }
  const memberIds = await resolveSpaceStudents(context, session, space);
  if (!memberIds) return { ok: false, error: "학생 또는 그룹을 찾을 수 없습니다. 다시 골라 주세요." };
  const [notes, closedStudents] = await Promise.all([
    space.kind === "student" ? personalNotes(space.id, null) : groupNotes(space.id, null),
    closedStudentsFor(context, page.id, memberIds),
  ]);
  const newNoteStudentId = space.kind === "student" ? space.id : memberIds.find((id) => activeIds.has(id)) ?? null;
  return { ok: true, value: { spaces, space, newNoteStudentId, notes, closedStudents, groupBlocked: false } };
}

/**
 * "넣으면서 이 페이지를 열기"(관리자). 공간 학생마다: 전체는 그대로, 선택은 이 페이지를 더하고,
 * 닫힘은 남아 있던 옛 선택 페이지를 비운 뒤 "선택"으로 바꿔 이 페이지만 연다.
 */
export async function openGuidePageForQuote(pageId: string, requestedSpace: GuideQuoteSpace): Promise<GuideQuoteResult<{ opened: number }>> {
  const session = await requireAdmin();
  const context = createDbContext();
  const id = parseGuidePageId(pageId);
  const space = parseSpace(requestedSpace);
  if (!id || !space) return { ok: false, error: "페이지 또는 학생을 다시 골라 주세요." };
  if (!(await listGuidePageSummaries(context)).some((page) => page.id === id)) return { ok: false, error: PAGE_MISSING };
  const memberIds = await resolveSpaceStudents(context, session, space);
  if (!memberIds) return { ok: false, error: "학생 또는 그룹을 찾을 수 없습니다. 다시 골라 주세요." };
  const now = new Date();
  let opened = 0;
  for (const studentId of memberIds) {
    const student = await requireStudentTarget(studentId).catch(() => null);
    if (!student) continue;
    const plan = planGuideQuoteOpen(await readStudentGuideAccess(context, student.id), id);
    if (plan.kind === "none") continue;
    if (plan.kind === "select-only") {
      for (const stale of plan.clearPageIds) {
        await writeGuideAccessPage(context, { studentId: student.id, pageId: stale, open: false, now });
      }
    }
    // 페이지를 먼저 넣고 설정을 바꿔, "선택"으로 바뀐 순간 옛 페이지가 보이지 않게 한다.
    await writeGuideAccessPage(context, { studentId: student.id, pageId: id, open: true, now });
    if (plan.kind === "select-only") {
      await writeGuideAccessSetting(context, { studentId: student.id, setting: "SELECTED", now });
    }
    revalidatePath(`/dashboard/admin/students/${student.id}`);
    opened += 1;
  }
  if (opened > 0) revalidatePath("/dashboard/guide", "layout");
  return { ok: true, value: { opened } };
}

/** 노트 편집기 "가이드 인용" 패널의 대상: 이미 있는 노트, 또는 아직 만들기 전인 공간(새 노트 화면). */
export type GuideQuotePickerTarget = { kind: "note"; noteId: string } | GuideQuoteSpace;

async function pickerAudience(context: DbContext, session: AuthSession, target: GuideQuotePickerTarget): Promise<string[] | null> {
  if (!target || typeof target !== "object") return null;
  if (target.kind === "note") {
    if (typeof target.noteId !== "string" || !target.noteId) return null;
    const [note] = await createDb()
      .select({
        studentId: privateNotes.studentId,
        authorId: privateNotes.authorId,
        groupId: privateNotes.groupId,
        studentReadOnly: privateNotes.studentReadOnly,
      })
      .from(privateNotes)
      .where(and(eq(privateNotes.id, target.noteId), isNull(privateNotes.deletedAt)))
      .limit(1);
    if (!note) return null;
    if (!note.groupId) {
      try {
        await requireStudentOwnerOrAdmin(session, note.studentId);
      } catch {
        return null;
      }
    }
    if ((await readNoteAccess(context, actorOf(session), note)) !== "write") return null;
    return note.groupId ? readLessonGroupMemberIds(context, note.groupId) : [note.studentId];
  }
  const space = parseSpace(target);
  return space ? resolveSpaceStudents(context, session, space) : null;
}

/** 노트의 학생(그룹 노트는 멤버 모두)과 보는 사람 모두에게 열린 페이지인지 판단하는 함수. */
async function pickerFilter(target: GuideQuotePickerTarget): Promise<((pageId: string) => boolean) | null> {
  const session = await requireAuth();
  const context = createDbContext();
  const audience = await pickerAudience(context, session, target);
  if (!audience) return null;
  const viewers = [...(await accessOfStudents(context, audience)).values()];
  const actorAccess = await resolveGuideViewerAccess(context, actorOf(session));
  return (pageId) => canViewGuidePage(actorAccess, pageId) && viewers.every((access) => canViewGuidePage(access, pageId));
}

export async function getGuideQuotePickerPages(target: GuideQuotePickerTarget): Promise<GuideQuoteResult<{ id: string; title: string }[]>> {
  const canView = await pickerFilter(target);
  if (!canView) return { ok: false, error: "이 노트에 가이드를 불러올 권한이 없습니다." };
  const pages = await listGuidePageSummaries(createDbContext());
  return { ok: true, value: pages.filter((page) => canView(page.id)).map((page) => ({ id: page.id, title: page.title })) };
}

export async function getGuideQuotePickerPage(
  target: GuideQuotePickerTarget,
  pageId: string,
): Promise<GuideQuoteResult<{ id: string; title: string; contentHtml: string }>> {
  const canView = await pickerFilter(target);
  if (!canView) return { ok: false, error: "이 노트에 가이드를 불러올 권한이 없습니다." };
  const id = parseGuidePageId(pageId);
  if (!id || !canView(id)) return { ok: false, error: PAGE_MISSING };
  const page = await findGuidePage(createDbContext(), id);
  if (!page) return { ok: false, error: PAGE_MISSING };
  return { ok: true, value: { id: page.id, title: page.title, contentHtml: page.contentHtml } };
}
