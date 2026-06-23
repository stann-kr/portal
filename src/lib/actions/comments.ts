/**
 * @file src/lib/actions/comments.ts
 * @description 커뮤니티 댓글 CRUD 서버 액션.
 * 작성: 모든 인증 사용자.
 * 삭제: 본인 댓글 또는 Admin.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { comments, profiles } from "@/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth-guard";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ───────────────────────────────────────────────
// 조회
// ───────────────────────────────────────────────

/**
 * 게시물별 댓글 목록 조회 (작성 순서 오름차순, 작성자 정보 포함).
 */
export async function getCommentsByPost(postId: string) {
  const db = createDb();
  return db
    .select({
      id: comments.id,
      postId: comments.postId,
      authorId: comments.authorId,
      contentHtml: comments.contentHtml,
      createdAt: comments.createdAt,
      authorName: profiles.displayName,
      authorEmail: profiles.email,
    })
    .from(comments)
    .leftJoin(profiles, eq(comments.authorId, profiles.id))
    .where(eq(comments.postId, postId))
    .orderBy(asc(comments.createdAt));
}

// ───────────────────────────────────────────────
// 생성
// ───────────────────────────────────────────────

export type CreateCommentState = { error?: string; success?: boolean };

/**
 * 댓글 작성.
 * @param postId - 대상 게시물 ID
 * @param _prev - useActionState 이전 상태
 * @param formData - { content (plain text) }
 */
export async function createComment(
  postId: string,
  _prev: CreateCommentState,
  formData: FormData,
): Promise<CreateCommentState> {
  const session = await requireAuth();

  const content = (formData.get("content") as string)?.trim();
  if (!content) return { error: "댓글 내용을 입력해주세요." };

  const db = createDb();
  await db.insert(comments).values({
    id: crypto.randomUUID(),
    postId,
    authorId: session.user.id!,
    contentHtml: `<p>${escapeHtml(content)}</p>`,
  });

  revalidatePath(`/community/${postId}`);
  return { success: true };
}

// ───────────────────────────────────────────────
// 삭제 (본인 댓글 또는 Admin)
// ───────────────────────────────────────────────

/**
 * 댓글 삭제.
 */
export async function deleteComment(commentId: string, postId: string) {
  const session = await requireAuth();
  const db = createDb();

  const condition =
    session.user.role === "admin"
      ? eq(comments.id, commentId)
      : and(
          eq(comments.id, commentId),
          eq(comments.authorId, session.user.id!),
        );

  await db.delete(comments).where(condition);
  revalidatePath(`/community/${postId}`);
}
