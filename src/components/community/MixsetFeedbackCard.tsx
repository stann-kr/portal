/**
 * @file src/components/community/MixsetFeedbackCard.tsx
 * @description 믹스셋 게시판의 한 줄 — 인라인 재생 버튼 포함.
 * 캔버스 Community 목록 줄(제목·미리보기·작성자·날짜) 앞에 재생 버튼을 둔다.
 * 업로드 오디오는 하단 미니 플레이어(앱 공용 곡)로 재생해 시간·진행선이 보이고 다른 화면으로 가도 이어진다(B 묶음 ⑤).
 * YouTube·SoundCloud 링크는 버튼을 누른 줄에만 플레이어를 줄 아래에 연다(목록 전체에 iframe을 미리 만들지 않는다).
 * 줄에서 재생을 시작하면 하단 미니 플레이어(앱 공용 곡)와 다른 줄의 재생을 멈추고, 미니 플레이어가 재생을 시작하면
 * 이 줄의 오디오·링크 플레이어가 멈춘다(player-store `claimLocalPlayback`). 링크 줄은 iframe controller를 손잡이로 맡기고
 * 실제 재생이 시작될 때(onPlayingChange(true)) 맡긴다.
 */
"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Music2, Pause, Play, X } from "lucide-react";
import type { MediaSeekRequest, PlaybackController } from "@/components/player/VideoPlayer";
import {
  claimLocalPlayback,
  pauseTrack,
  releaseLocalPlayback,
  resumeTrack,
  startTrack,
  usePlayerState,
  type PlaybackStopHandle,
} from "@/components/player/player-store";
import { classifyMixsetMedia } from "@/lib/community-mixset-media";
import { communityAuthorName, communityPreview, communityRowMeta } from "./CommunityPostRow";
import { MixsetPlayer } from "./MixsetPlayer";

type FeedbackPost = {
  id: string;
  title: string;
  contentHtml: string;
  mediaUrl: string | null;
  /** 업로드 오디오의 매체 ID. 링크 게시물은 비어 있다. */
  mediaObjectId?: string | null;
  authorName: string | null;
  createdAt: Date | null;
  commentCount?: number;
};

interface MixsetFeedbackCardProps {
  post: FeedbackPost;
  returnTo?: string;
}

export function MixsetFeedbackCard({ post, returnTo = "/community" }: MixsetFeedbackCardProps) {
  const player = usePlayerState();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkStart, setLinkStart] = useState<MediaSeekRequest>();
  const panelId = useId();
  const media = classifyMixsetMedia({ mediaUrl: post.mediaUrl, mediaObjectId: post.mediaObjectId ?? null });

  // 링크 줄의 멈춤 손잡이. 플레이어가 다시 그려져도 같은 손잡이로 지금 controller를 멈춘다.
  const linkControllerRef = useRef<PlaybackController | null>(null);
  const [linkHandle] = useState<PlaybackStopHandle>(() => ({ pause: () => linkControllerRef.current?.pause() }));
  const handleLinkController = useCallback((controller: PlaybackController | null) => {
    linkControllerRef.current = controller;
  }, []);
  // 실제로 재생이 시작될 때만 맡는다(자동 재생이 막히면 미니 플레이어를 멈추지 않는다). 멈추면 놓는다.
  const handleLinkPlaying = useCallback((playing: boolean) => {
    if (playing) claimLocalPlayback(linkHandle);
    else releaseLocalPlayback(linkHandle);
  }, [linkHandle]);

  // 줄이 사라지면 맡긴 링크 손잡이를 놓는다(언마운트된 플레이어를 멈추려 하지 않게).
  useEffect(() => () => releaseLocalPlayback(linkHandle), [linkHandle]);

  const meta = communityRowMeta(post);
  const preview = communityPreview(post.contentHtml, 80);

  // 업로드 오디오: 이 게시물이 지금 곡이면 멈춤·이어 재생, 아니면 미니 플레이어에서 처음부터 시작한다.
  // 재생 표시는 공용 오디오의 실제 상태(player-store)를 따른다.
  const isCurrent = media?.kind === "audio" && player.track?.key === post.id && player.track.url === media.url;
  const isPlaying = isCurrent && player.playing;
  const handleAudioToggle = () => {
    if (media?.kind !== "audio") return;
    if (isCurrent) {
      if (player.playing) pauseTrack();
      else resumeTrack();
      return;
    }
    startTrack({
      key: post.id,
      kind: "audio",
      url: media.url,
      title: post.title,
      subtitle: communityAuthorName(post),
      href: `/community/${post.id}?returnTo=${encodeURIComponent(returnTo)}`,
      mediaObjectId: post.mediaObjectId ?? null,
    });
  };

  // 열 때 처음부터 재생을 요청한다. 브라우저가 자동 재생을 막으면 플레이어 안에서 재생하면 된다.
  const handleLinkToggle = () => {
    if (linkOpen) {
      releaseLocalPlayback(linkHandle);
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
            <Play className="ml-0.5 size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
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
              <Pause className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
            ) : (
              <Play className="ml-0.5 size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
            )}
          </button>
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
      </div>

      {media?.kind === "link" && linkOpen ? (
        <div id={panelId} className="basis-full">
          <MixsetPlayer
            media={media}
            title={post.title}
            seekRequest={linkStart}
            onPlayingChange={handleLinkPlaying}
            onControllerChange={handleLinkController}
          />
        </div>
      ) : null}
    </li>
  );
}
