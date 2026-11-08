/**
 * @file src/lib/audio/peaks.ts
 * @description 업로드 오디오 파형(peaks) 데이터의 공통 계약. 브라우저가 MP3 변환 중(새 업로드) 또는
 * 처음 재생할 때(예전 오디오) 계산해 저장하고, 재생 화면은 이 값으로 파형을 그린다.
 * 서버는 모양·크기만 검증하고 값의 의미는 해석하지 않는다.
 */

/** 파형 막대 수. 화면 폭과 무관하게 이 수로 저장하고, 그릴 때 줄이거나 늘린다. */
export const AUDIO_PEAKS_COUNT = 1000;
/** 저장 JSON 상한(바이트). 1000개 × 소수 3자리면 약 7KB. */
export const AUDIO_PEAKS_MAX_BYTES = 32 * 1024;

export type AudioPeaks = {
  version: 1;
  /** 초 단위 길이(0 초과). */
  duration: number;
  /** 0~1로 정규화한 구간별 최대 진폭, 길이 = AUDIO_PEAKS_COUNT. 소수 3자리. */
  peaks: number[];
};

export type AudioPeaksParseResult = { ok: true; value: AudioPeaks } | { ok: false; error: string };

export function parseAudioPeaks(raw: unknown): AudioPeaksParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "파형 데이터가 올바르지 않습니다." };
  const value = raw as Record<string, unknown>;
  if (value.version !== 1) return { ok: false, error: "지원하지 않는 파형 형식입니다." };
  const duration = value.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60) {
    return { ok: false, error: "파형 길이가 올바르지 않습니다." };
  }
  const peaks = value.peaks;
  if (!Array.isArray(peaks) || peaks.length !== AUDIO_PEAKS_COUNT) return { ok: false, error: "파형 막대 수가 올바르지 않습니다." };
  const normalized: number[] = [];
  for (const peak of peaks) {
    if (typeof peak !== "number" || !Number.isFinite(peak) || peak < 0 || peak > 1) {
      return { ok: false, error: "파형 값이 올바르지 않습니다." };
    }
    normalized.push(Math.round(peak * 1000) / 1000);
  }
  return { ok: true, value: { version: 1, duration, peaks: normalized } };
}

/**
 * 구간별 최대 진폭을 누적한다. 디코딩한 PCM을 조각 단위로 넣으면(전체를 메모리에 두지 않음)
 * 끝난 뒤 `finish(duration)`이 정규화한 결과를 돌려준다. 전체 샘플 수를 미리 알아야 한다.
 */
export function createPeaksAccumulator(totalFrames: number) {
  const buckets = new Float32Array(AUDIO_PEAKS_COUNT);
  const framesPerBucket = Math.max(1, totalFrames / AUDIO_PEAKS_COUNT);
  let frame = 0;
  return {
    /** channels: 채널별 같은 길이의 샘플(-1~1). */
    push(channels: ArrayLike<number>[]) {
      const length = channels[0]?.length ?? 0;
      for (let i = 0; i < length; i += 1) {
        let amplitude = 0;
        for (const channel of channels) {
          const sample = Math.abs(channel[i] ?? 0);
          if (sample > amplitude) amplitude = sample;
        }
        const bucket = Math.min(AUDIO_PEAKS_COUNT - 1, Math.floor(frame / framesPerBucket));
        if (amplitude > buckets[bucket]) buckets[bucket] = amplitude;
        frame += 1;
      }
    },
    finish(duration: number): AudioPeaks {
      let max = 0;
      for (const value of buckets) if (value > max) max = value;
      const scale = max > 0 ? 1 / max : 0;
      return { version: 1, duration, peaks: Array.from(buckets, (value) => Math.round(Math.min(1, value * scale) * 1000) / 1000) };
    },
  };
}
