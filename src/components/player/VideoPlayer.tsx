"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SoundCloudPlayer } from "./SoundCloudPlayer";
import { isSoundCloudUrl } from "./media-source";
import { OriginalLink } from "./OriginalLink";

// Keep the installed player's public types: v3 uses src and an HTML media ref.
const ReactPlayer = dynamic(() => import("react-player"), { ssr: false });

export type MediaSeekRequest = { seconds: number };
/** 현재 재생 위치(초). 플레이어가 준비되지 않았거나 읽을 수 없으면 null. */
export type PlaybackPositionReader = () => Promise<number | null>;

type VideoPlayerProps = {
  url: string;
  /** Each click creates a request, including repeated clicks at the same time. */
  seekRequest?: MediaSeekRequest;
  /** 타임라인 피드백처럼 현재 위치가 필요한 화면에 reader를 연결하고 unmount 때 해제한다. */
  onPositionReaderChange?: (reader: PlaybackPositionReader | null) => void;
};

function finiteSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function MediaPlayer({ url, seekRequest, onPositionReaderChange }: VideoPlayerProps) {
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

  useEffect(() => {
    if (!onPositionReaderChange) return;
    onPositionReaderChange(async () => (
      readyRef.current ? finiteSeconds(playerRef.current?.currentTime) : null
    ));
    return () => onPositionReaderChange(null);
  }, [onPositionReaderChange]);

  return <>
    {/* 좁은 화면은 화면 폭 가득(모서리 없음), 넓은 화면은 r10. 영상 바깥은 테마와 무관하게 검은 여백이다. */}
    <div className="relative aspect-video overflow-hidden bg-black md:rounded-lg">
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
    {error && <p role="alert" className="px-5 text-ui text-destructive md:px-0">
      미디어를 불러오지 못했습니다. <OriginalLink url={url} />에서 재생해 주세요.
    </p>}
  </>;
}

export function VideoPlayer({ url, seekRequest, onPositionReaderChange }: VideoPlayerProps) {
  return (
    <div className="flex flex-col gap-3">
      {isSoundCloudUrl(url)
        ? <SoundCloudPlayer key={url} url={url} seekRequest={seekRequest} onPositionReaderChange={onPositionReaderChange} />
        : <MediaPlayer key={url} url={url} seekRequest={seekRequest} onPositionReaderChange={onPositionReaderChange} />}
    </div>
  );
}
