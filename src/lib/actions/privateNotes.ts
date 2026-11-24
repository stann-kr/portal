/**
 * @file src/lib/actions/privateNotes.ts
 * @description private note의 active/history/trash lifecycle server action.
 */
"use server";

import { formatCollabDocKey } from "@/lib/collab/doc-key";
import {
  abortCollabRestore,
  applyCollabRestore,
  beginCollabRestore,
  closeCollabRoomAfterMutation,
  loadServerRestore,
  notifyCollabTopic,
  parseCollabSaveEpoch,
  setCollabRoomMetaAfterMutation,
  STALE_COLLAB_SAVE_MESSAGE,
  readCollabRoomContributorsForSave,
} from "@/lib/collab/server-env";
import { noteRoomFields, readNoteRestoreTarget } from "@/lib/collab/restore-targets";
import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { createDb, createDbContext } from "@/db/client";
import { privateNoteRevisions, privateNotes, profiles } from "@/db/schema";
import { requireAdmin, requireAuth, requireStudentOwnerOrAdmin, type AuthSession } from "@/lib/auth-guard";
import {
  deleteDissolvedLessonGroupIfEmpty,
  listLessonGroupsWithTrashedNotes,
  readLessonGroupById,
  readLessonGroupMemberIds,
  readStudentLessonGroup,
} from "@/lib/lesson-groups";
import { readNoteAccess } from "@/lib/note-access";
import {
  canManageNoteLifecycle,
  resolveNoteAccess,
  type NoteAccessMode,
  type NoteAccessSubject,
} from "@/lib/note-access-rules";
import {
  CREATION_OPERATION_FIELD,
  createCreationOperationId,
  deriveCreationResourceId,
  resolveCreationOperationId,
} from "@/lib/creation-operation";
import { parseDocumentNoteDateInput } from "@/lib/document-snapshot-fingerprint";
import {
  createPrivateNoteAtomically,
  purgePrivateNoteAtomically,
  restorePrivateNoteRevisionAtomically,
  prunePrivateNoteRevisions,
  readPrivateNoteLifecycleMarker,
  privateNoteLifecycleSql,
  restoreTrashedPrivateNoteAtomically,
  trashPrivateNoteAtomically,
  updatePrivateNoteAtomically,
  type PrivateNoteMutationFailureReason,
  type PrivateNoteResourceState,
} from "@/lib/private-note-atomic";
import {
  PRIVATE_NOTE_BASE_REVISION_FIELD,
  PRIVATE_NOTE_GROUP_FIELD,
  PRIVATE_NOTE_MAX_CONTENT_LABEL,
  PRIVATE_NOTE_MAX_TITLE_LENGTH,
  PRIVATE_NOTE_TRASH_RETENTION_SECONDS,
  isPrivateNoteContentWithinLimit,
  parsePrivateNoteRevision,
} from "@/lib/private-note-continuity";
import { isRichTextEmpty } from "@/lib/rich-text";
import { sanitizeHtml } from "@/lib/sanitize-html";

function mutationErrorMessage(reason: PrivateNoteMutationFailureReason): string {
  switch (reason) {
    case "COLLAB_STALE":
      return "문서가 복원되어 최신 내용으로 다시 불러옵니다. 이 저장은 반영하지 않았습니다.";
    case "VERSION_CONFLICT":
      return "다른 화면에서 이 노트가 먼저 변경되었습니다. 현재 초안과 서버 최신본을 비교해 선택해 주세요.";
    case "TRASHED":
      return "이 노트는 휴지통에 있습니다. 현재 초안은 유지되며, 먼저 노트를 복원해 주세요.";
    case "PURGED":
      return "이 노트는 영구 삭제되었습니다. 현재 초안은 유지되며 새 노트로 복사할 수 있습니다.";
    case "OPERATION_PAYLOAD_CONFLICT":
      return "같은 저장 식별자가 다른 내용으로 이미 처리되었습니다. 현재 초안은 유지됩니다.";
    case "OPERATION_VERSION_UNSUPPORTED":
      return "이 문서의 저장 형식은 더 이상 지원하지 않습니다. 현재 초안을 복사한 뒤 페이지를 새로고침해 주세요.";
    case "RETENTION_NOT_EXPIRED":
      return "휴지통 보존 기간 30일이 지나기 전에는 영구 삭제할 수 없습니다.";
    case "RETENTION_EXPIRED":
      return "복원 가능 기간 30일이 지났습니다. Stann에게 문의해 주세요.";
    case "DOCUMENT_TOO_LARGE":
      return `노트 본문은 저장된 HTML 기준 ${PRIVATE_NOTE_MAX_CONTENT_LABEL}까지 저장할 수 있습니다. 내용을 나누어 주세요.`;
    case "STORAGE_QUOTA_EXCEEDED":
      return "노트 저장공간 100 MiB 한도에 도달했습니다. 오래된 노트를 정리하거나 Stann에게 문의해 주세요.";
    case "NOT_FOUND_OR_FORBIDDEN":
      return "노트를 찾을 수 없거나 이 작업을 수행할 권한이 없습니다.";
    case "INTERNAL_INVARIANT_FAILURE":
      return "노트를 안전하게 저장하지 못했습니다. 현재 초안을 유지한 채 다시 시도해 주세요.";
  }
}

function validateNotePayload(formData: FormData):
  | { ok: true; title: string; contentHtml: string; noteDate: Date | null }
  | { ok: false; error: string; reason?: PrivateNoteMutationFailureReason } {
  const title = String(formData.get("title") ?? "").trim();
  const rawHtml = String(formData.get("contentHtml") ?? "");
  if (!title || isRichTextEmpty(rawHtml)) {
    return { ok: false, error: "제목과 내용은 필수입니다." };
  }
  if (title.length > PRIVATE_NOTE_MAX_TITLE_LENGTH) {
    return {
      ok: false,
      error: `제목은 ${PRIVATE_NOTE_MAX_TITLE_LENGTH}자까지 입력할 수 있습니다.`,
    };
  }

  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml)) {
    return { ok: false, error: "유효한 노트 내용을 입력해 주세요." };
  }
  if (!isPrivateNoteContentWithinLimit(contentHtml)) {
    return {
      ok: false,
      reason: "DOCUMENT_TOO_LARGE",
      error: mutationErrorMessage("DOCUMENT_TOO_LARGE"),
    };
  }

  try {
    return {
      ok: true,
      title,
      contentHtml,
      noteDate: parseDocumentNoteDateInput(formData.get("noteDate")),
    };
  } catch {
    return { ok: false, error: "올바른 날짜를 입력해 주세요." };
  }
}

