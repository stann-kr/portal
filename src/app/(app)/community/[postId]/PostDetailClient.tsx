/**
 * @file src/app/(app)/community/[postId]/PostDetailClient.tsx
 * @description 게시물 상세(캔버스 CommunityPost·MobileCommunityPost 보드): 위치·제목·채널·작성자 머리,
 * 본문(수정 시 PostEditForm), 댓글·답글 목록(CommentThreads)과 댓글 입력. 좁은 화면에서는 수정·이력·삭제를 위쪽 막대의
 * 게시물 메뉴로 옮기고 댓글 입력을 화면 아래에 붙인다. 매체가 있는 믹스셋 게시물은 본문 위에 플레이어를 두고,
 * 재생 시점이 있는 댓글의 시점을 누르면 그 위치부터 재생한다.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, History, PencilLine, Trash2 } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/ui/CopyLinkButton";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { deletePost, getPostIncludingTrash } from "@/lib/actions/posts";
import {
  deleteComment,
  getCommentsByPost,
} from "@/lib/actions/comments";
import { CommentForm, type CommentFormHandle } from "@/components/community/CommentForm";
import { CommentThreads } from "@/components/community/CommentThreads";
import { MixsetPlayer } from "@/components/community/MixsetPlayer";
import type { MediaSeekRequest, PlaybackPositionReader } from "@/components/player/VideoPlayer";
import { classifyMixsetMedia, formatTimeMarker } from "@/lib/community-mixset-media";
import type { WaveformMarkerInput } from "@/components/player/waveform";
import { PostEditForm } from "@/components/community/PostEditForm";
import { PostTrashActions } from "@/components/community/PostTrashActions";
import { PostReadersPanel, PostReadersToggle } from "@/components/community/PostReaders";
import { recordPostRead, type PostReadSummary } from "@/lib/actions/postReads";
import { ADMIN_TRASHED_DETAIL_NOTE } from "@/lib/trash-restore";
import { COMMUNITY_BOARD_LABELS, communityAuthorName, communityPreview } from "@/components/community/CommunityPostRow";
import { MobileMoreMenu, type MobileMoreMenuItem } from "@/components/ui/mobile-more-menu";
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
  /** 관리자에게만 오는 읽은 학생 요약(캔버스 PostReaders). 학생에게는 null이다. */
  readSummary?: PostReadSummary | null;
}

