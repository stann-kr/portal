/**
 * @file src/components/community/MixsetFeedbackCard.tsx
 * @description 믹스셋 게시판의 한 줄 — 인라인 오디오 재생 버튼 포함.
 * 캔버스 Community 목록 줄(제목·미리보기·작성자·날짜) 앞에 재생 버튼을 둔다.
 * R2에 업로드된 오디오 파일을 HTML5 audio 태그로 인라인 재생.
 */
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Music2, Pause, Play } from "lucide-react";
import { formatKstShortDate } from "@/lib/kst-format";
import { communityAuthorName, communityPreview } from "./CommunityPostRow";

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
  const [playError, setPlayError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const author = communityAuthorName(post);
  const date = formatKstShortDate(post.createdAt, "날짜 정보 없음");
  const preview = communityPreview(post.contentHtml, 80);

  // 재생 상태는 실제 media event로만 바꿔 실패한 play()가 재생 중으로 보이지 않게 한다.
  const handleAudioToggle = () => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    if (!audioEl.paused) {
      audioEl.pause();
      return;
    }
    setPlayError(false);
    void audioEl.play().catch(() => setPlayError(true));
  };

  return (
    <li className="flex items-start gap-3 border-b border-muted py-3.5 md:gap-3.5 md:px-1 md:py-4">
      {post.mediaUrl ? (
        <>
          <button
            type="button"
            onClick={handleAudioToggle}
            aria-label={`${post.title} 재생`}
            aria-pressed={isPlaying}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:size-9"
          >
            {isPlaying ? (
              <Pause className="size-4" strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <Play className="ml-0.5 size-4" strokeWidth={1.6} aria-hidden="true" />
            )}
          </button>
          <audio
            ref={audioRef}
            src={post.mediaUrl}
            preload="none"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onError={() => { setIsPlaying(false); setPlayError(true); }}
            className="hidden"
          />
        </>
      ) : (
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground md:size-9">
          <Music2 className="size-4" strokeWidth={1.6} />
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`}
          className="self-start text-md font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {post.title}
        </Link>
        {preview ? <p className="truncate text-ui text-secondary-foreground">{preview}</p> : null}
        <p className="text-xs text-muted-foreground">
          {author} · {date}
          {post.mediaUrl ? null : " · 오디오 파일 없음"}
        </p>
        {playError ? (
          <p role="alert" className="text-xs text-destructive">오디오를 재생하지 못했습니다. 상세 화면에서 다시 시도해 주세요.</p>
        ) : null}
      </div>
    </li>
  );
}