/**
 * 목록·상세 경로를 다시 받게 한다. 생성·자동 저장(update)에서는 호출하지 않는다: action 안의 어떤
 * `revalidatePath`든 Next가 `x-action-revalidated`로 현재 route 전체를 다시 렌더해 입력 중 화면이 새로고침된
 * 것처럼 바뀐다(2026-10-31 확인). 대상 페이지는 모두 세션 기반 dynamic이라 다음 navigation에서 새로 받고,
 * 열린 읽기 화면은 revision 폴링(live view)이 맡는다. 휴지통·복원·purge·날짜 이동처럼 입력 중이 아닌 작업만 호출한다.
 */
function revalidatePrivateNotePaths(studentId: string, noteId?: string): void {
  if (noteId) {
    revalidatePath(`/dashboard/notes/${noteId}`);
    revalidatePath(`/dashboard/notes/${noteId}/history`);
  }
  revalidatePath(`/dashboard/admin/students/${studentId}`);
  revalidatePath(`/dashboard/admin/students/${studentId}/notes`);
  revalidatePath("/dashboard/notes/trash");
  revalidatePath("/dashboard/student/notes");
  revalidatePath("/dashboard/student");
}

function noteActor(session: AuthSession) {
  return { id: session.user.id, isAdmin: session.user.role === "admin" };
}

/**
 * 노트 하나에 대한 접근(쓰기·읽기). 그룹 노트는 관리자 또는 지금 그 그룹 멤버, 개인 노트는 그 학생 본인·관리자가
 * 읽고 쓴다(대상은 활성 학생 공간, 2026-11-23부터 Stann이 만든 노트도 학생이 쓴다). 권한이 없으면 "Unauthorized"를 던진다
 * (페이지는 `missingWhenAccessDenied`로 없는 노트처럼 404를 보인다).
 */
async function requireNoteAccess(session: AuthSession, note: NoteAccessSubject): Promise<NoteAccessMode> {
  const actor = noteActor(session);
  if (note.groupId) {
    const mode = await readNoteAccess(createDbContext(), actor, note);
    if (!mode) throw new Error("Unauthorized");
    return mode;
  }
  await requireStudentOwnerOrAdmin(session, note.studentId);
  const mode = resolveNoteAccess(actor, note, false);
  if (!mode) throw new Error("Unauthorized");
  return mode;
}

/** 노트를 알리고 다시 받게 할 학생 공간들. 그룹 노트는 지금 멤버 모두, 개인 노트는 그 학생. */
async function noteAudienceStudentIds(note: { studentId: string; groupId: string | null }): Promise<string[]> {
  if (!note.groupId) return [note.studentId];
  return readLessonGroupMemberIds(createDbContext(), note.groupId);
}

async function announceNoteChange(
  note: { studentId: string; groupId: string | null },
  options: { noteId?: string; revalidate: boolean },
): Promise<void> {
  const audience = await noteAudienceStudentIds(note).catch(() => [note.studentId]);
  for (const studentId of audience) {
    if (options.revalidate) revalidatePrivateNotePaths(studentId, options.noteId);
    notifyCollabTopic("student-notes", studentId);
  }
}

/** 노트 목록 미리보기는 본문 앞부분만 쓴다(학생 홈 통합 일정과 같은 길이). 검색할 때만 전체 본문을 읽는다. */
const NOTE_LIST_PREVIEW_SOURCE_CHARS = 4_096;

const noteListColumns = {
  id: privateNotes.id,
  title: privateNotes.title,
  // profiles를 join하므로 열 이름을 표 이름과 함께 적는다.
  contentHtml: sql<string>`substr("private_notes"."content_html", 1, ${NOTE_LIST_PREVIEW_SOURCE_CHARS})`,
  noteDate: privateNotes.noteDate,
  createdAt: privateNotes.createdAt,
  updatedAt: privateNotes.updatedAt,
  version: privateNotes.version,
  authorId: privateNotes.authorId,
  authorName: profiles.displayName,
  groupId: privateNotes.groupId,
  studentReadOnly: privateNotes.studentReadOnly,
};

/** 목록 열: 검색(`fullContent`)이면 전체 본문, 아니면 미리보기용 앞부분만. */
function noteListSelection(fullContent: boolean) {
  return fullContent ? { ...noteListColumns, contentHtml: privateNotes.contentHtml } : noteListColumns;
}

/**
 * 그 학생의 개인 노트(active)만 반환한다. 그룹 노트는 `getStudentGroupNotes`가 따로 준다.
 * `fullContent`가 아니면 본문은 미리보기용 앞부분만 담는다(목록 검색은 전체 본문으로 읽는다).
 */
export async function getPrivateNotes(targetStudentId: string, options: { fullContent?: boolean } = {}) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, targetStudentId);
  const db = createDb();
  return db
    .select(noteListSelection(options.fullContent === true))
    .from(privateNotes)
    .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
    .where(
      and(
        eq(privateNotes.studentId, targetStudentId),
        isNull(privateNotes.groupId),
        isNull(privateNotes.deletedAt),
      ),
    )
    .orderBy(desc(privateNotes.createdAt));
}

export type StudentGroupNotes = {
  group: { id: string; name: string; members: { id: string; name: string }[] };
  notes: Awaited<ReturnType<typeof getPrivateNotes>>;
};

/**
 * 그 학생이 지금 속한 그룹의 그룹 노트(active). 학생 본인(=지금 멤버)과 관리자만 부른다. 그룹이 없으면 null.
 */
export async function getStudentGroupNotes(
  targetStudentId: string,
  options: { fullContent?: boolean } = {},
): Promise<StudentGroupNotes | null> {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, targetStudentId);
  const group = await readStudentLessonGroup(createDbContext(), targetStudentId);
  if (!group) return null;
  const notes = await createDb()
    .select(noteListSelection(options.fullContent === true))
    .from(privateNotes)
    .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
    .where(and(eq(privateNotes.groupId, group.id), isNull(privateNotes.deletedAt)))
    .orderBy(desc(privateNotes.createdAt));
  return { group, notes };
}

