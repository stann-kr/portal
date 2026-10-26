/**
 * @file src/components/student-portal/AnnouncementSection.tsx
 * @description 공지 화면(캔버스 AdminAnnouncements·MobileAdminAnnouncements 보드).
 * 관리자 포털의 공지 구역이 쓰고, 공지 작성은 커뮤니티 공지 작성 화면(/community/new)으로 연다.
 * isAdmin=false면 작성·고정 조작을 숨긴다.
 */
"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { AnnouncementList } from "@/components/community/AnnouncementList";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { buttonClassName } from "@/components/ui/button";

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
  const composeHref = `/community/new?boardType=ANNOUNCEMENT&returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <section aria-labelledby="announcements-title" className="px-5 pb-8 pt-6 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      {isAdmin ? <MobileTopBar title="공지" action={{ href: composeHref, label: "공지 작성" }} /> : null}
      <div className="flex max-w-[820px] flex-col gap-5 md:gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 id="announcements-title" className="text-mobile-title font-semibold tracking-display md:text-display">공지</h1>
            <p className="text-body text-secondary-foreground">학생 홈과 커뮤니티 공지 탭에 함께 보입니다.</p>
          </div>
          {isAdmin ? (
            <Link href={composeHref} className={buttonClassName({ className: "hidden gap-1.5 md:inline-flex" })}>
              <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />공지 작성
            </Link>
          ) : null}
        </header>

        <AnnouncementList posts={posts} isAdmin={isAdmin} returnTo={returnTo} />
      </div>
    </section>
  );
}
