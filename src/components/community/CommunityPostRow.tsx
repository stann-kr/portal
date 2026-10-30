/**
 * @file src/components/community/CommunityPostRow.tsx
 * @description 커뮤니티 목록의 게시물 한 줄(캔버스 Community·MobileCommunity 보드).
 * 제목, 본문 첫 줄 미리보기, 작성자·날짜·댓글 수. 줄 전체가 상세로 가는 링크다.
 */
import Link from "next/link";
import { COMMUNITY_BOARD_LABELS } from "@/lib/community-location";
import { formatKstShortDate } from "@/lib/kst-format";
import { getSearchableDocumentText } from "@/lib/document-search";

// 게시판 이름은 이력 화면과 같은 원본(lib)을 쓴다. 기존 import 경로를 위해 다시 내보낸다.
export { COMMUNITY_BOARD_LABELS };

type CommunityPostSummary = {
  id: string;
  title: string;
  contentHtml: string;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
  /** 목록 응답이 함께 보내는 댓글 수. 상세·다른 목록처럼 값이 없으면 표시하지 않는다. */
  commentCount?: number;
};

/** 목록 줄 아래 메타: 작성자 · 날짜 · 댓글 N(캔버스 Community 보드). */
export function communityRowMeta(post: Pick<CommunityPostSummary, "authorName" | "authorEmail" | "createdAt" | "commentCount">, authorFallback?: string): string {
  const parts = [communityAuthorName(post, authorFallback), formatKstShortDate(post.createdAt, "날짜 정보 없음")];
  if (typeof post.commentCount === "number") parts.push(`댓글 ${post.commentCount}`);
  return parts.join(" · ");
}

export function communityAuthorName(post: Pick<CommunityPostSummary, "authorName" | "authorEmail">, fallback = "작성자 미상"): string {
  return post.authorName ?? post.authorEmail?.split("@")[0] ?? fallback;
}

/** 목록 미리보기용 평문. 저장 HTML을 직접 렌더하지 않는다. */
export function communityPreview(contentHtml: string, length = 100): string {
  return Array.from(getSearchableDocumentText(contentHtml)).slice(0, length).join("");
}

export function CommunityPostRow({ post, returnTo }: { post: CommunityPostSummary; returnTo: string }) {
  const preview = communityPreview(post.contentHtml);
  const meta = communityRowMeta(post);

  return (
    <li>
      <Link
        href={`/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`}
        className="flex flex-col gap-1 border-b border-muted py-3.5 text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none md:px-1 md:py-4"
      >
        <span className="text-md font-medium">{post.title}</span>
        {preview ? <span className="truncate text-ui text-secondary-foreground">{preview}</span> : null}
        <span className="text-xs text-muted-foreground">{meta}</span>
      </Link>
    </li>
  );
}