/** active 단일 note를 권한 범위 안에서 반환한다. */
export async function getPrivateNote(noteId: string) {
  return getPrivateNoteRecord(noteId, false);
}

/** 상세 lifecycle UI가 휴지통 상태까지 구분할 때 사용한다. */
export async function getPrivateNoteIncludingTrash(noteId: string) {
  return getPrivateNoteRecord(noteId, true);
}

/**
 * 공동 편집 시드용 head. 본문·칸·version과 lifecycle 표지(마지막 복원 revision)를 한 조회에서 읽어
 * room 세대와 맞는 head로만 시드하게 한다. 휴지통·없음·권한 없음은 상태로 돌려준다(재시도하지 않음).
 */
export type PrivateNoteCollabSeed =
  | { status: "ok"; title: string; contentHtml: string; noteDate: Date | null; version: number; lifecycle: number }
  | { status: "trashed" | "missing" };

export async function getPrivateNoteCollabSeed(noteId: string): Promise<PrivateNoteCollabSeed> {
  const session = await requireAuth();
  const [row] = await createDb()
    .select({
      studentId: privateNotes.studentId,
      authorId: privateNotes.authorId,
      groupId: privateNotes.groupId,
      studentReadOnly: privateNotes.studentReadOnly,
      title: privateNotes.title,
      contentHtml: privateNotes.contentHtml,
      noteDate: privateNotes.noteDate,
      version: privateNotes.version,
      deletedAt: privateNotes.deletedAt,
      lifecycle: privateNoteLifecycleSql,
    })
    .from(privateNotes)
    .where(eq(privateNotes.id, noteId))
    .limit(1);
  if (!row) return { status: "missing" };
  try {
    await requireNoteAccess(session, row);
  } catch {
    return { status: "missing" };
  }
  if (row.deletedAt) return { status: "trashed" };
  return {
    status: "ok",
    title: row.title,
    contentHtml: row.contentHtml,
    noteDate: row.noteDate,
    version: row.version,
    lifecycle: Number(row.lifecycle),
  };
}

export type PrivateNoteHead = { id: string; version: number; updatedAt: Date | null };

/**
 * 읽기 전용 실시간 보기(live view)의 가벼운 head 조회: 본문 없이 id·version·updatedAt만.
 * 권한 경계는 `getPrivateNote`와 같다(개인 노트는 본인 학생·관리자, 그룹 노트는 관리자·지금 멤버, 그 밖은 throw). 휴지통·없는 노트는 null.
 */
export async function getPrivateNoteHead(noteId: string): Promise<PrivateNoteHead | null> {
  const session = await requireAuth();
  const db = createDb();
  const [head] = await db
    .select({
      id: privateNotes.id,
      studentId: privateNotes.studentId,
      authorId: privateNotes.authorId,
      groupId: privateNotes.groupId,
      studentReadOnly: privateNotes.studentReadOnly,
      version: privateNotes.version,
      updatedAt: privateNotes.updatedAt,
    })
    .from(privateNotes)
    .where(and(eq(privateNotes.id, noteId), isNull(privateNotes.deletedAt)))
    .limit(1);
  if (!head) return null;
  await requireNoteAccess(session, head);
  return { id: head.id, version: head.version, updatedAt: head.updatedAt };
}

/**
 * Form action은 target guard의 거부를 throw가 아닌 기존 안전한 action state로 수렴시킨다.
 */
async function getPrivateNoteForMutation(noteId: string) {
  try {
    return await getPrivateNoteIncludingTrash(noteId);
  } catch {
    return null;
  }
}

async function getPrivateNoteRecord(noteId: string, includeTrash: boolean) {
  const session = await requireAuth();
  const db = createDb();
  const [note] = await db
    .select({
      id: privateNotes.id,
      studentId: privateNotes.studentId,
      authorId: privateNotes.authorId,
      title: privateNotes.title,
      contentHtml: privateNotes.contentHtml,
      noteDate: privateNotes.noteDate,
      createdAt: privateNotes.createdAt,
      updatedAt: privateNotes.updatedAt,
      version: privateNotes.version,
      deletedAt: privateNotes.deletedAt,
      authorName: profiles.displayName,
      authorRole: profiles.role,
      groupId: privateNotes.groupId,
      studentReadOnly: privateNotes.studentReadOnly,
    })
    .from(privateNotes)
    .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
    .where(
      includeTrash
        ? eq(privateNotes.id, noteId)
        : and(eq(privateNotes.id, noteId), isNull(privateNotes.deletedAt)),
    )
    .limit(1);

  if (!note) return null;
  const access = await requireNoteAccess(session, note);
  // 휴지통 이동·휴지통 복원 버튼을 보일지. 그룹 노트의 "write"는 관리자·지금 멤버라 멤버십을 다시 읽지 않는다.
  // 개인 노트는 작성자 본인·관리자만이다(학생은 Stann이 만든 자기 노트를 고치지만 버리지는 못한다, 2026-11-23).
  const canManageLifecycle = canManageNoteLifecycle(
    noteActor(session),
    note,
    Boolean(note.groupId) && access === "write",
  );
  // 그룹 노트는 문서 머리 안내 줄에 쓸 그룹 이름·멤버 이름을 함께 준다(볼 권한이 확인된 뒤에만 읽는다).
  const found = note.groupId ? await readLessonGroupById(createDbContext(), note.groupId, { includeDissolved: true }) : null;
  const group = found ? { id: found.id, name: found.name, members: found.members } : null;
  return { ...note, access, canManageLifecycle, group };
}

/**
 * 그 학생 공간의 휴지통: 개인 노트와 그 학생이 지금 속한 그룹의 그룹 노트. `canWrite`는 휴지통에서 복원할 수 있는지다
 * (`canManageNoteLifecycle`과 같다 — 개인: 작성자·관리자, 그룹: 관리자·멤버. 학생 본인은 멤버라 목록에 보이면 복원할 수 있다.
 * 2026-11-23부터 학생이 Stann의 노트를 편집할 수 있어도 휴지통 복원은 작성자·관리자만이다).
 */
