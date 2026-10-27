/**
 * @file src/app/community/[postId]/PostDetailClient.tsx
 * @description 게시물 상세(캔버스 CommunityPost·MobileCommunityPost 보드): 위치·제목·채널·작성자 머리,
 * 본문(수정 시 PostEditForm), 댓글 목록과 댓글 입력. 좁은 화면에서는 수정·이력·삭제를 위쪽 막대의
 * 게시물 메뉴로 옮기고 댓글 입력을 화면 아래에 붙인다.
 */
"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, History, PencilLine, Trash2 } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { deletePost, getPostIncludingTrash } from "@/lib/actions/posts";
import {
  deleteComment,
  getCommentsByPost,
} from "@/lib/actions/comments";
import { CommentForm } from "@/components/community/CommentForm";
import { PostEditForm } from "@/components/community/PostEditForm";
import { PostTrashActions } from "@/components/community/PostTrashActions";
import { COMMUNITY_BOARD_LABELS, communityAuthorName } from "@/components/community/CommunityPostRow";
import { MobileMoreMenu, type MobileMoreMenuItem } from "@/components/ui/mobile-more-menu";
import { initialOf } from "@/components/qna/qna-display";
import { formatKstMonthDayTime } from "@/lib/kst-format";
import { createCreationOperationId } from "@/lib/creation-operation";
import { resolveCommunityBoardType } from "@/lib/community-location";
import { formatKst, formatKstShortDate } from "@/lib/kst-format";
import { cn } from "@/lib/utils";

type Post = NonNullable<Awaited<ReturnType<typeof getPostIncludingTrash>>>;
type Comment = Awaited<ReturnType<typeof getCommentsByPost>>[number];

interface PostDetailClientProps {
  postId: string;
  post: Post;
  /** 자유 게시판 채널 이름. 없으면 저장된 주소 식별자를 보인다. */
  channelName?: string | null;
  initialCommentList: Comment[];
  currentUserId: string | null;
  isAdmin: boolean;
  returnTo: string;
}

