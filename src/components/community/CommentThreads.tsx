"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { CommentForm } from "@/components/community/CommentForm";
import { communityAuthorName } from "@/components/community/CommunityPostRow";
import { initialOf } from "@/components/qna/qna-display";
import { groupCommentThreads, replyMention } from "@/lib/community-comment";
import { formatTimeMarker } from "@/lib/community-mixset-media";
import { formatKstMonthDayTime } from "@/lib/kst-format";
import { cn } from "@/lib/utils";

export type ThreadComment = {
  id: string;
  authorId: string;
  contentHtml: string;
  createdAt: Date | null;
  timeMarkerSeconds: number | null;
  parentId: string | null;
  authorName: string | null;
  /** 관리자(Stann) 글은 아바타를 먹색으로(Q&A 답변과 같다). */
  authorRole: string | null;
};

type ReplyTarget = {
  rootId: string;
  /** 원 댓글이 쓰는 사이 지워지면 그 묶음 자리를 작성 시각으로 찾는다. */
  rootCreatedAt: Date | null;
  /** "답글"을 누른 댓글(원 댓글 또는 답글). 그 버튼이 열림 상태를 보인다. */
  sourceId: string;
  mention: string | null;
  label: string;
};

/**
 * 게시물 댓글 목록(캔버스 CommunityPost·CommunityReplies): 원 댓글 + 한 단계 답글 묶음.
 * 답글 입력은 묶음 아래에 하나만 열린다. 원 댓글이 지워진 묶음은 "삭제된 댓글입니다" 자리 아래에 답글만 남고
 * 새 답글은 받지 않는다. 재생 시점 칩은 원 댓글에만 있다.
 * 답글을 쓰는 사이 원 댓글이 지워지면 입력은 그 자리("삭제된 댓글입니다" 아래)에 남고, 쓴 글을 버리거나
 * 새 댓글 입력으로 옮긴다(캔버스 UxReview1120Lessons ⑧).
 */
