/**
 * @file src/components/player/use-audio-peaks.ts
 * @description 업로드 오디오 파형을 불러오고, 없으면 처음 재생할 때 이 브라우저가 만들어 저장한다.
 * 같은 주소는 한 번만 계산한다(화면을 떠나도 계산·저장은 끝까지 간다).
 */
"use client";

import { useEffect, useState } from "react";
import type { AudioPeaks } from "@/lib/audio/peaks";
import { loadAudioPeaks, saveAudioPeaks } from "@/lib/media-peaks-client";
import { computeAudioPeaksFromUrl } from "./compute-audio-peaks";

export type PeaksStatus = "loading" | "ready" | "missing" | "computing" | "unavailable";

/** 주소별 결과: 파형, 또는 만들 수 없음(null). */
const known = new Map<string, AudioPeaks | null>();
const computing = new Map<string, Promise<AudioPeaks | null>>();

function computeOnce(url: string, mediaObjectId: string | null): Promise<AudioPeaks | null> {
  const running = computing.get(url);
  if (running) return running;
  const task = computeAudioPeaksFromUrl(url).then(async (peaks) => {
    known.set(url, peaks);
    if (peaks && mediaObjectId) await saveAudioPeaks(mediaObjectId, peaks);
    return peaks;
  });
  computing.set(url, task);
  return task;
}

type Outcome = { url: string; peaks: AudioPeaks | null };

export function useAudioPeaks(url: string, mediaObjectId: string | null, shouldCompute: boolean) {
  // 서버에서 읽은 결과(없음 = null). 매체 ID가 없는 예전 주소는 읽을 곳이 없어 바로 "없음"이다.
  const [fetched, setFetched] = useState<Outcome | null>(() => (mediaObjectId ? null : { url, peaks: null }));
  const [computed, setComputed] = useState<Outcome | null>(null);
  // 처음 재생하면 계산을 시작하고, 멈춰도 계산 중 상태를 유지한다(이전 렌더 값을 저장하는 render 중 갱신).
  const [requested, setRequested] = useState(false);
  if (shouldCompute && !requested) setRequested(true);

  const cached = known.get(url);
  const fetchedNow = fetched?.url === url ? fetched : mediaObjectId ? null : { url, peaks: null };
  const computedNow = computed?.url === url ? computed : null;
  const needsCompute = !known.has(url) && fetchedNow !== null && !fetchedNow.peaks && requested && !computedNow;

  useEffect(() => {
    if (known.has(url) || !mediaObjectId) return;
    const controller = new AbortController();
    void loadAudioPeaks(mediaObjectId, controller.signal).then((peaks) => {
      if (controller.signal.aborted) return;
      if (peaks) known.set(url, peaks);
      setFetched({ url, peaks });
    });
    return () => controller.abort();
  }, [mediaObjectId, url]);

  useEffect(() => {
    if (!needsCompute) return;
    let active = true;
    void computeOnce(url, mediaObjectId).then((peaks) => {
      if (active) setComputed({ url, peaks });
    });
    return () => {
      active = false;
    };
  }, [mediaObjectId, needsCompute, url]);

  let peaks: AudioPeaks | null = null;
  let status: PeaksStatus;
  if (known.has(url)) {
    peaks = cached ?? null;
    status = peaks ? "ready" : "unavailable";
  } else if (computedNow) {
    peaks = computedNow.peaks;
    status = peaks ? "ready" : "unavailable";
  } else if (fetchedNow?.peaks) {
    peaks = fetchedNow.peaks;
    status = "ready";
  } else if (!fetchedNow) status = "loading";
  else status = requested ? "computing" : "missing";
  return { peaks, status };
}
