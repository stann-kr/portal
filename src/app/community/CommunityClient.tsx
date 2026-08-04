/**
 * @file src/app/community/CommunityClient.tsx
 * @description 커뮤니티 페이지 클라이언트 컴포넌트 — Phase 3 고도화.
 * boardType 탭(공지/자유/피드백) 기반 3유형 분리 UI.
 * - ANNOUNCEMENT: Accordion 아코디언 목록
 * - GENERAL: 카테고리별 스레드 (기존 방식 유지)
 * - FEEDBACK: 믹스셋 리치 미디어 카드 + 인라인 오디오
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Terminal,
  Hash,
  Plus,
  ChevronRight,
  Megaphone,
  MessageSquare,
  Music2,
  ArrowLeft,
} from "lucide-react";
import { getCategories } from "@/lib/actions/categories";
import { getPostsByCategory, getPostsByBoardType } from "@/lib/actions/posts";
import { AnnouncementList } from "@/components/community/AnnouncementList";
import { MixsetFeedbackCard } from "@/components/community/MixsetFeedbackCard";

type Category = Awaited<ReturnType<typeof getCategories>>[number];
type Post = Awaited<ReturnType<typeof getPostsByCategory>>[number];
type FeedbackPost = Awaited<ReturnType<typeof getPostsByBoardType>>[number];

interface CommunityClientProps {
  isAdmin: boolean;
}

// ─── GENERAL 탭 게시물 카드 ───────────────────────

function PostCard({ post }: { post: Post }) {
  const date = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString("ko-KR", {
        month: "short",
        day: "numeric",
      })
    : "날짜 정보 없음";

  const author =
    post.authorName ?? post.authorEmail?.split("@")[0] ?? "작성자 미상";
  const initials = author.slice(0, 2).toUpperCase();

  const preview = post.contentHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return (
    <Link
      href={`/community/${post.id}`}
      className="flex gap-4 p-4 rounded-xl border border-border bg-card hover:bg-accent/5 transition-colors group"
    >
      <div className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center flex-shrink-0 text-xs font-semibold">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs text-muted-foreground">{author}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{date}</span>
        </div>
        <p className="font-medium text-foreground truncate">{post.title}</p>
        <p className="text-sm text-muted-foreground truncate mt-0.5">
          {preview}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 self-center" />
    </Link>
  );
}

// ─── 빈 상태 ─────────────────────────────────────

function EmptyState({
  icon: Icon,
  message,
  href,
  label,
}: {
  icon: React.ElementType;
  message: string;
  href: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground space-y-3">
      <Icon className="w-10 h-10 opacity-20" />
      <p className="text-sm">{message}</p>
      <Button asChild size="sm" variant="outline">
        <Link href={href}>{label}</Link>
      </Button>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────

export default function CommunityClient({ isAdmin }: CommunityClientProps) {
  const [activeTab, setActiveTab] = useState<
    "ANNOUNCEMENT" | "GENERAL" | "FEEDBACK"
  >("GENERAL");
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [generalPosts, setGeneralPosts] = useState<Post[]>([]);
  const [announcementPosts, setAnnouncementPosts] = useState<FeedbackPost[]>(
    [],
  );
  const [feedbackPosts, setFeedbackPosts] = useState<FeedbackPost[]>([]);
  const [loading, setLoading] = useState(false);

  // 카테고리 초기 로드
  useEffect(() => {
    getCategories().then((data) => {
      setCategories(data);
      if (data.length > 0) setActiveCategory(data[0].slug);
    });
  }, []);

  // GENERAL 탭: 카테고리별 게시물 로드
  useEffect(() => {
    if (activeTab !== "GENERAL" || !activeCategory) return;
    setLoading(true);
    getPostsByCategory(
      activeCategory as Parameters<typeof getPostsByCategory>[0],
    ).then((data) => {
      setGeneralPosts(data);
      setLoading(false);
    });
  }, [activeTab, activeCategory]);

  // ANNOUNCEMENT/FEEDBACK 탭: boardType별 로드
  useEffect(() => {
    if (activeTab === "GENERAL") return;
    setLoading(true);
    getPostsByBoardType(activeTab).then((data) => {
      if (activeTab === "ANNOUNCEMENT") setAnnouncementPosts(data);
      else setFeedbackPosts(data);
      setLoading(false);
    });
  }, [activeTab]);

  const currentCat = categories.find((c) => c.slug === activeCategory);

  return (
    <div className="flex h-[calc(100vh-57px)] overflow-hidden bg-background">
      {/* 사이드바 */}
      <aside className="hidden md:flex w-56 border-r border-border flex-col bg-card">
        <div className="p-4 border-b border-border space-y-3">
          <Link
            href="/dashboard/student"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            대시보드로
          </Link>
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Terminal className="w-4 h-4" />
            Community
          </div>
        </div>

        {/* GENERAL일 때만 채널 사이드바 표시 */}
        {activeTab === "GENERAL" ? (
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-1.5">
              Channels
            </p>
            {categories.map((cat) => {
              const isActive = cat.slug === activeCategory;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.slug)}
                  className={`w-full text-left flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                  {cat.name}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="flex-1 p-4 flex flex-col gap-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {activeTab === "ANNOUNCEMENT" ? "공지사항" : "믹스셋 공유"}
            </p>
            <p className="text-xs text-muted-foreground">
              {activeTab === "ANNOUNCEMENT"
                ? "강사가 등록한 공지를 확인하세요."
                : "믹스셋을 공유하고 피드백을 나눠보세요."}
            </p>
          </div>
        )}
      </aside>

      {/* 메인 영역 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 상단 탭 + 헤더 */}
        <header className="border-b border-border bg-card/80 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center justify-between px-6 h-14">
            {/* 탭 전환 */}
            <Tabs
              value={activeTab}
              onValueChange={(v) =>
                setActiveTab(v as "ANNOUNCEMENT" | "GENERAL" | "FEEDBACK")
              }
            >
              <TabsList className="h-8">
                <TabsTrigger
                  value="ANNOUNCEMENT"
                  className="text-xs gap-1.5 px-3"
                >
                  <Megaphone className="w-3 h-3" />
                  공지
                </TabsTrigger>
                <TabsTrigger value="GENERAL" className="text-xs gap-1.5 px-3">
                  <MessageSquare className="w-3 h-3" />
                  자유{" "}
                  {activeTab === "GENERAL" && currentCat && (
                    <span className="text-muted-foreground">
                      / {currentCat.name}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="FEEDBACK" className="text-xs gap-1.5 px-3">
                  <Music2 className="w-3 h-3" />
                  믹스셋
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* 새 글 버튼 */}
            {(activeTab !== "ANNOUNCEMENT" || isAdmin) && (
              <Button
                asChild
                size="sm"
                className="gap-1.5"
              >
                <Link
                  href={`/community/new?boardType=${activeTab}&category=${activeCategory}`}
                >
                  <Plus className="w-3.5 h-3.5" />새 글
                </Link>
              </Button>
            )}
          </div>
        </header>

        {/* 게시물 목록 */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl border bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : (
            <>
              {/* ANNOUNCEMENT 탭 */}
              {activeTab === "ANNOUNCEMENT" && (
                <div className="max-w-3xl">
                  <AnnouncementList
                    posts={announcementPosts.map((p) => ({
                      ...p,
                      isPinned: p.isPinned ?? false,
                      createdAt: p.createdAt ?? null,
                    }))}
                    isAdmin={isAdmin}
                  />
                  {isAdmin && (
                    <div className="mt-4">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                      >
                        <Link href="/community/new?boardType=ANNOUNCEMENT">
                          <Plus className="w-3.5 h-3.5" />
                          공지 작성
                        </Link>
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* GENERAL 탭 */}
              {activeTab === "GENERAL" && (
                <div className="space-y-3 max-w-3xl">
                  {generalPosts.length === 0 ? (
                    <EmptyState
                      icon={MessageSquare}
                      message="아직 게시물이 없습니다."
                      href={`/community/new?boardType=GENERAL&category=${activeCategory}`}
                      label="첫 게시물 작성하기"
                    />
                  ) : (
                    generalPosts.map((post) => (
                      <PostCard key={post.id} post={post} />
                    ))
                  )}
                </div>
              )}

              {/* FEEDBACK 탭 */}
              {activeTab === "FEEDBACK" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
                  {feedbackPosts.length === 0 ? (
                    <div className="col-span-full">
                      <EmptyState
                        icon={Music2}
                        message="공유된 믹스셋이 없습니다."
                        href="/community/new?boardType=FEEDBACK"
                        label="첫 믹스셋 공유하기"
                      />
                    </div>
                  ) : (
                    feedbackPosts.map((post) => (
                      <MixsetFeedbackCard
                        key={post.id}
                        post={{
                          ...post,
                          isPinned: post.isPinned ?? false,
                          createdAt: post.createdAt ?? null,
                        }}
                      />
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* 모바일 탭 바 */}
        <div className="md:hidden flex border-t border-border bg-card">
          {(
            [
              { value: "ANNOUNCEMENT", icon: Megaphone, label: "공지" },
              { value: "GENERAL", icon: MessageSquare, label: "자유" },
              { value: "FEEDBACK", icon: Music2, label: "믹스셋" },
            ] as const
          ).map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setActiveTab(value)}
              className={`flex-1 flex flex-col items-center py-2.5 text-[10px] gap-1 transition-colors ${
                activeTab === value
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
