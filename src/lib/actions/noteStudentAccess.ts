"use server";

/**
 * 관리자가 노트의 학생 편집을 막거나 푼다(2026-11-23 사용자 결정, 0036 `student_read_only`). 기본은 함께 쓰기다.
 * 관리자가 만든 노트(개인·그룹)만 바꿀 수 있다. 학생이 만든 노트는 그 학생 것이라 막지 않는다(`canToggleStudentReadOnly`).
 * 막으면 열린 학생 편집 연결을 바로 읽기로 내린다. 풀면 학생이 노트를 다시 열 때부터 편집한다(읽기 연결은 올리지 않는다).
 */
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { createDb, createDbContext } from "@/db/client";
import { privateNotes, profiles } from "@/db/schema";
import { requireAdmin } from "@/lib/auth-guard";
import { formatCollabDocKey } from "@/lib/collab/doc-key";
import { downgradeCollabRoomUsersAfterMutation } from "@/lib/collab/server-env";
import { readLessonGroupMemberIds } from "@/lib/lesson-groups";
import { canToggleStudentReadOnly } from "@/lib/note-access-rules";

export type NoteStudentAccessResult = { ok: true; studentReadOnly: boolean } | { ok: false; error: string };

export async function setNoteStudentReadOnly(noteId: string, studentReadOnly: boolean): Promise<NoteStudentAccessResult> {
  const session = await requireAdmin();
  if (typeof noteId !== "string" || noteId.length === 0 || typeof studentReadOnly !== "boolean") {
    return { ok: false, error: "노트를 다시 열어 주세요." };
  }
  const db = createDb();
  const [note] = await db
    .select({
      id: privateNotes.id,
      studentId: privateNotes.studentId,
      authorId: privateNotes.authorId,
      groupId: privateNotes.groupId,
      studentReadOnly: privateNotes.studentReadOnly,
      authorRole: profiles.role,
    })
    .from(privateNotes)
    .innerJoin(profiles, eq(profiles.id, privateNotes.authorId))
    .where(and(eq(privateNotes.id, noteId), isNull(privateNotes.deletedAt)))
    .limit(1);
  if (!note) return { ok: false, error: "노트를 찾을 수 없습니다. 휴지통으로 옮겨졌는지 확인해 주세요." };
  const actor = { id: session.user.id!, isAdmin: true };
  if (!canToggleStudentReadOnly(actor, { ...note, authorIsAdmin: note.authorRole === "admin" })) {
    return { ok: false, error: "학생이 만든 노트는 읽기 전용으로 바꿀 수 없습니다." };
  }
  if (note.studentReadOnly !== studentReadOnly) {
    await db
      .update(privateNotes)
      .set({ studentReadOnly })
      .where(and(eq(privateNotes.id, note.id), eq(privateNotes.authorId, note.authorId), isNull(privateNotes.deletedAt)));
  }
  if (studentReadOnly) {
    const studentIds = note.groupId ? await readLessonGroupMemberIds(createDbContext(), note.groupId) : [note.studentId];
    await downgradeCollabRoomUsersAfterMutation(
      formatCollabDocKey({ kind: "note", id: note.id }),
      studentIds.filter((id) => id !== note.authorId),
    );
  }
  revalidatePath(`/dashboard/notes/${note.id}`);
  return { ok: true, studentReadOnly };
}
