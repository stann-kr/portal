/**
 * @file src/components/student-portal/CommunitySection.tsx
 * @description 포털의 최근 커뮤니티 목록. 작성·상세·분류 권한은 canonical /community route가 소유한다.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, Plus, MessageSquare, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKstShortDate } from "@/lib/kst-format";

// ── 타입 ──────────────────────────────────────────

type Post = {
  id: string;
  title: string;
  contentHtml: string;
  boardType: string;
  isPinned: boolean;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
};

interface CommunitySectionProps {
  initialPosts: Post[];
  returnTo: string;
}

// ── 메인 컴포넌트 ─────────────────────────────────

const BOARD_TABS = [
  { id: "ALL", label: "전체" },
  { id: "GENERAL", label: "자유" },
  { id: "FEEDBACK", label: "피드백" },
] as const;

const BOARD_LABELS: Record<string, string> = {
  GENERAL: "자유",
  FEEDBACK: "피드백",
  ANNOUNCEMENT: "공지",
};

type BoardFilter = (typeof BOARD_TABS)[number]["id"];

export function CommunitySection({ initialPosts, returnTo }: CommunitySectionProps) {
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
    <div className="space-y-4">
      {/* 섹션 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Users className="w-5 h-5 text-primary flex-shrink-0" />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">커뮤니티</h2>
            <p className="text-xs text-muted-foreground">전체 학생 소통 공간</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="ghost" className="h-8 gap-1.5 text-xs">
            <Link href="/community"><Users className="size-3.5" aria-hidden="true" />전체 커뮤니티</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
            <Link href={`/community/new?boardType=GENERAL&returnTo=${encodeURIComponent(returnTo)}`}><Plus className="size-3.5" aria-hidden="true" />새 글 작성</Link>
          </Button>
        </div>
      </div>

      {/* 탭 필터 + 검색 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {BOARD_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setBoardFilter(id)}
              aria-pressed={boardFilter === id}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                boardFilter === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목·작성자 검색"
            className="h-8 pl-8 text-xs"
            aria-label="게시물 검색"
          />
        </div>
      </div>

      {/* 게시물 리스트 */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <MessageSquare className="w-8 h-8 opacity-20" />
          <p className="text-sm">
            {normalizedQuery ? "검색 결과가 없습니다." : "게시물이 없습니다."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((post) => {
            const author =
              post.authorName ?? post.authorEmail?.split("@")[0] ?? "익명";
            const date = formatKstShortDate(post.createdAt, "날짜 정보 없음");

            return (
              <Link
                key={post.id}
                href={`/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`}
                className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-accent transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        post.boardType === "FEEDBACK"
                          ? "bg-warning-muted text-warning"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
                      {BOARD_LABELS[post.boardType] ?? post.boardType}
                    </span>
                    {post.isPinned && (
                      <span className="text-[10px] font-medium text-primary">📌</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{post.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {author} · {date}
                  </p>
                </div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}

    </div>
  );
}
