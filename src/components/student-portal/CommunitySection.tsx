/**
 * @file src/components/student-portal/CommunitySection.tsx
 * @description 커뮤니티 섹션 — 최근 게시물 카드 리스트 + 상세 SlidePanel.
 * boardType(GENERAL/FEEDBACK) 탭 필터. "새 글 작성" 버튼 → 작성 다이얼로그.
 */
"use client";

import { useState, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus, MessageSquare, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPost, type CreatePostState } from "@/lib/actions/posts";
import { SlidePanel } from "./SlidePanel";
import { PostDetailPanel } from "./PostDetailPanel";

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
  studentId: string;
}

// ── 작성 다이얼로그 ──────────────────────────────

function CreatePostDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [state, action, isPending] = useActionState<CreatePostState, FormData>(
    createPost,
    {},
  );

  useEffect(() => {
    if (state.success && !isPending) {
      onSuccess();
    }
  }, [state, isPending, onSuccess]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>새 글 작성</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4 pt-2">
          <input type="hidden" name="boardType" value="GENERAL" />
          <input type="hidden" name="returnTo" value="student-portal" />

          <div className="space-y-1.5">
            <label className="text-sm font-medium">제목</label>
            <Input name="title" placeholder="제목을 입력하세요" required disabled={isPending} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">내용</label>
            <textarea
              name="contentHtml"
              placeholder="내용을 입력하세요..."
              required
              disabled={isPending}
              rows={6}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 resize-none"
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? "게시 중..." : "게시"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────

const BOARD_TABS = [
  { id: "ALL", label: "전체" },
  { id: "GENERAL", label: "General" },
  { id: "FEEDBACK", label: "Feedback" },
] as const;

type BoardFilter = (typeof BOARD_TABS)[number]["id"];

export function CommunitySection({ initialPosts }: CommunitySectionProps) {
  const router = useRouter();
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("ALL");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // 상세 패널
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

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

  const handleCreateSuccess = () => {
    setCreateOpen(false);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* 섹션 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Users className="w-5 h-5 text-primary flex-shrink-0" />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">커뮤니티</h2>
            <p className="text-xs text-muted-foreground">전체 학생 소통 공간</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 text-xs"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="w-3.5 h-3.5" />
          새 글 작성
        </Button>
      </div>

      {/* 탭 필터 + 검색 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {BOARD_TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setBoardFilter(id)}
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
            const date = post.createdAt
              ? new Date(post.createdAt).toLocaleDateString("ko-KR", {
                  month: "short",
                  day: "numeric",
                })
              : "날짜 정보 없음";

            return (
              <button
                key={post.id}
                onClick={() => {
                  setSelectedPost(post);
                  setPanelOpen(true);
                }}
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
                      {post.boardType}
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
              </button>
            );
          })}
        </div>
      )}

      {/* 게시물 상세 패널 */}
      <SlidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title={selectedPost?.title}
      >
        {selectedPost && (
          <PostDetailPanel
            postId={selectedPost.id}
            contentHtml={selectedPost.contentHtml}
          />
        )}
      </SlidePanel>

      {/* 글 작성 다이얼로그 */}
      <CreatePostDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
