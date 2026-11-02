/**
 * @file src/lib/actions/instructorMemos.ts
 * @description 관리자만 보는 수업 메모(학생별·노트별) server action. 모든 호출이 관리자 세션을 요구하고,
 * 노트 메모는 대상 학생을 클라이언트 입력이 아니라 노트에서 읽는다.
 */
"use server";

import { and, eq, isNull } from "drizzle-orm";
import { createDb } from "@/db/client";
import { privateNotes } from "@/db/schema";
import { requireAdmin, requireStudentTarget } from "@/lib/auth-guard";
import {
  INSTRUCTOR_MEMO_MAX_HTML_LENGTH,
  listInstructorMemoRevisions,
  readInstructorMemo,
  saveInstructorMemo,
  type InstructorMemoHead,
  type InstructorMemoTarget,
} from "@/lib/instructor-memo";
import { isRichTextEmpty } from "@/lib/rich-text";
import { sanitizeHtml } from "@/lib/sanitize-html";

/** 클라이언트가 고르는 메모 대상. 노트 메모의 학생은 서버가 노트에서 정한다. */
export type InstructorMemoScope =
  | { kind: "student"; studentId: string }
  | { kind: "note"; noteId: string };

export type InstructorMemoSnapshot = {
  memoId: string | null;
  contentHtml: string;
  /** 0이면 아직 저장한 적 없는 메모 */
  version: number;
  updatedAt: Date | null;
};

export type SaveInstructorMemoState =
  | { ok: true; memo: InstructorMemoSnapshot }
  | { ok: false; error: string; conflict?: InstructorMemoSnapshot };

function toSnapshot(memo: InstructorMemoHead | null): InstructorMemoSnapshot {
  return memo
    ? { memoId: memo.id, contentHtml: memo.contentHtml, version: memo.version, updatedAt: memo.updatedAt }
    : { memoId: null, contentHtml: "", version: 0, updatedAt: null };
}

async function resolveTarget(scope: InstructorMemoScope): Promise<InstructorMemoTarget | null> {
  if (scope.kind === "student") {
    await requireStudentTarget(scope.studentId);
    return { studentId: scope.studentId, noteId: null };
  }
  const db = createDb();
  const [note] = await db
    .select({ studentId: privateNotes.studentId })
    .from(privateNotes)
    .where(and(eq(privateNotes.id, scope.noteId), isNull(privateNotes.deletedAt)))
    .limit(1);
  if (!note) return null;
  await requireStudentTarget(note.studentId);
  return { studentId: note.studentId, noteId: scope.noteId };
}

export async function getInstructorMemo(scope: InstructorMemoScope): Promise<InstructorMemoSnapshot | null> {
  await requireAdmin();
  const target = await resolveTarget(scope);
  if (!target) return null;
  return toSnapshot(await readInstructorMemo(createDb(), target));
}

export async function saveInstructorMemoAction(
  scope: InstructorMemoScope,
  input: { contentHtml: string; baseVersion: number },
): Promise<SaveInstructorMemoState> {
  const session = await requireAdmin();
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 0) {
    return { ok: false, error: "저장 기준을 확인할 수 없습니다. 새로고침한 뒤 다시 시도해 주세요." };
  }
  const target = await resolveTarget(scope);
  if (!target) return { ok: false, error: "메모를 붙일 노트를 찾을 수 없습니다." };
  const raw = typeof input.contentHtml === "string" ? input.contentHtml : "";
  const contentHtml = isRichTextEmpty(raw) ? "" : sanitizeHtml(raw);
  if (contentHtml.length > INSTRUCTOR_MEMO_MAX_HTML_LENGTH) {
    return { ok: false, error: "메모가 너무 깁니다. 일부를 나눠 적어 주세요." };
  }
  const db = createDb();
  // 처음 쓰는 메모를 비운 채 저장하지 않는다.
  if (input.baseVersion === 0 && contentHtml === "") {
    return { ok: true, memo: toSnapshot(null) };
  }
  const result = await saveInstructorMemo(db, {
    ...target,
    contentHtml,
    baseVersion: input.baseVersion,
    actorId: session.user.id!,
    now: new Date(),
  });
  if (!result.ok) {
    return {
      ok: false,
      error: "다른 기기에서 먼저 저장한 메모가 있습니다.",
      conflict: toSnapshot(result.current),
    };
  }
  return { ok: true, memo: toSnapshot(result.memo) };
}

export type InstructorMemoRevisionItem = {
  id: string;
  contentHtml: string;
  savedAt: Date;
};

export async function getInstructorMemoRevisions(scope: InstructorMemoScope): Promise<InstructorMemoRevisionItem[]> {
  await requireAdmin();
  const target = await resolveTarget(scope);
  if (!target) return [];
  const db = createDb();
  const memo = await readInstructorMemo(db, target);
  if (!memo) return [];
  const revisions = await listInstructorMemoRevisions(db, memo.id);
  return revisions.map((revision) => ({
    id: revision.id,
    contentHtml: revision.contentHtml,
    savedAt: revision.updatedAt,
  }));
}
