/**
 * @file src/lib/audio/mp3-encode.ts
 * @description 조각 단위 PCM 원본을 CBR MP3로 인코딩하면서 같은 흐름에서 파형(peaks)을 만든다.
 * 브라우저 Worker와 Node 테스트가 함께 쓰도록 환경 API(Worker·AudioContext)에 의존하지 않는다.
 * 인코딩 결과는 몇 MB마다 Blob으로 합쳐 큰 배열 하나로 커지지 않게 한다.
 * 상한은 끝에서만이 아니라 조각마다 확인한다: 출력 바이트가 maxBytes를 넘거나, 원본이 머리글에 적힌 길이
 * (+작은 여유)·절대 상한보다 많은 프레임을 내면 그 자리에서 AudioTooLongError로 멈춘다.
 */
import { createPeaksAccumulator, type AudioPeaks } from "./peaks";
import { selectMp3Bitrate, type Mp3BitrateKbps } from "./mp3-bitrate";
import { blobByteReader, parsePcmHeader } from "./pcm-header";
import { decodePcmChunk, outputChannelCount, pcmChunkRanges } from "./pcm-stream";
import { parseFlacStreamInfo } from "./flac-info";

export type PcmSource = {
  sampleRate: number;
  /** 인코더에 넣을 채널 수(1 또는 2). */
  channels: 1 | 2;
  totalFrames: number;
  /** 채널별 같은 길이의 -1~1 샘플 조각. */
  chunks(): AsyncIterable<Float32Array[]>;
};

export type Mp3EncoderLike = {
  configure(params: { channels: 1 | 2; sampleRate: number; bitrate: Mp3BitrateKbps; outputSampleRate: 44100 | 48000 }): void;
  encode(samples: readonly Float32Array[]): Uint8Array;
  finalize(): Uint8Array;
};

export type EncodeMp3Result = {
  blob: Blob;
  bitrateKbps: Mp3BitrateKbps;
  durationSec: number;
  peaks: AudioPeaks;
};

export class AudioTooLongError extends Error {
  constructor() {
    super("파일이 너무 길어 업로드 상한 안에 넣지 못했습니다.");
    this.name = "AudioTooLongError";
  }
}

const BLOB_FLUSH_BYTES = 8 * 1024 * 1024;
/** 머리글 길이보다 더 나와도 받아 주는 여유: 2% + 1초. */
const DECLARED_FRAMES_TOLERANCE_RATIO = 1.02;
const DECLARED_FRAMES_TOLERANCE_SEC = 1;
/** 머리글과 관계없이 처리하는 원본 길이의 절대 상한(4시간). */
export const MAX_SOURCE_DURATION_SEC = 4 * 60 * 60;

/** 이 원본에서 처리할 수 있는 최대 프레임 수(머리글 길이+여유와 절대 상한 중 작은 값). */
export function maxSourceFrames(source: Pick<PcmSource, "sampleRate" | "totalFrames">): number {
  const declared = Math.ceil(source.totalFrames * DECLARED_FRAMES_TOLERANCE_RATIO) + Math.ceil(source.sampleRate * DECLARED_FRAMES_TOLERANCE_SEC);
  return Math.min(declared, Math.floor(source.sampleRate * MAX_SOURCE_DURATION_SEC));
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("변환을 취소했습니다.", "AbortError");
}

/** 44.1k·48k는 그대로 두고, 그 밖의 샘플레이트는 인코더(LAME)가 44.1k로 바꾼다. */
export function mp3OutputSampleRate(inputRate: number): 44100 | 48000 {
  return inputRate === 48000 ? 48000 : 44100;
}

