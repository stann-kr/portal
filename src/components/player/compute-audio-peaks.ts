/**
 * @file src/components/player/compute-audio-peaks.ts
 * @description 파형이 없는 오디오의 파형을 브라우저에서 만든다(처음 재생할 때, 또는 MP3를 그대로 올린 직후).
 *
 * MP3(길이 제한 없음): 파일을 4MB 덩어리로 받아(서버는 Range를 지원한다. 지원하지 않으면 한 응답 본문을 받는 대로)
 * frame 경계에서 최대 4MB·120초 조각으로 끊고(`createMp3FrameChunker`), 조각마다 3kHz OfflineAudioContext로
 * 디코딩해 시간 칸 누적기에 넣는다. 들고 있는 것은 조각 하나와 그 디코딩 결과뿐이다.
 * 전체 길이는 센 frame 수로 정한다(CBR·VBR 모두 정확, Xing 머리 frame 제외).
 * 조각 경계는 앞 조각의 마지막 frame 몇 개를 붙여 디코딩하고 그 구간은 버린다. 디코더 지연 등으로 생기는
 * 수십 ms 어긋남은 1시간 개요 파형에서 보이지 않는다.
 *
 * 그 밖의 형식(M4A·AAC·OGG·WAV): 전과 같이 파일 전체를 받아 한 번에 디코딩하며 AUDIO_PEAKS_DECODE_MAX_BYTES(60MB)를 넘으면 만들지 않는다.
 *
 * 브라우저가 디코딩 전에 원래 sample rate로 한 번 풀 수 있어 순간 메모리는 조각 길이에 비례한다(120초 스테레오 ≈ 42MB).
 * 기기 메모리가 작다고 알리는 기기(deviceMemory ≤ 2GB)와 데이터 절약 모드는 만들지 않는다.
 * 디코딩은 이 모듈의 직렬 큐(`enqueuePeaksDecode`)로 한 번에 하나만 돌린다(재생 화면·업로드 화면 공통).
 */
import { createPeaksAccumulator, createTimedPeaksAccumulator, type AudioPeaks } from "@/lib/audio/peaks";
import { createMp3FrameChunker, looksLikeMp3, type Mp3Chunk } from "@/lib/audio/mp3-frames";
import { onAudioPrepared } from "@/lib/audio/on-audio-prepared";
import { createSerialQueue } from "./peaks-cache";

export const AUDIO_PEAKS_DECODE_MAX_BYTES = 60 * 1024 * 1024;
const DECODE_SAMPLE_RATE = 3000;
const FALLBACK_DECODE_SAMPLE_RATE = 22050;
const PUSH_CHUNK_FRAMES = 65_536;
/** 한 번에 받는 바이트(Range 요청 하나, 또는 본문을 모아 chunker에 넘기는 단위). */
const READ_BLOCK_BYTES = 4 * 1024 * 1024;

/** 디코딩은 메모리가 커서 한 번에 하나만 한다. */
export const enqueuePeaksDecode = createSerialQueue();

/**
 * 결과: 파형, 또는 실패. `retry`가 true면 네트워크·서버 문제라 다음에 다시 해 볼 만하고,
 * false면 이 파일을 이 브라우저가 디코딩하지 못한 것이다(다시 해도 같다).
 * `complete`가 false면 일부 조각을 디코딩하지 못해 빈 구간이 있는 파형이다. 화면에만 쓰고 서버에는 저장하지 않는다
 * (처음 값이 영구히 남으므로 빈 구간 있는 파형을 모두에게 남기지 않는다).
 */
export type ComputePeaksResult = { ok: true; peaks: AudioPeaks; complete: boolean } | { ok: false; retry: boolean };

type NavigatorHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

/** 이 기기에서 오디오 파형을 만들어도 되는지. */
export function canComputePeaksOnThisDevice(): boolean {
  if (typeof window === "undefined" || typeof OfflineAudioContext === "undefined") return false;
  const hints = navigator as NavigatorHints;
  if (hints.connection?.saveData) return false;
  if (typeof hints.deviceMemory === "number" && hints.deviceMemory <= 2) return false;
  return true;
}

class RetryableError extends Error {}

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

function isMpegType(contentType: string | null | undefined): boolean {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return type === "audio/mpeg" || type === "audio/mp3" || type === "audio/mpeg3" || type === "audio/x-mpeg";
}

