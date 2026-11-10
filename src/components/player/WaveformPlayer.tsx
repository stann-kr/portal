/**
 * @file src/components/player/WaveformPlayer.tsx
 * @description 게시물 상세의 업로드 오디오 파형 플레이어(캔버스 MixsetAudio "파형 플레이어").
 * 재생은 앱 공용 오디오 요소(player-store)를 조작하므로 화면을 떠나도 하단 미니 플레이어가 이어 가고,
 * 돌아오면 같은 위치에서 다시 이 화면이 맡는다.
 * 64px 파형(재생한 부분 먹색·남은 부분 회색) + 20px 시점 댓글 줄. 파형은 role=slider(←/→ 5초).
 * 파형(slider)을 누르거나 화살표로 옮기면 이 화면이 맡은 곡은 위치만 옮기고 재생·멈춤은 그대로 둔다(멈춘 채 옮겨도 재생하지 않는다).
 * 아직 이 곡을 맡지 않았으면(다른 곡 재생 중·처음) 그 위치부터 재생을 시작한다(위치만 기억해 두는 별도 상태는 두지 않는다).
 * 댓글 시점(seekRequest)은 "여기부터 듣기"이므로 그 위치로 옮기고 재생한다.
 */
"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import type { MediaSeekRequest, PlaybackPositionReader } from "./VideoPlayer";
import { formatTimeMarker } from "@/lib/community-mixset-media";
import { cn } from "@/lib/utils";
import { isPageActive, type PlayerTrack } from "./player-state";
import {
  dispatchPlayer,
  getPlayerState,
  getSharedAudio,
  pauseTrack,
  readAudioPosition,
  resumeTrack,
  seekAudio,
  startTrack,
  usePlayerState,
} from "./player-store";
import { useAudioPeaks } from "./use-audio-peaks";
import {
  fractionFromPointer,
  playedFraction,
  positionMarkers,
  resamplePeaks,
  seekForKey,
  spokenTime,
  waveformBarCount,
  type WaveformMarkerInput,
} from "./waveform";

type WaveformPlayerProps = {
  track: PlayerTrack;
  markers?: WaveformMarkerInput[];
  seekRequest?: MediaSeekRequest;
  onPositionReaderChange?: (reader: PlaybackPositionReader | null) => void;
  /** 말풍선을 누르면 그 댓글로 이동한다. */
  onMarkerOpen?: (id: string) => void;
};

