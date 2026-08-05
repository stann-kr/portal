/**
 * @file src/lib/actions/privateNotes.ts
 * @description 1:1 프라이빗 수업 게시판(노트) 관리를 위한 서버 액션.
 * Admin과 특정 Student만이 해당 노트를 읽고 쓸 수 있음.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { privateNotes, profiles } from "@/db/schema";
import { and, eq, desc, isNull } from "drizzle-orm";
import { requireAuth, assertOwnerOrAdmin } from "@/lib/auth-guard";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { isRichTextEmpty } from "@/lib/rich-text";
import {
  CREATION_OPERATION_FIELD,
  deriveCreationResourceId,
  resolveCreationOperationId,
} from "@/lib/creation-operation";

/**
 * 특정 학생의 프라이빗 노트 목록 조회.
 * Admin은 모든 학생의 노트를 볼 수 있고, 학생은 본인의 노트만 볼 수 있음.
 */
export async function getPrivateNotes(targetStudentId: string) {
  const session = await requireAuth();

  assertOwnerOrAdmin(session, targetStudentId);

  const db = createDb();
  
  // profile 정보와 조인하여 작성자 displayName 등을 가져올 수 있다
  const notes = await db
    .select({
      id: privateNotes.id,
      title: privateNotes.title,
      contentHtml: privateNotes.contentHtml,
      createdAt: privateNotes.createdAt,
      authorId: privateNotes.authorId,
      authorName: profiles.displayName,
    })
    .from(privateNotes)
    .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
    .where(eq(privateNotes.studentId, targetStudentId))
    .orderBy(desc(privateNotes.createdAt));

  return notes;
}

/** 단일 노트를 권한 범위 안에서 조회한다. */
export async function getPrivateNote(noteId: string) {
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
      authorName: profiles.displayName,
    })
    .from(privateNotes)
    .leftJoin(profiles, eq(privateNotes.authorId, profiles.id))
    .where(eq(privateNotes.id, noteId))
    .limit(1);

  if (!note) return null;
  assertOwnerOrAdmin(session, note.studentId);
  return note;
}

export type CreateNoteState = {
  error?: string;
  success?: boolean;
  operationConflict?: boolean;
  conflictedOperationId?: string;
  existingId?: string;
  note?: {
    id: string;
    title: string;
    contentHtml: string;
    noteDate: Date | null;
    createdAt: Date | null;
  };
};

/**
 * 1:1 노트 작성.
 * @param targetStudentId 노트를 소유/공유할 대상 학생 ID
 */
export async function createPrivateNote(targetStudentId: string, _prev: CreateNoteState, formData: FormData): Promise<CreateNoteState> {
  const session = await requireAuth();
  const userId = session.user.id!;

  assertOwnerOrAdmin(session, targetStudentId);

  const title = String(formData.get("title") ?? "").trim();
  const rawHtml = String(formData.get("contentHtml") ?? "");

  if (!title || isRichTextEmpty(rawHtml)) return { error: "제목과 내용은 필수입니다." };

  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml)) return { error: "유효한 노트 내용을 입력해 주세요." };

  // 사용자 지정 날짜 파싱 (YYYY-MM-DD → Date, 없으면 null)
  const noteDateStr = String(formData.get("noteDate") ?? "");
  const noteDate = noteDateStr ? new Date(noteDateStr) : null;
  if (noteDate && Number.isNaN(noteDate.getTime())) {
    return { error: "올바른 날짜를 입력해 주세요." };
  }

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

  const db = createDb();
  const findExisting = async () => {
    const [existing] = await db
      .select({
        id: privateNotes.id,
        studentId: privateNotes.studentId,
        authorId: privateNotes.authorId,
        title: privateNotes.title,
        contentHtml: privateNotes.contentHtml,
        noteDate: privateNotes.noteDate,
        createdAt: privateNotes.createdAt,
      })
      .from(privateNotes)
      .where(eq(privateNotes.id, id))
      .limit(1);
    return existing ?? null;
  };
  const isSameSubmission = (existing: Awaited<ReturnType<typeof findExisting>>) =>
    Boolean(
      existing &&
      existing.studentId === targetStudentId &&
      existing.authorId === userId &&
      existing.title === title &&
      existing.contentHtml === contentHtml &&
      (existing.noteDate?.getTime() ?? null) === (noteDate?.getTime() ?? null),
    );

  let createdAt: Date | null = null;

  try {
    const [inserted] = await db
      .insert(privateNotes)
      .values({
        id,
        studentId: targetStudentId,
        authorId: userId,
        title,
        contentHtml,
        ...(noteDate ? { noteDate } : {}),
      })
      .returning({ createdAt: privateNotes.createdAt });
    createdAt = inserted?.createdAt ?? null;
  } catch {
    try {
      const existing = await findExisting();
      if (isSameSubmission(existing)) {
        createdAt = existing?.createdAt ?? null;
      } else if (
        existing?.studentId === targetStudentId &&
        existing.authorId === userId
      ) {
        return {
          error: "이 초안은 다른 내용으로 이미 저장되었습니다. 기존 노트를 열거나 별도 노트로 분리해 주세요.",
          operationConflict: true,
          conflictedOperationId: operationId,
          existingId: existing.id,
        };
      } else {
        return { error: "노트 작성 중 오류가 발생했습니다." };
      }
    } catch {
      return { error: "노트 작성 중 오류가 발생했습니다." };
    }
  }

  // Admin 뷰(탭 통합 포함)와 Student 뷰 양쪽 모두 갱신
  revalidatePath(`/dashboard/admin/students/${targetStudentId}`);
  revalidatePath(`/dashboard/admin/students/${targetStudentId}/notes`);
  revalidatePath(`/dashboard/student/notes`);
  revalidatePath("/dashboard/student");

  return { success: true, note: { id, title, contentHtml, noteDate, createdAt } };
}

