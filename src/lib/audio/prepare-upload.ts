/**
 * @file src/lib/audio/prepare-upload.ts
 * @description 업로드 전 오디오 준비(브라우저 전용). WAV·AIFF·FLAC은 Worker에서 MP3(CBR 192kbps,
 * 길면 상한 안에 들도록 낮춤)로 바꾸고 원본은 올리지 않는다. MP3·M4A·OGG 등은 그대로 둔다.
 * 변환하면 같은 흐름에서 만든 파형(peaks)도 함께 돌려준다.
 */
import { MEDIA_WORKER_UPLOAD_MAX_BYTES } from "@/lib/media-lifecycle";
import type { AudioPeaks } from "./peaks";
import type { AudioConvertErrorCode, AudioConvertRequest, AudioConvertResponse, LosslessAudioKind } from "./audio-convert-protocol";

export type PreparedAudioUpload = {
  /** 올릴 파일: 변환한 MP3 또는 원본. */
  file: File;
  converted: boolean;
  bitrateKbps?: number;
  durationSec?: number;
  peaks?: AudioPeaks;
};

export type AudioPrepareProgress = {
  /** 0~100 */
  percent: number;
  /** 남은 시간(초). 아직 추정할 수 없으면 null. */
  etaSec: number | null;
};

export type PrepareAudioUploadOptions = {
  onProgress?: (progress: AudioPrepareProgress) => void;
  signal?: AbortSignal;
  /** 테스트·다른 목적용 상한. 기본은 Worker 업로드 상한(95MB). */
  maxBytes?: number;
};

export type PrepareAudioErrorCode = "unreadable" | "too-long" | "too-large";

const PREPARE_ERROR_MESSAGES: Record<PrepareAudioErrorCode, string> = {
  unreadable: "이 기기에서 이 파일을 읽지 못했습니다. MP3로 바꿔 올리거나 다른 기기에서 시도해 주세요.",
  "too-long": "파일이 너무 길어 95MB 안에 넣지 못했습니다. 길이를 줄이거나 나눠 올려 주세요.",
  "too-large": "95MB를 넘는 파일은 올릴 수 없습니다. 더 작은 파일을 골라 주세요.",
};

export class PrepareAudioError extends Error {
  constructor(readonly code: PrepareAudioErrorCode) {
    super(PREPARE_ERROR_MESSAGES[code]);
    this.name = "PrepareAudioError";
  }
}

/**
 * 머리글로 읽지 못한 파일(ADPCM·μ-law WAV 등)을 decodeAudioData로 통째로 푸는 대체 경로의 원본 크기 상한.
 *
 * 최악의 디코딩 메모리 계산: 이 경로에 오는 형식 중 가장 많이 압축된 것은 4bit ADPCM(표본·채널당 0.5바이트)이고,
 * 디코더는 표본·채널당 float32(4바이트)로 풀므로 원본의 최대 8배다. 20MB × 8 = 160MB(디코딩 PCM) + 원본 20MB
 * = 약 180MB. 디코딩한 채널 버퍼는 복사하지 않고 그대로 Worker로 넘기므로(transfer) 이 위에 사본이 더해지지 않는다.
 * 단, 디코더는 AudioContext 표본율(보통 44.1·48kHz)로 다시 표본화하므로 이보다 낮은 표본율(예: 8kHz 전화 음질)의
 * 원본은 그만큼 더 커질 수 있다. 그래서 디코딩 뒤 PCM 크기도 DECODE_FALLBACK_MAX_PCM_BYTES로 한 번 더 막는다.
 * 20MB는 4bit ADPCM 44.1kHz 스테레오로 약 7분, 8bit μ-law로 약 4분 분량이다.
 */
export const DECODE_FALLBACK_MAX_BYTES = 20 * 1024 * 1024;
/** 대체 경로에서 Worker로 넘길 디코딩 PCM(앞 2채널, float32)의 크기 상한. */
export const DECODE_FALLBACK_MAX_PCM_BYTES = 160 * 1024 * 1024;

/**
 * 디코딩한 채널을 복사 없이 Worker로 넘길 목록으로 만든다. 채널마다 자기 ArrayBuffer 전체를 쓰면 그대로 넘기고(transfer),
 * 다른 채널과 버퍼를 나눠 쓰거나 일부만 쓰는 구현이면 그 채널만 복사한다(같은 버퍼를 두 번 넘기면 postMessage가 실패한다).
 */
export function transferableChannels(channels: readonly Float32Array[]): { channelData: Float32Array[]; transfer: ArrayBuffer[] } {
  const transfer: ArrayBuffer[] = [];
  const channelData = channels.map((channel) => {
    const buffer = channel.buffer;
    const whole = buffer instanceof ArrayBuffer && channel.byteOffset === 0 && channel.byteLength === buffer.byteLength;
    if (whole && !transfer.includes(buffer)) {
      transfer.push(buffer);
      return channel;
    }
    const copy = channel.slice();
    transfer.push(copy.buffer);
    return copy;
  });
  return { channelData, transfer };
}

const LOSSLESS_EXTENSIONS: Record<string, LosslessAudioKind> = {
  wav: "pcm",
  wave: "pcm",
  aif: "pcm",
  aiff: "pcm",
  aifc: "pcm",
  flac: "flac",
};

const LOSSLESS_MIME_TYPES: Record<string, LosslessAudioKind> = {
  "audio/wav": "pcm",
  "audio/wave": "pcm",
  "audio/x-wav": "pcm",
  "audio/vnd.wave": "pcm",
  "audio/aiff": "pcm",
  "audio/x-aiff": "pcm",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};

