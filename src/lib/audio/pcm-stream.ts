/**
 * @file src/lib/audio/pcm-stream.ts
 * @description PCM 데이터 구간을 프레임 경계에 맞춘 조각으로 나누고, 각 조각을 -1~1 Float32 채널로 바꾼다.
 * 한 번에 한 조각만 메모리에 둔다. 3채널 이상은 앞의 두 채널(L·R)만 쓴다.
 */
import type { PcmHeader } from "./pcm-header";

/** 기본 조각 크기(원본 바이트). 휴대폰에서도 부담 없는 크기. */
export const PCM_CHUNK_TARGET_BYTES = 1024 * 1024;

export type ByteRange = { start: number; end: number };

/** dataOffset부터 dataBytes를 blockAlign 배수 조각으로 나눈다. 마지막 조각만 짧을 수 있다. */
export function* pcmChunkRanges(
  dataOffset: number,
  dataBytes: number,
  blockAlign: number,
  targetBytes = PCM_CHUNK_TARGET_BYTES,
): Generator<ByteRange> {
  if (blockAlign <= 0) throw new Error("blockAlign must be positive");
  const step = Math.max(blockAlign, Math.floor(targetBytes / blockAlign) * blockAlign);
  const usable = Math.floor(Math.max(0, dataBytes) / blockAlign) * blockAlign;
  const end = dataOffset + usable;
  for (let start = dataOffset; start < end; start += step) {
    yield { start, end: Math.min(end, start + step) };
  }
}

/** 출력 채널 수: 모노는 1, 그 외는 2. */
export function outputChannelCount(channels: number): 1 | 2 {
  return channels === 1 ? 1 : 2;
}

/** 프레임 경계에 맞춘 원본 바이트를 채널별 Float32 샘플로 바꾼다. */
export function decodePcmChunk(bytes: Uint8Array, header: PcmHeader): Float32Array[] {
  const { blockAlign, bytesPerSample, channels, littleEndian, sampleFormat, unsigned8 } = header;
  const frames = Math.floor(bytes.byteLength / blockAlign);
  const outChannels = outputChannelCount(channels);
  const out = Array.from({ length: outChannels }, () => new Float32Array(frames));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let channel = 0; channel < outChannels; channel += 1) {
    const target = out[channel]!;
    let position = channel * bytesPerSample;
    for (let frame = 0; frame < frames; frame += 1, position += blockAlign) {
      target[frame] = readSample(dv, bytes, position, bytesPerSample, sampleFormat, littleEndian, unsigned8);
    }
  }
  return out;
}

function readSample(
  dv: DataView,
  bytes: Uint8Array,
  at: number,
  size: number,
  format: PcmHeader["sampleFormat"],
  le: boolean,
  unsigned8: boolean,
): number {
  if (format === "float") {
    const value = size === 8 ? dv.getFloat64(at, le) : dv.getFloat32(at, le);
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  }
  switch (size) {
    case 1:
      return unsigned8 ? (bytes[at]! - 128) / 128 : dv.getInt8(at) / 128;
    case 2:
      return dv.getInt16(at, le) / 32768;
    case 3: {
      const value = le
        ? bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16)
        : (bytes[at]! << 16) | (bytes[at + 1]! << 8) | bytes[at + 2]!;
      return ((value << 8) >> 8) / 8388608;
    }
    default:
      return dv.getInt32(at, le) / 2147483648;
  }
}
