/**
 * @file src/components/community/MixsetPlayer.tsx
 * @description 믹스셋 게시물의 재생 매체. 링크(YouTube·SoundCloud)는 과제와 같은 VideoPlayer로,
 * 업로드 오디오는 브라우저 기본 오디오 조작부로 재생한다. 두 경우 모두 VideoPlayer와 같은
 * `seekRequest`(누를 때마다 새 객체)·`onPositionReaderChange` 계약을 따른다.
 */
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  VideoPlayer,
  type MediaSeekRequest,
  type PlaybackPositionReader,
} from "@/components/player/VideoPlayer";
import { SoundCloudPlayer } from "@/components/player/SoundCloudPlayer";
import { isSoundCloudUrl } from "@/components/player/media-source";
import type { MixsetMedia } from "@/lib/community-mixset-media";

type MixsetPlayerProps = {
  media: MixsetMedia;
  /** 오디오 조작부의 접근 이름에 쓰는 게시물 제목 */
  title: string;
  seekRequest?: MediaSeekRequest;
  onPositionReaderChange?: (reader: PlaybackPositionReader | null) => void;
};

/** HTMLMediaElement.HAVE_METADATA: 길이를 알아 위치를 옮길 수 있는 상태 */
const HAVE_METADATA = 1;

function finiteSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function MixsetAudio({ url, title, seekRequest, onPositionReaderChange }: Omit<MixsetPlayerProps, "media"> & { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const readyRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [error, setError] = useState(false);

  // hydration 전에 metadata가 먼저 읽혔으면 event를 놓치므로 요소 상태도 함께 본다.
  const isReady = useCallback(() => {
    const audio = audioRef.current;
    return Boolean(audio) && (readyRef.current || (audio?.readyState ?? 0) >= HAVE_METADATA);
  }, []);

  const applySeek = useCallback(() => {
    const audio = audioRef.current;
    const seconds = pendingSeekRef.current;
    if (!audio || seconds === null || !isReady()) return;
    pendingSeekRef.current = null;
    audio.currentTime = seconds;
    // 자동 재생이 막히면 그 위치에 멈춰 두고 사용자가 조작부로 재생한다.
    void Promise.resolve(audio.play()).catch(() => {});
  }, [isReady]);

  useLayoutEffect(() => {
    if (audioRef.current && audioRef.current.readyState >= HAVE_METADATA) readyRef.current = true;
  }, []);

  useEffect(() => {
    if (!seekRequest || !Number.isFinite(seekRequest.seconds) || seekRequest.seconds < 0) return;
    pendingSeekRef.current = seekRequest.seconds;
    const audio = audioRef.current;
    // preload를 무시하는 브라우저(iOS 등)는 재생 요청이 있어야 불러온다. metadata가 오면 handleReady가
    // 소리가 나기 전에 위치를 옮긴다. 자동 재생이 막히면 그대로 두고 사용자가 조작부로 재생한다.
    if (audio && !isReady()) void Promise.resolve(audio.play()).catch(() => {});
    applySeek();
  }, [applySeek, isReady, seekRequest]);

  useEffect(() => {
    if (!onPositionReaderChange) return;
    onPositionReaderChange(async () => (isReady() ? finiteSeconds(audioRef.current?.currentTime) : null));
    return () => onPositionReaderChange(null);
  }, [isReady, onPositionReaderChange]);

  const handleReady = () => {
    readyRef.current = true;
    setError(false);
    applySeek();
  };

  return (
    <div className="flex flex-col gap-2">
      <audio
        ref={audioRef}
        src={url}
        controls
        preload="metadata"
        aria-label={`${title} 오디오`}
        onLoadedMetadata={handleReady}
        onCanPlay={handleReady}
        onError={() => setError(true)}
        className="w-full"
      />
      {error ? (
        <p role="alert" className="text-ui text-destructive">
          오디오를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.
        </p>
      ) : null}
    </div>
  );
}

export function MixsetPlayer({ media, title, seekRequest, onPositionReaderChange }: MixsetPlayerProps) {
  // SoundCloud 세트는 곡 목록이 보이는 높은 위젯으로 열고, 여러 줄이 열려도 구분되게 제목을 이름에 넣는다.
  if (media.kind === "link" && isSoundCloudUrl(media.url)) {
    return (
      <div className="flex flex-col gap-3">
        <SoundCloudPlayer
          key={media.url}
          url={media.url}
          title={`${title} SoundCloud 플레이어`}
          variant={/^https:\/\/soundcloud\.com\/[^/]+\/sets\//u.test(media.url) ? "playlist" : "track"}
          seekRequest={seekRequest}
          onPositionReaderChange={onPositionReaderChange}
        />
      </div>
    );
  }
  if (media.kind === "link") {
    return <VideoPlayer key={media.url} url={media.url} seekRequest={seekRequest} onPositionReaderChange={onPositionReaderChange} />;
  }
  return (
    <MixsetAudio
      key={media.url}
      url={media.url}
      title={title}
      seekRequest={seekRequest}
      onPositionReaderChange={onPositionReaderChange}
    />
  );
}
