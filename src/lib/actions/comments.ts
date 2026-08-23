/**
 * @file src/lib/actions/comments.ts
 * @description 커뮤니티 댓글 CRUD 서버 액션.
 * 작성: 모든 인증 사용자.
 * 삭제: 본인 댓글 또는 Admin.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { comments, posts, profiles } from "@/db/schema";
import { and, eq, asc, isNull } from "drizzle-orm";
import { assertOwnerOrAdmin, requireAuth } from "@/lib/auth-guard";

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
  const session = await requireAuth();
  const db = createDb();
  const [post] = await db
    .select({ authorId: posts.authorId, deletedAt: posts.deletedAt })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return [];
  if (post.deletedAt) assertOwnerOrAdmin(session, post.authorId);
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

export type CreateCommentState = {
  error?: string;
  success?: boolean;
  commentId?: string;
};

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
  const commentId = crypto.randomUUID();
  try {
    const [activePost] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
      .limit(1);
    if (!activePost) {
      return { error: "휴지통에 있거나 존재하지 않는 게시물에는 댓글을 남길 수 없습니다." };
    }
    await db.insert(comments).values({
      id: commentId,
      postId,
      authorId: session.user.id!,
      contentHtml: `<p>${escapeHtml(content)}</p>`,
    });
  } catch {
    return { error: "댓글을 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  revalidatePath(`/community/${postId}`);
  return { success: true, commentId };
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

  const [activePost] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  if (!activePost) return;

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
