/**
 * @file src/lib/actions/privateNotes.ts
 * @description private note의 active/history/trash lifecycle server action.
 */
"use server";

import { revalidatePath } from "next/cache";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { createDb, createDbContext } from "@/db/client";
import { privateNoteRevisions, privateNotes, profiles } from "@/db/schema";
import { requireAuth, requireStudentOwnerOrAdmin } from "@/lib/auth-guard";
import {
  CREATION_OPERATION_FIELD,
  deriveCreationResourceId,
  resolveCreationOperationId,
} from "@/lib/creation-operation";
import { parseDocumentNoteDateInput } from "@/lib/document-snapshot-fingerprint";
import {
  createPrivateNoteAtomically,
  purgePrivateNoteAtomically,
  restorePrivateNoteRevisionAtomically,
  restoreTrashedPrivateNoteAtomically,
  trashPrivateNoteAtomically,
  updatePrivateNoteAtomically,
  type PrivateNoteMutationFailureReason,
  type PrivateNoteResourceState,
} from "@/lib/private-note-atomic";
import {
  PRIVATE_NOTE_BASE_REVISION_FIELD,
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
      return "복원 가능 기간 30일이 지났습니다. 관리자에게 문의해 주세요.";
    case "DOCUMENT_TOO_LARGE":
      return `노트 본문은 저장된 HTML 기준 ${PRIVATE_NOTE_MAX_CONTENT_LABEL}까지 저장할 수 있습니다. 내용을 나누어 주세요.`;
    case "STORAGE_QUOTA_EXCEEDED":
      return "노트 저장공간 100 MiB 한도에 도달했습니다. 오래된 노트를 정리하거나 관리자에게 문의해 주세요.";
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

/** active note만 반환한다. */
export async function getPrivateNotes(targetStudentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, targetStudentId);
  const db = createDb();
  return db
    .select({
      id: privateNotes.id,
      title: privateNotes.title,
      contentHtml: privateNotes.contentHtml,
      noteDate: privateNotes.noteDate,
      createdAt: privateNotes.createdAt,
      updatedAt: privateNotes.updatedAt,
      version: privateNotes.version,
      authorId: privateNotes.authorId,
      authorName: profiles.displayName,
    })
    .from(privateNotes)
    .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
    .where(
      and(
        eq(privateNotes.studentId, targetStudentId),
        isNull(privateNotes.deletedAt),
      ),
    )
    .orderBy(desc(privateNotes.createdAt));
}

/** 목록 미리보기(평문 앞부분)에 필요한 만큼만 본문 앞부분을 읽는다. 미리보기도 앞 4,096자만 본다. */
const PRIVATE_NOTE_PREVIEW_SOURCE_CHARS = 4_096;

/**
 * 학생 상세 노트 탭용: 전체 본문 대신 최근 note 몇 개의 본문 앞부분과 active note 수만 읽는다.
 * 권한 검사는 getPrivateNotes와 같다.
 */
export async function getRecentPrivateNotesOverview(targetStudentId: string, limit: number) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, targetStudentId);
  const db = createDb();
  const activeNotesOfStudent = and(
    eq(privateNotes.studentId, targetStudentId),
    isNull(privateNotes.deletedAt),
  );
  const [notes, [totals]] = await Promise.all([
    db
      .select({
        id: privateNotes.id,
        title: privateNotes.title,
        contentHtml: sql<string>`substr(${privateNotes.contentHtml}, 1, ${PRIVATE_NOTE_PREVIEW_SOURCE_CHARS})`,
        noteDate: privateNotes.noteDate,
        createdAt: privateNotes.createdAt,
        updatedAt: privateNotes.updatedAt,
        authorName: profiles.displayName,
      })
      .from(privateNotes)
      .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
      .where(activeNotesOfStudent)
      .orderBy(desc(privateNotes.createdAt))
      .limit(limit),
    db.select({ value: count() }).from(privateNotes).where(activeNotesOfStudent),
  ]);
  return { notes, total: totals?.value ?? 0 };
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
  await requireStudentOwnerOrAdmin(session, note.studentId);
  return note;
}