export function PostDetailClient({
  postId,
  post,
  channelName = null,
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

  const boardType = resolveCommunityBoardType(post.boardType);
  const boardLabel = COMMUNITY_BOARD_LABELS[boardType];
  const longDate = formatKst(post.createdAt, { year: "numeric", month: "long", day: "numeric" }, "날짜 정보 없음");
  const shortDate = formatKstShortDate(post.createdAt, "날짜 정보 없음");
  const author = communityAuthorName(post);
  const canManagePost = isAdmin || currentUserId === post.authorId;
  const canDeletePost = canManagePost && !post.deletedAt;
  const canEditPost = canDeletePost;
  const isBusy = isPending || isEditPending;
  const historyHref = `/community/${post.id}/history?returnTo=${encodeURIComponent(returnTo)}`;
  const handleSaved = useCallback(() => {
    setIsEditing(false);
    router.refresh();
  }, [router]);
  const requestPostDelete = postDeleteConfirm.request;
  const toggleEditing = useCallback(() => setIsEditing((value) => !value), []);

  const mobileActions = useMemo(() => {
    const items: MobileMoreMenuItem[] = [];
    if (canEditPost) {
      items.push({ key: "edit", label: isEditing ? "읽기" : "수정", Icon: isEditing ? BookOpen : PencilLine, onSelect: toggleEditing, disabled: isBusy });
    }
    if (canManagePost) items.push({ key: "history", label: "이력", Icon: History, href: historyHref });
    if (canDeletePost) {
      items.push({ key: "delete", label: "게시물 삭제", Icon: Trash2, destructive: true, disabled: isBusy, onSelect: (trigger) => requestPostDelete(trigger) });
    }
    return <MobileMoreMenu label="게시물 메뉴" items={items} />;
  }, [canDeletePost, canEditPost, canManagePost, historyHref, isBusy, isEditing, requestPostDelete, toggleEditing]);

  const backLabel = returnTo.startsWith("/community") ? "커뮤니티 목록으로" : "이전 화면으로";
  const canComment = !post.deletedAt && Boolean(currentUserId);

  return (
    <article className={cn("flex flex-1 flex-col gap-4 md:gap-6", !canComment && "pb-8 md:pb-0")}>
      <MobileTopBar title={boardLabel} back={{ href: returnTo, label: backLabel }} actions={mobileActions} />

      <nav aria-label="위치" className="hidden items-center gap-1.5 text-ui md:flex">
        <Link href={returnTo} className="text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">커뮤니티</Link>
        <span aria-hidden="true" className="text-faint">/</span>
        <span className="text-secondary-foreground">{boardLabel}</span>
      </nav>

      {/* 머리 */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5 md:gap-2">
          <h1 className="break-words text-xl font-semibold tracking-title md:text-display md:tracking-display">{post.title}</h1>
          <p className="text-ui text-muted-foreground">
            {boardType === "GENERAL" ? (
              <>
                <span className="text-secondary-foreground"># {channelName ?? post.category}</span>
                {" · "}
              </>
            ) : null}
            {author}
            {" · "}
            <span className="md:hidden">{shortDate}</span>
            <span className="hidden md:inline">{longDate}</span>
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-1 md:flex">
          {canEditPost ? (
            <Button
              variant="ghost"
              onClick={toggleEditing}
              disabled={isBusy}
              aria-pressed={isEditing}
            >
              {isEditing ? "읽기" : "수정"}
            </Button>
          ) : null}
          {canManagePost ? (
            <Link href={historyHref} className={buttonClassName({ variant: "ghost" })}>이력</Link>
          ) : null}
          {canDeletePost ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={(event) => postDeleteConfirm.request(event.currentTarget)}
              disabled={isBusy}
              aria-expanded={postDeleteConfirm.isOpen}
              aria-label="게시물 삭제"
            >
              <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </header>

      {postDeleteConfirm.isOpen && !post.deletedAt ? (
        <ConfirmPanel
          confirm={postDeleteConfirm}
          message="이 게시물을 휴지통으로 이동할까요? 30일 동안 복원할 수 있고 댓글과 이력은 함께 보존됩니다."
          confirmLabel="휴지통 이동 확인"
          pendingLabel="이동 중..."
          pending={isPending}
          onConfirm={handleDeletePost}
          className="max-w-md"
        />
      ) : null}
      {deleteError ? (
        <p role="alert" className="text-ui text-destructive">
          {deleteError}
        </p>
      ) : null}

      {post.deletedAt ? (
        <section className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-muted p-4">
          <div className="flex flex-col gap-1">
            <p className="text-body font-semibold">휴지통에 있는 게시물입니다.</p>
            <p className="text-ui text-secondary-foreground">
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
        <RichTextContent html={post.contentHtml} className="border-b border-border pb-5 text-base leading-7 md:pb-8" />
      )}

      {/* 댓글 */}
      <section aria-labelledby="comments-title" className="flex flex-col">
        <h2 id="comments-title" className="mb-1 text-ui font-semibold text-secondary-foreground">
          댓글 <span className="font-mono font-normal text-muted-foreground">{commentList.length}</span>
        </h2>

        {commentList.length === 0 ? (
          <p className="py-3 text-body text-muted-foreground">
            {post.deletedAt ? "보존된 댓글이 없습니다." : "첫 댓글을 남겨보세요."}
          </p>
        ) : (
          <ol className="flex flex-col">
            {commentList.map((c) => {
              const cAuthor = communityAuthorName(c);
              const cDate = formatKstMonthDayTime(c.createdAt, "날짜 정보 없음");
              const canDelete =
                !post.deletedAt && (isAdmin || currentUserId === c.authorId);

              return (
                <li key={c.id} className="flex flex-col gap-2 border-b border-muted py-3 md:py-3.5">
                  <div className="flex gap-3">
                    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-selected text-xs font-semibold text-secondary-foreground">
                      {initialOf(cAuthor)}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="flex flex-wrap items-center gap-2 text-ui">
                        <span className="font-semibold">{cAuthor}</span>
                        <span className="font-mono text-xs text-muted-foreground">{cDate}</span>
                      </p>
                      <RichTextContent html={c.contentHtml} className="text-md leading-6 md:text-body" />
                    </div>
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(event) => commentDeleteConfirm.request(event.currentTarget, c.id)}
                        disabled={isPending}
                        aria-expanded={commentDeleteConfirm.value === c.id}
                        aria-label={`${cAuthor} 댓글 삭제`}
                        className="-mr-2 -mt-2 size-11 shrink-0 rounded-touch text-muted-foreground md:mr-0 md:mt-0 md:size-7 md:rounded-md"
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  {canDelete && commentDeleteConfirm.value === c.id ? (
                    <ConfirmPanel
                      confirm={commentDeleteConfirm}
                      message="이 댓글을 삭제할까요? 삭제한 댓글은 되돌릴 수 없습니다."
                      confirmLabel="댓글 삭제 확인"
                      pendingLabel="삭제 중..."
                      pending={isPending}
                      onConfirm={() => handleDeleteComment(c.id)}
                      className="ml-10"
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* 댓글 입력: 좁은 화면은 화면 아래에 붙는다(게시물 영역 안에서만). */}
      {canComment && currentUserId ? (
        <CommentForm
          key={`${currentUserId}:${postId}`}
          postId={postId}
          actorId={currentUserId}
          onSaved={() => router.refresh()}
          className={cn(
            "sticky bottom-0 -mx-5 mt-auto border-t border-border bg-background px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2",
            "md:static md:mx-0 md:-mt-3 md:border-0 md:p-0",
          )}
        />
      ) : null}
    </article>
  );
}
