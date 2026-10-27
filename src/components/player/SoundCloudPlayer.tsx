"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Script from "next/script";
import { Button } from "@/components/ui/button";
import { OriginalLink } from "./OriginalLink";
import type { MediaSeekRequest, PlaybackPositionReader } from "./VideoPlayer";

type SoundCloudWidget = {
  bind(event: string, handler: () => void): void;
  unbind(event: string): void;
  seekTo(milliseconds: number): void;
  getPosition(callback: (milliseconds: number) => void): void;
  play(): void;
  pause(): void;
};

type SoundCloudApi = {
  Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidget) & {
    Events: { READY: string; ERROR: string };
  };
};

type SoundCloudPlayerProps = {
  url: string;
  seekRequest?: MediaSeekRequest;
  onPositionReaderChange?: (reader: PlaybackPositionReader | null) => void;
};

function readSoundCloudApi(): SoundCloudApi | undefined {
  return (window as Window & { SC?: SoundCloudApi }).SC;
}

// widget이 응답하지 않으면 피드백 입력을 막지 않도록 짧게 포기한다.
const POSITION_READ_TIMEOUT_MS = 1_500;

function SoundCloudEmbed({ url, seekRequest, onPositionReaderChange, onRetry }: SoundCloudPlayerProps & { onRetry: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const widgetRef = useRef<SoundCloudWidget | null>(null);
  const readyRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState(false);

  const applySeek = useCallback(() => {
    const widget = widgetRef.current;
    const seconds = pendingSeekRef.current;
    if (!widget || !readyRef.current || seconds === null) return;
    widget.seekTo(seconds * 1000);
    widget.play();
    pendingSeekRef.current = null;
  }, []);

  // The SDK posts to the iframe during unbind. Dispose before React removes it.
  useLayoutEffect(() => {
    if (!sdkReady || !iframeRef.current) return;
    const api = readSoundCloudApi();
    // SDK가 준비됐는데 전역 API가 없으면 onReady에서 이미 오류로 표시했다.
    if (!api) return;
    let active = true;
    const widget = api.Widget(iframeRef.current);
    widgetRef.current = widget;
    widget.bind(api.Widget.Events.READY, () => {
      if (!active) return;
      readyRef.current = true;
      setError(false);
      applySeek();
    });
    widget.bind(api.Widget.Events.ERROR, () => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      readyRef.current = false;
      widgetRef.current = null;
      widget.unbind(api.Widget.Events.READY);
      widget.unbind(api.Widget.Events.ERROR);
      widget.pause();
    };
  }, [applySeek, sdkReady]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!readyRef.current) setError(true);
    }, 15_000);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!onPositionReaderChange) return;
    onPositionReaderChange(() => new Promise<number | null>((resolve) => {
      const widget = widgetRef.current;
      if (!widget || !readyRef.current) {
        resolve(null);
        return;
      }
      const timer = window.setTimeout(() => resolve(null), POSITION_READ_TIMEOUT_MS);
      widget.getPosition((milliseconds) => {
        window.clearTimeout(timer);
        resolve(Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds / 1000 : null);
      });
    }));
    return () => onPositionReaderChange(null);
  }, [onPositionReaderChange]);

  useEffect(() => {
    if (!seekRequest || !Number.isFinite(seekRequest.seconds) || seekRequest.seconds < 0) return;
    pendingSeekRef.current = seekRequest.seconds;
    applySeek();
  }, [applySeek, seekRequest]);

  return <>
    <Script src="https://w.soundcloud.com/player/api.js" onReady={() => {
      if (readSoundCloudApi()) setSdkReady(true);
      else setError(true);
    }} onError={() => setError(true)} />
    <iframe
      ref={iframeRef}
      title="SoundCloud 믹스셋 플레이어"
      src={`https://w.soundcloud.com/player/?${new URLSearchParams({ url, auto_play: "false", show_artwork: "true", visual: "false" })}`}
      allow="autoplay"
      hidden={error}
      className="h-[166px] w-full md:rounded-lg"
    />
    {error && <div role="alert" className="flex min-h-[166px] flex-col items-start justify-center gap-3 bg-sidebar px-5 py-4 text-ui md:rounded-lg md:border md:border-border md:px-4">
      <p>SoundCloud에 연결하지 못했습니다. 다시 불러오거나 <OriginalLink url={url} />에서 재생해 주세요.</p>
      <Button type="button" variant="outline" onClick={onRetry}>플레이어 다시 불러오기</Button>
    </div>}
  </>;
}

/** ReactPlayer v3 has no SoundCloud provider; use its official widget contract. */
export function SoundCloudPlayer(props: SoundCloudPlayerProps) {
  const [attempt, setAttempt] = useState(0);
  return <SoundCloudEmbed key={attempt} {...props} onRetry={() => setAttempt((value) => value + 1)} />;
}
