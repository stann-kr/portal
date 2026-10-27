/**
 * @file src/components/community/AnnouncementList.tsx
 * @description 커뮤니티 공지 목록(캔버스 AdminAnnouncements·MobileAdminAnnouncements 보드: 관리자가 보는 커뮤니티 공지).
 * 고정 공지는 본문 미리보기와 상세 보기·고정 해제를 펼친 줄로, 나머지는 제목·작성자·날짜 한 줄 링크로 보인다.
 * 관리자만 고정·고정 해제를 바꾼다.
 */
"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Megaphone, Pin } from "lucide-react";
import { ButtonSpinner, buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { togglePinPost } from "@/lib/actions/posts";
import { createCreationOperationId } from "@/lib/creation-operation";
import { cn } from "@/lib/utils";
import { communityPreview, communityRowMeta } from "./CommunityPostRow";

type Post = {
  id: string;
  title: string;
  contentHtml: string;
  isPinned: boolean;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
  version: number;
  commentCount?: number;
};

interface AnnouncementListProps {
  posts: Post[];
  isAdmin: boolean;
  returnTo?: string;
}

const PIN_BUTTON_CLASS =
  "h-11 shrink-0 rounded-touch px-3 text-body font-normal text-secondary-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-7 md:rounded-md md:px-2.5 md:text-xs";

export function AnnouncementList({ posts, isAdmin, returnTo = "/community" }: AnnouncementListProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingPostId, setPendingPostId] = useState<string | null>(null);
  const operationIdsRef = useRef(new Map<string, string>());
  const router = useRouter();

  if (posts.length === 0) {
    return (
      <EmptyState
        className="mt-4 md:mt-0"
        icon={<Megaphone className="size-4" strokeWidth={1.6} aria-hidden="true" />}
        title="등록된 공지가 없습니다"
        description={isAdmin ? "공지 작성으로 첫 공지를 올려 보세요." : "강사가 공지를 올리면 여기에 보입니다."}
      />
    );
  }

  const handleTogglePin = (postId: string, currentPinned: boolean, version: number) => {
    setPendingPostId(postId);
    startTransition(async () => {
      const operationId =
        operationIdsRef.current.get(postId) ?? createCreationOperationId();
      operationIdsRef.current.set(postId, operationId);
      try {
        const result = await togglePinPost(
          postId,
          !currentPinned,
          operationId,
          version,
        );
        if (!result.success) {
          setError(result.error ?? "공지 고정 상태를 변경하지 못했습니다.");
          return;
        }
        operationIdsRef.current.delete(postId);
        setError(null);
        router.refresh();
      } catch {
        setError("공지 고정 상태를 변경하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}
      <ul className="flex flex-col">
        {posts.map((post) => {
          const meta = communityRowMeta(post, "관리자");
          const detailHref = `/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`;
          const pinButton = isAdmin ? (
            <button
              type="button"
              className={PIN_BUTTON_CLASS}
              onClick={() => handleTogglePin(post.id, post.isPinned, post.version)}
              disabled={isPending}
              aria-busy={isPending && pendingPostId === post.id ? true : undefined}
            >
              {isPending && pendingPostId === post.id ? <ButtonSpinner className="mr-1.5 inline-block align-[-2px]" /> : null}
              {post.isPinned ? "고정 해제" : "고정"}
              <span className="sr-only">: {post.title}</span>
            </button>
          ) : null;

          if (post.isPinned) {
            const preview = communityPreview(post.contentHtml, 240);
            return (
              <li key={post.id} className="flex flex-col gap-2.5 border-b border-muted py-4 md:gap-3 md:px-1 md:py-[18px]">
                <div className="flex items-start gap-2.5 md:items-center">
                  <Pin
                    role="img"
                    aria-label="고정됨"
                    className="mt-1 size-3.5 shrink-0 fill-current text-foreground md:mt-0"
                    strokeWidth={1.4}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:gap-2.5">
                    <span className="break-words text-md font-medium md:flex-1">{post.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
                  </span>
                </div>
                {preview ? <p className="ml-6 line-clamp-3 text-body text-secondary-foreground">{preview}</p> : null}
                <div className="ml-6 flex flex-wrap gap-2">
                  <Link
                    href={detailHref}
                    className={buttonClassName({
                      variant: "outline",
                      className: "h-11 rounded-touch px-3.5 text-body md:h-7 md:rounded-md md:px-2.5 md:text-xs",
                    })}
                  >
                    상세 보기<span className="sr-only">: {post.title}</span>
                  </Link>
                  {pinButton}
                </div>
              </li>
            );
          }

          return (
            <li key={post.id} className="flex items-center gap-2 border-b border-muted md:h-14 md:gap-2.5 md:px-1">
              <Link
                href={detailHref}
                className={cn(
                  "flex min-w-0 flex-1 flex-col gap-0.5 py-3 pl-6 text-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  "md:flex-row md:items-center md:gap-2.5 md:py-0",
                )}
              >
                <span className="text-md md:min-w-0 md:flex-1 md:truncate">{post.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
              </Link>
              {pinButton}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
