/**
 * @file src/components/community/MixsetFeedbackCard.tsx
 * @description 믹스셋 게시판의 한 줄 — 인라인 재생 버튼 포함.
 * 캔버스 Community 목록 줄(제목·미리보기·작성자·날짜) 앞에 재생 버튼을 둔다.
 * 업로드 오디오는 HTML5 audio 태그로 바로 재생하고, YouTube·SoundCloud 링크는 버튼을 누른 줄에만
 * 플레이어를 줄 아래에 연다(목록 전체에 iframe을 미리 만들지 않는다).
 */
"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { Music2, Pause, Play, X } from "lucide-react";
import type { MediaSeekRequest } from "@/components/player/VideoPlayer";
import { classifyMixsetMedia } from "@/lib/community-mixset-media";
import { communityPreview, communityRowMeta } from "./CommunityPostRow";
import { MixsetPlayer } from "./MixsetPlayer";

type FeedbackPost = {
  id: string;
  title: string;
  contentHtml: string;
  mediaUrl: string | null;
  /** 업로드 오디오의 매체 ID. 링크 게시물은 비어 있다. */
  mediaObjectId?: string | null;
  authorName: string | null;
  authorEmail: string | null;
  createdAt: Date | null;
  commentCount?: number;
};

interface MixsetFeedbackCardProps {
  post: FeedbackPost;
  returnTo?: string;
}

export function MixsetFeedbackCard({ post, returnTo = "/community" }: MixsetFeedbackCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkStart, setLinkStart] = useState<MediaSeekRequest>();
  const panelId = useId();
  const media = classifyMixsetMedia({ mediaUrl: post.mediaUrl, mediaObjectId: post.mediaObjectId ?? null });

  const meta = communityRowMeta(post);
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

  // 열 때 처음부터 재생을 요청한다. 브라우저가 자동 재생을 막으면 플레이어 안에서 재생하면 된다.
  const handleLinkToggle = () => {
    if (linkOpen) {
      setLinkOpen(false);
      return;
    }
    setLinkStart({ seconds: 0 });
    setLinkOpen(true);
  };

  const buttonClass = "flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none md:size-9";

  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-muted py-3.5 md:gap-3.5 md:px-1 md:py-4">
      {media?.kind === "link" ? (
        <button
          type="button"
          onClick={handleLinkToggle}
          aria-label={`${post.title} 플레이어`}
          aria-expanded={linkOpen}
          aria-controls={linkOpen ? panelId : undefined}
          className={buttonClass}
        >
          {linkOpen ? (
            <X className="size-4" strokeWidth={1.6} aria-hidden="true" />
          ) : (
            <Play className="ml-0.5 size-4" strokeWidth={1.6} aria-hidden="true" />
          )}
        </button>
      ) : media ? (
        <>
          <button
            type="button"
            onClick={handleAudioToggle}
            aria-label={`${post.title} 재생`}
            aria-pressed={isPlaying}
            className={buttonClass}
          >
            {isPlaying ? (
              <Pause className="size-4" strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <Play className="ml-0.5 size-4" strokeWidth={1.6} aria-hidden="true" />
            )}
          </button>
          <audio
            ref={audioRef}
            src={media.url}
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
          {meta}
          {media ? null : " · 재생할 매체 없음"}
        </p>
        {playError ? (
          <p role="alert" className="text-xs text-destructive">오디오를 재생하지 못했습니다. 상세 화면에서 다시 시도해 주세요.</p>
        ) : null}
      </div>

      {media?.kind === "link" && linkOpen ? (
        <div id={panelId} className="basis-full">
          <MixsetPlayer media={media} title={post.title} seekRequest={linkStart} />
        </div>
      ) : null}
    </li>
  );
}
