/**
 * @file src/components/community/AnnouncementList.tsx
 * @description 공지 게시판 — Radix UI Accordion 기반 아코디언 목록.
 * isPinned 공지는 핀 아이콘 표시. Admin은 고정/해제 토글 버튼 표시.
 */
"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Pin, PinOff, Megaphone } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { togglePinPost } from "@/lib/actions/posts";

type Post = {
  id: string;
  title: string;
  contentHtml: string;
  isPinned: boolean;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
};

interface AnnouncementListProps {
  posts: Post[];
  isAdmin: boolean;
}

export function AnnouncementList({ posts, isAdmin }: AnnouncementListProps) {
  const [isPending, startTransition] = useTransition();

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <Megaphone className="w-10 h-10 opacity-20" />
        <p className="text-sm">등록된 공지가 없습니다.</p>
      </div>
    );
  }

  const handleTogglePin = (postId: string, currentPinned: boolean) => {
    startTransition(() => togglePinPost(postId, currentPinned));
  };

  return (
    <Accordion type="multiple" className="space-y-2">
      {posts.map((post) => {
        const author =
          post.authorName ?? post.authorEmail?.split("@")[0] ?? "관리자";
        const date = post.createdAt
          ? new Date(post.createdAt).toLocaleDateString("ko-KR", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "날짜 정보 없음";

        return (
          <AccordionItem
            key={post.id}
            value={post.id}
            className={`rounded-xl border px-4 ${
              post.isPinned
                ? "border-primary/30 bg-primary/5"
                : "border-border bg-card"
            }`}
          >
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                {post.isPinned && (
                  <Pin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                )}
                <span className="font-medium text-foreground truncate text-sm">
                  {post.title}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0 hidden sm:block">
                  {author} · {date}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div
                className="prose prose-sm max-w-none text-foreground prose-a:text-primary mb-4"
                dangerouslySetInnerHTML={{ __html: post.contentHtml }}
              />
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <Link
                  href={`/community/${post.id}`}
                  className="text-xs text-primary hover:underline"
                >
                  상세 보기 →
                </Link>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1.5"
                    onClick={() => handleTogglePin(post.id, post.isPinned)}
                    disabled={isPending}
                  >
                    {post.isPinned ? (
                      <>
                        <PinOff className="w-3 h-3" /> 고정 해제
                      </>
                    ) : (
                      <>
                        <Pin className="w-3 h-3" /> 고정
                      </>
                    )}
                  </Button>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
