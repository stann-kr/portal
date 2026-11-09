/**
 * @file src/lib/audio/flac-info.ts
 * @description FLAC STREAMINFO(첫 metadata block)에서 샘플레이트·채널·전체 프레임 수를 읽는다.
 * 전체 길이를 미리 알아야 비트레이트와 파형 구간을 정할 수 있다.
 */
import { UnsupportedAudioFormatError } from "./pcm-header";

export type FlacStreamInfo = { sampleRate: number; channels: number; bitsPerSample: number; totalFrames: number };

/** 파일 앞부분(최소 42바이트, ID3가 있으면 그만큼 더)을 받아 STREAMINFO를 읽는다. */
export function parseFlacStreamInfo(bytes: Uint8Array): FlacStreamInfo {
  let at = 0;
  // 일부 도구는 FLAC 앞에 ID3v2 태그를 붙인다.
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.length >= 10) {
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    at = 10 + size + (bytes[5]! & 0x10 ? 10 : 0);
  }
  if (bytes.length < at + 42) throw new UnsupportedAudioFormatError("FLAC 머리글이 짧습니다.");
  if (String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!) !== "fLaC") {
    throw new UnsupportedAudioFormatError("FLAC 머리글이 아닙니다.");
  }
  const blockType = bytes[at + 4]! & 0x7f;
  if (blockType !== 0) throw new UnsupportedAudioFormatError("FLAC STREAMINFO가 없습니다.");
  const s = at + 8; // STREAMINFO 본문 시작
  const b = (index: number) => bytes[s + index]!;
  const sampleRate = (b(10) << 12) | (b(11) << 4) | (b(12) >> 4);
  const channels = ((b(12) >> 1) & 0x07) + 1;
  const bitsPerSample = (((b(12) & 0x01) << 4) | (b(13) >> 4)) + 1;
  const totalFrames = (b(13) & 0x0f) * 2 ** 32 + ((b(14) << 24) >>> 0) + (b(15) << 16) + (b(16) << 8) + b(17);
  if (sampleRate <= 0) throw new UnsupportedAudioFormatError("FLAC 샘플레이트가 올바르지 않습니다.");
  if (totalFrames <= 0) throw new UnsupportedAudioFormatError("FLAC 전체 길이가 기록되지 않았습니다.");
  return { sampleRate, channels, bitsPerSample, totalFrames };
}