export async function getTrashedPrivateNotes(targetStudentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, targetStudentId);
  const group = await readStudentLessonGroup(createDbContext(), targetStudentId);
  const db = createDb();
  const notes = await db
    .select({
      id: privateNotes.id,
      title: privateNotes.title,
      noteDate: privateNotes.noteDate,
      createdAt: privateNotes.createdAt,
      updatedAt: privateNotes.updatedAt,
      version: privateNotes.version,
      deletedAt: privateNotes.deletedAt,
      authorId: privateNotes.authorId,
      authorName: profiles.displayName,
      groupId: privateNotes.groupId,
      studentReadOnly: privateNotes.studentReadOnly,
    })
    .from(privateNotes)
    .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
    .where(
      and(
        group
          ? or(
            and(eq(privateNotes.studentId, targetStudentId), isNull(privateNotes.groupId)),
            eq(privateNotes.groupId, group.id),
          )
          : and(eq(privateNotes.studentId, targetStudentId), isNull(privateNotes.groupId)),
        isNotNull(privateNotes.deletedAt),
      ),
    )
    .orderBy(desc(privateNotes.deletedAt));

  const isAdmin = session.user.role === "admin";
  return notes.map((note) => ({
    ...note,
    groupName: note.groupId && group ? group.name : null,
    canWrite: isAdmin || note.groupId !== null || note.authorId === session.user.id,
    purgeEligibleAt: note.deletedAt
      ? new Date(note.deletedAt.getTime() + PRIVATE_NOTE_TRASH_RETENTION_SECONDS * 1000)
      : null,
  }));
}

/**
 * 그룹 하나의 휴지통(관리자 전용). 학생이 그룹에서 빠졌거나 그룹을 해제해도 그 그룹의 휴지통 노트를 찾을 수 있게
 * 학생이 아니라 그룹으로 연다. 그룹 멤버는 학생 휴지통에서 같은 노트를 본다.
 */
export async function getTrashedGroupNotes(groupId: string) {
  await requireAdmin();
  if (typeof groupId !== "string" || !groupId) return null;
  const group = await readLessonGroupById(createDbContext(), groupId, { includeDissolved: true });
  if (!group) return null;
  const notes = await createDb()
    .select({
      id: privateNotes.id,
      title: privateNotes.title,
      version: privateNotes.version,
      deletedAt: privateNotes.deletedAt,
      authorName: profiles.displayName,
    })
    .from(privateNotes)
    .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
    .where(and(eq(privateNotes.groupId, groupId), isNotNull(privateNotes.deletedAt)))
    .orderBy(desc(privateNotes.deletedAt));
  return {
    group: { id: group.id, name: group.name, dissolved: group.dissolved },
    notes: notes.map((note) => ({
      ...note,
      purgeEligibleAt: note.deletedAt
        ? new Date(note.deletedAt.getTime() + PRIVATE_NOTE_TRASH_RETENTION_SECONDS * 1000)
        : null,
    })),
  };
}

/** 관리자 노트 휴지통 첫 화면에서 고를 그룹: 휴지통에 그룹 노트가 있는 그룹(해제한 그룹 포함). */
export async function getTrashGroupChoices() {
  await requireAdmin();
  return listLessonGroupsWithTrashedNotes(createDbContext());
}

export async function getPrivateNoteRevisions(noteId: string) {
  const note = await getPrivateNoteIncludingTrash(noteId);
  if (!note) return [];
  const db = createDb();
  const rows = await db
    .select({
      id: privateNoteRevisions.id,
      revisionNumber: privateNoteRevisions.revisionNumber,
      changeType: privateNoteRevisions.changeType,
      title: privateNoteRevisions.title,
      contentHtml: privateNoteRevisions.contentHtml,
      noteDate: privateNoteRevisions.noteDate,
      deletedAt: privateNoteRevisions.deletedAt,
      restoredFromRevision: privateNoteRevisions.restoredFromRevision,
      actorId: privateNoteRevisions.actorId,
      actorName: profiles.displayName,
      contributorIds: privateNoteRevisions.contributorIds,
      createdAt: privateNoteRevisions.createdAt,
    })
    .from(privateNoteRevisions)
    .leftJoin(profiles, eq(privateNoteRevisions.actorId, profiles.id))
    .where(eq(privateNoteRevisions.noteId, noteId))
    .orderBy(desc(privateNoteRevisions.revisionNumber));
  // 공동 편집 버전은 저장 담당 대신 room이 기록한 실제 편집자 이름을 보인다(0036 이후 버전만, 그 전 버전은 저장한 사람).
  const contributorsOf = new Map(rows.map((row) => [row.id, parseRevisionContributorIds(row.contributorIds)]));
  const ids = [...new Set([...contributorsOf.values()].flat())];
  const names = new Map<string, string | null>();
  if (ids.length > 0) {
    const people = await db
      .select({ id: profiles.id, displayName: profiles.displayName })
      .from(profiles)
      .where(inArray(profiles.id, ids));
    for (const person of people) names.set(person.id, person.displayName);
  }
  return rows.map((row) => {
    const contributorNames = (contributorsOf.get(row.id) ?? [])
      .map((id) => names.get(id)?.trim())
      .filter((name): name is string => Boolean(name));
    return { ...row, actorName: contributorNames.length > 0 ? contributorNames.join(", ") : row.actorName };
  });
}

/** 버전의 편집자 JSON(0036). 형식이 맞지 않으면 없는 것으로 본다. */
function parseRevisionContributorIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

export type CreateNoteState = {
  error?: string;
  success?: boolean;
  conflictKind?: PrivateNoteMutationFailureReason;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
  replayed?: boolean;
  resourceState?: PrivateNoteResourceState;
  operationResultRevision?: number;
  currentRevision?: number | null;
  note?: {
    id: string;
    title: string;
    contentHtml: string;
    noteDate: Date | null;
    createdAt: Date | null;
    version: number;
  };
};

