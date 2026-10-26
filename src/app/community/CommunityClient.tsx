/**
 * @file src/app/community/CommunityClient.tsx
 * @description 커뮤니티 페이지 클라이언트 컴포넌트 — Phase 3 고도화.
 * boardType 탭(공지/자유/피드백) 기반 3유형 분리 UI.
 * - ANNOUNCEMENT: Accordion 아코디언 목록
 * - GENERAL: 카테고리별 스레드 (기존 방식 유지)
 * - FEEDBACK: 믹스셋 리치 미디어 카드 + 인라인 오디오
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Hash,
  Plus,
  ChevronRight,
  Megaphone,
  MessageSquare,
  Music2,
  RotateCcw,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { getCategories } from "@/lib/actions/categories";
import { getCommunityPostPage } from "@/lib/actions/posts";
import { AnnouncementList } from "@/components/community/AnnouncementList";
import { MixsetFeedbackCard } from "@/components/community/MixsetFeedbackCard";
import { formatKstShortDate } from "@/lib/kst-format";
import { getSearchableDocumentText } from "@/lib/document-search";
import { resolveCommunityBoardType, type CommunityBoardType } from "@/lib/community-location";

type Category = Awaited<ReturnType<typeof getCategories>>[number];
type Post = Awaited<ReturnType<typeof getCommunityPostPage>>["posts"][number];
type FeedbackPost = Post;

interface CommunityClientProps {
  isAdmin: boolean;
  /** 서버가 URL로 확정한 첫 위치와 첫 페이지. */
  initial: {
    boardType: CommunityBoardType;
    category: string;
    categories: Category[];
    posts: Post[];
    nextCursor: string | null;
  };
}

/** 이어 읽은 페이지를 붙이되 이미 보이는 게시물은 다시 넣지 않는다. */
function appendPage(current: Post[], next: Post[]): Post[] {
  const seen = new Set(current.map((post) => post.id));
  return [...current, ...next.filter((post) => !seen.has(post.id))];
}

/** 지금 화면에 필요한 목록의 식별자. 받은 목록의 key와 다르면 skeleton을 보인다. */
function listKey(boardType: CommunityBoardType, category: string): string | null {
  if (boardType !== "GENERAL") return boardType;
  return category ? `GENERAL:${category}` : null;
}

// ─── GENERAL 탭 게시물 카드 ───────────────────────