export function WaveformPlayer({ track, markers = [], seekRequest, onPositionReaderChange, onMarkerOpen }: WaveformPlayerProps) {
  const state = usePlayerState();
  const key = track.key;
  const active = isPageActive(state, key);
  const playing = active && state.playing;
  const [error, setError] = useState(false);
  const { peaks, status } = useAudioPeaks(track.url, track.mediaObjectId, active);
  const position = active ? state.position : 0;
  const duration = active && state.duration > 0 ? state.duration : (peaks?.duration ?? 0);

  // 게시물 화면이 열려 있는 동안 이 화면이 재생을 맡는다. 떠날 때 재생 중이면 미니 플레이어가 이어 간다.
  useLayoutEffect(() => {
    dispatchPlayer({ type: "page-mount", key });
    return () => dispatchPlayer({ type: "page-unmount", key });
  }, [key]);

  const seekTo = useCallback((seconds: number, { play }: { play: boolean }) => {
    // 렌더 시점 값이 아니라 최신 상태로 판단한다.
    if (isPageActive(getPlayerState(), key)) {
      seekAudio(seconds);
      if (play) resumeTrack();
    } else startTrack(track, seconds);
  }, [key, track]);

  // 댓글 시점(누를 때마다 새 객체). metadata 전이면 공용 요소가 받아 두었다가 옮긴다.
  useEffect(() => {
    if (!seekRequest || !Number.isFinite(seekRequest.seconds) || seekRequest.seconds < 0) return;
    seekTo(seekRequest.seconds, { play: true });
    // seekTo는 track 객체가 바뀔 때마다 새로 만들어지므로 요청이 바뀔 때만 실행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest]);

  useEffect(() => {
    if (!onPositionReaderChange) return;
    onPositionReaderChange(async () => readAudioPosition(key));
    return () => onPositionReaderChange(null);
  }, [key, onPositionReaderChange]);

  useEffect(() => {
    if (!active) return;
    const element = getSharedAudio();
    if (!element) return;
    const handleError = () => setError(true);
    element.addEventListener("error", handleError);
    return () => element.removeEventListener("error", handleError);
  }, [active]);

  const toggle = () => {
    setError(false);
    if (!active) startTrack(track);
    else if (playing) pauseTrack();
    else resumeTrack();
  };

  const timeText = `${formatTimeMarker(position)} / ${duration > 0 ? formatTimeMarker(duration) : "--:--"}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "일시정지" : "재생"}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-primary/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {playing ? <Pause className="size-4" fill="currentColor" strokeWidth={0} aria-hidden="true" /> : <Play className="ml-0.5 size-4" fill="currentColor" strokeWidth={0} aria-hidden="true" />}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body font-medium">{track.title}</span>
          {track.subtitle ? <span className="truncate text-xs text-muted-foreground">{track.subtitle}</span> : null}
        </div>
        <span className="shrink-0 font-mono text-xs text-secondary-foreground">{timeText}</span>
      </div>

      <WaveformTrack
        peaks={peaks?.peaks ?? null}
        status={status}
        position={position}
        duration={duration}
        onSeek={(seconds) => {
          setError(false);
          seekTo(seconds, { play: false });
        }}
        markers={markers}
        onMarkerOpen={onMarkerOpen}
      />

      {error ? (
        <p role="alert" className="text-ui text-destructive">
          오디오를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.
        </p>
      ) : null}
    </div>
  );
}

function WaveformTrack({
  peaks,
  status,
  position,
  duration,
  onSeek,
  markers,
  onMarkerOpen,
}: {
  peaks: number[] | null;
  status: ReturnType<typeof useAudioPeaks>["status"];
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  markers: WaveformMarkerInput[];
  onMarkerOpen?: (id: string) => void;
}) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [openMarker, setOpenMarker] = useState<string | null>(null);
  const draggingRef = useRef(false);

  useLayoutEffect(() => {
    const element = sliderRef.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === "number") setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bars = useMemo(() => (peaks ? resamplePeaks(peaks, waveformBarCount(width, peaks.length)) : null), [peaks, width]);
  const placed = useMemo(() => positionMarkers(markers, duration), [duration, markers]);
  const fraction = playedFraction(position, duration);
  const open = placed.find((marker) => marker.id === openMarker) ?? null;

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const element = sliderRef.current;
    if (!element) return;
    const ratio = fractionFromPointer(event.clientX, element.getBoundingClientRect());
    onSeek(duration > 0 ? ratio * duration : 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = seekForKey(event.key, position, duration);
    if (next === null) return;
    event.preventDefault();
    onSeek(next);
  };

  const bars64 = (tone: "rest" | "played") => (
    <span aria-hidden="true" className={cn("waveform-bars", tone === "played" ? "waveform-bars--played" : "waveform-bars--rest")}
      style={tone === "played" ? { clipPath: `inset(0 ${(1 - fraction) * 100}% 0 0)` } : undefined}>
      {bars?.map((value, index) => <span key={index} style={{ height: `max(2px, ${Math.round(value * 100)}%)` }} />)}
    </span>
  );

  // 파형이 없으면(아직 재생 전·만들 수 없음) 84px 파형 자리 대신 진행 막대 높이만 쓴다.
  // 시점 댓글 줄은 표시가 있을 때만 막대 바로 아래에 둔다.
  const lineOnly = !bars && status !== "computing" && status !== "loading";
  return (
    <div className="flex flex-col gap-2" onPointerLeave={(event) => { if (event.pointerType === "mouse") setOpenMarker(null); }}>
      <div className={cn("relative", lineOnly ? (placed.length > 0 ? "h-12" : "h-7") : "h-[84px]")}>
        <div
          ref={sliderRef}
          role="slider"
          tabIndex={0}
          aria-label="재생 위치"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={spokenTime(position)}
          onPointerDown={(event) => {
            draggingRef.current = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            seekFromPointer(event);
          }}
          onPointerMove={(event) => { if (draggingRef.current) seekFromPointer(event); }}
          onPointerUp={() => { draggingRef.current = false; }}
          onPointerCancel={() => { draggingRef.current = false; }}
          onKeyDown={handleKeyDown}
          className={cn("absolute inset-x-0 top-0 cursor-pointer touch-none", lineOnly ? "h-7" : "h-16", "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        >
          {bars ? (
            <>
              {bars64("rest")}
              {bars64("played")}
            </>
          ) : status === "computing" || status === "loading" ? (
            <span className="waveform-pending">
              <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" strokeWidth={1.8} aria-hidden="true" />
              {status === "computing" ? "파형을 만드는 중… 재생은 바로 할 수 있습니다" : "파형을 불러오는 중…"}
              <span aria-hidden="true" className="waveform-pending__progress" style={{ width: `${fraction * 100}%` }} />
            </span>
          ) : (
            // 파형이 없으면(아직 재생 전·만들 수 없음) 같은 자리에 진행 막대만 둔다.
            <span aria-hidden="true" className="waveform-line waveform-line--compact"><span style={{ width: `${fraction * 100}%` }} /></span>
          )}
        </div>
        <div aria-label="시점 댓글" role="group" className="absolute inset-x-0 bottom-0 h-5">
          {placed.map((marker) => (
            <button
              key={marker.id}
              type="button"
              aria-label={`${marker.author} ${formatTimeMarker(marker.seconds)} 댓글`}
              aria-expanded={openMarker === marker.id}
              onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpenMarker(marker.id); }}
              onFocus={() => setOpenMarker(marker.id)}
              onClick={() => setOpenMarker(marker.id)}
              onKeyDown={(event) => { if (event.key === "Escape") setOpenMarker(null); }}
              style={{ left: `calc(${marker.leftPercent}% - 10px)` }}
              className={cn(
                "waveform-marker absolute top-0 flex size-5 items-center justify-center rounded-full text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                marker.isStann ? "bg-primary text-primary-foreground" : "bg-selected text-secondary-foreground",
              )}
            >
              {Array.from(marker.author.trim())[0] ?? "?"}
            </button>
          ))}
        </div>
      </div>
      {open ? (
        <button
          type="button"
          onClick={() => {
            setOpenMarker(null);
            onMarkerOpen?.(open.id);
          }}
          onKeyDown={(event) => { if (event.key === "Escape") setOpenMarker(null); }}
          aria-label={`${open.author} ${formatTimeMarker(open.seconds)} 댓글로 이동`}
          style={{ marginLeft: `clamp(0px, calc(${open.leftPercent}% - 140px), max(0px, calc(100% - 280px)))` }}
          className="flex max-w-[280px] flex-col gap-1 self-start rounded-md bg-primary px-3 py-2.5 text-left text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="font-mono text-[11px] opacity-80">{open.author} · {formatTimeMarker(open.seconds)}</span>
          <span className="line-clamp-3 text-ui">{open.text}</span>
        </button>
      ) : null}
    </div>
  );
}
