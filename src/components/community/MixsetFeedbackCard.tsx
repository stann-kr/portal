/**
 * @file src/components/community/MixsetFeedbackCard.tsx
 * @description 믹스셋 피드백 게시물 카드 — 인라인 오디오 플레이어 포함.
 * R2에 업로드된 오디오 파일을 HTML5 audio 태그로 인라인 재생.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { Music2, Play, Pause, ChevronRight } from "lucide-react";
import { formatKstShortDate } from "@/lib/kst-format";

type FeedbackPost = {
  id: string;
  title: string;
  contentHtml: string;
  mediaUrl: string | null;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
};

interface MixsetFeedbackCardProps {
  post: FeedbackPost;
  returnTo?: string;
}

export function MixsetFeedbackCard({ post, returnTo = "/community" }: MixsetFeedbackCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);

  const author =
    post.authorName ?? post.authorEmail?.split("@")[0] ?? "작성자 미상";
  const initials = author.slice(0, 2).toUpperCase();
  const date = formatKstShortDate(post.createdAt, "날짜 정보 없음");

  const preview = post.contentHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  const handleAudioToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    const audioEl = document.getElementById(
      `audio-${post.id}`,
    ) as HTMLAudioElement | null;
    if (!audioEl) return;
    if (isPlaying) {
      audioEl.pause();
    } else {
      audioEl.play();
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent/5 transition-colors group">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center flex-shrink-0 text-xs font-semibold">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{author}</span>
            <span>·</span>
            <span>{date}</span>
          </div>
          <p className="font-medium text-foreground truncate text-sm mt-0.5">
            {post.title}
          </p>
        </div>
        <Link
          href={`/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`}
          className="flex-shrink-0"
        >
          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      </div>

      {/* 오디오 플레이어 */}
      {post.mediaUrl ? (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
          <button
            onClick={handleAudioToggle}
            className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 hover:bg-primary/90 transition-colors"
            aria-label={isPlaying ? "오디오 일시 정지" : "오디오 재생"}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Music2 className="w-3 h-3" />
              <span className="truncate">{post.title}</span>
            </p>
            <audio
              id={`audio-${post.id}`}
              src={post.mediaUrl}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
          <Music2 className="w-3.5 h-3.5" />
          <span>오디오 파일 없음</span>
        </div>
      )}

      {/* 미리보기 텍스트 */}
      {preview && (
        <p className="text-sm text-muted-foreground line-clamp-2">{preview}</p>
      )}
    </div>
  );
}