function PostCard({ post, returnTo }: { post: Post; returnTo: string }) {
  const date = formatKstShortDate(post.createdAt, "날짜 정보 없음");

  const author =
    post.authorName ?? post.authorEmail?.split("@")[0] ?? "작성자 미상";
  const initials = author.slice(0, 2).toUpperCase();

  const preview = Array.from(getSearchableDocumentText(post.contentHtml)).slice(0, 100).join("");

  return (
    <Link
      href={`/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`}
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
      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 self-center" aria-hidden="true" />
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
      <Icon className="w-10 h-10 opacity-20" aria-hidden="true" />
      <p className="text-sm">{message}</p>
      <Button asChild size="sm" variant="outline">
        <Link href={href}>{label}</Link>
      </Button>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────

export default function CommunityClient({ isAdmin, initial }: CommunityClientProps) {
  const [activeTab, setActiveTab] = useState<CommunityBoardType>(initial.boardType);
  const [activeCategory, setActiveCategory] = useState<string>(initial.category);
  const [categories, setCategories] = useState<Category[]>(initial.categories);
  const [generalPosts, setGeneralPosts] = useState<Post[]>(
    initial.boardType === "GENERAL" ? initial.posts : [],
  );
  const [announcementPosts, setAnnouncementPosts] = useState<FeedbackPost[]>(
    initial.boardType === "ANNOUNCEMENT" ? initial.posts : [],
  );
  const [feedbackPosts, setFeedbackPosts] = useState<FeedbackPost[]>(
    initial.boardType === "FEEDBACK" ? initial.posts : [],
  );
  const [loadedKey, setLoadedKey] = useState<string | null>(() => listKey(initial.boardType, initial.category));
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadedKeyRef = useRef(loadedKey);
  const handledReloadRef = useRef(reloadToken);
  const requestedKeyRef = useRef<string | null>(loadedKey);

  // 다시 시도할 때만 채널 목록을 새로 읽는다. 첫 목록은 서버가 함께 보냈다.
  useEffect(() => {
    if (reloadToken === 0) return;
    let cancelled = false;
    getCategories()
      .then((data) => {
        if (!cancelled) setCategories(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("커뮤니티 채널을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // tab·category를 URL에서 복원해 상세·작성 화면을 다녀와도 같은 목록 문맥을 유지한다.
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      setActiveTab(resolveCommunityBoardType(params.get("boardType")));

      const requestedCategory = params.get("category");
      const restoredCategory = categories.find((item) => item.slug === requestedCategory)?.slug
        ?? categories[0]?.slug;
      if (restoredCategory) setActiveCategory(restoredCategory);
    };

    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [categories]);

  // 현재 위치의 목록이 없거나 다시 시도를 요청했을 때만 읽는다.
  useEffect(() => {
    const key = listKey(activeTab, activeCategory);
    const reloadRequested = handledReloadRef.current !== reloadToken;
    if (!key || (key === loadedKeyRef.current && !reloadRequested)) {
      // 다른 목록을 읽던 중 이미 받은 목록으로 돌아오면 취소된 요청의 진행·오류 상태를 남기지 않는다.
      setLoading(false);
      setLoadError(null);
      return;
    }
    handledReloadRef.current = reloadToken;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setLoadMoreError(null);
    getCommunityPostPage({ boardType: activeTab, category: activeCategory })
      .then((page) => {
        if (cancelled) return;
        if (activeTab === "GENERAL") setGeneralPosts(page.posts);
        else if (activeTab === "ANNOUNCEMENT") setAnnouncementPosts(page.posts);
        else setFeedbackPosts(page.posts);
        setNextCursor(page.nextCursor);
        loadedKeyRef.current = key;
        setLoadedKey(key);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("게시물을 불러오지 못했습니다.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, activeCategory, reloadToken]);

  const requestedKey = listKey(activeTab, activeCategory);
  // 늦게 도착한 "더 보기" 응답이 지금 보이는 목록인지 비교할 수 있게 커밋된 위치만 기록한다.
  useLayoutEffect(() => {
    requestedKeyRef.current = requestedKey;
  }, [requestedKey]);
  const hasNoChannel = activeTab === "GENERAL" && categories.length === 0;
  const awaitingList = !loadError && !hasNoChannel && (loading || requestedKey !== loadedKey);
  const visibleCount = activeTab === "GENERAL"
    ? generalPosts.length
    : activeTab === "ANNOUNCEMENT" ? announcementPosts.length : feedbackPosts.length;

  const loadMore = () => {
    const key = requestedKey;
    if (!nextCursor || loadingMore || !key || key !== loadedKey) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    getCommunityPostPage({ boardType: activeTab, category: activeCategory, cursor: nextCursor })
      .then((page) => {
        // 읽는 동안 다른 목록으로 옮겼으면 결과를 섞지 않는다.
        if (requestedKeyRef.current !== key) return;
        if (activeTab === "GENERAL") setGeneralPosts((current) => appendPage(current, page.posts));
        else if (activeTab === "ANNOUNCEMENT") setAnnouncementPosts((current) => appendPage(current, page.posts));
        else setFeedbackPosts((current) => appendPage(current, page.posts));
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (requestedKeyRef.current === key) setLoadMoreError("다음 게시물을 불러오지 못했습니다. 다시 시도해 주세요.");
      })
      .finally(() => setLoadingMore(false));
  };
  const currentCat = categories.find((c) => c.slug === activeCategory);
  const returnTo = `/community?boardType=${activeTab}&category=${encodeURIComponent(activeCategory)}`;
  const trashHref = `/community/trash?returnTo=${encodeURIComponent(returnTo)}`;

  const changeLocation = (
    nextTab: CommunityBoardType,
    nextCategory = activeCategory,
  ) => {
    setActiveTab(nextTab);
    setActiveCategory(nextCategory);
    const url = new URL(window.location.href);
    url.searchParams.set("boardType", nextTab);
    if (nextCategory) url.searchParams.set("category", nextCategory);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <div className="flex h-app overflow-hidden bg-background">
      {/* 사이드바 */}
      <aside className="hidden md:flex w-56 border-r border-border flex-col bg-card">
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Users className="w-4 h-4" aria-hidden="true" />
            커뮤니티
          </div>
          <Link
            href={trashHref}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            게시물 휴지통
          </Link>
          {isAdmin ? (
            <Link
              href="/dashboard/admin/categories"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              채널 관리
            </Link>
          ) : null}
        </div>

        {/* GENERAL일 때만 채널 사이드바 표시 */}
        {activeTab === "GENERAL" ? (
          <nav aria-label="채널" className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              채널
            </p>
            {categories.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">등록된 채널이 없습니다.</p>
            ) : null}
            {categories.map((cat) => {
              const isActive = cat.slug === activeCategory;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => changeLocation("GENERAL", cat.slug)}
                  aria-current={isActive ? "page" : undefined}
                  className={`w-full text-left flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <Hash className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                  {cat.name}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="flex-1 p-4 flex flex-col gap-2">
            <p className="text-xs font-semibold text-muted-foreground">
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
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 모바일에서는 채널 목록 대신 휴지통·채널을 상단에 둔다. 게시판 전환은 아래 탭이 맡는다. */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-card px-4 py-2 md:hidden">
          <div className="flex items-center justify-end gap-3">
            <Link href={trashHref} className="inline-flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <Trash2 className="size-4" aria-hidden="true" />
              휴지통
            </Link>
          </div>
          {activeTab === "GENERAL" && categories.length > 0 ? (
            <div className="scroll-row -mx-1 flex gap-1 pb-1" role="group" aria-label="채널">
              {categories.map((cat) => {
                const isActive = cat.slug === activeCategory;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => changeLocation("GENERAL", cat.slug)}
                    aria-pressed={isActive}
                    className={`inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs transition-colors ${
                      isActive ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Hash className="size-3" aria-hidden="true" />
                    {cat.name}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {/* 상단 탭 + 헤더 */}
        <header className="border-b border-border bg-card/80 backdrop-blur-sm flex-shrink-0">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            {/* 탭 전환 */}
            <Tabs
              value={activeTab}
              onValueChange={(value) => changeLocation(resolveCommunityBoardType(value))}
            >
              <TabsList className="h-8">
                <TabsTrigger
                  value="ANNOUNCEMENT"
                  className="text-xs gap-1.5 px-3"
                >
                  <Megaphone className="w-3 h-3" aria-hidden="true" />
                  공지
                </TabsTrigger>
                <TabsTrigger value="GENERAL" className="text-xs gap-1.5 px-3">
                  <MessageSquare className="w-3 h-3" aria-hidden="true" />
                  자유{" "}
                  {/* 좁은 화면은 위 채널 칩이 같은 이름을 보여 주므로 새 글 버튼 자리를 남긴다. */}
                  {activeTab === "GENERAL" && currentCat && (
                    <span className="hidden text-muted-foreground sm:inline">
                      / {currentCat.name}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="FEEDBACK" className="text-xs gap-1.5 px-3">
                  <Music2 className="w-3 h-3" aria-hidden="true" />
                  믹스셋
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* 새 글 버튼 */}
            {(activeTab !== "ANNOUNCEMENT" || isAdmin) && !hasNoChannel && (
              <Button
                asChild
                size="sm"
                className="shrink-0 gap-1.5"
              >
                <Link
                  href={`/community/new?boardType=${activeTab}&category=${activeCategory}&returnTo=${encodeURIComponent(returnTo)}`}
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />새 글
                </Link>
              </Button>
            )}
          </div>
        </header>

        {/* 게시물 목록 */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {awaitingList ? (
            <div className="space-y-3" role="status" aria-label="게시물을 불러오는 중">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl border bg-muted animate-pulse motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : loadError ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
              <p role="alert" className="text-sm text-destructive">{loadError}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setReloadToken((token) => token + 1)}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                다시 시도
              </Button>
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
                    returnTo={returnTo}
                  />
                  {isAdmin && (
                    <div className="mt-4">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                      >
                        <Link href={`/community/new?boardType=ANNOUNCEMENT&returnTo=${encodeURIComponent(returnTo)}`}>
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
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
                  {hasNoChannel ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                      <Hash className="size-10 opacity-20" aria-hidden="true" />
                      <p className="text-sm">
                        {isAdmin
                          ? "자유 게시판에 글을 쓰려면 채널이 하나 이상 필요합니다."
                          : "아직 열린 채널이 없습니다. 강사가 채널을 추가하면 글을 쓸 수 있습니다."}
                      </p>
                      {isAdmin ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href="/dashboard/admin/categories">채널 추가하기</Link>
                        </Button>
                      ) : null}
                    </div>
                  ) : generalPosts.length === 0 ? (
                    <EmptyState
                      icon={MessageSquare}
                      message="아직 게시물이 없습니다."
                      href={`/community/new?boardType=GENERAL&category=${activeCategory}&returnTo=${encodeURIComponent(returnTo)}`}
                      label="첫 게시물 작성하기"
                    />
                  ) : (
                    generalPosts.map((post) => (
                      <PostCard key={post.id} post={post} returnTo={returnTo} />
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
                        href={`/community/new?boardType=FEEDBACK&returnTo=${encodeURIComponent(returnTo)}`}
                        label="첫 믹스셋 공유하기"
                      />
                    </div>
                  ) : (
                    feedbackPosts.map((post) => (
                      <MixsetFeedbackCard
                        key={post.id}
                        post={{
                          ...post,
                          createdAt: post.createdAt ?? null,
                        }}
                        returnTo={returnTo}
                      />
                    ))
                  )}
                </div>
              )}

              {nextCursor && !hasNoChannel ? (
                <div className="mt-4 max-w-3xl space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadMore}
                    disabled={loadingMore}
                    aria-describedby="community-list-count"
                  >
                    {loadingMore ? "불러오는 중..." : "게시물 더 보기"}
                  </Button>
                  <p id="community-list-count" role="status" className="text-xs text-muted-foreground">
                    최근 {visibleCount}개 표시 중
                  </p>
                  {loadMoreError ? <p role="alert" className="text-sm text-destructive">{loadMoreError}</p> : null}
                </div>
              ) : null}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
