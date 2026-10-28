/**
 * @file src/lib/actions/comments.ts
 * @description 커뮤니티 댓글 CRUD 서버 액션.
 * 작성: 모든 인증 사용자. 재생 시점은 매체(오디오·링크)가 있는 믹스셋 게시물에만 남길 수 있다.
 * 삭제: 본인 댓글 또는 Admin.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { comments, posts, profiles } from "@/db/schema";
import { and, eq, asc, isNull, sql } from "drizzle-orm";
import { assertOwnerOrAdmin, requireAuth } from "@/lib/auth-guard";
import { CREATION_OPERATION_FIELD, deriveCreationResourceId, resolveCreationOperationId } from "@/lib/creation-operation";
import { COMMENT_TIME_MARKER_FIELD, parseTimeMarker } from "@/lib/community-mixset-media";

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
      timeMarkerSeconds: comments.timeMarkerSeconds,
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
 * @param formData - { content (plain text), timeMarker (선택: h:mm:ss·m:ss·초), operationId (UUID v4) }
 */
export async function createComment(
  postId: string,
  _prev: CreateCommentState,
  formData: FormData,
): Promise<CreateCommentState> {
  const session = await requireAuth();

  const rawContent = formData.get("content");
  const content = typeof rawContent === "string" ? rawContent.trim() : "";
  if (!content) return { error: "댓글 내용을 입력해주세요." };
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) return { error: "작성 정보를 확인하지 못했습니다. 입력 내용을 보관한 뒤 새로고침해 주세요." };

  const timeMarker = parseTimeMarker(formData.get(COMMENT_TIME_MARKER_FIELD));
  if (!timeMarker.ok) return { error: timeMarker.error };
  const timeMarkerSeconds = timeMarker.seconds;

  const db = createDb();
  const commentId = deriveCreationResourceId(operationId, JSON.stringify(["community-comment", session.user.id, postId]));
  const contentHtml = `<p>${escapeHtml(content)}</p>`;
  try {
    const [activePost] = await db
      .select({ id: posts.id, boardType: posts.boardType, mediaUrl: posts.mediaUrl })
      .from(posts)
      .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
      .limit(1);
    if (!activePost) {
      return { error: "휴지통에 있거나 존재하지 않는 게시물에는 댓글을 남길 수 없습니다." };
    }
    if (timeMarkerSeconds !== null && (activePost.boardType !== "FEEDBACK" || !activePost.mediaUrl)) {
      return { error: "재생 시점은 오디오나 링크가 있는 믹스셋 게시물의 댓글에만 남길 수 있습니다." };
    }
    // 조회 이후 휴지통으로 옮겨진 게시물에도 쓰지 않도록 INSERT 안에서 다시 확인한다.
    // 시점 댓글은 같은 자리에서 매체가 있는 믹스셋 게시물인지도 다시 확인한다.
    const postGuard = timeMarkerSeconds === null
      ? sql`(SELECT ${posts.id} FROM ${posts} WHERE ${posts.id} = ${postId} AND ${posts.deletedAt} IS NULL)`
      : sql`(SELECT ${posts.id} FROM ${posts} WHERE ${posts.id} = ${postId} AND ${posts.deletedAt} IS NULL AND ${posts.boardType} = 'FEEDBACK' AND ${posts.mediaUrl} IS NOT NULL)`;
    const inserted = await db.insert(comments).values({
      id: commentId,
      postId: postGuard,
      authorId: session.user.id!,
      contentHtml,
      timeMarkerSeconds,
    }).onConflictDoNothing({ target: comments.id }).returning({ id: comments.id });
    if (inserted.length === 0) {
      const [existing] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      if (
        !existing ||
        existing.authorId !== session.user.id ||
        existing.postId !== postId ||
        existing.contentHtml !== contentHtml ||
        existing.timeMarkerSeconds !== timeMarkerSeconds
      ) {
        return { error: "이 댓글은 수정 전 내용으로 이미 저장되었거나 상태가 바뀌었습니다. 목록을 확인한 뒤 내용을 편집해 새 댓글로 등록해 주세요." };
      }
    }
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

  const condition = and(
    eq(comments.id, commentId),
    eq(comments.postId, postId),
    session.user.role === "admin"
      ? undefined
      : eq(comments.authorId, session.user.id!),
  );

  await db.delete(comments).where(condition);
  revalidatePath(`/community/${postId}`);
}
