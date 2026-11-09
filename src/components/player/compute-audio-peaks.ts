/**
 * @file src/components/player/compute-audio-peaks.ts
 * @description 파형이 없는 예전 오디오를 처음 재생한 브라우저가 파형을 만든다.
 *
 * 메모리 상한:
 * - 압축 파일이 AUDIO_PEAKS_DECODE_MAX_BYTES(60MB)를 넘으면 만들지 않는다(응답 Content-Length로 먼저 확인하고 본문을 받지 않고 끊는다, 받는 중에도 누적 크기로 확인).
 * - 디코딩은 3kHz OfflineAudioContext로 한다(파형은 진폭 윤곽만 필요). 1시간 스테레오 ≈ 86MB PCM.
 * - 브라우저가 디코딩 전에 원래 샘플레이트로 한 번 풀 수 있어 순간 메모리는 더 클 수 있다.
 *   그래서 기기 메모리가 작다고 알리는 기기(deviceMemory ≤ 2GB)와 데이터 절약 모드는 건너뛴다.
 * 스트리밍 디코딩(WebCodecs + MP3 frame 분해)은 하지 않는다. 만들지 못하면 파형 없이 재생만 한다.
 */
import { createPeaksAccumulator, type AudioPeaks } from "@/lib/audio/peaks";

export const AUDIO_PEAKS_DECODE_MAX_BYTES = 60 * 1024 * 1024;
const DECODE_SAMPLE_RATE = 3000;
const PUSH_CHUNK_FRAMES = 65_536;

type NavigatorHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

/** 이 기기에서 예전 오디오 파형을 만들어도 되는지. */
export function canComputePeaksOnThisDevice(): boolean {
  if (typeof window === "undefined" || typeof OfflineAudioContext === "undefined") return false;
  const hints = navigator as NavigatorHints;
  if (hints.connection?.saveData) return false;
  if (typeof hints.deviceMemory === "number" && hints.deviceMemory <= 2) return false;
  return true;
}

async function readWithLimit(response: Response, limit: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      return null;
    }
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/** 오디오 주소에서 파형을 만든다. 상한을 넘거나 디코딩하지 못하면 null. */
export async function computeAudioPeaksFromUrl(url: string, signal?: AbortSignal): Promise<AudioPeaks | null> {
  if (!canComputePeaksOnThisDevice()) return null;
  try {
    const response = await fetch(url, { credentials: "same-origin", signal });
    if (!response.ok) return null;
    const encoded = await readWithLimit(response, AUDIO_PEAKS_DECODE_MAX_BYTES, signal);
    if (!encoded || signal?.aborted) return null;
    const context = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
    const decoded = await context.decodeAudioData(encoded);
    if (signal?.aborted || decoded.duration <= 0) return null;
    const accumulator = createPeaksAccumulator(decoded.length);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    for (let start = 0; start < decoded.length; start += PUSH_CHUNK_FRAMES) {
      const end = Math.min(decoded.length, start + PUSH_CHUNK_FRAMES);
      accumulator.push(channels.map((channel) => channel.subarray(start, end)));
      // 긴 계산이 화면을 멈추지 않게 조각마다 양보한다.
      if ((start / PUSH_CHUNK_FRAMES) % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return accumulator.finish(decoded.duration);
  } catch {
    return null;
  }
}