/** 변환 대상이면 종류, 아니면 null. 확장자를 먼저 보고 없으면 MIME을 본다. */
export function losslessAudioKind(file: { name: string; type: string }): LosslessAudioKind | null {
  const extension = /\.([a-z0-9]+)$/iu.exec(file.name)?.[1]?.toLowerCase();
  if (extension && extension in LOSSLESS_EXTENSIONS) return LOSSLESS_EXTENSIONS[extension]!;
  return LOSSLESS_MIME_TYPES[file.type.toLowerCase()] ?? null;
}

export function mp3FileName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/u, "") || "audio";
  return `${base}.mp3`;
}

/** 진행률과 경과 시간으로 남은 시간을 추정한다. 초반(2% 미만·1.5초 미만)은 흔들려서 null. */
export function estimateRemainingSeconds(percent: number, elapsedMs: number): number | null {
  if (percent < 2 || elapsedMs < 1500) return null;
  if (percent >= 100) return 0;
  return Math.max(1, Math.round(((elapsedMs / percent) * (100 - percent)) / 1000));
}

/** "약 40초 남음" · "약 3분 남음" */
export function formatRemaining(etaSec: number): string {
  if (etaSec < 60) return `약 ${Math.max(1, Math.round(etaSec / 5) * 5 || 1)}초 남음`;
  return `약 ${Math.round(etaSec / 60)}분 남음`;
}

function abortError() {
  return new DOMException("변환을 취소했습니다.", "AbortError");
}

function runWorker(request: AudioConvertRequest, options: PrepareAudioUploadOptions, transfer: Transferable[] = []) {
  return new Promise<Extract<AudioConvertResponse, { type: "done" }>>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./audio-convert.worker.ts", import.meta.url), { type: "module" });
    } catch {
      reject(new WorkerFailure("failed"));
      return;
    }
    const startedAt = performance.now();
    const finish = () => {
      worker.terminate();
      options.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<AudioConvertResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        options.onProgress?.({ percent: message.percent, etaSec: estimateRemainingSeconds(message.percent, performance.now() - startedAt) });
        return;
      }
      finish();
      if (message.type === "done") resolve(message);
      else reject(new WorkerFailure(message.code));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      reject(new WorkerFailure("failed"));
    };
    worker.postMessage(request, transfer);
  });
}

class WorkerFailure extends Error {
  constructor(readonly code: AudioConvertErrorCode) {
    super(code);
  }
}

/** 머리글을 읽지 못한 작은 파일만: 브라우저 디코더로 통째로 푼다(Worker에는 AudioContext가 없다). */
async function decodeWholeFile(file: File) {
  if (file.size > DECODE_FALLBACK_MAX_BYTES || typeof AudioContext === "undefined") throw new PrepareAudioError("unreadable");
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channelCount = Math.min(2, buffer.numberOfChannels);
    if (buffer.length * channelCount * Float32Array.BYTES_PER_ELEMENT > DECODE_FALLBACK_MAX_PCM_BYTES) throw new PrepareAudioError("unreadable");
    // getChannelData는 AudioBuffer의 버퍼를 그대로 보여 준다. 복사하지 않고 Worker로 넘긴다(이 AudioBuffer는 다시 쓰지 않는다).
    const { channelData, transfer } = transferableChannels(Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index)));
    return { sampleRate: buffer.sampleRate, channelData, transfer };
  } catch (error) {
    if (error instanceof PrepareAudioError) throw error;
    throw new PrepareAudioError("unreadable");
  } finally {
    void context.close().catch(() => undefined);
  }
}

function toPrepareError(error: unknown): unknown {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (error instanceof PrepareAudioError) return error;
  if (error instanceof WorkerFailure && error.code === "too-long") return new PrepareAudioError("too-long");
  return new PrepareAudioError("unreadable");
}

/**
 * 업로드할 파일을 준비한다. 취소하면 AbortError(DOMException)로, 그 밖의 실패는 PrepareAudioError로 끝난다.
 */
export async function prepareAudioUpload(file: File, options: PrepareAudioUploadOptions = {}): Promise<PreparedAudioUpload> {
  const maxBytes = options.maxBytes ?? MEDIA_WORKER_UPLOAD_MAX_BYTES;
  const kind = losslessAudioKind(file);
  if (!kind) {
    if (file.size > maxBytes) throw new PrepareAudioError("too-large");
    return { file, converted: false };
  }
  options.onProgress?.({ percent: 0, etaSec: null });
  let done: Extract<AudioConvertResponse, { type: "done" }>;
  try {
    done = await runWorker({ type: "file", kind, file, maxBytes }, options);
  } catch (error) {
    if (!(error instanceof WorkerFailure && error.code === "unsupported")) throw toPrepareError(error);
    // 머리글로 읽지 못한 형식(예: ADPCM WAV): 짧은 파일만 브라우저 디코더로 대신 푼다.
    try {
      const decoded = await decodeWholeFile(file);
      if (options.signal?.aborted) throw abortError();
      done = await runWorker(
        { type: "pcm", sampleRate: decoded.sampleRate, channelData: decoded.channelData, maxBytes },
        options,
        decoded.transfer,
      );
    } catch (fallbackError) {
      throw toPrepareError(fallbackError);
    }
  }
  return {
    file: new File([done.blob], mp3FileName(file.name), { type: "audio/mpeg" }),
    converted: true,
    bitrateKbps: done.bitrateKbps,
    durationSec: done.durationSec,
    peaks: done.peaks,
  };
}
