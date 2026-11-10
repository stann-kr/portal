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

/** 파형 길이로 본 평균 비트레이트 허용 범위(kbps). 압축 오디오(8~320kbps)부터 무압축 다채널까지 넉넉히 둔다. */
const MIN_PLAUSIBLE_KBPS = 4;
const MAX_PLAUSIBLE_KBPS = 10_000;
/** MP3는 8~320kbps(VBR 여유 포함)라 범위를 좁힌다. 남이 엉뚱한 길이를 먼저 저장하기 어렵게 한다. */
const MPEG_MIN_PLAUSIBLE_KBPS = 8;
const MPEG_MAX_PLAUSIBLE_KBPS = 400;

function isMpegContentType(contentType: string | null | undefined): boolean {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return type === "audio/mpeg" || type === "audio/mp3" || type === "audio/mpeg3" || type === "audio/x-mpeg";
}

/**
 * 파형 길이가 파일 크기와 맞는지(크기를 모르면 통과). 남이 엉뚱한 길이를 먼저 저장하지 못하게 한다.
 * MP3(audio/mpeg)는 평균 8~400kbps, 그 밖의 형식은 4~10,000kbps를 받는다.
 */
export function isPlausiblePeaksDuration(duration: number, sizeBytes: number | null, contentType?: string | null): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (!sizeBytes || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return true;
  const kbps = (sizeBytes * 8) / duration / 1000;
  const [min, max] = isMpegContentType(contentType)
    ? [MPEG_MIN_PLAUSIBLE_KBPS, MPEG_MAX_PLAUSIBLE_KBPS]
    : [MIN_PLAUSIBLE_KBPS, MAX_PLAUSIBLE_KBPS];
  return kbps >= min && kbps <= max;
}

/**
 * 저장한 파형을 쓴 사람의 종류. `owner`는 오디오 소유자·관리자, `reader`는 그 밖에 오디오를 읽을 수 있는 사람이다.
 * 저장 JSON에 `writer` 필드로 함께 두며(`AudioPeaks` 모양은 그대로), 필드가 없는 예전 파일은 `owner`로 본다.
 */
export type AudioPeaksWriter = "owner" | "reader";

/** 저장할 JSON. `parseAudioPeaks`는 `writer`를 무시하므로 읽는 쪽 모양은 바뀌지 않는다. */
export function serializeStoredAudioPeaks(value: AudioPeaks, writer: AudioPeaksWriter): string {
  return JSON.stringify({ ...value, writer });
}

/** 저장 JSON을 쓴 사람의 종류. `writer: "reader"`만 reader이고, 없거나 읽을 수 없으면 owner(예전 파일 호환)다. */
export function storedAudioPeaksWriter(stored: string): AudioPeaksWriter {
  try {
    const raw = JSON.parse(stored) as { writer?: unknown } | null;
    return raw && typeof raw === "object" && raw.writer === "reader" ? "reader" : "owner";
  } catch {
    return "owner";
  }
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
      return normalizedPeaks(buckets, duration);
    },
  };
}

function normalizedPeaks(buckets: Float32Array, duration: number): AudioPeaks {
  let max = 0;
  for (const value of buckets) if (value > max) max = value;
  const scale = max > 0 ? 1 / max : 0;
  return { version: 1, duration, peaks: Array.from(buckets, (value) => Math.round(Math.min(1, value * scale) * 1000) / 1000) };
}

export type TimedPeaksAccumulatorOptions = {
  /** 처음 시간 칸 폭(초). 기본 0.01초. */
  initialBucketSeconds?: number;
  /** 시간 칸 최대 수. 넘으면 이웃 두 칸을 합쳐 폭을 두 배로 한다. 기본 262144(1MB). */
  maxBuckets?: number;
};

/**
 * 전체 길이를 미리 모를 때 쓰는 누적기. 조각마다 시작 시각을 주면 시간 칸에 최대 진폭을 모으고,
 * `finish(duration)`이 AUDIO_PEAKS_COUNT 구간으로 줄여 정규화한다. 메모리는 maxBuckets개 float로 묶인다.
 */
export function createTimedPeaksAccumulator(options: TimedPeaksAccumulatorOptions = {}) {
  const maxBuckets = Math.max(AUDIO_PEAKS_COUNT * 2, options.maxBuckets ?? 1 << 18);
  let width = options.initialBucketSeconds ?? 0.01;
  let buckets = new Float32Array(Math.min(maxBuckets, 4096));
  let used = 0;

  function ensure(index: number): number {
    while (index >= maxBuckets) {
      // 이웃 두 칸을 합쳐 칸 폭을 두 배로 한다.
      const half = Math.ceil(used / 2);
      for (let i = 0; i < half; i += 1) buckets[i] = Math.max(buckets[2 * i], buckets[2 * i + 1] ?? 0);
      buckets.fill(0, half);
      used = half;
      width *= 2;
      index = Math.floor(index / 2);
    }
    if (index >= buckets.length) {
      let size = buckets.length;
      while (size <= index) size *= 2;
      const grown = new Float32Array(Math.min(maxBuckets, size));
      grown.set(buckets);
      buckets = grown;
    }
    return index;
  }

  return {
    /**
     * startSeconds에서 시작하는 표본을 넣는다. [fromSeconds, toSeconds) 밖 표본은 버린다(조각의 lead·꼬리).
     * channels: 채널별 같은 길이의 표본(-1~1).
     */
    push(channels: ArrayLike<number>[], sampleRate: number, startSeconds: number, fromSeconds = 0, toSeconds = Infinity) {
      const length = channels[0]?.length ?? 0;
      if (length === 0 || !(sampleRate > 0)) return;
      const from = Math.max(0, fromSeconds);
      const end = Math.min(toSeconds, startSeconds + length / sampleRate);
      if (end <= from) return;
      ensure(Math.floor(end / width));
      const first = Math.max(0, Math.ceil((from - startSeconds) * sampleRate));
      const last = Math.min(length, Math.ceil((end - startSeconds) * sampleRate));
      for (let i = first; i < last; i += 1) {
        let amplitude = 0;
        for (const channel of channels) {
          const sample = Math.abs(channel[i] ?? 0);
          if (sample > amplitude) amplitude = sample;
        }
        const index = Math.min(buckets.length - 1, Math.floor((startSeconds + i / sampleRate) / width));
        if (amplitude > buckets[index]) buckets[index] = amplitude;
        if (index >= used) used = index + 1;
      }
    },
    finish(duration: number): AudioPeaks {
      const out = new Float32Array(AUDIO_PEAKS_COUNT);
      for (let j = 0; j < AUDIO_PEAKS_COUNT; j += 1) {
        const start = Math.floor(((j * duration) / AUDIO_PEAKS_COUNT) / width);
        const stop = Math.max(start + 1, Math.ceil((((j + 1) * duration) / AUDIO_PEAKS_COUNT) / width));
        let max = 0;
        for (let i = start; i < stop && i < used; i += 1) if (buckets[i] > max) max = buckets[i];
        out[j] = max;
      }
      return normalizedPeaks(out, duration);
    },
  };
}
