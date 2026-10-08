/**
 * @file src/app/community/[postId]/page.tsx
 * @description 게시물 상세 페이지 — 내용 + 댓글.
 * Server Component로 분리하여 auth 및 db 호출을 서버 측에서 안전하게 수행.
 */
import Link from "next/link";
import { getPostIncludingTrash } from "@/lib/actions/posts";
import { getCommentsByPost } from "@/lib/actions/comments";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { PostDetailClient } from "./PostDetailClient";
import { safeReturnPath } from "@/lib/safe-return-path";
import { redirect } from "next/navigation";

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { postId } = await params;
  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo, "/community");
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");

  const [post, commentList] = await Promise.all([
    getPostIncludingTrash(postId),
    getCommentsByPost(postId),
  ]);

  if (!post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 text-center text-muted-foreground sm:px-6">
        <p>게시물을 찾을 수 없습니다.</p>
        <Link href={returnTo} className="text-sm underline mt-2 block">
          목록으로
        </Link>
      </div>
    );
  }

  const currentUserId = session.user.id;
  const isAdmin = session.user.role === "admin";

  return (
    <PostDetailClient
      postId={postId}
      post={post}
      initialCommentList={commentList}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      returnTo={returnTo}
    />
  );
}