/** 본문을 READ_BLOCK_BYTES 정도로 모아 내보낸다(작은 덩어리마다 chunker 버퍼를 복사하지 않게). */
async function* readBodyInBlocks(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let parts: Uint8Array[] = [];
  let size = 0;
  const flush = () => {
    const block = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      block.set(part, offset);
      offset += part.byteLength;
    }
    parts = [];
    size = 0;
    return block;
  };
  try {
    for (;;) {
      if (signal?.aborted) throw new RetryableError("aborted");
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.byteLength;
      if (size >= READ_BLOCK_BYTES) yield flush();
    }
    if (size > 0) yield flush();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function totalFromContentRange(value: string | null): number | null {
  const match = /\/(\d+)\s*$/.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * 주소의 바이트를 덩어리로 내보낸다. 첫 응답이 206이면 이어서 Range로 받고, 200이면 그 본문을 받는 대로 읽는다.
 */
async function* readUrlInBlocks(first: Response, url: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (!first.body) throw new RetryableError("no body");
  const total = first.status === 206 ? totalFromContentRange(first.headers.get("content-range")) : null;
  if (total === null) {
    yield* readBodyInBlocks(first.body, signal);
    return;
  }
  const head = new Uint8Array(await first.arrayBuffer());
  let offset = head.byteLength;
  yield head;
  while (offset < total) {
    if (signal?.aborted) throw new RetryableError("aborted");
    const end = Math.min(total, offset + READ_BLOCK_BYTES) - 1;
    const response = await fetch(url, { credentials: "same-origin", headers: { Range: `bytes=${offset}-${end}` }, signal });
    if (response.status !== 206) throw new RetryableError(`range ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new RetryableError("empty range");
    offset += bytes.byteLength;
    yield bytes;
  }
}

/** 로컬 파일을 덩어리로 읽는다(네트워크 없음). */
async function* readFileInBlocks(file: Blob, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < file.size; offset += READ_BLOCK_BYTES) {
    if (signal?.aborted) throw new RetryableError("aborted");
    yield new Uint8Array(await file.slice(offset, offset + READ_BLOCK_BYTES).arrayBuffer());
  }
}

/** 3kHz 디코딩 context. 낮은 sample rate를 받지 않는 예전 브라우저는 22.05kHz로 한다(120초 스테레오 ≈ 21MB). */
function createDecodeContext(): OfflineAudioContext {
  try {
    return new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
  } catch {
    return new OfflineAudioContext(1, 1, FALLBACK_DECODE_SAMPLE_RATE);
  }
}

async function decode(bytes: Uint8Array): Promise<AudioBuffer> {
  // decodeAudioData는 넘긴 ArrayBuffer를 떼어 가므로 조각 전용 버퍼를 넘긴다.
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  return createDecodeContext().decodeAudioData(buffer as ArrayBuffer);
}

/** MP3 덩어리를 조각으로 끊어 디코딩하며 파형을 만든다. 조각 절반 넘게 디코딩하지 못하면 실패. */
async function computeMp3PeaksFromBlocks(blocks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<ComputePeaksResult> {
  const chunker = createMp3FrameChunker();
  const accumulator = createTimedPeaksAccumulator();
  let decodedChunks = 0;
  let failedChunks = 0;

  const handle = async (chunk: Mp3Chunk) => {
    const format = chunker.format;
    if (!format) return;
    const frameSeconds = format.samplesPerFrame / format.sampleRate;
    const from = chunk.firstFrame * frameSeconds;
    const to = (chunk.firstFrame + chunk.frameCount) * frameSeconds;
    const start = (chunk.firstFrame - chunk.leadFrames) * frameSeconds;
    let decoded: AudioBuffer;
    try {
      decoded = await decode(chunk.bytes);
    } catch {
      failedChunks += 1;
      return;
    }
    decodedChunks += 1;
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    for (let offset = 0; offset < decoded.length; offset += PUSH_CHUNK_FRAMES) {
      const end = Math.min(decoded.length, offset + PUSH_CHUNK_FRAMES);
      accumulator.push(
        channels.map((channel) => channel.subarray(offset, end)),
        decoded.sampleRate,
        start + offset / decoded.sampleRate,
        from,
        to,
      );
    }
    await yieldToUi();
  };

  for await (const block of blocks) {
    if (signal?.aborted) throw new RetryableError("aborted");
    for (const chunk of chunker.push(block)) await handle(chunk);
  }
  for (const chunk of chunker.finish()) await handle(chunk);
  const duration = chunker.durationSeconds;
  if (decodedChunks === 0 || failedChunks > decodedChunks || !(duration > 0)) return { ok: false, retry: false };
  return { ok: true, peaks: accumulator.finish(duration), complete: failedChunks === 0 };
}

/** 한 번에 디코딩한다(MP3가 아닌 형식). */
async function computeWholeFilePeaks(encoded: ArrayBuffer, signal?: AbortSignal): Promise<ComputePeaksResult> {
  let decoded: AudioBuffer;
  try {
    decoded = await createDecodeContext().decodeAudioData(encoded);
  } catch {
    return { ok: false, retry: false };
  }
  if (signal?.aborted) return { ok: false, retry: true };
  if (decoded.duration <= 0) return { ok: false, retry: false };
  const accumulator = createPeaksAccumulator(decoded.length);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
  for (let start = 0; start < decoded.length; start += PUSH_CHUNK_FRAMES) {
    const end = Math.min(decoded.length, start + PUSH_CHUNK_FRAMES);
    accumulator.push(channels.map((channel) => channel.subarray(start, end)));
    // 긴 계산이 화면을 멈추지 않게 조각마다 양보한다.
    if ((start / PUSH_CHUNK_FRAMES) % 8 === 7) await yieldToUi();
  }
  return { ok: true, peaks: accumulator.finish(decoded.duration), complete: true };
}

/** 상한까지만 모은다. 넘으면 null. */
async function readWithLimit(blocks: AsyncIterable<Uint8Array>, limit: number): Promise<ArrayBuffer | null> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const block of blocks) {
    total += block.byteLength;
    if (total > limit) return null;
    parts.push(block);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes.buffer;
}

async function prefix(blocks: AsyncGenerator<Uint8Array>): Promise<{ head: Uint8Array | null; rest: AsyncGenerator<Uint8Array> }> {
  const first = await blocks.next();
  const head = first.done ? null : first.value;
  async function* rest() {
    if (head) yield head;
    yield* blocks;
  }
  return { head, rest: rest() };
}

/** 오디오 주소에서 파형을 만든다. 기기 확인은 호출부가 먼저 한다(`canComputePeaksOnThisDevice`). */
export async function computeAudioPeaksFromUrl(url: string, signal?: AbortSignal): Promise<ComputePeaksResult> {
  try {
    const response = await fetch(url, { credentials: "same-origin", headers: { Range: `bytes=0-${READ_BLOCK_BYTES - 1}` }, signal });
    if (!response.ok) return { ok: false, retry: true };
    const declared = response.status === 206 ? totalFromContentRange(response.headers.get("content-range")) : Number(response.headers.get("content-length") ?? "0");
    const { head, rest } = await prefix(readUrlInBlocks(response, url, signal));
    if (!head) return { ok: false, retry: false };
    if (isMpegType(response.headers.get("content-type")) || looksLikeMp3(head)) return await computeMp3PeaksFromBlocks(rest, signal);
    if (declared && declared > AUDIO_PEAKS_DECODE_MAX_BYTES) {
      await rest.return(undefined).catch(() => undefined); // 받던 본문을 닫는다.
      return { ok: false, retry: false };
    }
    const encoded = await readWithLimit(rest, AUDIO_PEAKS_DECODE_MAX_BYTES);
    if (!encoded) return { ok: false, retry: false };
    return await computeWholeFilePeaks(encoded, signal);
  } catch (error) {
    // 네트워크·중단은 다시 해 볼 만하다. 그 밖(디코더 예외 등)은 이 파일의 문제로 본다.
    return { ok: false, retry: error instanceof RetryableError || (error instanceof Error && (error.name === "AbortError" || error.name === "TypeError")) };
  }
}

/** 로컬 MP3 파일에서 파형을 만든다(업로드 직후, 네트워크 없음). MP3가 아니면 실패. */
export async function computeMp3PeaksFromFile(file: Blob, signal?: AbortSignal): Promise<ComputePeaksResult> {
  try {
    const { head, rest } = await prefix(readFileInBlocks(file, signal));
    if (!head || !looksLikeMp3(head)) return { ok: false, retry: false };
    return await computeMp3PeaksFromBlocks(rest, signal);
  } catch (error) {
    return { ok: false, retry: error instanceof RetryableError };
  }
}

/** MP3 파일인지(형식 또는 확장자). */
export function isMp3File(file: { name: string; type: string }): boolean {
  return isMpegType(file.type) || /\.mp3$/i.test(file.name);
}

/**
 * 그대로 올린 MP3의 파형을 로컬 파일로 만들어 저장한다(업로드 완료 직후, fire-and-forget).
 * 기다리지 않으며 실패해도 업로드·게시를 막지 않는다. 메모리가 작은 기기는 건너뛰고(첫 재생 때도 만들지 않는다),
 * 디코딩은 재생 화면과 같은 직렬 큐에서 돈다. 돌려주는 Promise는 테스트용이며 reject하지 않는다.
 */
export function savePeaksForUploadedMp3(
  file: File,
  mediaObjectId: string,
  save: (peaks: AudioPeaks, mediaObjectId: string) => Promise<boolean> = onAudioPrepared,
): Promise<boolean> {
  if (!mediaObjectId || !isMp3File(file) || !canComputePeaksOnThisDevice()) return Promise.resolve(false);
  return enqueuePeaksDecode(() => computeMp3PeaksFromFile(file))
    .then((result) => (result.ok && result.complete ? save(result.peaks, mediaObjectId) : false))
    .catch(() => false);
}