export async function getTrashedPrivateNotes(targetStudentId: string) {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, targetStudentId);
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
    })
    .from(privateNotes)
    .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
    .where(
      and(
        eq(privateNotes.studentId, targetStudentId),
        isNotNull(privateNotes.deletedAt),
      ),
    )
    .orderBy(desc(privateNotes.deletedAt));

  return notes.map((note) => ({
    ...note,
    purgeEligibleAt: note.deletedAt
      ? new Date(note.deletedAt.getTime() + PRIVATE_NOTE_TRASH_RETENTION_SECONDS * 1000)
      : null,
  }));
}

export async function getPrivateNoteRevisions(noteId: string) {
  const note = await getPrivateNoteIncludingTrash(noteId);
  if (!note) return [];
  const db = createDb();
  return db
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
      createdAt: privateNoteRevisions.createdAt,
    })
    .from(privateNoteRevisions)
    .leftJoin(profiles, eq(privateNoteRevisions.actorId, profiles.id))
    .where(eq(privateNoteRevisions.noteId, noteId))
    .orderBy(desc(privateNoteRevisions.revisionNumber));
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
  const payload = validateNotePayload(formData);
  if (!payload.ok) return { error: payload.error, conflictKind: payload.reason };

  const operationId = resolveCreationOperationId(
    formData.get(CREATION_OPERATION_FIELD),
  );
  if (!operationId) {
    return { error: "문서 생성 식별자가 올바르지 않습니다. 페이지를 새로고침해 주세요." };
  }
  const id = deriveCreationResourceId(
    operationId,
    JSON.stringify(["private-note", userId, targetStudentId]),
  );
  const result = await createPrivateNoteAtomically(createDbContext(), {
    actor: { id: userId, isAdmin: session.user.role === "admin" },
    subjectId: targetStudentId,
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

  revalidatePrivateNotePaths(targetStudentId, id);
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
  success?: boolean;
  conflictKind?: PrivateNoteMutationFailureReason;
  replayed?: boolean;
  resourceState?: PrivateNoteResourceState;
  operationResultRevision?: number;
  currentRevision?: number | null;
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
    now: new Date(),
  });
  if (!result.ok) {
    let conflictNote: UpdateNoteState["conflictNote"];
    if (result.reason === "VERSION_CONFLICT") {
      const db = createDb();
      const [current] = await db
        .select({
          id: privateNotes.id,
          studentId: privateNotes.studentId,
          authorId: privateNotes.authorId,
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
          (session.user.role === "admin" ||
            (session.user.id === current.studentId &&
              session.user.id === current.authorId)),
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
  revalidatePrivateNotePaths(note.studentId, noteId);
  return {
    success: true,
    replayed: result.replayed,
    resourceState: result.resourceState,
    operationResultRevision: result.operationResultRevision,
    currentRevision,
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
  if (!current || (!isAdmin && current.authorId !== session.user.id)) {
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
  revalidatePrivateNotePaths(current.studentId, noteId);
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
  if (noteBefore) revalidatePrivateNotePaths(noteBefore.studentId, noteId);
  return {
    success: true,
    replayed: result.replayed,
    resourceState: result.resourceState,
    currentRevision: result.currentRevision,
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
  const result = await restorePrivateNoteRevisionAtomically(createDbContext(), {
    actor: { id: session.user.id!, isAdmin: session.user.role === "admin" },
    noteId,
    operationId,
    baseRevision,
    revisionNumber,
    now: new Date(),
  });
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
  if (noteBefore) revalidatePrivateNotePaths(noteBefore.studentId, noteId);
  return {
    success: true,
    replayed: result.replayed,
    resourceState: result.resourceState,
    currentRevision: result.currentRevision,
  };
}