export async function createPrivateNote(
  targetStudentId: string,
  _prev: CreateNoteState,
  formData: FormData,
): Promise<CreateNoteState> {
  const session = await requireAuth();
  const userId = session.user.id!;
  await requireStudentOwnerOrAdmin(session, targetStudentId);
  // 저장 위치가 그룹이면 그 그룹 노트로 만든다. 만든 사람이 student_id(용량 주체)이고, 학생은 지금 멤버일 때만,
  // 관리자는 있는 그룹이면 만든다(원자 INSERT가 확인한다).
  const rawGroupId = formData.get(PRIVATE_NOTE_GROUP_FIELD);
  const groupId = typeof rawGroupId === "string" && rawGroupId.trim() ? rawGroupId.trim() : null;
  const payload = validateNotePayload(formData);
  if (!payload.ok) return { error: payload.error, conflictKind: payload.reason };

  const operationId = resolveCreationOperationId(
    formData.get(CREATION_OPERATION_FIELD),
  );
  if (!operationId) {
    return { error: "문서 생성 식별자가 올바르지 않습니다. 페이지를 새로고침해 주세요." };
  }
  // 노트 id는 저장 위치와 관계없이 (작성자, 열린 학생 공간)에서 정한다. 작성 화면이 처음부터 이 id로 공동 편집 room을
  // 열고(저장 위치를 바꿔도 room이 바뀌지 않게), 생성 전 room 권한도 그 학생 공간 규칙을 따른다.
  const id = deriveCreationResourceId(
    operationId,
    JSON.stringify(["private-note", userId, targetStudentId]),
  );
  const result = await createPrivateNoteAtomically(createDbContext(), {
    actor: { id: userId, isAdmin: session.user.role === "admin" },
    subjectId: groupId ? userId : targetStudentId,
    groupId,
    noteId: id,
    operationId,
    title: payload.title,
    contentHtml: payload.contentHtml,
    noteDate: payload.noteDate,
    now: new Date(),
  });

  if (!result.ok) {
    return {
      error: mutationErrorMessage(result.reason),
      conflictKind: result.reason,
      operationConflict: result.reason === "OPERATION_PAYLOAD_CONFLICT",
      conflictedOperationId:
        result.reason === "OPERATION_PAYLOAD_CONFLICT" ? operationId : undefined,
      existingId: result.noteId,
      resourceState:
        result.reason === "TRASHED"
          ? "TRASHED"
          : result.reason === "PURGED"
            ? "PURGED"
            : undefined,
    };
  }

  // 자동 저장(제자리 생성) 중 route 재렌더를 막기 위해 revalidate하지 않는다(위 주석). 학생 홈 최근 노트에는 알린다.
  await announceNoteChange({ studentId: targetStudentId, groupId }, { revalidate: false });
  const currentNote = result.replayed
    ? await getPrivateNoteIncludingTrash(id)
    : null;
  const currentRevision = result.currentRevision ?? result.operationResultRevision;
  return {
    success: true,
    replayed: result.replayed,
    resourceState: result.resourceState,
    operationResultRevision: result.operationResultRevision,
    currentRevision,
    note: {
      id,
      title: currentNote?.title ?? payload.title,
      contentHtml: currentNote?.contentHtml ?? payload.contentHtml,
      noteDate: currentNote?.noteDate ?? payload.noteDate,
      createdAt: result.createdAt ?? null,
      version: currentRevision,
    },
  };
}

export type UpdateNoteState = {
  error?: string;
  /** 공동 편집 room이 복원·휴지통으로 비워진 뒤의 옛 저장이라 반영하지 않았다. 다시 시도하지 않는다. */
  collabStale?: boolean;
  success?: boolean;
  conflictKind?: PrivateNoteMutationFailureReason;
  replayed?: boolean;
  resourceState?: PrivateNoteResourceState;
  operationResultRevision?: number;
  currentRevision?: number | null;
  /** 저장된 서버 수정 시각. 화면은 revalidate 없이 이 값으로 "수정" 줄을 맞춘다. */
  updatedAt?: Date | null;
  conflictNote?: {
    id: string;
    title: string;
    contentHtml: string;
    noteDate: Date | null;
    version: number;
  };
  note?: {
    id: string;
    title: string;
    contentHtml: string;
    noteDate: Date | null;
    version?: number;
  };
};

/**
 * room이 기록한 편집자 중 지금 이 노트를 볼 수 있는 사람만 남긴다(그 사이 그룹을 떠난 사람 등은 이름을 남기지 않는다).
 * id는 room이 서명된 연결 토큰에서 얻은 값이라 클라이언트가 고를 수 없다. 읽기 전용으로 바뀐 학생도 그 전에 고친 것은 남긴다.
 */
async function verifiedRevisionContributors(note: NoteAccessSubject, ids: readonly string[] | null): Promise<string[] | null> {
  if (!ids || ids.length === 0) return null;
  const candidates = [...new Set(ids)].slice(0, 20);
  const rows = await createDb()
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(inArray(profiles.id, candidates));
  const roles = new Map(rows.map((row) => [row.id, row.role]));
  const context = createDbContext();
  const kept: string[] = [];
  for (const id of candidates) {
    const role = roles.get(id);
    if (!role) continue;
    if ((await readNoteAccess(context, { id, isAdmin: role === "admin" }, note)) !== null) kept.push(id);
  }
  return kept.length > 0 ? kept : null;
}

