/**
 * @file src/components/community/AnnouncementList.tsx
 * @description 공지 게시판 — Radix UI Accordion 기반 아코디언 목록.
 * isPinned 공지는 핀 아이콘 표시. Admin은 고정/해제 토글 버튼 표시.
 */
"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pin, PinOff, Megaphone } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { RichTextContent } from "@/components/editor/RichTextContent";
import { togglePinPost } from "@/lib/actions/posts";
import { createCreationOperationId } from "@/lib/creation-operation";
import { formatKst } from "@/lib/kst-format";

type Post = {
  id: string;
  title: string;
  contentHtml: string;
  isPinned: boolean;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
  version: number;
};

interface AnnouncementListProps {
  posts: Post[];
  isAdmin: boolean;
  returnTo?: string;
}

export function AnnouncementList({ posts, isAdmin, returnTo = "/community" }: AnnouncementListProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const operationIdsRef = useRef(new Map<string, string>());
  const router = useRouter();

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <Megaphone className="w-10 h-10 opacity-20" />
        <p className="text-sm">등록된 공지가 없습니다.</p>
      </div>
    );
  }

  const handleTogglePin = (postId: string, currentPinned: boolean, version: number) => {
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
    <div className="space-y-2">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Accordion type="multiple" className="space-y-2">
      {posts.map((post) => {
        const author =
          post.authorName ?? post.authorEmail?.split("@")[0] ?? "관리자";
        const date = formatKst(post.createdAt, { year: "numeric", month: "short", day: "numeric" }, "날짜 정보 없음");

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
              <RichTextContent html={post.contentHtml} className="mb-4" />
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <Link
                  href={`/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`}
                  className="text-xs text-primary hover:underline"
                >
                  상세 보기 →
                </Link>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1.5"
                    onClick={() => handleTogglePin(post.id, post.isPinned, post.version)}
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
    </div>
  );
}
