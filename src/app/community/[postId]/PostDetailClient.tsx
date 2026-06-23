"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deletePost } from "@/lib/actions/posts";
import {
  createComment,
  deleteComment,
  getCommentsByPost,
  type CreateCommentState,
} from "@/lib/actions/comments";
import { getPostById } from "@/lib/actions/posts";

type Post = NonNullable<Awaited<ReturnType<typeof getPostById>>>;
type Comment = Awaited<ReturnType<typeof getCommentsByPost>>[number];

interface PostDetailClientProps {
  postId: string;
  post: Post;
  initialCommentList: Comment[];
  currentUserId: string | null;
  isAdmin: boolean;
}

export function PostDetailClient({
  postId,
  post,
  initialCommentList,
  currentUserId,
  isAdmin,
}: PostDetailClientProps) {
  const [commentList] = useState<Comment[]>(initialCommentList);
  const [isPending, startTransition] = useTransition();

  // ─── 댓글 폼 ──────────────────────────────────
  const boundCreateComment = createComment.bind(null, postId);
  const [commentState, commentAction, isCommentPending] = useActionState<
    CreateCommentState,
    FormData
  >(boundCreateComment, {});

  // useEffect(() => {
  //   if (commentState.success) refresh(); // Server Action의 revalidatePath가 동작하므로 불필요할 수 있음.
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [commentState.success]);
  // * Server Components 환경에서는 Server Action 실행 후 revalidatePath로 인해 페이지 전체가 자동 리프레시됩니다. 
  //   따라서 별도의 상태 동기화가 필요하지 않습니다.

  const handleDeletePost = () => {
    if (!post || !confirm("이 게시물을 삭제하시겠습니까?")) return;
    startTransition(async () => {
      await deletePost(post.id);
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
    : "—";
  const author =
    post.authorName ?? post.authorEmail?.split("@")[0] ?? "Unknown";
  const canDeletePost = isAdmin || currentUserId === post.authorId;

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-8">
      {/* 헤더 */}
      <div className="space-y-1">
        <Link
          href="/community"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Community
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <h1 className="text-2xl font-semibold">{post.title}</h1>
          {canDeletePost && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeletePost}
              disabled={isPending}
              className="text-destructive hover:bg-destructive/10 flex-shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
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
      </div>

      {/* 본문 */}
      <div
        className="prose prose-sm max-w-none prose-headings:font-semibold prose-p:text-foreground prose-a:text-primary"
        dangerouslySetInnerHTML={{ __html: post.contentHtml }}
      />

      {/* 댓글 섹션 */}
      <section className="space-y-4 border-t pt-6">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">
          댓글 {commentList.length}개
        </h2>

        {/* 댓글 목록 */}
        {commentList.length === 0 ? (
          <p className="text-sm text-muted-foreground">첫 댓글을 남겨보세요.</p>
        ) : (
          <ul className="space-y-3">
            {commentList.map((c) => {
              const cAuthor =
                c.authorName ?? c.authorEmail?.split("@")[0] ?? "Unknown";
              const cDate = c.createdAt
                ? new Date(c.createdAt).toLocaleDateString("ko-KR", {
                    month: "short",
                    day: "numeric",
                  })
                : "—";
              const cInitials = cAuthor.slice(0, 2).toUpperCase();
              const canDelete = isAdmin || currentUserId === c.authorId;

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
                    <div
                      className="text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: c.contentHtml }}
                    />
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
        <form action={commentAction} className="flex gap-2">
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
      </section>
    </div>
  );
}
