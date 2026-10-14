/**
 * @file src/components/student-portal/AnnouncementSection.tsx
 * @description 원페이지 학생 포털 — 공지사항 섹션.
 * AnnouncementList를 감싸는 섹션 래퍼. isAdmin=false로 고정/해제 버튼 숨김.
 */
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { AnnouncementList } from "@/components/community/AnnouncementList";
import { Button } from "@/components/ui/button";

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

interface AnnouncementSectionProps {
  posts: Post[];
  returnTo?: string;
  isAdmin?: boolean;
}

export function AnnouncementSection({ posts, returnTo = "/community", isAdmin = false }: AnnouncementSectionProps) {
  return (
    <div className="h-full flex flex-col">
      {/* 섹션 헤더 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Megaphone className="w-5 h-5 text-primary flex-shrink-0" aria-hidden="true" />
          <h2 className="text-lg font-semibold tracking-tight">공지사항</h2>
        </div>
        {isAdmin ? (
          <Button asChild size="sm">
            <Link href={`/community/new?boardType=ANNOUNCEMENT&returnTo=${encodeURIComponent(returnTo)}`}>
              <Plus className="size-4" aria-hidden="true" />공지 작성
            </Link>
          </Button>
        ) : null}
      </div>

      {/* 공지 목록 */}
      <div className="flex-1 overflow-auto">
        <AnnouncementList posts={posts} isAdmin={isAdmin} returnTo={returnTo} />
      </div>
    </div>
  );
}
