/**
 * @file src/lib/audio/mp3-bitrate.ts
 * @description 변환 MP3 비트레이트 선택. 기본 192kbps(CBR)이고, 길이 때문에 업로드 상한을 넘으면
 * 들어갈 때까지 한 단계씩 낮춘다. 가장 낮은 단계로도 넘으면 null.
 */

export const MP3_DEFAULT_BITRATE_KBPS = 192;
export const MP3_BITRATE_LADDER_KBPS = [192, 160, 128, 112, 96, 80, 64] as const;
export type Mp3BitrateKbps = (typeof MP3_BITRATE_LADDER_KBPS)[number];

/** CBR MP3 예상 크기(바이트). 프레임 padding·LAME 태그·인코더 지연 몫으로 1% + 64KB 여유를 둔다. */
export function estimateMp3Bytes(durationSec: number, bitrateKbps: number): number {
  return Math.ceil(((bitrateKbps * 1000) / 8) * durationSec * 1.01) + 64 * 1024;
}

export function selectMp3Bitrate(durationSec: number, maxBytes: number): Mp3BitrateKbps | null {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  for (const bitrate of MP3_BITRATE_LADDER_KBPS) {
    if (estimateMp3Bytes(durationSec, bitrate) <= maxBytes) return bitrate;
  }
  return null;
}
