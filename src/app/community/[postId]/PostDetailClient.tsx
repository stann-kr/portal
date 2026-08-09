"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2, Hash, History, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { Input } from "@/components/ui/input";
import { deletePost, getPostIncludingTrash } from "@/lib/actions/posts";
import {
  createComment,
  deleteComment,
  getCommentsByPost,
  type CreateCommentState,
} from "@/lib/actions/comments";
import { PostEditForm } from "@/components/community/PostEditForm";
import { PostTrashActions } from "@/components/community/PostTrashActions";
import { createCreationOperationId } from "@/lib/creation-operation";

type Post = NonNullable<Awaited<ReturnType<typeof getPostIncludingTrash>>>;
type Comment = Awaited<ReturnType<typeof getCommentsByPost>>[number];

interface PostDetailClientProps {
  postId: string;
  post: Post;
  initialCommentList: Comment[];
  currentUserId: string | null;
  isAdmin: boolean;
  returnTo: string;
}

export function PostDetailClient({
  postId,
  post,
  initialCommentList,
  currentUserId,
  isAdmin,
  returnTo,
}: PostDetailClientProps) {
  const commentList = initialCommentList;
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [isEditPending, setIsEditPending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteOperationId] = useState(() => createCreationOperationId());
  const commentFormRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // ─── 댓글 폼 ──────────────────────────────────
  const boundCreateComment = createComment.bind(null, postId);
  const [commentState, commentAction, isCommentPending] = useActionState<
    CreateCommentState,
    FormData
  >(boundCreateComment, {});

  useEffect(() => {
    if (!commentState.commentId) return;
    commentFormRef.current?.reset();
    router.refresh();
  }, [commentState.commentId, router]);

  const handleDeletePost = () => {
    if (!post || !confirm("이 게시물을 휴지통으로 이동하시겠습니까? 30일 동안 복원할 수 있습니다.")) return;
    startTransition(async () => {
      try {
        await deletePost(post.id, deleteOperationId, post.version, returnTo);
      } catch (error) {
        setDeleteError(
          error instanceof Error
            ? error.message
            : "게시물을 휴지통으로 이동하지 못했습니다.",
        );
      }
    });
  };

  const handleDeleteComment = (commentId: string) => {
    if (!confirm("댓글을 삭제하시겠습니까?")) return;
    startTransition(async () => {
      await deleteComment(commentId, postId);
    });
  };

  const date = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "날짜 정보 없음";
  const author =
    post.authorName ?? post.authorEmail?.split("@")[0] ?? "작성자 미상";
  const canManagePost = isAdmin || currentUserId === post.authorId;
  const canDeletePost = canManagePost && !post.deletedAt;
  const canEditPost = canDeletePost;
  const handleSaved = useCallback(() => {
    setIsEditing(false);
    router.refresh();
  }, [router]);

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-8">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> 커뮤니티
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <h1 className="text-2xl font-semibold">{post.title}</h1>
          <div className="flex shrink-0 items-center gap-1">
            {canEditPost ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing((value) => !value)}
                disabled={isPending || isEditPending}
                aria-pressed={isEditing}
                className="gap-1.5"
              >
                <PencilLine className="h-4 w-4" aria-hidden="true" />
                {isEditing ? "읽기" : "수정"}
              </Button>
            ) : null}
            {canManagePost ? (
              <Button asChild variant="ghost" size="sm" className="gap-1.5">
                <Link
                  href={`/community/${post.id}/history?returnTo=${encodeURIComponent(returnTo)}`}
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                  이력
                </Link>
              </Button>
            ) : null}
            {canDeletePost ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeletePost}
                disabled={isPending || isEditPending}
                className="text-destructive hover:bg-destructive/10"
                aria-label="게시물 삭제"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Hash className="w-3 h-3" />
            {post.category}
          </span>
          <span>·</span>
          <span>{author}</span>
          <span>·</span>
          <span>{date}</span>
        </div>
        {deleteError ? (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        ) : null}
      </div>

      {post.deletedAt ? (
        <section className="space-y-3 rounded-xl border border-warning/30 bg-warning-muted p-4">
          <div>
            <p className="font-medium">휴지통에 있는 게시물입니다.</p>
            <p className="text-sm text-muted-foreground">
              삭제 {post.deletedAt.toLocaleString("ko-KR")} · 댓글과 변경 이력은 함께 보존됩니다.
            </p>
          </div>
          <PostTrashActions
            postId={post.id}
            version={post.version}
            deletedAt={post.deletedAt.toISOString()}
            canRestore={canManagePost}
            canPurge={isAdmin}
            returnTo={returnTo}
          />
        </section>
      ) : null}

      {/* 본문 */}
      {isEditing && currentUserId ? (
        <PostEditForm
          post={{
            id: post.id,
            title: post.title,
            contentHtml: post.contentHtml,
            version: post.version,
          }}
          actorId={currentUserId}
          onCancel={() => setIsEditing(false)}
          onSaved={handleSaved}
          onBusyChange={setIsEditPending}
        />
      ) : (
        <RichTextContent html={post.contentHtml} />
      )}

      {/* 댓글 섹션 */}
      <section className="space-y-4 border-t pt-6">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
          댓글 {commentList.length}개
        </h2>

        {/* 댓글 목록 */}
        {commentList.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {post.deletedAt ? "보존된 댓글이 없습니다." : "첫 댓글을 남겨보세요."}
          </p>
        ) : (
          <ul className="space-y-3">
            {commentList.map((c) => {
              const cAuthor =
                c.authorName ?? c.authorEmail?.split("@")[0] ?? "작성자 미상";
              const cDate = c.createdAt
                ? new Date(c.createdAt).toLocaleDateString("ko-KR", {
                    month: "short",
                    day: "numeric",
                  })
                : "날짜 정보 없음";
              const cInitials = cAuthor.slice(0, 2).toUpperCase();
              const canDelete =
                !post.deletedAt && (isAdmin || currentUserId === c.authorId);

              return (
                <li key={c.id} className="flex gap-3 group">
                  <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5">
                    {cInitials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <span className="font-medium text-foreground">
                        {cAuthor}
                      </span>
                      <span>{cDate}</span>
                    </div>
                    <RichTextContent html={c.contentHtml} className="text-sm" />
                  </div>
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteComment(c.id)}
                      disabled={isPending}
                      className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 self-start mt-0.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* 댓글 입력 */}
        {!post.deletedAt ? (
          <>
            <form ref={commentFormRef} action={commentAction} className="flex gap-2">
              <Input
                name="content"
                type="text"
                placeholder="댓글을 입력하세요..."
                required
                disabled={isCommentPending}
                className="flex-1"
              />
              <Button type="submit" disabled={isCommentPending} size="sm">
                등록
              </Button>
            </form>
            {commentState.error && (
              <p className="text-sm text-destructive">{commentState.error}</p>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
