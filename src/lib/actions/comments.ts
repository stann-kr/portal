/**
 * @file src/lib/actions/comments.ts
 * @description 커뮤니티 댓글 CRUD 서버 액션.
 * 작성: 모든 인증 사용자. 재생 시점은 매체(오디오·링크)가 있는 믹스셋 게시물에만 남길 수 있다.
 * 답글: 같은 게시물 원 댓글에 한 단계로 단다(답글의 답글도 그 원 댓글 묶음으로). 답글에는 재생 시점이 없다.
 * 삭제: 본인 댓글 또는 Admin. 원 댓글을 지워도 답글은 남고 화면이 그 자리를 "삭제된 댓글입니다"로 보인다.
 */
"use server";

import { revalidatePath } from "next/cache";
import { createDb } from "@/db/client";
import { comments, posts, profiles } from "@/db/schema";
import { and, eq, asc, isNull, sql } from "drizzle-orm";
import { assertOwnerOrAdmin, requireAuth } from "@/lib/auth-guard";
import { CREATION_OPERATION_FIELD, deriveCreationResourceId, resolveCreationOperationId } from "@/lib/creation-operation";
import { COMMENT_MAX_LENGTH, COMMENT_PARENT_FIELD, COMMENT_REPLY_TO_FIELD } from "@/lib/community-comment";
import { COMMENT_TIME_MARKER_FIELD, parseTimeMarker } from "@/lib/community-mixset-media";
import { publicAuthorName } from "@/lib/public-author-name";
import { pushMessages } from "@/lib/push/messages";
import { notifyPush } from "@/lib/push/notify";
import { runAfterResponse } from "@/lib/after-response";

// 댓글은 짧은 일반 글이라 문서 본문(800 KiB)보다 훨씬 작게 막는다. 글자 수는 code point로 센다(입력 칸과 같은 상수).

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
      parentId: comments.parentId,
      authorName: publicAuthorName,
      authorRole: profiles.role,
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
  /** 답글을 달 원 댓글이 지워져 저장하지 않았다. 입력 칸은 쓴 글을 새 댓글로 옮길 수 있게 한다. */
  replyRootMissing?: boolean;
};

/**
 * 새 댓글 알림: 답글이면 원 댓글 작성자와 "답글"을 누른 답글의 작성자(@이름, 2026-11-20 사용자 결정)에게 "내 댓글에 답글",
 * 글쓴이에게 "내 글에 새 댓글", 앞서 댓글을 단 다른 사람에게 "새 댓글". 한 사람에게는 한 건만(답글 > 내 글 > 참여 순) 가고,
 * 댓글 쓴 본인은 받지 않는다. 알림 준비가 실패해도 댓글 저장 결과는 바꾸지 않는다.
 */
async function notifyCommentAdded(
  db: ReturnType<typeof createDb>,
  postId: string,
  post: { title: string; authorId: string },
  session: Awaited<ReturnType<typeof requireAuth>>,
  reply: { rootId: string; rootAuthorId: string; replyToId: string | null } | null,
  commentId: string,
): Promise<void> {
  try {
    const actorId = session.user.id;
    const authorName = session.user.name ?? null;
    const replyAuthorIds = reply ? [reply.rootAuthorId] : [];
    if (reply?.replyToId && reply.replyToId !== reply.rootId) {
      // 같은 묶음의 답글일 때만 그 작성자를 더한다. 지워졌거나 다른 묶음이면 원 댓글 작성자에게만 간다.
      const [target] = await db
        .select({ authorId: comments.authorId })
        .from(comments)
        .where(and(eq(comments.id, reply.replyToId), eq(comments.postId, postId), eq(comments.parentId, reply.rootId)))
        .limit(1);
      if (target) replyAuthorIds.push(target.authorId);
    }
    const replyRecipients = [...new Set(replyAuthorIds)].filter((id) => id !== actorId);
    if (replyRecipients.length > 0) {
      await notifyPush(
        { kind: "profiles", profileIds: replyRecipients },
        pushMessages.commentReplied({ postId, commentId, authorName, title: post.title }),
        { excludeProfileId: actorId },
      );
    }
    if (post.authorId !== actorId && !replyRecipients.includes(post.authorId)) {
      await notifyPush(
        { kind: "profiles", profileIds: [post.authorId] },
        pushMessages.commentAdded({ postId, commentId, authorName, title: post.title, toPostAuthor: true }),
        { excludeProfileId: actorId },
      );
    }
    const participants = await db
      .selectDistinct({ authorId: comments.authorId })
      .from(comments)
      .where(eq(comments.postId, postId));
    const others = participants
      .map((row) => row.authorId)
      .filter((id) => id !== post.authorId && id !== actorId && !replyRecipients.includes(id));
    if (others.length > 0) {
      await notifyPush(
        { kind: "profiles", profileIds: others },
        pushMessages.commentAdded({ postId, commentId, authorName, title: post.title, toPostAuthor: false }),
        { excludeProfileId: actorId },
      );
    }
  } catch {
    // 알림은 댓글 저장 결과를 바꾸지 않는다.
  }
}