export async function updatePrivateNote(
  noteId: string,
  _prev: UpdateNoteState,
  formData: FormData,
): Promise<UpdateNoteState> {
  const session = await requireAuth();
  const noteBefore = await getPrivateNoteForMutation(noteId);
  if (!noteBefore) {
    return {
      error: mutationErrorMessage("NOT_FOUND_OR_FORBIDDEN"),
      conflictKind: "NOT_FOUND_OR_FORBIDDEN",
    };
  }
  const operationId = resolveCreationOperationId(
    formData.get(CREATION_OPERATION_FIELD),
  );
  const baseRevision = parsePrivateNoteRevision(
    formData.get(PRIVATE_NOTE_BASE_REVISION_FIELD),
  );
  if (!operationId || !baseRevision) {
    return { error: "저장 기준을 확인할 수 없습니다. 현재 초안을 유지한 채 페이지를 새로고침해 주세요." };
  }
  const payload = validateNotePayload(formData);
  if (!payload.ok) return { error: payload.error, conflictKind: payload.reason };
  const collab = parseCollabSaveEpoch(formData);
  if (!collab.ok) return { error: STALE_COLLAB_SAVE_MESSAGE, collabStale: true };
  // 공동 편집 저장이면 저장 담당이 아니라 room이 기록한 실제 편집자를 버전에 남긴다(이력 표시).
  const contributorIds =
    collab.collabEpoch === undefined
      ? null
      : await verifiedRevisionContributors(
          noteBefore,
          await readCollabRoomContributorsForSave(formatCollabDocKey({ kind: "note", id: noteId })),
        );

  const result = await updatePrivateNoteAtomically(createDbContext(), {
    actor: {
      id: session.user.id!,
      isAdmin: session.user.role === "admin",
    },
    noteId,
    operationId,
    baseRevision,
    title: payload.title,
    contentHtml: payload.contentHtml,
    noteDate: payload.noteDate,
    ...(collab.collabEpoch === undefined ? {} : { collabEpoch: collab.collabEpoch }),
    contributorIds,
    now: new Date(),
  });
  if (!result.ok && result.reason === "COLLAB_STALE") {
    return {
      error: mutationErrorMessage("COLLAB_STALE"),
      collabStale: true,
      conflictKind: "COLLAB_STALE",
      currentRevision: result.currentRevision,
    };
  }
  if (!result.ok) {
    let conflictNote: UpdateNoteState["conflictNote"];
    if (result.reason === "VERSION_CONFLICT") {
      const db = createDb();
      const [current] = await db
        .select({
          id: privateNotes.id,
          studentId: privateNotes.studentId,
          authorId: privateNotes.authorId,
          groupId: privateNotes.groupId,
          studentReadOnly: privateNotes.studentReadOnly,
          title: privateNotes.title,
          contentHtml: privateNotes.contentHtml,
          noteDate: privateNotes.noteDate,
          version: privateNotes.version,
          deletedAt: privateNotes.deletedAt,
        })
        .from(privateNotes)
        .where(eq(privateNotes.id, noteId))
        .limit(1);
      const mayReadCurrent = Boolean(
        current &&
          !current.deletedAt &&
          (await readNoteAccess(createDbContext(), noteActor(session), current)) === "write",
      );
      if (current && mayReadCurrent) {
        conflictNote = {
          id: current.id,
          title: current.title,
          contentHtml: current.contentHtml,
          noteDate: current.noteDate,
          version: current.version,
        };
      }
    }
    return {
      error: mutationErrorMessage(result.reason),
      conflictKind: result.reason,
      currentRevision: result.currentRevision,
      conflictNote,
      resourceState:
        result.reason === "TRASHED"
          ? "TRASHED"
          : result.reason === "PURGED"
            ? "PURGED"
            : undefined,
    };
  }

  const currentRevision = result.currentRevision ?? result.operationResultRevision;
  const note = await getPrivateNoteForMutation(noteId);
  if (!note) {
    return {
      error: mutationErrorMessage("INTERNAL_INVARIANT_FAILURE"),
      conflictKind: "INTERNAL_INVARIANT_FAILURE",
    };
  }
  // 자동 저장마다 route가 다시 렌더되지 않도록 revalidate하지 않는다(위 주석). 학생 홈 최근 노트에는 알린다.
  await announceNoteChange(note, { revalidate: false });
  if (!result.replayed) {
    // 보관 단계를 넘긴 자동 저장 이력을 솎는다. 실패해도 저장 결과는 그대로다(다음 저장이 다시 솎는다).
    await prunePrivateNoteRevisions(createDbContext(), { noteId, now: new Date() }).catch((error: unknown) => {
      console.warn("private note revision prune failed", error instanceof Error ? error.message : "unknown");
    });
  }
  return {
    success: true,
    replayed: result.replayed,
    resourceState: result.resourceState,
    operationResultRevision: result.operationResultRevision,
    currentRevision,
    updatedAt: note.updatedAt,
    note: {
      id: noteId,
      title: note.title,
      contentHtml: note.contentHtml,
      noteDate: note.noteDate,
      version: currentRevision,
    },
  };
}

export type MovePrivateNoteDateState =
  | { ok: true; noteDate: Date; version: number }
  | { ok: false; error: string; conflictKind?: PrivateNoteMutationFailureReason };

/**
 * 캘린더에서 끌어 옮긴 노트의 날짜만 바꾼다. 본문·제목은 서버 최신본 그대로 두고,
 * 읽은 revision을 기준으로 저장해 그 사이 다른 화면의 변경은 충돌로 돌려준다.
 */
export async function movePrivateNoteDate(
  noteId: string,
  noteDate: string,
  operationIdValue: string,
): Promise<MovePrivateNoteDateState> {
  const session = await requireAuth();
  const operationId = resolveCreationOperationId(operationIdValue);
  if (!operationId) {
    return { ok: false, error: "작업 기준을 확인할 수 없습니다. 페이지를 새로고침해 주세요." };
  }
  let parsedDate: Date | null;
  try {
    parsedDate = parseDocumentNoteDateInput(noteDate);
  } catch {
    parsedDate = null;
  }
  if (!parsedDate) return { ok: false, error: "올바른 날짜를 입력해 주세요." };

  const current = await getPrivateNoteForMutation(noteId);
  const isAdmin = session.user.role === "admin";
  if (!current || current.access !== "write") {
    return {
      ok: false,
      error: mutationErrorMessage("NOT_FOUND_OR_FORBIDDEN"),
      conflictKind: "NOT_FOUND_OR_FORBIDDEN",
    };
  }
  if (current.deletedAt) {
    return { ok: false, error: mutationErrorMessage("TRASHED"), conflictKind: "TRASHED" };
  }
  // 이미 그 날짜면 쓰지 않고 성공으로 돌려준다. 응답을 잃은 같은 이동을 다시 보내도 같은 결과가 된다.
  if (current.noteDate?.getTime() === parsedDate.getTime()) {
    return { ok: true, noteDate: parsedDate, version: current.version };
  }
  // 이동 전후 lifecycle 표지가 같을 때만 열린 room에 날짜를 반영한다(사이에 복원이 끼면 새 세대에 옛 날짜를 넣지 않는다).
  const markerBefore = await readPrivateNoteLifecycleMarker(createDbContext(), noteId);
  const result = await updatePrivateNoteAtomically(createDbContext(), {
    actor: { id: session.user.id!, isAdmin },
    noteId,
    operationId,
    baseRevision: current.version,
    title: current.title,
    contentHtml: current.contentHtml,
    noteDate: parsedDate,
    now: new Date(),
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.reason === "VERSION_CONFLICT"
        ? "방금 다른 화면에서 이 노트가 바뀌었습니다. 다시 옮겨 주세요."
        : mutationErrorMessage(result.reason),
      conflictKind: result.reason,
    };
  }
  await announceNoteChange(current, { noteId, revalidate: true });
  // 열린 편집 room의 날짜도 바꾼다. 그렇지 않으면 다음 자동 저장이 옛 날짜로 되돌린다.
  const markerAfter = await readPrivateNoteLifecycleMarker(createDbContext(), noteId);
  const movedVersion = result.currentRevision ?? result.operationResultRevision;
  if (markerAfter === markerBefore) {
    await setCollabRoomMetaAfterMutation(formatCollabDocKey({ kind: "note", id: noteId }), "noteDate", noteDate, markerAfter, movedVersion);
  }
  return {
    ok: true,
    noteDate: parsedDate,
    version: result.currentRevision ?? result.operationResultRevision,
  };
}

