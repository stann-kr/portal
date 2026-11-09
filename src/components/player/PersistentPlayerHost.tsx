/**
 * @file src/components/player/PersistentPlayerHost.tsx
 * @description 페이지를 옮겨도 이어지는 하단 미니 플레이어(캔버스 MixsetAudio "하단 미니 플레이어"·
 * "휴대폰 미니 플레이어"). 루트 레이아웃에 한 번만 두어 app router 이동(커뮤니티↔대시보드 레이아웃 교체 포함)에도
 * 남는다. 게시물 화면 안 플레이어가 재생을 맡는 동안에는 아무것도 그리지 않는다.
 *
 * - 업로드 오디오: 공용 오디오 요소를 조작한다(소리 끊김 없음, 잠금 화면 조작은 player-store의 Media Session).
 * - YouTube: 넓은 화면은 오른쪽 아래 240×135 작은 창(접기 가능, 소리는 계속), 휴대폰은 줄 왼쪽 썸네일만.
 * - SoundCloud: 영상 없이 위젯을 화면 밖에 두고 같은 막대로 조작한다.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Pause, Play, X } from "lucide-react";
import { formatTimeMarker } from "@/lib/community-mixset-media";
import { VideoPlayer, type PlaybackController, type PlaybackPositionReader } from "./VideoPlayer";
import { SoundCloudPlayer } from "./SoundCloudPlayer";
import { isMiniPlayerVisible, type PlayerState, type PlayerTrack } from "./player-state";
import {
  bindSharedLinkPlayback,
  closePlayer,
  dispatchPlayer,
  pauseTrack,
  resumeTrack,
  seekAudio,
  usePlayerState,
} from "./player-store";
import { fractionFromPointer, playedFraction, seekForKey, spokenTime } from "./waveform";

const YOUTUBE_NOTICE_KEY = "portal:mini-player:youtube-notice";
/** player.css에서 작은 창을 화면 밖으로 옮기는 폭과 같다. */
const MOBILE_QUERY = "(max-width: 767.98px)";

function subscribeMobile(listener: () => void): () => void {
  const query = typeof window !== "undefined" ? window.matchMedia?.(MOBILE_QUERY) : undefined;
  if (!query) return () => {};
  query.addEventListener?.("change", listener);
  return () => query.removeEventListener?.("change", listener);
}

/** 휴대폰 폭인지(작은 창이 화면 밖에 있는지). matchMedia가 없으면 넓은 화면으로 본다. */
function useIsMobileViewport(): boolean {
  return useSyncExternalStore(
    subscribeMobile,
    () => (typeof window !== "undefined" && window.matchMedia?.(MOBILE_QUERY).matches) || false,
    () => false,
  );
}

/** 정규화된 YouTube 주소(watch?v= · youtu.be/)에서 영상 ID를 꺼낸다. */
export function youtubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1).split("/")[0] || null;
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

export function PersistentPlayerHost() {
  const state = usePlayerState();
  const visible = isMiniPlayerVisible(state);

  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.dataset.miniPlayer = "on";
    else delete root.dataset.miniPlayer;
  }, [visible]);

  if (!visible || !state.track) return null;
  return <MiniPlayer key={`${state.track.key}:${state.track.url}`} state={state} track={state.track} />;
}

