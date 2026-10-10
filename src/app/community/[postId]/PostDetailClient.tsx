"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2, Hash, History, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { deletePost, getPostIncludingTrash } from "@/lib/actions/posts";
import {
  deleteComment,
  getCommentsByPost,
} from "@/lib/actions/comments";
import { CommentForm } from "@/components/community/CommentForm";
import { PostEditForm } from "@/components/community/PostEditForm";
import { PostTrashActions } from "@/components/community/PostTrashActions";
import { createCreationOperationId } from "@/lib/creation-operation";
import { formatKst, formatKstShortDate } from "@/lib/kst-format";

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
  const deleteOperation = useRef<{ key: string; id: string } | null>(null);
  const router = useRouter();
  const postDeleteConfirm = useConfirmAction();
  const commentDeleteConfirm = useConfirmAction<string>();

  const handleDeletePost = () => {
    if (isPending || isEditPending || post.deletedAt) return;
    const requestKey = JSON.stringify([currentUserId, post.id, post.version]);
    if (deleteOperation.current?.key !== requestKey) {
      deleteOperation.current = { key: requestKey, id: createCreationOperationId() };
    }
    const deleteOperationId = deleteOperation.current.id;
    setDeleteError(null);
    startTransition(async () => {
      try {
        const result = await deletePost(post.id, deleteOperationId, post.version, returnTo);
        if (result && !result.success) setDeleteError(result.error ?? "게시물을 휴지통으로 이동하지 못했습니다.");
      } catch {
        // 성공한 redirect는 router가 처리한다. 예외 원문은 production에서 숨겨지므로 고정 안내를 쓴다.
        setDeleteError("게시물을 휴지통으로 이동하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
      }
    });
  };

  const handleDeleteComment = (commentId: string) => {
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteComment(commentId, postId);
      } catch {
        setDeleteError("댓글을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  const date = formatKst(post.createdAt, { year: "numeric", month: "long", day: "numeric" }, "날짜 정보 없음");
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
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href={returnTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> 이전 화면으로 돌아가기
        </Link>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <h1 className="min-w-0 break-words text-2xl font-semibold">{post.title}</h1>
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
                onClick={(event) => postDeleteConfirm.request(event.currentTarget)}
                disabled={isPending || isEditPending}
                aria-expanded={postDeleteConfirm.isOpen}
                className="text-destructive hover:bg-destructive/10"
                aria-label="게시물 삭제"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
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
        {postDeleteConfirm.isOpen && !post.deletedAt ? (
          <ConfirmPanel
            confirm={postDeleteConfirm}
            message="이 게시물을 휴지통으로 이동할까요? 30일 동안 복원할 수 있고 댓글과 이력은 함께 보존됩니다."
            confirmLabel="휴지통 이동 확인"
            pendingLabel="이동 중..."
            pending={isPending}
            onConfirm={handleDeletePost}
            className="mt-3"
          />
        ) : null}
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
              삭제 {formatKst(post.deletedAt)} · 댓글과 변경 이력은 함께 보존됩니다.
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
              const cDate = formatKstShortDate(c.createdAt, "날짜 정보 없음");
              const cInitials = cAuthor.slice(0, 2).toUpperCase();
              const canDelete =
                !post.deletedAt && (isAdmin || currentUserId === c.authorId);

              return (
                <li key={c.id} className="group space-y-2">
                  <div className="flex gap-3">
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
                        onClick={(event) => commentDeleteConfirm.request(event.currentTarget, c.id)}
                        disabled={isPending}
                        aria-expanded={commentDeleteConfirm.value === c.id}
                        aria-label={`${cAuthor} 댓글 삭제`}
                        className="text-destructive opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus:opacity-100 aria-expanded:opacity-100 transition-opacity flex-shrink-0 self-start mt-0.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  {canDelete && commentDeleteConfirm.value === c.id ? (
                    <ConfirmPanel
                      confirm={commentDeleteConfirm}
                      message="이 댓글을 삭제할까요? 삭제한 댓글은 되돌릴 수 없습니다."
                      confirmLabel="댓글 삭제 확인"
                      pendingLabel="삭제 중..."
                      pending={isPending}
                      onConfirm={() => handleDeleteComment(c.id)}
                      className="ml-11"
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {/* 댓글 입력 */}
        {!post.deletedAt && currentUserId ? (
          <CommentForm key={`${currentUserId}:${postId}`} postId={postId} actorId={currentUserId} onSaved={() => router.refresh()} />
        ) : null}
      </section>
    </div>
  );
}
