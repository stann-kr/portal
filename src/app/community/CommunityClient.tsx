/**
 * @file src/app/community/CommunityClient.tsx
 * @description 커뮤니티 목록(캔버스 Community·MobileCommunity 보드).
 * 게시판(공지·자유·믹스셋) 탭과 자유 게시판 채널 칩, 게시물 목록, 이어 읽기.
 * - ANNOUNCEMENT: 고정 공지는 펼친 줄, 나머지는 한 줄 링크(AnnouncementList)
 * - GENERAL: 채널별 최신순 목록
 * - FEEDBACK: 믹스셋 줄과 인라인 오디오(MixsetFeedbackCard)
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Hash, MessageSquare, Music2, Plus, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MobileTopBar } from "@/components/app-shell/AppSidebar";
import { getCategories } from "@/lib/actions/categories";
import { getCommunityPostPage } from "@/lib/actions/posts";
import { AnnouncementList } from "@/components/community/AnnouncementList";
import { MixsetFeedbackCard } from "@/components/community/MixsetFeedbackCard";
import { COMMUNITY_BOARD_LABELS, CommunityPostRow } from "@/components/community/CommunityPostRow";
import { resolveCommunityBoardType, type CommunityBoardType } from "@/lib/community-location";
import { cn } from "@/lib/utils";

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

/** 캔버스 순서: 공지 · 자유 · 믹스셋 */
const BOARD_TABS: readonly CommunityBoardType[] = ["ANNOUNCEMENT", "GENERAL", "FEEDBACK"];

