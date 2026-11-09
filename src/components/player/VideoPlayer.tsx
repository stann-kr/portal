"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { SoundCloudPlayer } from "./SoundCloudPlayer";
import { isSoundCloudUrl } from "./media-source";
import { OriginalLink } from "./OriginalLink";

// Keep the installed player's public types: v3 uses src and an HTML media ref.
const ReactPlayer = dynamic(() => import("react-player"), { ssr: false });

export type MediaSeekRequest = { seconds: number };
/** 현재 재생 위치(초). 플레이어가 준비되지 않았거나 읽을 수 없으면 null. */
export type PlaybackPositionReader = () => Promise<number | null>;
/** 이어 듣기 미니 플레이어가 화면 밖에서 재생을 조작할 때 쓴다. 과제 화면은 쓰지 않는다. */
export type PlaybackController = {
  play(): void;
  pause(): void;
  /** 위치를 옮긴다. 기본은 옮긴 위치부터 재생하고, `play: false`면 재생 여부를 바꾸지 않는다(멈춰 있으면 그대로). */
  seek(seconds: number, options?: { play?: boolean }): void;
  /** 길이(초). 아직 모르면 null. */
  readDuration(): Promise<number | null>;
};

type VideoPlayerProps = {
  url: string;
  /** Each click creates a request, including repeated clicks at the same time. */
  seekRequest?: MediaSeekRequest;
  /** 타임라인 피드백처럼 현재 위치가 필요한 화면에 reader를 연결하고 unmount 때 해제한다. */
  onPositionReaderChange?: (reader: PlaybackPositionReader | null) => void;
  /** 영상을 재생하지 못했을 때(올린 사람이 다른 사이트 재생을 막은 YouTube 영상 등). 시점을 원본에서 열도록 바꿀 때 쓴다. */
  onPlaybackError?: () => void;
  /** 재생 실패 안내를 화면에 맞게 바꾼다. 없으면 기본 안내(원본에서 재생)를 보인다. */
  errorNotice?: ReactNode;
  /** 재생·멈춤이 바뀔 때(이어 듣기 플레이어가 주인을 정할 때 쓴다). */
  onPlayingChange?: (playing: boolean) => void;
  onControllerChange?: (controller: PlaybackController | null) => void;
};

function finiteSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function MediaPlayer({ url, seekRequest, onPositionReaderChange, onPlaybackError, errorNotice, onPlayingChange, onControllerChange }: VideoPlayerProps) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const readyRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const pendingPlayRef = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  const applySeek = useCallback(() => {
    const player = playerRef.current;
    const seconds = pendingSeekRef.current;
    if (!player || !readyRef.current || seconds === null) return;
    player.currentTime = seconds;
    pendingSeekRef.current = null;
    if (pendingPlayRef.current) setPlaying(true);
  }, []);

  useEffect(() => {
    if (!seekRequest || !Number.isFinite(seekRequest.seconds) || seekRequest.seconds < 0) return;
    pendingSeekRef.current = seekRequest.seconds;
    pendingPlayRef.current = true;
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

  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => { onPlayingChangeRef.current = onPlayingChange; }, [onPlayingChange]);
  useEffect(() => { onPlayingChangeRef.current?.(playing); }, [playing]);

  useEffect(() => {
    if (!onControllerChange) return;
    onControllerChange({
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      seek: (seconds, options) => {
        pendingSeekRef.current = seconds;
        pendingPlayRef.current = options?.play !== false;
        applySeek();
      },
      readDuration: async () => finiteSeconds(playerRef.current?.duration) || null,
    });
    return () => onControllerChange(null);
  }, [applySeek, onControllerChange]);

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
        onError={() => { setError(true); setPlaying(false); onPlaybackError?.(); }}
        width="100%"
        height="100%"
        controls
        playsInline
        className="absolute inset-0"
      />
    </div>
    {error && (errorNotice ?? <p role="alert" className="px-5 text-ui text-destructive md:px-0">
      미디어를 불러오지 못했습니다. <OriginalLink url={url} />에서 재생해 주세요.
    </p>)}
  </>;
}

export function VideoPlayer({ url, seekRequest, onPositionReaderChange, onPlaybackError, errorNotice, onPlayingChange, onControllerChange }: VideoPlayerProps) {
  return (
    <div className="flex flex-col gap-3">
      {isSoundCloudUrl(url)
        ? <SoundCloudPlayer key={url} url={url} seekRequest={seekRequest} onPositionReaderChange={onPositionReaderChange} onPlayingChange={onPlayingChange} onControllerChange={onControllerChange} />
        : <MediaPlayer key={url} url={url} seekRequest={seekRequest} onPositionReaderChange={onPositionReaderChange} onPlaybackError={onPlaybackError} errorNotice={errorNotice} onPlayingChange={onPlayingChange} onControllerChange={onControllerChange} />}
    </div>
  );
}