export type PrivateNoteLifecycleState = {
  error?: string;
  success?: boolean;
  conflictKind?: PrivateNoteMutationFailureReason;
  replayed?: boolean;
  resourceState?: PrivateNoteResourceState;
  currentRevision?: number | null;
  /** 이 작업이 만든 revision(재전송이면 처음 만든 revision). */
  operationResultRevision?: number | null;
};

async function runLifecycleAction(
  kind: "trash" | "restore" | "purge",
  noteId: string,
  operationIdValue: string,
  baseRevisionValue: number,
): Promise<PrivateNoteLifecycleState> {
  const session = await requireAuth();
  const operationId = resolveCreationOperationId(operationIdValue);
  const baseRevision = parsePrivateNoteRevision(baseRevisionValue);
  if (!operationId || !baseRevision) {
    return { error: "작업 기준을 확인할 수 없습니다. 페이지를 새로고침해 주세요." };
  }
  const noteBefore = await getPrivateNoteForMutation(noteId);
  const actor = { id: session.user.id!, isAdmin: session.user.role === "admin" };
  const write = { actor, noteId, operationId, baseRevision, now: new Date() };
  const result =
    kind === "trash"
      ? await trashPrivateNoteAtomically(createDbContext(), write)
      : kind === "restore"
        ? await restoreTrashedPrivateNoteAtomically(createDbContext(), write)
        : await purgePrivateNoteAtomically(createDbContext(), write);
  if (!result.ok) {
    return {
      error: mutationErrorMessage(result.reason),
      conflictKind: result.reason,
      currentRevision: result.currentRevision,
      resourceState:
        result.reason === "TRASHED"
          ? "TRASHED"
          : result.reason === "PURGED"
            ? "PURGED"
            : undefined,
    };
  }
  // 휴지통 이동은 본문을 바꾸지 않으므로 room 상태를 남긴 채 연결만 닫는다(복구하면 그대로 이어진다).
  // 영구 삭제는 room을 비운다. 휴지통 복구는 room을 건드리지 않는다.
  const roomKey = formatCollabDocKey({ kind: "note", id: noteId });
  if (kind === "trash") await closeCollabRoomAfterMutation(roomKey, true);
  if (kind === "purge") await closeCollabRoomAfterMutation(roomKey, false);
  // 해제한 그룹의 마지막 휴지통 노트를 지웠으면 남은 그룹 행도 지운다(해제하지 않은 그룹은 그대로).
  if (kind === "purge" && noteBefore?.groupId) await deleteDissolvedLessonGroupIfEmpty(createDbContext(), noteBefore.groupId);
  if (noteBefore) await announceNoteChange(noteBefore, { noteId, revalidate: true });
  return {
    success: true,
    replayed: result.replayed,
    resourceState: result.resourceState,
    currentRevision: result.currentRevision,
    operationResultRevision: result.operationResultRevision,
  };
}

export async function trashPrivateNote(
  noteId: string,
  operationId: string,
  baseRevision: number,
) {
  return runLifecycleAction("trash", noteId, operationId, baseRevision);
}

/** rolling caller compatibility: delete는 더 이상 hard delete가 아니다. */
export const deletePrivateNote = trashPrivateNote;

export async function restorePrivateNote(
  noteId: string,
  operationId: string,
  baseRevision: number,
) {
  return runLifecycleAction("restore", noteId, operationId, baseRevision);
}

export async function purgePrivateNote(
  noteId: string,
  operationId: string,
  baseRevision: number,
) {
  return runLifecycleAction("purge", noteId, operationId, baseRevision);
}

