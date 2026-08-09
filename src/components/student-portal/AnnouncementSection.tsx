/**
 * @file src/components/student-portal/AnnouncementSection.tsx
 * @description 원페이지 학생 포털 — 공지사항 섹션.
 * AnnouncementList를 감싸는 섹션 래퍼. isAdmin=false로 고정/해제 버튼 숨김.
 */
import { Megaphone } from "lucide-react";
import { AnnouncementList } from "@/components/community/AnnouncementList";

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
}

export function AnnouncementSection({ posts, returnTo }: AnnouncementSectionProps) {
  return (
    <div className="h-full flex flex-col">
      {/* 섹션 헤더 */}
      <div className="flex items-center gap-2.5 mb-6">
        <Megaphone className="w-5 h-5 text-primary flex-shrink-0" />
        <h2 className="text-lg font-semibold tracking-tight">공지사항</h2>
      </div>

      {/* 공지 목록 */}
      <div className="flex-1 overflow-auto">
        <AnnouncementList posts={posts} isAdmin={false} returnTo={returnTo} />
      </div>
    </div>
  );
}