/**
 * 댓글 작성.
 * @param postId - 대상 게시물 ID
 * @param _prev - useActionState 이전 상태
 * @param formData - { content (plain text), timeMarker (선택: h:mm:ss·m:ss·초), parentId (선택: 답글을 달 댓글),
 *   replyToId (선택: 답글의 답글이면 "답글"을 누른 답글, 알림 대상만 정한다), operationId (UUID v4) }
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
  if ([...content].length > COMMENT_MAX_LENGTH) return { error: `댓글은 ${new Intl.NumberFormat("ko-KR").format(COMMENT_MAX_LENGTH)}자까지 쓸 수 있습니다.` };
  const operationId = resolveCreationOperationId(formData.get(CREATION_OPERATION_FIELD));
  if (!operationId) return { error: "작성 정보를 확인하지 못했습니다. 입력 내용을 보관한 뒤 새로고침해 주세요." };

  const timeMarker = parseTimeMarker(formData.get(COMMENT_TIME_MARKER_FIELD));
  if (!timeMarker.ok) return { error: timeMarker.error };
  const timeMarkerSeconds = timeMarker.seconds;
  const rawParentId = formData.get(COMMENT_PARENT_FIELD);
  const requestedParentId = typeof rawParentId === "string" && rawParentId.trim() ? rawParentId.trim() : null;
  if (requestedParentId !== null && timeMarkerSeconds !== null) return { error: "답글에는 재생 시점을 남길 수 없습니다." };
  const rawReplyToId = formData.get(COMMENT_REPLY_TO_FIELD);
  const replyToId = requestedParentId !== null && typeof rawReplyToId === "string" && rawReplyToId.trim() ? rawReplyToId.trim() : null;

  const db = createDb();
  const contentHtml = `<p>${escapeHtml(content)}</p>`;
  // 답글은 원 댓글 하나로 모은다(답글의 답글도 그 원 댓글 묶음). 원 댓글이 없으면(지워짐·다른 게시물) 달지 않는다.
  // 원 댓글은 예전과 같은 식별자 규칙, 답글은 원 댓글까지 묶어 같은 작업 재전송만 같은 답글로 회수한다.
  const deriveCommentId = (rootId: string | null) => deriveCreationResourceId(
    operationId,
    JSON.stringify(rootId === null ? ["community-comment", session.user.id, postId] : ["community-comment-reply", session.user.id, postId, rootId]),
  );
  let root: { id: string; authorId: string } | null = null;
  if (requestedParentId !== null) {
    try {
      const lookup = await findReplyRoot(db, postId, requestedParentId);
      if (!lookup.root) {
        // 저장한 뒤 응답을 받지 못한 사이 원 댓글이 지워졌으면, 같은 작업 재전송은 남아 있는 그 답글로 회수한다.
        const replayId = deriveCommentId(lookup.rootId);
        const [saved] = await db.select().from(comments).where(eq(comments.id, replayId)).limit(1);
        if (
          saved &&
          saved.authorId === session.user.id &&
          saved.postId === postId &&
          saved.contentHtml === contentHtml &&
          saved.timeMarkerSeconds === null &&
          saved.parentId === lookup.rootId
        ) {
          revalidatePath(`/community/${postId}`);
          return { success: true, commentId: replayId };
        }
        return { error: REPLY_ROOT_MISSING, replyRootMissing: true };
      }
      root = lookup.root;
    } catch {
      return { error: "댓글을 저장하지 못했습니다. 다시 시도해 주세요." };
    }
  }
  const rootId = root?.id ?? null;
  const commentId = deriveCommentId(rootId);
  try {
    const [activePost] = await db
      .select({ id: posts.id, boardType: posts.boardType, mediaUrl: posts.mediaUrl, title: posts.title, authorId: posts.authorId })
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
    // 답글은 같은 자리에서 원 댓글이 아직 이 게시물의 원 댓글인지도 확인한다. 아니면 post_id가 NULL이 되어 저장되지 않는다
    // (parent_id만 비면 원 댓글로 잘못 저장되므로 post_id 쪽에 묶는다). 상관 subquery는 별칭을 직접 쓴다.
    const postGuard = rootId !== null
      ? sql`(SELECT reply_post.id FROM posts AS reply_post WHERE reply_post.id = ${postId} AND reply_post.deleted_at IS NULL AND EXISTS (SELECT 1 FROM comments AS reply_root WHERE reply_root.id = ${rootId} AND reply_root.post_id = reply_post.id AND reply_root.parent_id IS NULL))`
      : timeMarkerSeconds === null
        ? sql`(SELECT ${posts.id} FROM ${posts} WHERE ${posts.id} = ${postId} AND ${posts.deletedAt} IS NULL)`
        : sql`(SELECT ${posts.id} FROM ${posts} WHERE ${posts.id} = ${postId} AND ${posts.deletedAt} IS NULL AND ${posts.boardType} = 'FEEDBACK' AND ${posts.mediaUrl} IS NOT NULL)`;
    let inserted: { id: string }[];
    try {
      inserted = await db.insert(comments).values({
        id: commentId,
        postId: postGuard,
        authorId: session.user.id!,
        contentHtml,
        timeMarkerSeconds,
        parentId: rootId,
      }).onConflictDoNothing({ target: comments.id }).returning({ id: comments.id });
    } catch (error) {
      // 확인 뒤 원 댓글이 지워졌으면 이유를 알린다. 그 밖의 실패는 바깥에서 일반 오류로 알린다.
      if (rootId !== null && !(await findReplyRoot(db, postId, rootId)).root) return { error: REPLY_ROOT_MISSING, replyRootMissing: true };
      throw error;
    }
    if (inserted.length === 0) {
      const [existing] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      if (
        !existing ||
        existing.authorId !== session.user.id ||
        existing.postId !== postId ||
        existing.contentHtml !== contentHtml ||
        existing.timeMarkerSeconds !== timeMarkerSeconds ||
        existing.parentId !== rootId
      ) {
        return { error: "이 댓글은 수정 전 내용으로 이미 저장되었거나 상태가 바뀌었습니다. 목록을 확인한 뒤 내용을 편집해 새 댓글로 등록해 주세요." };
      }
    } else {
      // 받는 사람을 찾는 조회(답글 대상·참여자)까지 응답 뒤로 미뤄 댓글 저장 응답을 늦추지 않는다.
      const replyTarget = root ? { rootId: root.id, rootAuthorId: root.authorId, replyToId } : null;
      await runAfterResponse(() => notifyCommentAdded(db, postId, activePost, session, replyTarget, commentId));
    }
  } catch {
    return { error: "댓글을 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  revalidatePath(`/community/${postId}`);
  return { success: true, commentId };
}

const REPLY_ROOT_MISSING = "원 댓글이 삭제되어 답글을 달 수 없습니다. 댓글 목록을 새로 확인해 주세요.";

/**
 * 답글을 달 원 댓글을 찾는다. 답글에 답하면 그 답글의 원 댓글로 올라간다(한 단계).
 * root는 같은 게시물의 원 댓글(parent_id 없음)만이고, 지워졌거나 다른 게시물이면 null이다.
 * rootId는 그때도 이 답글이 묶였을 원 댓글 ID(같은 작업 재전송 회수용)다.
 */