export function PostDetailClient({
  postId,
  post,
  channelName = null,
  initialCommentList,
  currentUserId,
  isAdmin,
  returnTo,
  readSummary = null,
}: PostDetailClientProps) {
  const commentList = initialCommentList;
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [isEditPending, setIsEditPending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteOperation = useRef<{ key: string; id: string } | null>(null);
  const router = useRouter();
  const postDeleteConfirm = useConfirmAction();
  // 시점 요청은 그 요청을 만든 매체 주소에 묶는다. 링크를 바꿔 저장하면 새 플레이어가 예전 시점으로 재생하지 않는다.
  const [seekState, setSeekState] = useState<{ url: string; request: MediaSeekRequest }>();
  // 같은 시점을 다시 눌러도 화면 낭독기가 다시 읽도록 매번 새 노드(nonce key)로 알린다.
  const [seekAnnouncement, setSeekAnnouncement] = useState({ text: "", nonce: 0 });
  const playerRegionRef = useRef<HTMLElement>(null);
  const [readersOpen, setReadersOpen] = useState(false);
  // 학생이 남의 게시물을 열면 처음 한 번 읽음으로 남긴다(서버가 글쓴이·관리자·휴지통을 다시 거른다).
  // 기록 실패는 읽기 화면에 영향을 주지 않는다.
  const recordsRead = !isAdmin && Boolean(currentUserId) && currentUserId !== post.authorId && !post.deletedAt;
  useEffect(() => {
    if (!recordsRead) return;
    recordPostRead(postId).catch(() => undefined);
  }, [postId, recordsRead]);
  const positionReaderRef = useRef<PlaybackPositionReader | null>(null);
  // 원 댓글이 지워진 답글을 "새 댓글로 남기기"로 옮길 아래 댓글 입력.
  const commentFormRef = useRef<CommentFormHandle>(null);
  // 플레이어는 reader 콜백이 바뀔 때마다 다시 연결하므로 안정된 참조를 넘긴다.
  const handlePositionReaderChange = useCallback((reader: PlaybackPositionReader | null) => {
    positionReaderRef.current = reader;
  }, []);
  const readPlaybackPosition = useCallback(
    async () => (positionReaderRef.current ? positionReaderRef.current() : null),
    [],
  );

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
        const result = await deleteComment(commentId, postId);
        if ("error" in result) {
          // 화면을 열어 둔 사이 게시물·댓글 상태가 바뀌었다. 이유를 알린다. 지금 상태는 action이 revalidatePath로
          // 같은 응답에 담아 보내므로 따로 다시 받지 않는다(두 번 그리지 않는다).
          setDeleteError(result.error);
        }
      } catch {
        setDeleteError("댓글을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  const boardType = resolveCommunityBoardType(post.boardType);
  const boardLabel = COMMUNITY_BOARD_LABELS[boardType];
  const mixsetMedia = boardType === "FEEDBACK" ? classifyMixsetMedia(post) : null;

  // 같은 시점을 다시 눌러도 새 요청이 되도록 매번 새 객체를 만든다. focus는 누른 시점에 두고
  // 플레이어가 화면 밖이면 보이는 곳까지만 옮긴다.
  const seekRequest = mixsetMedia && seekState?.url === mixsetMedia.url ? seekState.request : undefined;
  const seekTo = (seconds: number) => {
    if (!mixsetMedia) return;
    setSeekState({ url: mixsetMedia.url, request: { seconds } });
    setSeekAnnouncement((previous) => ({ text: `${formatTimeMarker(seconds)} 위치부터 재생합니다.`, nonce: previous.nonce + 1 }));
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    playerRegionRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  };
  const longDate = formatKst(post.createdAt, { year: "numeric", month: "long", day: "numeric" }, "날짜 정보 없음");
  const shortDate = formatKstShortDate(post.createdAt, "날짜 정보 없음");
  const author = communityAuthorName(post);
  const canManagePost = isAdmin || currentUserId === post.authorId;
  const canDeletePost = canManagePost && !post.deletedAt;
  const canEditPost = canDeletePost;
  const isBusy = isPending || isEditPending;
  const historyHref = `/community/${post.id}/history?returnTo=${encodeURIComponent(returnTo)}`;
  const postPath = `/community/${encodeURIComponent(post.id)}`;
  const refreshComments = useCallback(() => router.refresh(), [router]);
  // 저장 action(updatePostContent)이 revalidatePath로 새 화면을 같은 응답에 담아 보내므로 따로 다시 받지 않는다.
  const handleSaved = useCallback(() => {
    setIsEditing(false);
  }, []);
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

  // 이어 듣기 정보: 미니 플레이어의 제목·작성자·"게시물로 가기"(돌아오면 같은 목록 위치로).
  const playerTrack = useMemo(() => ({
    key: post.id,
    title: post.title,
    subtitle: author,
    href: `/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`,
    mediaObjectId: post.mediaObjectId ?? null,
  }), [author, post.id, post.mediaObjectId, post.title, returnTo]);
  // 파형 아래 시점 댓글(Stann은 먹색).
  const waveformMarkers = useMemo<WaveformMarkerInput[]>(() => commentList.flatMap((c) => {
    if (c.timeMarkerSeconds === null) return [];
    const name = communityAuthorName(c);
    return [{ id: c.id, seconds: c.timeMarkerSeconds, author: name, isStann: name === "Stann", text: communityPreview(c.contentHtml, 120) }];
  }), [commentList]);
  const openMarkerComment = useCallback((commentId: string) => {
    const target = document.getElementById(`comment-${commentId}`);
    if (!target) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target.scrollIntoView?.({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }, []);

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
            {readSummary ? (
              <>
                {" · "}
                <PostReadersToggle summary={readSummary} open={readersOpen} onToggle={() => setReadersOpen((value) => !value)} />
              </>
            ) : null}
          </p>
          {post.deletedAt ? null : (
            <CopyLinkButton className="-ml-2.5 self-start md:hidden" path={postPath} title={post.title} />
          )}
        </div>
        <div className="hidden shrink-0 items-center gap-1 md:flex">
          {post.deletedAt ? null : <CopyLinkButton path={postPath} title={post.title} />}
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

      {readSummary && readersOpen ? <PostReadersPanel summary={readSummary} postId={post.id} /> : null}

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
            {post.restoreLocked ? (
              <p className="text-ui text-secondary-foreground">{ADMIN_TRASHED_DETAIL_NOTE}</p>
            ) : null}
          </div>
          <PostTrashActions
            postId={post.id}
            version={post.version}
            deletedAt={post.deletedAt.toISOString()}
            canRestore={canManagePost && !post.restoreLocked}
            canPurge={isAdmin}
            returnTo={returnTo}
          />
        </section>
      ) : null}

      {/* 믹스셋 재생: 링크 플레이어는 좁은 화면에서 화면 폭 가득 놓는다. */}
      {mixsetMedia ? (
        <section
          ref={playerRegionRef}
          aria-label="믹스셋 재생"
          className={cn("scroll-mt-4", mixsetMedia.kind === "link" && "-mx-5 md:mx-0")}
        >
          <MixsetPlayer
            media={mixsetMedia}
            title={post.title}
            seekRequest={seekRequest}
            onPositionReaderChange={handlePositionReaderChange}
            track={playerTrack}
            markers={waveformMarkers}
            onMarkerOpen={openMarkerComment}
          />
          <p role="status" className="sr-only">
            {seekAnnouncement.text ? <span key={seekAnnouncement.nonce}>{seekAnnouncement.text}</span> : null}
          </p>
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
          mixsetLinkUrl={mixsetMedia?.kind === "link" ? mixsetMedia.url : null}
        />
      ) : (
        <RichTextContent html={post.contentHtml} className="border-b border-border pb-5 text-base leading-7 md:pb-8" />
      )}

      {/* 댓글 + 답글 묶음 */}
      <CommentThreads
        postId={postId}
        actorId={currentUserId}
        comments={commentList}
        isAdmin={isAdmin}
        trashed={Boolean(post.deletedAt)}
        canComment={canComment}
        busy={isPending}
        onDelete={handleDeleteComment}
        onSeek={mixsetMedia ? seekTo : undefined}
        onSaved={refreshComments}
        onMoveToNewComment={canComment && currentUserId ? (text) => commentFormRef.current?.appendText(text) ?? false : undefined}
      />

      {/* 댓글 입력: 좁은 화면은 화면 아래에 붙는다(게시물 영역 안에서만). */}
      {canComment && currentUserId ? (
        <CommentForm
          key={`${currentUserId}:${postId}`}
          ref={commentFormRef}
          postId={postId}
          actorId={currentUserId}
          onSaved={refreshComments}
          allowTimeMarker={Boolean(mixsetMedia)}
          readPlaybackPosition={mixsetMedia ? readPlaybackPosition : undefined}
          className={cn(
            "sticky-dock sticky bottom-0 -mx-5 mt-auto border-t border-border bg-background px-5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2",
            "md:static md:mx-0 md:-mt-3 md:border-0 md:p-0",
          )}
        />
      ) : null}
    </article>
  );
}