export function CommentThreads({
  postId,
  actorId,
  comments,
  isAdmin,
  trashed,
  canComment,
  busy,
  onDelete,
  onSeek,
  onSaved,
  onMoveToNewComment,
}: {
  postId: string;
  actorId: string | null;
  comments: ThreadComment[];
  isAdmin: boolean;
  /** 휴지통에 있는 게시물: 댓글은 읽기만 한다. */
  trashed: boolean;
  canComment: boolean;
  busy: boolean;
  onDelete: (commentId: string) => void;
  /** 시점 칩을 누르면 그 위치부터 재생한다. 플레이어가 없으면 시점만 보인다. */
  onSeek?: (seconds: number) => void;
  onSaved: () => void;
  /** 원 댓글이 지워진 답글을 새 댓글 입력으로 옮긴다. 옮겼으면 true. */
  onMoveToNewComment?: (text: string) => boolean;
}) {
  const groupedThreads = useMemo(() => groupCommentThreads(comments), [comments]);
  const deleteConfirm = useConfirmAction<string>();
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const replyOpener = useRef<HTMLButtonElement | null>(null);
  // 지금 열린 답글 입력의 원 댓글. 등록을 기다리는 사이 다른 묶음의 입력을 열었는지 저장 응답에서 확인한다.
  const openReplyRoot = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  // 답글을 등록하면 새로 받은 목록에서 그 답글로 초점을 옮긴다.
  const focusAfterSave = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfterSave.current;
    if (!id) return;
    const target = document.getElementById(`comment-${id}`);
    if (!target) return;
    focusAfterSave.current = null;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "nearest" });
  }, [comments]);

  // 알림으로 연 주소(`#comment-<id>`)의 댓글로 옮긴다. 열려 있던 화면에서 주소만 바뀐 뒤 다시 받은 목록에
  // 그 댓글이 들어오는 경우도 있어 목록이 바뀔 때마다 확인하고, 한 주소는 한 번만 옮긴다.
  const handledHash = useRef<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#comment-") || hash === handledHash.current) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    const target = document.getElementById(id);
    if (!target) return;
    handledHash.current = hash;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "center" });
  }, [comments]);

  // 댓글을 지우면 초점을 지운 자리 바로 다음 댓글(없으면 앞 댓글, 그것도 없으면 댓글 제목)로 옮긴다.
  // 삭제 요청 때의 목록과 다른 목록이 왔는데 지운 댓글이 남아 있으면(실패·다시 받기) 초점을 그대로 둔다.
  const focusAfterDelete = useRef<{ deletedId: string; neighborIds: string[]; comments: ThreadComment[] } | null>(null);
  useEffect(() => {
    const pending = focusAfterDelete.current;
    if (!pending || pending.comments === comments) return;
    focusAfterDelete.current = null;
    if (document.getElementById(pending.deletedId)) return;
    const target = pending.neighborIds
      .map((id) => document.getElementById(id))
      .find((element): element is HTMLElement => element !== null) ?? headingRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "nearest" });
  }, [comments]);
  const confirmDelete = (commentId: string) => {
    const ids = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[id^="comment-"]') ?? [], (element) => element.id);
    const index = ids.indexOf(`comment-${commentId}`);
    focusAfterDelete.current = {
      deletedId: `comment-${commentId}`,
      neighborIds: index < 0 ? [] : [...ids.slice(index + 1), ...ids.slice(0, index).reverse()],
      comments,
    };
    onDelete(commentId);
  };

  const canDelete = (authorId: string) => !trashed && (isAdmin || actorId === authorId);
  // 열린 답글 입력의 원 댓글이 목록에서 사라졌으면(지워짐) 입력을 닫지 않고 그 자리에 남긴다.
  // 답글이 하나도 없어 묶음까지 사라졌으면 원 댓글 작성 시각 자리에 "삭제된 댓글입니다"를 잠시 둔다.
  const composerAllowed = canComment && actorId !== null && replyTarget !== null;
  const orphanRootId = composerAllowed && !groupedThreads.some((thread) => thread.kind === "comment" && thread.id === replyTarget.rootId)
    ? replyTarget.rootId
    : null;
  const orphanRootCreatedAt = orphanRootId ? replyTarget?.rootCreatedAt ?? null : null;
  const threads = useMemo(() => {
    if (!orphanRootId || groupedThreads.some((thread) => thread.id === orphanRootId)) return groupedThreads;
    const placeholder = { kind: "deleted" as const, id: orphanRootId, replies: [] as ThreadComment[] };
    const at = orphanRootCreatedAt?.getTime();
    const index = at === undefined
      ? -1
      : groupedThreads.findIndex((thread) => {
        const first = thread.kind === "comment" ? thread.root : thread.replies[0];
        return (first?.createdAt?.getTime() ?? Number.POSITIVE_INFINITY) > at;
      });
    return index < 0 ? [...groupedThreads, placeholder] : [...groupedThreads.slice(0, index), placeholder, ...groupedThreads.slice(index)];
  }, [groupedThreads, orphanRootId, orphanRootCreatedAt]);

  const openReply = (opener: HTMLButtonElement, target: ReplyTarget) => {
    replyOpener.current = opener;
    openReplyRoot.current = target.rootId;
    setReplyTarget(target);
  };
  const closeReply = () => {
    openReplyRoot.current = null;
    setReplyTarget(null);
    // 연 버튼이 원 댓글과 함께 사라졌으면 댓글 제목으로 돌아간다.
    const opener = replyOpener.current;
    if (opener?.isConnected) opener.focus();
    else headingRef.current?.focus();
  };

  const replyButton = (rootId: string, sourceId: string, mention: string | null, rootName: string, sourceName: string, kind: "댓글" | "답글") => (
    <div className="mt-0.5 flex h-6 items-center md:h-auto">
      <button
        type="button"
        onClick={(event) => openReply(event.currentTarget, {
          rootId,
          rootCreatedAt: comments.find((comment) => comment.id === rootId)?.createdAt ?? null,
          sourceId,
          mention,
          label: `${rootName} 댓글에 답글`,
        })}
        aria-expanded={replyTarget?.sourceId === sourceId}
        aria-label={`${sourceName} ${kind}에 답글`}
        className="-my-2.5 -ml-2 h-11 rounded-touch px-2 text-ui text-secondary-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:font-semibold aria-expanded:text-foreground motion-reduce:transition-none md:my-0 md:-ml-1.5 md:h-7 md:rounded-md md:px-1.5 md:text-xs md:hover:bg-muted md:aria-expanded:bg-muted md:aria-expanded:font-normal"
      >
        답글
      </button>
    </div>
  );

  const deleteButton = (comment: ThreadComment, label: string) => (
    <Button
      variant="ghost"
      size="icon"
      onClick={(event) => deleteConfirm.request(event.currentTarget, comment.id)}
      disabled={busy}
      aria-expanded={deleteConfirm.value === comment.id}
      aria-label={label}
      className="-mr-2 -mt-2 size-11 shrink-0 rounded-touch text-muted-foreground md:mr-0 md:mt-0 md:size-7 md:rounded-md"
    >
      <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
    </Button>
  );

  const confirmPanel = (comment: ThreadComment, message: string, confirmLabel: string, className: string) =>
    canDelete(comment.authorId) && deleteConfirm.value === comment.id ? (
      <ConfirmPanel
        confirm={deleteConfirm}
        message={message}
        confirmLabel={confirmLabel}
        pendingLabel="삭제 중..."
        pending={busy}
        onConfirm={() => confirmDelete(comment.id)}
        className={className}
      />
    ) : null;

  const replyList = (rootId: string, rootName: string | null, replies: ThreadComment[], acceptsReplies: boolean) => (
    <ol aria-label={rootName ? `${rootName} 댓글의 답글` : "삭제된 댓글의 답글"} className="ml-10 mt-1 flex flex-col">
      {replies.map((reply) => {
        const name = communityAuthorName(reply);
        return (
          <li key={reply.id} id={`comment-${reply.id}`} tabIndex={-1} className="flex scroll-mt-4 flex-col gap-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:py-2.5">
            <div className="flex gap-2.5">
              <span aria-hidden="true" className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", avatarTone(reply))}>
                {initialOf(name)}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-ui">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{formatKstMonthDayTime(reply.createdAt, "날짜 정보 없음")}</span>
                </p>
                <RichTextContent html={reply.contentHtml} className="min-w-0 text-md leading-6 md:text-body" />
                {canComment && acceptsReplies && rootName ? replyButton(rootId, reply.id, replyMention(name), rootName, name, "답글") : null}
              </div>
              {canDelete(reply.authorId) ? deleteButton(reply, `${name} 답글 삭제`) : null}
            </div>
            {confirmPanel(reply, "이 답글을 삭제할까요? 삭제한 답글은 되돌릴 수 없습니다.", "답글 삭제 확인", "ml-[2.125rem]")}
          </li>
        );
      })}
    </ol>
  );

  const replyComposer = (rootId: string, orphaned: boolean) =>
    composerAllowed && actorId !== null && replyTarget?.rootId === rootId ? (
      <CommentForm
        key={`${actorId}:${postId}:${rootId}`}
        postId={postId}
        actorId={actorId}
        parentId={rootId}
        replyToId={replyTarget.sourceId !== rootId ? replyTarget.sourceId : undefined}
        replyLabel={replyTarget.label}
        mention={replyTarget.mention}
        onCancel={closeReply}
        orphaned={orphaned}
        onRootMissing={onSaved}
        onDiscardOrphan={closeReply}
        onMoveToComment={onMoveToNewComment ? (text) => {
          if (!onMoveToNewComment(text)) return false;
          // 초점은 새 댓글 입력으로 갔으니 연 버튼으로 돌리지 않는다.
          openReplyRoot.current = null;
          setReplyTarget(null);
          return true;
        } : undefined}
        onSaved={(commentId) => {
          // 등록을 기다리는 사이 다른 묶음의 답글 입력을 열었으면 그 입력과 초점은 그대로 둔다.
          if (openReplyRoot.current === rootId) {
            openReplyRoot.current = null;
            focusAfterSave.current = commentId;
            setReplyTarget(null);
          }
          onSaved();
        }}
        className="ml-10 mt-1.5"
      />
    ) : null;

  return (
    <section ref={listRef} aria-labelledby="comments-title" className="flex flex-col">
      <h2
        ref={headingRef}
        id="comments-title"
        tabIndex={-1}
        className="mb-1 rounded-sm text-ui font-semibold text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        댓글 <span className="font-mono font-normal text-muted-foreground">{comments.length}</span>
      </h2>

      {threads.length === 0 ? (
        <p className="py-3 text-body text-muted-foreground">
          {trashed ? "보존된 댓글이 없습니다." : "첫 댓글을 남겨보세요."}
        </p>
      ) : (
        <ol className="flex flex-col">
          {threads.map((thread) => {
            if (thread.kind === "deleted") {
              return (
                <li key={`deleted-${thread.id}`} className="flex flex-col border-b border-muted py-3 md:py-3.5">
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="size-7 shrink-0 rounded-full border border-dashed border-faint" />
                    <p className="text-md leading-6 text-muted-foreground md:text-body">삭제된 댓글입니다</p>
                  </div>
                  {thread.replies.length > 0 ? replyList(thread.id, null, thread.replies, false) : null}
                  {replyComposer(thread.id, true)}
                </li>
              );
            }
            const c = thread.root;
            const name = communityAuthorName(c);
            const replyCount = thread.replies.length;
            return (
              <li key={c.id} className="flex flex-col border-b border-muted py-3 md:py-3.5">
                <div id={`comment-${c.id}`} tabIndex={-1} className="flex scroll-mt-4 gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span aria-hidden="true" className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", avatarTone(c))}>
                    {initialOf(name)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    {/*
                      좁은 화면: 시점 칩을 이름·시각 줄 끝에 두어 본문이 줄 전체를 쓴다(B 묶음 ①).
                      넓은 화면: 칩이 본문 왼쪽. 칩은 하나만 그리고 grid 자리만 바꾼다.
                    */}
                    <div
                      className={cn(
                        "grid min-w-0 items-center gap-x-2 gap-y-0.5 text-ui",
                        c.timeMarkerSeconds === null
                          ? "grid-cols-1"
                          : "grid-cols-[auto_auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,1fr)]",
                      )}
                    >
                      <p className="col-start-1 row-start-1 flex flex-wrap items-center gap-2 md:col-span-full">
                        <span className="font-semibold">{name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{formatKstMonthDayTime(c.createdAt, "날짜 정보 없음")}</span>
                      </p>
                      {c.timeMarkerSeconds !== null ? (
                        <span className="col-start-2 row-start-1 flex md:col-start-1 md:row-start-2 md:self-start">
                          <CommentTimeMarker seconds={c.timeMarkerSeconds} onSeek={onSeek} />
                        </span>
                      ) : null}
                      <RichTextContent
                        html={c.contentHtml}
                        className={cn(
                          "col-span-full row-start-2 min-w-0 text-md leading-6 md:text-body",
                          c.timeMarkerSeconds !== null && "md:col-span-1 md:col-start-2",
                        )}
                      />
                    </div>
                    {canComment ? replyButton(c.id, c.id, null, name, name, "댓글") : null}
                  </div>
                  {canDelete(c.authorId) ? deleteButton(c, `${name} 댓글 삭제`) : null}
                </div>
                {confirmPanel(
                  c,
                  replyCount > 0
                    ? `이 댓글을 삭제할까요? 답글 ${replyCount}개는 남고, 이 자리에는 “삭제된 댓글입니다”만 보입니다.`
                    : "이 댓글을 삭제할까요? 삭제한 댓글은 되돌릴 수 없습니다.",
                  "댓글 삭제 확인",
                  "ml-10 mt-2",
                )}
                {replyCount > 0 ? replyList(c.id, name, thread.replies, true) : null}
                {replyComposer(c.id, false)}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function avatarTone(comment: ThreadComment): string {
  return comment.authorRole === "admin" ? "bg-primary text-primary-foreground" : "bg-selected text-secondary-foreground";
}

/** 댓글 재생 시점. 플레이어가 있으면 누르면 그 위치부터 재생하고, 매체가 사라졌으면 시점만 보인다. */
function CommentTimeMarker({ seconds, onSeek }: { seconds: number; onSeek?: (seconds: number) => void }) {
  const label = formatTimeMarker(seconds);
  const chip = "inline-flex h-6 shrink-0 items-center rounded-sm px-2 font-mono text-xs font-medium";
  if (!onSeek) {
    return <span className={cn(chip, "bg-muted text-secondary-foreground")}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onSeek(seconds)}
      aria-label={`${label} 위치로 이동`}
      // 좁은 화면은 위아래로 터치 영역을 넓힌다.
      className={cn(
        chip,
        "relative bg-accent text-highlight transition-colors duration-[var(--duration-fast)] after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:bg-highlight/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:after:hidden",
      )}
    >
      {label}
    </button>
  );
}