async function findReplyRoot(
  db: ReturnType<typeof createDb>,
  postId: string,
  parentId: string,
): Promise<{ root: { id: string; authorId: string } | null; rootId: string }> {
  const [target] = await db
    .select({ id: comments.id, authorId: comments.authorId, parentId: comments.parentId })
    .from(comments)
    .where(and(eq(comments.id, parentId), eq(comments.postId, postId)))
    .limit(1);
  if (!target) return { root: null, rootId: parentId };
  if (target.parentId === null) return { root: { id: target.id, authorId: target.authorId }, rootId: target.id };
  const [root] = await db
    .select({ id: comments.id, authorId: comments.authorId })
    .from(comments)
    .where(and(eq(comments.id, target.parentId), eq(comments.postId, postId), isNull(comments.parentId)))
    .limit(1);
  return { root: root ?? null, rootId: target.parentId };
}

// ───────────────────────────────────────────────
// 삭제 (본인 댓글 또는 Admin)
// ───────────────────────────────────────────────

export type DeleteCommentResult = { success: true } | { error: string };

/**
 * 댓글 삭제. 지우지 못한 이유(게시물이 휴지통으로 감, 이미 지워짐·권한 없음)는 결과로 돌려준다.
 * 화면이 열려 있는 사이 상태가 바뀐 경우이므로 호출한 화면이 안내하고 새로 받게 한다.
 * 원 댓글을 지워도 답글은 지우지 않는다(다른 사람의 글). 화면이 남은 답글 위에 "삭제된 댓글입니다"를 보인다.
 */
export async function deleteComment(commentId: string, postId: string): Promise<DeleteCommentResult> {
  const session = await requireAuth();
  const db = createDb();

  const [activePost] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  if (!activePost) {
    revalidatePath(`/community/${postId}`);
    return { error: "휴지통으로 옮겨진 게시물의 댓글은 삭제할 수 없습니다." };
  }

  const condition = and(
    eq(comments.id, commentId),
    eq(comments.postId, postId),
    session.user.role === "admin"
      ? undefined
      : eq(comments.authorId, session.user.id!),
  );

  const deleted = await db.delete(comments).where(condition).returning({ id: comments.id });
  revalidatePath(`/community/${postId}`);
  if (deleted.length === 0) return { error: "댓글을 찾을 수 없거나 삭제할 권한이 없습니다." };
  return { success: true };
}
