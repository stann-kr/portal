import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getTrashedPosts } from "@/lib/actions/posts";
import { PostTrashActions } from "@/components/community/PostTrashActions";
import { formatKst } from "@/lib/kst-format";

export const metadata = { title: "게시물 휴지통" };

export default async function CommunityTrashPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const posts = await getTrashedPosts();
  const now = Date.now();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3 border-b border-border pb-5">
        <Link
          href="/community"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          커뮤니티로 돌아가기
        </Link>
        <div className="flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">게시물 휴지통</h1>
            <p className="text-sm text-muted-foreground">
              삭제한 게시물과 댓글은 30일 동안 보존되며, 만료 뒤에는 관리자만 영구 삭제할 수 있습니다.
            </p>
          </div>
        </div>
      </header>

      {posts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          휴지통이 비어 있습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => {
            const expired = Boolean(
              post.purgeEligibleAt && post.purgeEligibleAt.getTime() <= now,
            );
            return (
              <li key={post.id} className="space-y-3 rounded-xl border border-border bg-card p-5">
                <div>
                  <Link
                    href={`/community/${post.id}?returnTo=${encodeURIComponent("/community/trash")}`}
                    className="font-medium hover:underline"
                  >
                    {post.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {post.authorName ?? "작성자 미상"} · 삭제 {formatKst(post.deletedAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {expired
                      ? "복원 기한이 만료되어 영구 삭제할 수 있습니다."
                      : `복원 가능: ${formatKst(post.purgeEligibleAt)}까지`}
                  </p>
                </div>
                <PostTrashActions
                  postId={post.id}
                  version={post.version}
                  deletedAt={post.deletedAt!.toISOString()}
                  canRestore={!expired && (session.user.role === "admin" || session.user.id === post.authorId)}
                  canPurge={session.user.role === "admin" && expired}
                  returnTo="/community/trash"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
