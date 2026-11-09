/**
 * @file src/components/player/use-audio-peaks.ts
 * @description 업로드 오디오 파형을 불러오고, 없으면 처음 재생할 때 이 브라우저가 만들어 저장한다.
 * 같은 주소는 한 번만 계산한다(화면을 떠나도 계산·저장은 끝까지 간다).
 * 메모리: 결과는 최근 8개 주소만 기억하고, 디코딩은 한 번에 하나만 돌린다.
 * 저장은 올린 사람·관리자만 된다. 다른 사람은 계산한 파형을 화면에만 쓰고 403은 오류로 보지 않는다(다시 저장하지 않는다).
 */
"use client";

import { useEffect, useState } from "react";
import type { AudioPeaks } from "@/lib/audio/peaks";
import { loadAudioPeaks, saveAudioPeaksResult } from "@/lib/media-peaks-client";
import { computeAudioPeaksFromUrl } from "./compute-audio-peaks";
import { createSerialQueue, LruMap } from "./peaks-cache";

export type PeaksStatus = "loading" | "ready" | "missing" | "computing" | "unavailable";

/** 주소별 결과: 파형, 또는 만들 수 없음(null). */
const known = new LruMap<string, AudioPeaks | null>(8);
const computing = new Map<string, Promise<AudioPeaks | null>>();
/** 디코딩은 메모리가 커서 한 번에 하나만 한다. */
const enqueueDecode = createSerialQueue();
/** 저장 권한이 없다고 답한 매체(다시 PUT하지 않는다). 매체 ID 문자열만 둔다. */
const saveForbidden = new LruMap<string, true>(64);

function computeOnce(url: string, mediaObjectId: string | null): Promise<AudioPeaks | null> {
  const running = computing.get(url);
  if (running) return running;
  const task = enqueueDecode(() => computeAudioPeaksFromUrl(url))
    .then(async (peaks) => {
      known.set(url, peaks);
      if (peaks && mediaObjectId && !saveForbidden.has(mediaObjectId)) {
        const result = await saveAudioPeaksResult(mediaObjectId, peaks);
        if (result === "forbidden") saveForbidden.set(mediaObjectId, true);
      }
      return peaks;
    })
    .finally(() => computing.delete(url));
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
