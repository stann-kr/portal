/**
 * @file src/components/student-portal/PostDetailPanel.tsx
 * @description SlidePanel 내 게시물 상세 뷰.
 * HTML 콘텐츠 + 댓글 리스트 + 댓글 작성 폼.
 */
"use client";

import { useState, useEffect, useActionState, useCallback, useRef } from "react";
import Link from "next/link";
import { ExternalLink, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { formatKstShortDate } from "@/lib/kst-format";
import {
  getCommentsByPost,
  createComment,
  type CreateCommentState,
} from "@/lib/actions/comments";

type RawComment = Awaited<ReturnType<typeof getCommentsByPost>>[number];

type Comment = {
  id: string;
  contentHtml: string;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
};

interface PostDetailPanelProps {
  postId: string;
  contentHtml: string;
  returnTo: string;
}

// ── 댓글 작성 폼 ──────────────────────────────────

function CommentForm({
  postId,
  onSuccess,
}: {
  postId: string;
  onSuccess: () => void;
}) {
  const boundAction = createComment.bind(null, postId);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, isPending] = useActionState<CreateCommentState, FormData>(
    boundAction,
    {},
  );

  useEffect(() => {
    if (!state.commentId) return;
    formRef.current?.reset();
    onSuccess();
  }, [state.commentId, onSuccess]);

  return (
    <form ref={formRef} action={action} className="flex gap-2 mt-4">
      <input
        name="content"
        placeholder="댓글을 입력하세요..."
        required
        disabled={isPending}
        className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50"
      />
      <Button type="submit" size="sm" disabled={isPending} className="h-9 gap-1.5">
        <Send className="w-3.5 h-3.5" />
        {isPending ? "..." : "등록"}
      </Button>
      {state.error && (
        <p className="text-xs text-destructive mt-1 col-span-2">{state.error}</p>
      )}
    </form>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────

export function PostDetailPanel({ postId, contentHtml, returnTo }: PostDetailPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestIdRef = useRef(0);

  const loadComments = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(false);
    try {
      const data = await getCommentsByPost(postId);
      if (requestId !== requestIdRef.current) return;
      setComments(
        (data as RawComment[]).map((c) => ({
          id: c.id,
          contentHtml: c.contentHtml ?? "",
          authorName: c.authorName ?? null,
          authorEmail: c.authorEmail ?? null,
          createdAt: c.createdAt ? new Date(c.createdAt) : null,
        })),
      );
      setLoading(false);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setLoadError(true);
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    loadComments();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadComments]);

  return (
    <div className="space-y-6">
      {/* 게시물 본문 */}
      <RichTextContent html={contentHtml} />
      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <Link href={`/community/${postId}?returnTo=${encodeURIComponent(returnTo)}`}>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          전체 화면에서 열기·수정
        </Link>
      </Button>

      {/* 구분선 */}
      <div className="border-t border-border pt-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          댓글 {comments.length > 0 ? `(${comments.length})` : ""}
        </h4>

        {/* 댓글 리스트 */}
        {loading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="space-y-2 py-4 text-center">
            <p role="alert" className="text-sm text-destructive">
              댓글을 불러오지 못했습니다.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={loadComments}>
              다시 시도
            </Button>
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            첫 댓글을 남겨보세요.
          </p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => {
              const author = c.authorName ?? c.authorEmail?.split("@")[0] ?? "익명";
              const date = formatKstShortDate(c.createdAt, "날짜 정보 없음");
              return (
                <li
                  key={c.id}
                  className="flex gap-3 p-3 rounded-lg border border-border bg-card"
                >
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground">{author}</span>
                      <span className="text-xs text-muted-foreground">{date}</span>
                    </div>
                    <RichTextContent html={c.contentHtml} className="text-sm" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* 댓글 작성 폼 */}
        <CommentForm postId={postId} onSuccess={loadComments} />
      </div>
    </div>
  );
}
