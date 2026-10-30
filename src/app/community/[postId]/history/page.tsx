import { notFound, redirect } from "next/navigation";
import { getActiveAuthSession } from "@/lib/auth-guard";
import {
  getPostIncludingTrash,
  getPostRevisions,
} from "@/lib/actions/posts";
import { safeReturnPath } from "@/lib/safe-return-path";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { RestorePostRevisionButton } from "@/components/community/RestorePostRevisionButton";
import {
  HistoryRecordItem,
  RecordDetails,
  RecordList,
  RecordMeta,
  RecordPageFrame,
} from "@/components/notes/DocumentRecordFrame";
import { formatRecordTime } from "@/lib/kst-format";
import { getRequestNow } from "@/lib/request-time";
import { describeRevisionLinkChange } from "@/lib/community-mixset-media";

export const metadata = { title: "게시물 변경 이력" };

const CHANGE_LABELS = {
  BASELINE: "기존 게시물 이관",
  CREATE: "게시물 생성",
  UPDATE: "내용 수정",
  SET_PIN: "공지 고정 변경",
  RESTORE_REVISION: "과거 버전 복원",
  TRASH: "휴지통 이동",
  RESTORE_TRASH: "휴지통 복원",
} as const;

/** 게시물 변경 이력. 노트 변경 이력(NoteHistory 보드)과 같은 틀이다. */
export default async function PostHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) redirect("/login");
  const { postId } = await params;
  const post = await getPostIncludingTrash(postId);
  if (!post || (session.user.role !== "admin" && session.user.id !== post.authorId)) {
    notFound();
  }
  const revisions = await getPostRevisions(postId);
  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo, "/community");
  const postHref = `/community/${postId}?returnTo=${encodeURIComponent(returnTo)}`;
  const canRestore = !post.deletedAt;
  const now = getRequestNow();

  return (
    <RecordPageFrame
      width="history"
      back={{ href: postHref, label: "게시물로 돌아가기" }}
      title="변경 이력"
      subtitle={<>{post.title} · 현재 <span className="font-mono">{post.version}</span>번 버전</>}
      description="과거 버전을 복원해도 기존 기록은 유지되고 새 현재 버전이 추가됩니다."
    >
      <RecordList ordered label="게시물 변경 이력">
        {revisions.map((revision, index) => {
          // 이력은 최신순이므로 바로 앞 버전은 다음 행이다. 제목·본문이 같고 링크만 바뀐 수정도 구분해 보인다.
          const linkChange = describeRevisionLinkChange(revision, revisions[index + 1]);
          const changeLabel = linkChange?.linkOnly && revision.changeType === "UPDATE"
            ? "링크 변경"
            : CHANGE_LABELS[revision.changeType];
          const extra = [
            revision.restoredFromRevision ? `${revision.restoredFromRevision}번에서 복원` : null,
            linkChange && changeLabel !== "링크 변경" ? "링크 변경" : null,
          ].filter(Boolean).join(" · ");
          return (
            <HistoryRecordItem
              key={revision.id}
              number={revision.revisionNumber}
              changeLabel={changeLabel}
              meta={
                <RecordMeta
                  time={formatRecordTime(revision.createdAt, now)}
                  actor={revision.actorName ?? "시스템"}
                  extra={extra || undefined}
                />
              }
              action={canRestore ? (
                <RestorePostRevisionButton
                  postId={post.id}
                  baseRevision={post.version}
                  revisionNumber={revision.revisionNumber}
                />
              ) : null}
            >
              <RecordDetails summary={`저장된 내용 보기 — ${revision.title}`}>
                <p className="text-xs text-muted-foreground">
                  {revision.boardType} · {revision.category}
                  {revision.isPinned ? " · 고정" : ""}
                </p>
                {linkChange ? (
                  <p className="text-xs text-muted-foreground">
                    링크 변경: <span className="break-all">{linkChange.from ?? "없음"}</span>
                    {" → "}
                    <span className="break-all">{linkChange.to ?? "없음"}</span>
                  </p>
                ) : null}
                <RichTextContent html={revision.contentHtml} className="text-body text-secondary-foreground" />
              </RecordDetails>
            </HistoryRecordItem>
          );
        })}
      </RecordList>
    </RecordPageFrame>
  );
}
