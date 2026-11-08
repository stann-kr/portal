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

/** 머리글로 읽지 못한 파일을 decodeAudioData로 통째로 푸는 대체 경로의 원본 크기 상한(약 10분 분량). */
export const DECODE_FALLBACK_MAX_BYTES = 110 * 1024 * 1024;

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

/** 머리글을 읽지 못한 짧은 파일만: 브라우저 디코더로 통째로 푼다(Worker에는 AudioContext가 없다). */
async function decodeWholeFile(file: File) {
  if (file.size > DECODE_FALLBACK_MAX_BYTES || typeof AudioContext === "undefined") throw new PrepareAudioError("unreadable");
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channelData = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index).slice());
    return { sampleRate: buffer.sampleRate, channelData };
  } catch {
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
        decoded.channelData.map((channel) => channel.buffer),
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
