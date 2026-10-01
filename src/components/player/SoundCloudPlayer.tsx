"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import type { MediaSeekRequest } from "./VideoPlayer";

type SoundCloudWidget = {
  bind(event: string, handler: () => void): void;
  unbind(event: string): void;
  seekTo(milliseconds: number): void;
  play(): void;
  pause(): void;
};

type SoundCloudApi = {
  Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidget) & {
    Events: { READY: string; ERROR: string };
  };
};

/** ReactPlayer v3 has no SoundCloud provider; use its official widget contract. */
export function SoundCloudPlayer({ url, seekRequest }: { url: string; seekRequest?: MediaSeekRequest }) {
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

  useEffect(() => {
    if (!sdkReady || !iframeRef.current) return;
    const api = (window as Window & { SC?: SoundCloudApi }).SC;
    if (!api) { setError(true); return; }
    let active = true;
    const widget = api.Widget(iframeRef.current);
    widgetRef.current = widget;
    widget.bind(api.Widget.Events.READY, () => {
      if (!active) return;
      readyRef.current = true;
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
    if (!seekRequest || !Number.isFinite(seekRequest.seconds) || seekRequest.seconds < 0) return;
    pendingSeekRef.current = seekRequest.seconds;
    applySeek();
  }, [applySeek, seekRequest]);

  return <>
    <Script src="https://w.soundcloud.com/player/api.js" onReady={() => setSdkReady(true)} onError={() => setError(true)} />
    <iframe
      ref={iframeRef}
      title="SoundCloud 믹스셋 플레이어"
      src={`https://w.soundcloud.com/player/?${new URLSearchParams({ url, auto_play: "false", show_artwork: "true", visual: "false" })}`}
      allow="autoplay"
      className="h-[166px] w-full rounded-xl border border-border"
    />
    {error && <p role="alert" className="text-sm text-destructive">SoundCloud를 불러오지 못했습니다. 원본 링크에서 재생해 주세요.</p>}
  </>;
}