function MiniPlayer({ state, track }: { state: PlayerState; track: PlayerTrack }) {
  const controllerRef = useRef<PlaybackController | null>(null);
  const readerRef = useRef<PlaybackPositionReader | null>(null);
  const isLink = track.kind !== "audio";
  const playing = state.playing;
  const position = state.position;
  const duration = state.duration;

  // 주인이 바뀌어 새로 연 링크 플레이어는 넘겨받은 위치부터 재생한다(nonce마다 새 요청).
  const resumeNonce = state.resume?.nonce;
  const resumeSeconds = state.resume?.seconds;
  const resumeRequest = useMemo(
    () => (typeof resumeSeconds === "number" ? { seconds: resumeSeconds } : undefined),
    // nonce가 바뀔 때만 새 요청으로 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resumeNonce],
  );

  // controller를 공용 상태에 맡겨, 목록 줄이 재생을 시작하면(pauseTrack) 이 iframe을 직접 멈추게 한다.
  const handleController = useCallback((controller: PlaybackController | null) => {
    bindSharedLinkPlayback(controller, controllerRef.current);
    controllerRef.current = controller;
  }, []);
  const handleReader = useCallback((reader: PlaybackPositionReader | null) => {
    readerRef.current = reader;
  }, []);
  const handlePlaying = useCallback((next: boolean) => {
    dispatchPlayer({ type: "progress", key: track.key, playing: next });
  }, [track.key]);

  // 공용 상태가 멈춤이 되면(목록 줄 재생·로그아웃 등 어디서 바뀌었든) iframe도 멈춘다.
  useEffect(() => {
    if (isLink && !playing) controllerRef.current?.pause();
  }, [isLink, playing]);

  // 링크 플레이어는 위치를 알려 주지 않으므로 재생 중에 1초마다 읽는다.
  useEffect(() => {
    if (!isLink || !playing) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const [seconds, length] = await Promise.all([
          readerRef.current?.() ?? null,
          controllerRef.current?.readDuration() ?? null,
        ]);
        dispatchPlayer({ type: "progress", key: track.key, position: seconds ?? undefined, duration: length ?? undefined });
      })();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLink, playing, track.key]);

  const toggle = () => {
    if (isLink) {
      if (playing) controllerRef.current?.pause();
      else controllerRef.current?.play();
      dispatchPlayer({ type: "progress", key: track.key, playing: !playing });
    } else if (playing) pauseTrack();
    else resumeTrack();
  };

  // 위치만 옮기고 재생·멈춤은 그대로 둔다(멈춘 채 키보드 화살표로 옮겨도 재생이 시작되지 않게).
  const seekTo = (seconds: number) => {
    if (isLink) {
      controllerRef.current?.seek(seconds, { play: false });
      dispatchPlayer({ type: "progress", key: track.key, position: seconds });
    } else {
      seekAudio(seconds);
    }
  };
  const mobile = useIsMobileViewport();

  const videoId = track.kind === "youtube" ? youtubeVideoId(track.url) : null;
  const fraction = playedFraction(position, duration);
  const durationText = duration > 0 ? formatTimeMarker(duration) : "--:--";

  return (
    <>
      {track.kind === "youtube" ? (
        // 휴대폰은 작은 창을 화면 밖에 두므로 focus·보조기기에서 뺀다(재생은 이어 간다).
        <div
          aria-label="YouTube 작은 창"
          role="region"
          className="mini-video"
          data-collapsed={state.videoCollapsed}
          inert={mobile || undefined}
          aria-hidden={mobile || undefined}
        >
          <VideoPlayer
            url={track.url}
            seekRequest={resumeRequest}
            onPositionReaderChange={handleReader}
            onPlayingChange={handlePlaying}
            onControllerChange={handleController}
          />
          <button
            type="button"
            onClick={() => dispatchPlayer({ type: "toggle-video" })}
            aria-label="작은 창 접기"
            className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-md bg-black/40 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      ) : track.kind === "soundcloud" ? (
        <div className="mini-offscreen" aria-hidden="true">
          <SoundCloudPlayer
            url={track.url}
            title={`${track.title} SoundCloud 플레이어`}
            seekRequest={resumeRequest}
            onPositionReaderChange={handleReader}
            onPlayingChange={handlePlaying}
            onControllerChange={handleController}
          />
        </div>
      ) : null}

      <section aria-label="이어 듣기 플레이어" className="mini-player">
        {track.kind === "youtube" ? <YouTubeLeaveNotice /> : null}
        <div className="flex h-14 items-center gap-2.5 pl-3 pr-2 md:h-16 md:gap-4 md:px-4">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "일시정지" : "재생"}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-primary/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none md:size-10"
          >
            {playing
              ? <Pause className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
              : <Play className="ml-0.5 size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />}
          </button>
          {videoId ? (
            // 휴대폰은 작은 창 대신 썸네일만 둔다.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/default.jpg`} alt="" className="size-10 shrink-0 rounded-sm object-cover md:hidden" />
          ) : null}
          <Link
            href={track.href}
            className="flex min-w-0 flex-1 flex-col rounded-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-[220px] md:flex-none md:gap-0.5"
          >
            <span className="truncate text-ui font-medium">{track.title}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground md:hidden">
              {formatTimeMarker(position)} / {durationText}
            </span>
            <span className="hidden truncate text-xs text-muted-foreground md:block">
              {track.subtitle ? `${track.subtitle} · ` : ""}게시물로 가기
            </span>
          </Link>
          <div className="hidden min-w-0 flex-1 items-center gap-2.5 md:flex">
            <span className="font-mono text-[11px] text-secondary-foreground">{formatTimeMarker(position)}</span>
            <SeekBar position={position} duration={duration} onSeek={seekTo} />
            <span className="font-mono text-[11px] text-secondary-foreground">{durationText}</span>
          </div>
          {track.kind === "youtube" && state.videoCollapsed ? (
            <button
              type="button"
              onClick={() => dispatchPlayer({ type: "toggle-video" })}
              aria-label="작은 창 펼치기"
              className="hidden size-10 shrink-0 items-center justify-center rounded-md text-secondary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
            >
              <ChevronUp className="size-4" strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={closePlayer}
            aria-label="플레이어 닫기"
            className="flex size-11 shrink-0 items-center justify-center rounded-touch text-secondary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-10 md:rounded-md"
          >
            <X className="size-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        {/* 휴대폰: 줄 맨 아래 2px 진행선 */}
        <span aria-hidden="true" className="block h-0.5 bg-border md:hidden">
          <span className="block h-0.5 bg-foreground" style={{ width: `${fraction * 100}%` }} />
        </span>
      </section>
    </>
  );
}

function SeekBar({ position, duration, onSeek }: { position: number; duration: number; onSeek: (seconds: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const fraction = playedFraction(position, duration);
  const fromPointer = (event: PointerEvent<HTMLSpanElement>) => {
    if (!ref.current || duration <= 0) return;
    onSeek(fractionFromPointer(event.clientX, ref.current.getBoundingClientRect()) * duration);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    const next = seekForKey(event.key, position, duration);
    if (next === null) return;
    event.preventDefault();
    onSeek(next);
  };
  return (
    <span
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="재생 위치"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={spokenTime(position)}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        fromPointer(event);
      }}
      onPointerMove={(event) => { if (dragging.current) fromPointer(event); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onKeyDown={handleKeyDown}
      className="flex h-6 min-w-0 flex-1 cursor-pointer touch-none items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-border">
        <span className="block h-1 bg-foreground" style={{ width: `${fraction * 100}%` }} />
      </span>
    </span>
  );
}

/** 휴대폰에서 YouTube를 이어 들을 때 처음 한 번만 정책 안내를 보인다. */
function YouTubeLeaveNotice() {
  // 미니 플레이어는 브라우저에서만 그려지므로(서버 상태에는 곡이 없다) 초기값에서 저장소를 읽어도 된다.
  const [show, setShow] = useState(() => {
    try {
      return !window.localStorage.getItem(YOUTUBE_NOTICE_KEY);
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (!show) return;
    try {
      window.localStorage.setItem(YOUTUBE_NOTICE_KEY, "1");
    } catch {
      // 저장하지 못하면 다음에 다시 보인다.
    }
  }, [show]);
  if (!show) return null;
  return (
    <div role="status" className="flex items-start gap-2 border-b border-muted px-3 py-2 text-xs text-secondary-foreground md:hidden">
      <p className="min-w-0 flex-1">화면을 끄거나 앱을 떠나면 YouTube 정책상 재생이 멈출 수 있습니다.</p>
      <button
        type="button"
        onClick={() => setShow(false)}
        className="-my-1 h-8 shrink-0 rounded-md px-2 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        확인
      </button>
    </div>
  );
}
