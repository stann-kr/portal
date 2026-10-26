/**
 * @file src/components/student-portal/CommunitySection.tsx
 * @description 포털의 최근 커뮤니티 목록. 작성·상세·분류 권한은 canonical /community route가 소유한다.
 * 캔버스 Community 보드의 목록 줄(제목·게시판·작성자·날짜)과 같은 모양을 쓴다.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquare, Pin, Plus, Search, Settings2 } from "lucide-react";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { formatKstShortDate } from "@/lib/kst-format";
import { cn } from "@/lib/utils";

// ── 타입 ──────────────────────────────────────────

type Post = {
  id: string;
  title: string;
  boardType: string;
  isPinned: boolean;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
};

interface CommunitySectionProps {
  initialPosts: Post[];
  returnTo: string;
  /** 관리자에게만 전달하는 채널 관리 경로. */
  manageHref?: string;
}

// ── 메인 컴포넌트 ─────────────────────────────────

const BOARD_TABS = [
  { id: "ALL", label: "전체" },
  { id: "GENERAL", label: "자유" },
  { id: "FEEDBACK", label: "믹스셋" },
] as const;

const BOARD_LABELS: Record<string, string> = {
  GENERAL: "자유",
  FEEDBACK: "믹스셋",
  ANNOUNCEMENT: "공지",
};

type BoardFilter = (typeof BOARD_TABS)[number]["id"];

export function CommunitySection({ initialPosts, returnTo, manageHref }: CommunitySectionProps) {
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("ALL");
  const [query, setQuery] = useState("");

  // 보드 타입 필터 + 제목/작성자 검색 결합
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = initialPosts.filter((p) => {
    if (boardFilter !== "ALL" && p.boardType !== boardFilter) return false;
    if (!normalizedQuery) return true;
    const author = (p.authorName ?? p.authorEmail ?? "").toLowerCase();
    return (
      p.title.toLowerCase().includes(normalizedQuery) ||
      author.includes(normalizedQuery)
    );
  });

  return (
    <section aria-labelledby="community-section-title" className="flex flex-col gap-5 md:gap-6">
      {/* 섹션 헤더 */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="community-section-title" className="text-xl font-semibold tracking-title">커뮤니티</h2>
          <p className="text-body text-secondary-foreground">최근 게시물 20개를 보여줍니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {manageHref ? (
            <Link href={manageHref} className={buttonClassName({ variant: "ghost", className: "gap-1.5" })}>
              <Settings2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />채널 관리
            </Link>
          ) : null}
          <Link href="/community" className={buttonClassName({ variant: "ghost" })}>전체 커뮤니티</Link>
          <Link href={`/community/new?boardType=GENERAL&returnTo=${encodeURIComponent(returnTo)}`} className={buttonClassName({ className: "gap-1.5" })}>
            <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />새 글
          </Link>
        </div>
      </header>

      {/* 게시판 칩 + 검색 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="게시판 분류">
          {BOARD_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setBoardFilter(id)}
              aria-pressed={boardFilter === id}
              className={cn(
                "h-7 rounded-full px-2.5 text-xs transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                boardFilter === id ? "bg-primary text-primary-foreground" : "bg-muted text-secondary-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="relative flex w-full items-center sm:w-60">
          <span className="sr-only">게시물 검색</span>
          <Search className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground md:left-2.5 md:size-3.5" strokeWidth={1.8} aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목·작성자 검색"
            className="pl-10 md:h-8 md:pl-8 md:text-ui"
          />
        </label>
      </div>

      {/* 게시물 리스트 */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-4" strokeWidth={1.6} aria-hidden="true" />}
          title={normalizedQuery ? "검색 결과가 없습니다" : "게시물이 없습니다"}
          description={normalizedQuery ? "다른 제목이나 작성자로 검색해 주세요." : "새 글로 첫 이야기를 남겨 보세요."}
        />
      ) : (
        <ul className="flex flex-col">
          {filtered.map((post) => {
            const author =
              post.authorName ?? post.authorEmail?.split("@")[0] ?? "익명";
            const date = formatKstShortDate(post.createdAt, "날짜 정보 없음");

            return (
              <li key={post.id}>
                <Link
                  href={`/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`}
                  className="flex flex-col gap-1 border-b border-muted px-1 py-3.5 text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <span className="flex items-center gap-2 text-md font-medium">
                    {post.isPinned ? (
                      <Pin role="img" aria-label="고정됨" className="size-3.5 shrink-0 fill-current" strokeWidth={1.4} />
                    ) : null}
                    <span className="min-w-0 truncate">{post.title}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {BOARD_LABELS[post.boardType] ?? post.boardType} · {author} · {date}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
