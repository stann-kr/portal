/**
 * @file src/app/community/[postId]/page.tsx
 * @description 게시물 상세 페이지(캔버스 CommunityPost·MobileCommunityPost 보드) — 내용 + 댓글.
 * Server Component로 분리하여 auth 및 db 호출을 서버 측에서 안전하게 수행.
 */
import Link from "next/link";
import { getPostIncludingTrash } from "@/lib/actions/posts";
import { getCommentsByPost } from "@/lib/actions/comments";
import { getCategories } from "@/lib/actions/categories";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { PostDetailClient } from "./PostDetailClient";
import { safeReturnPath } from "@/lib/safe-return-path";
import { redirect } from "next/navigation";
import { buttonClassName } from "@/components/ui/button";

export const metadata = { title: "게시물" };

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

  const [post, commentList, categories] = await Promise.all([
    getPostIncludingTrash(postId),
    getCommentsByPost(postId),
    getCategories(),
  ]);

  if (!post) {
    return (
      <div className="px-5 pb-8 pt-10 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
        <div className="flex max-w-[760px] flex-col items-start gap-3">
          <h1 className="text-xl font-semibold tracking-title">게시물을 찾을 수 없습니다</h1>
          <p className="text-body text-secondary-foreground">삭제되었거나 볼 수 있는 권한이 없는 게시물입니다.</p>
          <Link href={returnTo} className={buttonClassName({ variant: "outline" })}>목록으로</Link>
        </div>
      </div>
    );
  }

  const currentUserId = session.user.id;
  const isAdmin = session.user.role === "admin";
  // 게시물은 채널의 주소 식별자를 저장한다. 화면에는 채널 이름을 보인다.
  const channelName = categories.find((category) => category.slug === post.category)?.name ?? null;

  return (
    <div className="flex min-h-[calc(100dvh-var(--app-topbar-height))] flex-col md:block md:min-h-0 px-5 pt-5 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-10">
      <div className="flex max-w-[760px] flex-1 flex-col md:block">
        <PostDetailClient
          postId={postId}
          post={post}
          channelName={channelName}
          initialCommentList={commentList}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          returnTo={returnTo}
        />
      </div>
    </div>
  );
}
