/**
 * @file src/lib/actions/privateNotes.ts
 * @description 1:1 프라이빗 수업 게시판(노트) 관리를 위한 서버 액션.
 * Admin과 특정 Student만이 해당 노트를 읽고 쓸 수 있음.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { privateNotes, profiles } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth, assertOwnerOrAdmin } from "@/lib/auth-guard";
import { sanitizeHtml } from "@/lib/sanitize-html";

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

export type CreateNoteState = {
  error?: string;
  success?: boolean;
  note?: { id: string; title: string; noteDate: Date | null; createdAt: Date | null };
};

/**
 * 1:1 노트 작성.
 * @param targetStudentId 노트를 소유/공유할 대상 학생 ID
 */
export async function createPrivateNote(targetStudentId: string, _prev: CreateNoteState, formData: FormData): Promise<CreateNoteState> {
  const session = await requireAuth();
  const userId = session.user.id!;

  assertOwnerOrAdmin(session, targetStudentId);

  const title = formData.get("title") as string;
  const rawHtml = formData.get("contentHtml") as string;

  if (!title || !rawHtml) return { error: "제목과 내용은 필수입니다." };

  const contentHtml = sanitizeHtml(rawHtml);

  // 사용자 지정 날짜 파싱 (YYYY-MM-DD → Date, 없으면 null)
  const noteDateStr = formData.get("noteDate") as string | null;
  const noteDate = noteDateStr ? new Date(noteDateStr) : null;

  const db = createDb();
  const id = crypto.randomUUID();
  const now = new Date();

  try {
    await db.insert(privateNotes).values({
      id,
      studentId: targetStudentId,
      authorId: userId,
      title,
      contentHtml,
      ...(noteDate ? { noteDate } : {}),
    });

    // Admin 뷰(탭 통합 포함)와 Student 뷰 양쪽 모두 갱신
    revalidatePath(`/dashboard/admin/students/${targetStudentId}`);
    revalidatePath(`/dashboard/admin/students/${targetStudentId}/notes`);
    revalidatePath(`/dashboard/student/notes`);
    revalidatePath("/dashboard/student");

    return { success: true, note: { id, title, noteDate, createdAt: now } };
  } catch {
    return { error: "노트 작성 중 오류가 발생했습니다." };
  }
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