export async function restorePrivateNoteRevision(
  noteId: string,
  operationIdValue: string,
  baseRevisionValue: number,
  revisionNumberValue: number,
): Promise<PrivateNoteLifecycleState> {
  const session = await requireAuth();
  const operationId = resolveCreationOperationId(operationIdValue);
  const baseRevision = parsePrivateNoteRevision(baseRevisionValue);
  const revisionNumber = parsePrivateNoteRevision(revisionNumberValue);
  if (!operationId || !baseRevision || !revisionNumber) {
    return { error: "복원 기준을 확인할 수 없습니다. 페이지를 새로고침해 주세요." };
  }
  const noteBefore = await getPrivateNoteForMutation(noteId);
  const actor = { id: session.user.id!, isAdmin: session.user.role === "admin" };
  const roomKey = formatCollabDocKey({ kind: "note", id: noteId });
  // 되돌리기 전에 열린 실시간 문서의 지금 상태를 복원 기준으로 남기고, 저장되지 않은 내용은 revision으로 남긴다
  // (다른 기기의 입력이 이력에서 사라지지 않게). 편집은 멈추지 않는다: 준비 뒤 입력은 복원 뒤에도 문서에 남는다.
  // 쓸 수 있는 사람의 요청만 준비한다(권한 없는 요청이 다른 복원을 막지 못하게).
  const mayRestore = Boolean(noteBefore && !noteBefore.deletedAt && noteBefore.access === "write");
  let checkpointBase = baseRevision;
  let checkpointRevision: number | undefined;
  if (mayRestore && noteBefore) {
    const prepared = await beginCollabRestore(roomKey, operationId);
    if (prepared.kind === "busy" || prepared.kind === "failed") {
      await abortCollabRestore(roomKey, operationId);
      return {
        error:
          prepared.kind === "busy"
            ? "다른 화면에서 이미 되돌리는 중입니다. 잠시 뒤 다시 시도해 주세요."
            : "열린 편집 화면의 내용을 확인하지 못해 되돌리지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
      };
    }
    if (prepared.kind === "ready" && !prepared.clean && prepared.content) {
      const checkpoint = await saveRestoreCheckpoint(noteId, actor, noteBefore, prepared.content, prepared.lifecycle);
      if (!checkpoint.ok) {
        await abortCollabRestore(roomKey, operationId);
        return { error: checkpoint.error };
      }
      if (typeof checkpoint.revision === "number" && checkpoint.revision > baseRevision) {
        // checkpoint만 기준을 바꿀 수 있다. 사이에 다른 복원이 있었으면(보지 못한 변경) 되돌리지 않는다.
        const marker = await readPrivateNoteLifecycleMarker(createDbContext(), noteId);
        if (marker > baseRevision) {
          await abortCollabRestore(roomKey, operationId);
          return { error: mutationErrorMessage("VERSION_CONFLICT"), conflictKind: "VERSION_CONFLICT" };
        }
        checkpointBase = checkpoint.revision;
        checkpointRevision = checkpoint.revision;
      }
    }
  }
  let result: Awaited<ReturnType<typeof restorePrivateNoteRevisionAtomically>>;
  try {
    result = await restorePrivateNoteRevisionAtomically(createDbContext(), {
      actor,
      noteId,
      operationId,
      baseRevision: checkpointBase,
      revisionNumber,
      now: new Date(),
    });
  } catch (error) {
    // D1 일시 오류 등으로 끝나도 남긴 복원 준비를 풀어 다음 되돌리기를 막지 않는다.
    if (mayRestore) await abortCollabRestore(roomKey, operationId);
    throw error;
  }
  if (!result.ok) {
    if (mayRestore) await abortCollabRestore(roomKey, operationId);
    return {
      error:
        typeof checkpointRevision === "number"
          ? `${mutationErrorMessage(result.reason)} 되돌리기 전 열린 화면의 내용은 버전 ${checkpointRevision}로 저장해 두었습니다.`
          : mutationErrorMessage(result.reason),
      conflictKind: result.reason,
      currentRevision: result.currentRevision,
      resourceState:
        result.reason === "TRASHED"
          ? "TRASHED"
          : result.reason === "PURGED"
            ? "PURGED"
            : undefined,
    };
  }
  // 이 복원 작업의 revision이 lifecycle 표지다(재전송이면 그 뒤 일반 저장으로 head가 앞서 있을 수 있어 head가 아니라 작업 결과를 쓴다).
  // 열린 편집기에는 복원본을 같은 live 문서의 한 편집으로 적용한다(다시 시작하지 않는다).
  const restoredRevision = result.operationResultRevision ?? result.currentRevision;
  const target = typeof restoredRevision === "number" ? await readNoteRestoreTarget(noteId) : null;
  if (typeof restoredRevision === "number" && target) await applyCollabRestore(roomKey, operationId, restoredRevision, target);
  else if (mayRestore) await abortCollabRestore(roomKey, operationId);
  if (noteBefore) await announceNoteChange(noteBefore, { noteId, revalidate: true });
  return {
    success: true,
    replayed: result.replayed,
    resourceState: result.resourceState,
    currentRevision: result.currentRevision,
    operationResultRevision: result.operationResultRevision,
  };
}

/**
 * 복원 직전 room의 저장되지 않은 내용을 일반 저장 경로(sanitize·CAS·lifecycle 조건)로 revision에 남긴다.
 * 이미 head와 같으면 저장하지 않는다. 저장할 수 없으면(빈 제목·본문, 충돌) 복원을 멈춘다: 옛 내용을 최신 version으로
 * 다시 저장하면 그 사이 다른 저장을 되돌리게 된다.
 */
async function saveRestoreCheckpoint(
  noteId: string,
  actor: { id: string; isAdmin: boolean },
  head: { title: string; contentHtml: string; noteDate: Date | null; version: number },
  content: { html: string; fields: Record<string, string | number | null> },
  lifecycle: number,
): Promise<{ ok: true; revision?: number } | { ok: false; error: string }> {
  const fields = noteRoomFields(head);
  const title = typeof content.fields.title === "string" ? content.fields.title : "";
  const noteDate = typeof content.fields.noteDate === "string" ? content.fields.noteDate : "";
  const { canonicalServerHtml } = await loadServerRestore();
  if (title.trim() === fields.title && noteDate === fields.noteDate && content.html === canonicalServerHtml(head.contentHtml)) {
    return { ok: true };
  }
  const formData = new FormData();
  formData.set("title", title);
  formData.set("contentHtml", content.html);
  formData.set("noteDate", noteDate);
  const payload = validateNotePayload(formData);
  if (!payload.ok) {
    return { ok: false, error: "열린 화면에 제목이나 내용이 비어 있는 작성 중 내용이 있어 되돌리지 않았습니다. 내용을 채우거나 정리한 뒤 다시 시도해 주세요." };
  }
  const result = await updatePrivateNoteAtomically(createDbContext(), {
    actor,
    noteId,
    operationId: createCreationOperationId(),
    baseRevision: head.version,
    title: payload.title,
    contentHtml: payload.contentHtml,
    noteDate: payload.noteDate,
    collabEpoch: lifecycle,
    now: new Date(),
  });
  if (!result.ok) {
    return { ok: false, error: "되돌리기 전에 열린 화면의 내용을 저장하지 못했습니다(그 사이 다른 저장이 있었을 수 있습니다). 잠시 뒤 다시 시도해 주세요." };
  }
  return { ok: true, revision: result.currentRevision ?? result.operationResultRevision };
}
