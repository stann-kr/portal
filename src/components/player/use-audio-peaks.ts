/**
 * @file src/components/player/use-audio-peaks.ts
 * @description 업로드 오디오 파형을 서버에서 불러오고, 없으면 처음 재생할 때 이 브라우저가 만들어 서버에 저장한다.
 * 한 번 저장되면 그 뒤로는 누구든 서버에서 불러오기만 한다.
 * - 같은 주소는 한 번만 계산한다(`shared-peaks-jobs`). 그 주소를 기다리는 화면이 모두 떠나고 하단 공용 플레이어도
 *   그 주소를 재생하지 않으면 받기·디코딩을 멈춘다. 아직 큐에서 차례를 기다리던 작업은 시작하지 않는다.
 *   멈춘 작업은 실패로 기억하지 않고 저장하지 않으며, 다음에 그 화면을 열면 처음부터 다시 만든다.
 * - 메모리: 결과는 최근 8개 주소만 기억하고, 디코딩은 한 번에 하나만 돌린다(`enqueuePeaksDecode`).
 * - 저장: 오디오를 읽을 수 있는 사람은 누구든 아직 없는 파형을 처음 한 번 저장한다(서버가 처음 값만 남긴다).
 *   예전 서버가 403을 주면 그 매체는 다시 PUT하지 않는다.
 * - 일부 조각을 디코딩하지 못한 파형은 화면에만 쓰고 저장하지 않는다(처음 값이 영구히 남으므로).
 * - 이 브라우저가 (전부 또는 일부) 디코딩하지 못한 매체는 7일 동안 기억해(`peaks-failure-memory`) 재생할 때마다 다시 받지 않고
 *   "만드는 중" 대신 진행 막대만 보인다. 네트워크 실패는 기억하지 않는다(다음 방문 때 다시 해 본다).
 * - 메모리가 작은 기기·데이터 절약 모드는 만들지 않는다.
 */
"use client";

import { useEffect, useState } from "react";
import type { AudioPeaks } from "@/lib/audio/peaks";
import { loadAudioPeaks, saveAudioPeaksResult } from "@/lib/media-peaks-client";
import { canComputePeaksOnThisDevice, computeAudioPeaksFromUrl, enqueuePeaksDecode } from "./compute-audio-peaks";
import { LruMap } from "./peaks-cache";
import { hasRecentPeaksFailure, rememberPeaksFailure } from "./peaks-failure-memory";
import { getPlayerState } from "./player-store";
import { createSharedPeaksJobs } from "./shared-peaks-jobs";

export type PeaksStatus = "loading" | "ready" | "missing" | "computing" | "unavailable";

/** 주소별 결과: 파형, 또는 만들 수 없음(null). */
const known = new LruMap<string, AudioPeaks | null>(8);
/** 저장 권한이 없다고 답한 매체(다시 PUT하지 않는다). 매체 ID 문자열만 둔다. */
const saveForbidden = new LruMap<string, true>(64);
/** 주소별 매체 ID(작업 본문은 주소만 받는다). */
const mediaIds = new LruMap<string, string | null>(32);

/** 이 브라우저에서 만들지 않을 것인지(기기 제한 또는 최근 실패). */
function shouldSkipCompute(mediaObjectId: string | null): boolean {
  if (!canComputePeaksOnThisDevice()) return true;
  return mediaObjectId ? hasRecentPeaksFailure(mediaObjectId) : false;
}

type DecodeOutcome = { peaks: AudioPeaks | null; complete: boolean; aborted: boolean };

const jobs = createSharedPeaksJobs<AudioPeaks | null>({
  async run(url, signal) {
    const mediaObjectId = mediaIds.get(url) ?? null;
    const { peaks, complete, aborted } = await enqueueDecode(url, mediaObjectId, signal);
    // 멈춘 작업은 결과를 남기지 않는다(다음에 다시 만든다).
    if (aborted) return null;
    known.set(url, peaks);
    if (peaks && complete && mediaObjectId && !saveForbidden.has(mediaObjectId)) {
      const result = await saveAudioPeaksResult(mediaObjectId, peaks);
      if (result === "forbidden") saveForbidden.set(mediaObjectId, true);
    }
    return peaks;
  },
  // 하단 공용 플레이어가 이 주소를 재생 중이면 화면을 떠나도 끝까지 만든다.
  keepAlive: (url) => getPlayerState().track?.url === url,
});

async function enqueueDecode(url: string, mediaObjectId: string | null, signal: AbortSignal): Promise<DecodeOutcome> {
  if (shouldSkipCompute(mediaObjectId)) return { peaks: null, complete: false, aborted: false };
  const result = await enqueuePeaksDecode(async () => {
    // 차례를 기다리는 동안 모두 떠났으면 시작하지 않는다.
    if (signal.aborted) return null;
    return computeAudioPeaksFromUrl(url, signal);
  });
  if (result === null || signal.aborted) return { peaks: null, complete: false, aborted: true };
  // 일부 조각을 디코딩하지 못한 파형은 이번에만 보여 주고 저장하지 않으며, 실패처럼 기억해 다음 재생 때 다시 받지 않는다.
  if (!result.ok ? !result.retry : !result.complete) {
    if (mediaObjectId) rememberPeaksFailure(mediaObjectId);
  }
  return result.ok ? { peaks: result.peaks, complete: result.complete, aborted: false } : { peaks: null, complete: false, aborted: false };
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
  const wantsCompute = !known.has(url) && fetchedNow !== null && !fetchedNow.peaks && requested && !computedNow;
  // 만들지 않을 기기·최근 실패한 매체는 "만드는 중"을 보이지 않고 바로 진행 막대만 둔다(재생 뒤에만 확인한다).
  const skipCompute = wantsCompute && shouldSkipCompute(mediaObjectId);
  const needsCompute = wantsCompute && !skipCompute;

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
    mediaIds.set(url, mediaObjectId);
    const job = jobs.subscribe(url);
    void job.promise.then((peaks) => {
      if (active) setComputed({ url, peaks });
    });
    return () => {
      active = false;
      job.release();
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
  else if (skipCompute) status = "unavailable";
  else status = requested ? "computing" : "missing";
  return { peaks, status };
}
