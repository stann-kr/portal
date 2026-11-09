/**
 * @file src/components/community/MixsetPlayer.tsx
 * @description 믹스셋 게시물의 재생 매체. 링크(YouTube·SoundCloud)는 과제와 같은 VideoPlayer로,
 * 업로드 오디오는 브라우저 기본 오디오 조작부로 재생한다. 두 경우 모두 VideoPlayer와 같은
 * `seekRequest`(누를 때마다 새 객체)·`onPositionReaderChange` 계약을 따른다.
 *
 * `track`을 주면(게시물 상세) 앱 공용 플레이어에 묶여 화면을 떠나도 하단 미니 플레이어가 이어 간다.
 * 업로드 오디오는 파형 플레이어(WaveformPlayer), 링크는 재생이 시작되면 공용 상태에 알리고 떠날 때 위치를 넘긴다.
 * `track`이 없으면(목록 줄) 예전처럼 그 자리에서만 재생한다.
 */
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WaveformPlayer } from "@/components/player/WaveformPlayer";
import { getPlayerState, dispatchPlayer, startTrack } from "@/components/player/player-store";
import type { PlayerTrack } from "@/components/player/player-state";
import type { WaveformMarkerInput } from "@/components/player/waveform";
import {
  VideoPlayer,
  type MediaSeekRequest,
  type PlaybackController,
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
  /** 이어 듣기 정보(게시물 상세). 없으면 이 자리에서만 재생한다. */
  track?: Omit<PlayerTrack, "kind" | "url">;
  /** 업로드 오디오 파형 아래 시점 댓글. */
  markers?: WaveformMarkerInput[];
  onMarkerOpen?: (id: string) => void;
  /** 목록 줄 링크 플레이어(track 없음)의 재생·멈춤과 조작 손잡이. 다른 재생과 겹치지 않게 할 때 쓴다. */
  onPlayingChange?: (playing: boolean) => void;
  onControllerChange?: (controller: PlaybackController | null) => void;
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

/**
 * 게시물 화면의 링크 플레이어를 공용 재생 상태에 묶는다. 재생이 시작되면 이 곡이 지금 곡이 되고(다른 곡은 멈춤),
 * 재생 중 위치를 1초마다 알려 화면을 떠날 때 미니 플레이어가 그 위치부터 이어 가게 한다.
 * 미니 플레이어가 이 곡을 재생하던 중에 돌아오면 그 위치부터 다시 이 화면에서 재생한다.
 */
function PersistentLinkPlayer({ media, track, title, seekRequest, onPositionReaderChange }: {
  media: { kind: "link"; url: string };
  track: PlayerTrack;
  title: string;
  seekRequest?: MediaSeekRequest;
  onPositionReaderChange?: (reader: PlaybackPositionReader | null) => void;
}) {
  const key = track.key;
  const [handoff] = useState<MediaSeekRequest | undefined>(() => {
    const state = getPlayerState();
    return state.track?.key === key && state.owner === "persistent" && state.track.url === track.url
      ? { seconds: state.position }
      : undefined;
  });
  const readerRef = useRef<PlaybackPositionReader | null>(null);
  const [playing, setPlaying] = useState(false);
  const trackRef = useRef(track);
  useEffect(() => { trackRef.current = track; }, [track]);

  useLayoutEffect(() => {
    dispatchPlayer({ type: "page-mount", key });
    return () => dispatchPlayer({ type: "page-unmount", key });
  }, [key]);

  const handleReader = useCallback((reader: PlaybackPositionReader | null) => {
    readerRef.current = reader;
    onPositionReaderChange?.(reader);
  }, [onPositionReaderChange]);

  const handlePlaying = useCallback((next: boolean) => {
    setPlaying(next);
    const state = getPlayerState();
    const current = trackRef.current;
    if (next && (state.track?.key !== current.key || state.track.url !== current.url)) {
      startTrack(current);
      return;
    }
    dispatchPlayer({ type: "progress", key: current.key, playing: next });
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      void Promise.resolve(readerRef.current?.() ?? null).then((seconds) => {
        if (seconds !== null) dispatchPlayer({ type: "progress", key, position: seconds });
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [key, playing]);

  const effectiveSeek = seekRequest ?? handoff;
  if (isSoundCloudUrl(media.url)) {
    return (
      <div className="flex flex-col gap-3">
        <SoundCloudPlayer
          key={media.url}
          url={media.url}
          title={`${title} SoundCloud 플레이어`}
          variant={/^https:\/\/soundcloud\.com\/[^/]+\/sets\//u.test(media.url) ? "playlist" : "track"}
          seekRequest={effectiveSeek}
          onPositionReaderChange={handleReader}
          onPlayingChange={handlePlaying}
        />
      </div>
    );
  }
  return <VideoPlayer key={media.url} url={media.url} seekRequest={effectiveSeek} onPositionReaderChange={handleReader} onPlayingChange={handlePlaying} />;
}

export function MixsetPlayer({ media, title, seekRequest, onPositionReaderChange, track, markers, onMarkerOpen, onPlayingChange, onControllerChange }: MixsetPlayerProps) {
  if (track) {
    const kind = media.kind === "audio" ? "audio" : isSoundCloudUrl(media.url) ? "soundcloud" : "youtube";
    const fullTrack: PlayerTrack = { ...track, kind, url: media.url };
    if (media.kind === "audio") {
      return (
        <WaveformPlayer
          track={fullTrack}
          markers={markers}
          seekRequest={seekRequest}
          onPositionReaderChange={onPositionReaderChange}
          onMarkerOpen={onMarkerOpen}
        />
      );
    }
    return (
      <PersistentLinkPlayer
        media={media}
        track={fullTrack}
        title={title}
        seekRequest={seekRequest}
        onPositionReaderChange={onPositionReaderChange}
      />
    );
  }
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
          onPlayingChange={onPlayingChange}
          onControllerChange={onControllerChange}
        />
      </div>
    );
  }
  if (media.kind === "link") {
    return <VideoPlayer key={media.url} url={media.url} seekRequest={seekRequest} onPositionReaderChange={onPositionReaderChange} onPlayingChange={onPlayingChange} onControllerChange={onControllerChange} />;
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
