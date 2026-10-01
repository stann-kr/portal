"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ExternalLink } from "lucide-react";
import { SoundCloudPlayer } from "./SoundCloudPlayer";

// Keep the installed player's public types: v3 uses src and an HTML media ref.
const ReactPlayer = dynamic(() => import("react-player"), { ssr: false });

export type MediaSeekRequest = { seconds: number };

type VideoPlayerProps = {
  url: string;
  /** Each click creates a request, including repeated clicks at the same time. */
  seekRequest?: MediaSeekRequest;
};

function MediaPlayer({ url, seekRequest }: VideoPlayerProps) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const readyRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  const applySeek = useCallback(() => {
    const player = playerRef.current;
    const seconds = pendingSeekRef.current;
    if (!player || !readyRef.current || seconds === null) return;
    player.currentTime = seconds;
    pendingSeekRef.current = null;
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!seekRequest || !Number.isFinite(seekRequest.seconds) || seekRequest.seconds < 0) return;
    pendingSeekRef.current = seekRequest.seconds;
    applySeek();
  }, [applySeek, seekRequest]);

  const handleReady = () => {
    readyRef.current = true;
    applySeek();
  };

  return <>
    <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
      <ReactPlayer
        ref={playerRef}
        src={url}
        playing={playing}
        onLoadedMetadata={handleReady}
        onCanPlay={handleReady}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => { setError(true); setPlaying(false); }}
        width="100%"
        height="100%"
        controls
        playsInline
        className="absolute inset-0"
      />
    </div>
    {error && <p role="alert" className="text-sm text-destructive">미디어를 불러오지 못했습니다. 원본 링크에서 재생해 주세요.</p>}
  </>;
}

export function VideoPlayer({ url, seekRequest }: VideoPlayerProps) {
  const isSoundCloud = /^https?:\/\/(?:www\.)?soundcloud\.com\//iu.test(url);
  return (
    <div className="space-y-3">
      {isSoundCloud
        ? <SoundCloudPlayer key={url} url={url} seekRequest={seekRequest} />
        : <MediaPlayer key={url} url={url} seekRequest={seekRequest} />}
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        원본 믹스셋 열기 <ExternalLink className="size-3.5" aria-hidden="true" />
      </a>
    </div>
  );
}
