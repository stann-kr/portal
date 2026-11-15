/**
 * 노트 접근 판단의 서버 쪽 진입점. 규칙은 `note-access-rules.ts`의 `resolveNoteAccess` 하나이고,
 * 여기서는 그룹 노트일 때만 지금 멤버십을 DB에서 읽어 넘긴다.
 */
import { and, eq } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import { lessonGroupMembers } from "@/db/schema";
import { asDocumentReadDb } from "@/lib/document-lifecycle-atomic";
import {
  noteAccessNeedsMembership,
  resolveNoteAccess,
  type NoteAccessActor,
  type NoteAccessMode,
  type NoteAccessSubject,
} from "@/lib/note-access-rules";

/** 학생이 지금 그 그룹 멤버인지. */
export async function isCurrentLessonGroupMember(context: DbContext, studentId: string, groupId: string): Promise<boolean> {
  const [row] = await asDocumentReadDb(context)
    .select({ studentId: lessonGroupMembers.studentId })
    .from(lessonGroupMembers)
    .where(and(eq(lessonGroupMembers.studentId, studentId), eq(lessonGroupMembers.groupId, groupId)))
    .limit(1);
  return Boolean(row);
}

export async function readNoteAccess(
  context: DbContext,
  actor: NoteAccessActor,
  note: NoteAccessSubject,
): Promise<NoteAccessMode | null> {
  const member = noteAccessNeedsMembership(actor, note)
    ? await isCurrentLessonGroupMember(context, actor.id, note.groupId)
    : false;
  return resolveNoteAccess(actor, note, member);
}