function communityHref(boardType: CommunityBoardType, category: string): string {
  const params = new URLSearchParams({ boardType });
  if (category) params.set("category", category);
  return `/community?${params.toString()}`;
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

  const canWrite = (activeTab !== "ANNOUNCEMENT" || isAdmin) && !hasNoChannel;
  // 학생은 공지를 쓸 수 없으므로 좁은 화면의 새 글(+)은 자유 게시판 작성으로 연다.
  const newPostBoardType: CommunityBoardType = activeTab === "ANNOUNCEMENT" && !isAdmin ? "GENERAL" : activeTab;
  const newPostHref = `/community/new?boardType=${newPostBoardType}&category=${encodeURIComponent(activeCategory)}&returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="px-5 pb-8 md:px-[clamp(20px,4.5vw,64px)] md:pb-20 md:pt-14">
      <MobileTopBar title="커뮤니티" action={{ href: newPostHref, label: "새 글" }} />
      <div className="flex max-w-[880px] flex-col md:gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="sr-only md:not-sr-only md:text-display md:font-semibold md:tracking-display">커뮤니티</h1>
          <div className="hidden gap-2 md:flex">
            {isAdmin ? (
              <Link href="/dashboard/admin/categories" className={buttonClassName({ variant: "ghost", className: "gap-1.5" })}>
                <Settings2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />채널 관리
              </Link>
            ) : null}
            <Link href={trashHref} className={buttonClassName({ variant: "ghost" })}>휴지통</Link>
            {canWrite ? (
              <Link href={newPostHref} className={buttonClassName({ className: "gap-1.5" })}>
                <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />새 글
              </Link>
            ) : null}
          </div>
        </header>

        <div className="flex flex-col md:gap-3 md:border-b md:border-border md:pb-3">
          <nav aria-label="게시판" className="-mx-5 flex gap-6 border-b border-muted px-5 text-body md:mx-0 md:gap-5 md:border-0 md:px-0">
            {BOARD_TABS.map((tab) => {
              const isActive = tab === activeTab;
              return (
                <a
                  key={tab}
                  href={communityHref(tab, activeCategory)}
                  aria-current={isActive ? "page" : undefined}
                  onClick={(event) => {
                    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    if (!isActive) changeLocation(tab);
                  }}
                  className={cn(
                    "flex h-11 items-center transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none md:h-8",
                    isActive
                      ? "font-medium text-foreground shadow-[inset_0_-2px_0_currentColor]"
                      : "text-secondary-foreground hover:text-foreground",
                  )}
                >
                  {COMMUNITY_BOARD_LABELS[tab]}
                </a>
              );
            })}
          </nav>
          {activeTab === "GENERAL" && categories.length > 0 ? (
            <div role="group" aria-label="채널" className="scroll-row -mx-5 flex gap-1.5 px-5 py-1 md:mx-0 md:flex-wrap md:gap-1 md:overflow-visible md:p-0">
              {categories.map((cat) => {
                const isActive = cat.slug === activeCategory;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => changeLocation("GENERAL", cat.slug)}
                    aria-pressed={isActive}
                    className="group flex h-11 shrink-0 items-center focus-visible:outline-none md:h-7"
                  >
                    <span
                      className={cn(
                        "inline-flex h-8 items-center whitespace-nowrap rounded-full px-3 text-ui transition-colors duration-[var(--duration-fast)] group-focus-visible:ring-2 group-focus-visible:ring-ring motion-reduce:transition-none md:h-7 md:px-2.5 md:text-xs",
                        isActive ? "bg-primary text-primary-foreground" : "bg-muted text-secondary-foreground group-hover:text-foreground",
                      )}
                    >
                      # {cat.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* 게시물 목록 */}
        <div className="flex flex-col">
          {awaitingList ? (
            <div role="status" aria-label="게시물을 불러오는 중" className="flex flex-col border-t border-border md:border-t-0">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex flex-col gap-2 border-b border-muted py-4 md:px-1">
                  <span className="h-4 w-2/5 rounded-sm bg-muted" />
                  <span className="h-3.5 w-4/5 rounded-sm bg-sidebar" />
                  <span className="h-3 w-24 rounded-sm bg-sidebar" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div role="alert" className="mt-4 flex flex-col items-start gap-3 rounded-lg border border-muted px-5 py-8 md:mt-0">
              <p className="text-body text-foreground">{loadError}</p>
              <Button type="button" onClick={() => setReloadToken((token) => token + 1)} className="gap-1.5">
                <RotateCcw className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
                다시 시도
              </Button>
            </div>
          ) : (
            <>
              {activeTab === "ANNOUNCEMENT" ? (
                <AnnouncementList
                  posts={announcementPosts.map((p) => ({
                    ...p,
                    isPinned: p.isPinned ?? false,
                    createdAt: p.createdAt ?? null,
                  }))}
                  isAdmin={isAdmin}
                  returnTo={returnTo}
                  layout="board"
                />
              ) : null}

              {activeTab === "GENERAL" ? (
                hasNoChannel ? (
                  <EmptyState
                    className="mt-4 md:mt-0"
                    icon={<Hash className="size-4" strokeWidth={1.6} aria-hidden="true" />}
                    title={isAdmin ? "채널이 아직 없습니다" : "아직 열린 채널이 없습니다"}
                    description={isAdmin
                      ? "자유 게시판에 글을 쓰려면 채널이 하나 이상 필요합니다."
                      : "강사가 채널을 추가하면 글을 쓸 수 있습니다."}
                    action={isAdmin ? (
                      <Link href="/dashboard/admin/categories" className={buttonClassName({ variant: "outline" })}>채널 추가하기</Link>
                    ) : undefined}
                  />
                ) : generalPosts.length === 0 ? (
                  <EmptyState
                    className="mt-4 md:mt-0"
                    icon={<MessageSquare className="size-4" strokeWidth={1.6} aria-hidden="true" />}
                    title="아직 게시물이 없습니다"
                    description={currentCat ? `# ${currentCat.name} 채널의 첫 글을 남겨 보세요.` : "첫 글을 남겨 보세요."}
                    action={<Link href={newPostHref} className={buttonClassName({ variant: "outline" })}>첫 게시물 작성하기</Link>}
                  />
                ) : (
                  <ul className="flex flex-col border-t border-border md:border-t-0">
                    {generalPosts.map((post) => (
                      <CommunityPostRow key={post.id} post={post} returnTo={returnTo} />
                    ))}
                  </ul>
                )
              ) : null}

              {activeTab === "FEEDBACK" ? (
                feedbackPosts.length === 0 ? (
                  <EmptyState
                    className="mt-4 md:mt-0"
                    icon={<Music2 className="size-4" strokeWidth={1.6} aria-hidden="true" />}
                    title="공유된 믹스셋이 없습니다"
                    description="녹음한 믹스셋을 올리고 피드백을 나눠 보세요."
                    action={<Link href={newPostHref} className={buttonClassName({ variant: "outline" })}>첫 믹스셋 공유하기</Link>}
                  />
                ) : (
                  <ul className="flex flex-col border-t border-border md:border-t-0">
                    {feedbackPosts.map((post) => (
                      <MixsetFeedbackCard
                        key={post.id}
                        post={{
                          ...post,
                          createdAt: post.createdAt ?? null,
                        }}
                        returnTo={returnTo}
                      />
                    ))}
                  </ul>
                )
              ) : null}

              {nextCursor && !hasNoChannel ? (
                <div className="mt-6 flex flex-col items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={loadMore}
                    disabled={loadingMore}
                    aria-describedby="community-list-count"
                    className="text-secondary-foreground"
                  >
                    {loadingMore ? "불러오는 중..." : "게시물 더 보기"}
                  </Button>
                  <p id="community-list-count" role="status" className="sr-only">
                    최근 {visibleCount}개 표시 중
                  </p>
                  {loadMoreError ? <p role="alert" className="text-ui text-destructive">{loadMoreError}</p> : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* 좁은 화면은 머리 버튼 대신 목록 아래에서 휴지통·채널 관리로 간다. */}
        <div className="mt-2 flex flex-col md:hidden">
          <Link href={trashHref} className="flex h-11 items-center gap-2 self-start text-body text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Trash2 className="size-4" strokeWidth={1.6} aria-hidden="true" />휴지통
          </Link>
          {isAdmin ? (
            <Link href="/dashboard/admin/categories" className="flex h-11 items-center gap-2 self-start text-body text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Settings2 className="size-4" strokeWidth={1.6} aria-hidden="true" />채널 관리
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