export async function encodeSourceToMp3(
  source: PcmSource,
  options: {
    createEncoder: () => Promise<Mp3EncoderLike>;
    maxBytes: number;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  },
): Promise<EncodeMp3Result> {
  const durationSec = source.totalFrames / source.sampleRate;
  const bitrateKbps = selectMp3Bitrate(durationSec, options.maxBytes);
  if (!bitrateKbps || durationSec > MAX_SOURCE_DURATION_SEC) throw new AudioTooLongError();
  const maxFrames = maxSourceFrames(source);
  const encoder = await options.createEncoder();
  encoder.configure({
    channels: source.channels,
    sampleRate: source.sampleRate,
    bitrate: bitrateKbps,
    outputSampleRate: mp3OutputSampleRate(source.sampleRate),
  });
  const peaks = createPeaksAccumulator(source.totalFrames);
  let blob = new Blob([]);
  let pending: Uint8Array<ArrayBuffer>[] = [];
  let pendingBytes = 0;
  let outputBytes = 0;
  // 인코더가 돌려주는 배열은 WASM 메모리를 가리키므로 다음 호출 전에 복사한다.
  const keep = (bytes: Uint8Array) => {
    if (bytes.byteLength === 0) return;
    outputBytes += bytes.byteLength;
    // 상한을 넘는 순간 멈춘다(남은 조각을 더 읽거나 인코딩하지 않는다).
    if (outputBytes > options.maxBytes) throw new AudioTooLongError();
    pending.push(bytes.slice());
    pendingBytes += bytes.byteLength;
    if (pendingBytes >= BLOB_FLUSH_BYTES) {
      blob = new Blob([blob, ...pending]);
      pending = [];
      pendingBytes = 0;
    }
  };
  let framesDone = 0;
  let lastPercent = -1;
  for await (const channels of source.chunks()) {
    throwIfAborted(options.signal);
    const length = channels[0]?.length ?? 0;
    if (length === 0) continue;
    // 머리글보다 훨씬 긴 원본은 인코딩하기 전에 멈춘다.
    if (framesDone + length > maxFrames) throw new AudioTooLongError();
    peaks.push(channels);
    keep(encoder.encode(channels));
    framesDone += length;
    const percent = Math.min(99, Math.floor((framesDone / source.totalFrames) * 100));
    if (percent !== lastPercent) {
      lastPercent = percent;
      options.onProgress?.(percent);
    }
  }
  throwIfAborted(options.signal);
  if (framesDone === 0) throw new Error("소리 데이터를 읽지 못했습니다.");
  keep(encoder.finalize());
  blob = new Blob([blob, ...pending], { type: "audio/mpeg" });
  if (blob.size > options.maxBytes) throw new AudioTooLongError();
  // 헤더가 실제보다 길게 적힌 파일은 실제로 읽은 길이로 파형·길이를 맞춘다.
  const actualDuration = framesDone > 0 ? framesDone / source.sampleRate : durationSec;
  options.onProgress?.(100);
  return { blob, bitrateKbps, durationSec: actualDuration, peaks: peaks.finish(actualDuration) };
}

/** WAV·AIFF: 머리글만 읽고 PCM은 File.slice 조각으로 읽는다. */
export async function createPcmFileSource(file: Blob): Promise<PcmSource> {
  const header = await parsePcmHeader(blobByteReader(file), file.size);
  return {
    sampleRate: header.sampleRate,
    channels: outputChannelCount(header.channels),
    totalFrames: header.frames,
    async *chunks() {
      for (const range of pcmChunkRanges(header.dataOffset, header.dataBytes, header.blockAlign)) {
        const bytes = new Uint8Array(await file.slice(range.start, range.end).arrayBuffer());
        yield decodePcmChunk(bytes, header);
      }
    },
  };
}

type FlacDecoderLike = {
  ready: Promise<void>;
  decode(data: Uint8Array): Promise<{ channelData: Float32Array[]; samplesDecoded: number; errors: unknown[] }>;
  flush(): Promise<{ channelData: Float32Array[]; samplesDecoded: number; errors: unknown[] }>;
  free(): void;
};

const FLAC_CHUNK_BYTES = 512 * 1024;
const FLAC_HEADER_PROBE_BYTES = 256 * 1024;

/** FLAC: STREAMINFO로 길이를 알고, 스트리밍 디코더에 File.slice 조각을 차례로 넣는다. */
export async function createFlacFileSource(file: Blob, createDecoder: () => Promise<FlacDecoderLike>): Promise<PcmSource> {
  const info = parseFlacStreamInfo(new Uint8Array(await file.slice(0, FLAC_HEADER_PROBE_BYTES).arrayBuffer()));
  const channels = outputChannelCount(info.channels);
  const pick = (decoded: { channelData: Float32Array[]; samplesDecoded: number; errors: unknown[] }) => {
    // 일부 프레임 오류는 건너뛴다(디코더가 다음 프레임에서 다시 맞춘다). 전체가 실패하면 아래에서 막는다.
    const left = decoded.channelData[0];
    if (!left || decoded.samplesDecoded === 0) return null;
    return channels === 1 ? [left] : [left, decoded.channelData[1] ?? left];
  };
  return {
    sampleRate: info.sampleRate,
    channels,
    totalFrames: info.totalFrames,
    async *chunks() {
      const decoder = await createDecoder();
      await decoder.ready;
      try {
        for (let start = 0; start < file.size; start += FLAC_CHUNK_BYTES) {
          const bytes = new Uint8Array(await file.slice(start, Math.min(file.size, start + FLAC_CHUNK_BYTES)).arrayBuffer());
          const out = pick(await decoder.decode(bytes));
          if (out) yield out;
        }
        const tail = pick(await decoder.flush());
        if (tail) yield tail;
      } finally {
        decoder.free();
      }
    },
  };
}

/** 이미 메모리에 있는 짧은 PCM(decodeAudioData 대체 경로)을 조각으로 나눠 넣는다. */
export function createMemorySource(sampleRate: number, channelData: Float32Array[]): PcmSource {
  const channels = outputChannelCount(channelData.length);
  const used = channelData.slice(0, channels);
  const totalFrames = used[0]?.length ?? 0;
  const step = sampleRate * 4;
  return {
    sampleRate,
    channels,
    totalFrames,
    async *chunks() {
      for (let start = 0; start < totalFrames; start += step) {
        yield used.map((channel) => channel.subarray(start, Math.min(totalFrames, start + step)));
      }
    },
  };
}