export type UpdateNoteState = {
  error?: string;
  success?: boolean;
  note?: { id: string; title: string; contentHtml: string; noteDate: Date | null };
};

/**
 * 저장된 노트를 다시 편집한다. 작성자 또는 관리자로 제한한다.
 * 현재 저장본 스냅샷으로 충돌을 감지하며, 버전 컬럼과 이력 보존은 schema migration 승인 후 추가한다.
 */
export async function updatePrivateNote(
  noteId: string,
  _prev: UpdateNoteState,
  formData: FormData,
): Promise<UpdateNoteState> {
  const session = await requireAuth();
  const db = createDb();
  const [existing] = await db
    .select({
      id: privateNotes.id,
      studentId: privateNotes.studentId,
      authorId: privateNotes.authorId,
      title: privateNotes.title,
      contentHtml: privateNotes.contentHtml,
      noteDate: privateNotes.noteDate,
    })
    .from(privateNotes)
    .where(eq(privateNotes.id, noteId))
    .limit(1);

  if (!existing) return { error: "노트를 찾을 수 없습니다." };
  assertOwnerOrAdmin(session, existing.authorId);

  const title = String(formData.get("title") ?? "").trim();
  const rawHtml = String(formData.get("contentHtml") ?? "");
  if (!title || isRichTextEmpty(rawHtml)) return { error: "제목과 내용은 필수입니다." };

  const contentHtml = sanitizeHtml(rawHtml);
  if (isRichTextEmpty(contentHtml)) return { error: "유효한 노트 내용을 입력해 주세요." };

  const noteDateValue = String(formData.get("noteDate") ?? "");
  const noteDate = noteDateValue ? new Date(noteDateValue) : null;
  if (noteDate && Number.isNaN(noteDate.getTime())) return { error: "올바른 날짜를 입력해 주세요." };

  const baseTitle = formData.get("baseTitle");
  const baseContentHtml = formData.get("baseContentHtml");
  const baseNoteDateValue = formData.get("baseNoteDate");
  if (
    typeof baseTitle !== "string" ||
    typeof baseContentHtml !== "string" ||
    typeof baseNoteDateValue !== "string"
  ) {
    return { error: "편집 기준 정보를 확인할 수 없습니다. 페이지를 새로고침해 주세요." };
  }
  const baseNoteDate = baseNoteDateValue ? new Date(baseNoteDateValue) : null;
  if (baseNoteDate && Number.isNaN(baseNoteDate.getTime())) {
    return { error: "편집 기준 날짜를 확인할 수 없습니다. 페이지를 새로고침해 주세요." };
  }

  const alreadyCurrent =
    existing.title === title &&
    existing.contentHtml === contentHtml &&
    (existing.noteDate?.getTime() ?? null) === (noteDate?.getTime() ?? null);

  if (!alreadyCurrent) {
    let updated: { id: string }[];
    try {
      updated = await db
        .update(privateNotes)
        .set({ title, contentHtml, noteDate })
        .where(and(
          eq(privateNotes.id, noteId),
          eq(privateNotes.title, baseTitle),
          eq(privateNotes.contentHtml, baseContentHtml),
          baseNoteDate ? eq(privateNotes.noteDate, baseNoteDate) : isNull(privateNotes.noteDate),
        ))
        .returning({ id: privateNotes.id });
    } catch {
      return { error: "노트를 저장하지 못했습니다. 다시 시도해 주세요." };
    }
    if (updated.length === 0) {
      let current: {
        authorId: string;
        title: string;
        contentHtml: string;
        noteDate: Date | null;
      } | undefined;
      try {
        [current] = await db
          .select({
            authorId: privateNotes.authorId,
            title: privateNotes.title,
            contentHtml: privateNotes.contentHtml,
            noteDate: privateNotes.noteDate,
          })
          .from(privateNotes)
          .where(eq(privateNotes.id, noteId))
          .limit(1);
      } catch {
        return { error: "노트를 저장하지 못했습니다. 다시 시도해 주세요." };
      }
      if (current) assertOwnerOrAdmin(session, current.authorId);
      const converged =
        current?.title === title &&
        current.contentHtml === contentHtml &&
        (current.noteDate?.getTime() ?? null) === (noteDate?.getTime() ?? null);
      if (!converged) {
        return {
          error: "다른 화면에서 이 노트가 먼저 변경되었습니다. 현재 내용은 임시 저장되어 있으며, 새로고침 후 서버 최신본과 초안 중 선택할 수 있습니다.",
        };
      }
    }
  }

  revalidatePath(`/dashboard/notes/${noteId}`);
  revalidatePath(`/dashboard/admin/students/${existing.studentId}`);
  revalidatePath(`/dashboard/admin/students/${existing.studentId}/notes`);
  revalidatePath("/dashboard/student");

  return { success: true, note: { id: noteId, title, contentHtml, noteDate } };
}

export async function deletePrivateNote(noteId: string) {
  const session = await requireAuth();

  const db = createDb();
  
  // 삭제할 노트 조회하여 권한 체크
  const note = await db.select().from(privateNotes).where(eq(privateNotes.id, noteId)).limit(1);
  if (note.length === 0) throw new Error("Not found");
  
  const targetNote = note[0];

  assertOwnerOrAdmin(session, targetNote.authorId);

  await db.delete(privateNotes).where(eq(privateNotes.id, noteId));
  revalidatePath(`/dashboard/admin/students/${targetNote.studentId}`);
  revalidatePath(`/dashboard/admin/students/${targetNote.studentId}/notes`);
  revalidatePath(`/dashboard/student/notes`);
  revalidatePath("/dashboard/student");
}
