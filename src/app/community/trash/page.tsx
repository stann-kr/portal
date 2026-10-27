import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { getTrashedPosts } from "@/lib/actions/posts";
import { PostTrashActions } from "@/components/community/PostTrashActions";
import {
  RecordEmpty,
  RecordList,
  RecordPageFrame,
  TrashRecordItem,
} from "@/components/notes/DocumentRecordFrame";
import { formatTrashDeadline, formatTrashTime } from "@/components/notes/note-display";
import { getRequestNow } from "@/lib/request-time";

export const metadata = { title: "게시물 휴지통" };

/** 게시물 휴지통. 노트 휴지통(NotesTrash 보드)과 같은 틀이다. */
export default async function CommunityTrashPage() {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const posts = await getTrashedPosts();
  const now = getRequestNow();

  return (
    <RecordPageFrame
      width="trash"
      back={{ href: "/community", label: "커뮤니티로 돌아가기" }}
      title="게시물 휴지통"
      description="삭제한 게시물과 댓글은 30일 동안 보존되며, 만료 뒤에는 관리자만 영구 삭제할 수 있습니다."
    >
      {posts.length === 0 ? (
        <RecordEmpty icon={Trash2}>휴지통이 비어 있습니다.</RecordEmpty>
      ) : (
        <RecordList label="휴지통의 게시물">
          {posts.map((post) => {
            const expired = Boolean(
              post.purgeEligibleAt && post.purgeEligibleAt.getTime() <= now,
            );
            return (
              <TrashRecordItem
                key={post.id}
                title={post.title}
                href={`/community/${post.id}?returnTo=${encodeURIComponent("/community/trash")}`}
                meta={`${post.authorName ?? "작성자 미상"} · 삭제 ${formatTrashTime(post.deletedAt, now)}`}
                expired={expired}
                state={expired
                  ? "복원 기한이 만료되어 영구 삭제할 수 있습니다."
                  : `복원 가능: ${formatTrashDeadline(post.purgeEligibleAt, now)}까지`}
                actions={
                  <PostTrashActions
                    postId={post.id}
                    version={post.version}
                    deletedAt={post.deletedAt!.toISOString()}
                    canRestore={!expired && (session.user.role === "admin" || session.user.id === post.authorId)}
                    canPurge={session.user.role === "admin" && expired}
                    returnTo="/community/trash"
                  />
                }
              />
            );
          })}
        </RecordList>
      )}
    </RecordPageFrame>
  );
}
