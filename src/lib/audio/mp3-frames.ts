/**
 * @file src/lib/audio/mp3-frames.ts
 * @description MP3(MPEG-1/2/2.5 Layer III) 바이트를 frame 경계에서 끊어 작은 조각으로 나누는 순수 helper.
 * 긴 믹스셋 파형을 파일 전체를 메모리에 올리지 않고 조각마다 디코딩하려고 쓴다(브라우저 API 없음, Node에서 테스트한다).
 *
 * - 앞의 ID3v2 태그는 받는 대로 버린다(표지 그림이 커도 모아 두지 않는다).
 * - 첫 frame이 Xing/Info/VBRI 머리 frame이면 소리가 아니므로 버리고 개수에도 넣지 않는다.
 * - frame 머리가 깨진 곳은 다음 올바른 frame(같은 version·layer·sample rate, 이어지는 frame도 올바름)까지 건너뛴다.
 *   끝의 ID3v1·APE 태그 같은 남은 바이트는 버린다.
 * - 조각마다 앞 조각의 마지막 frame 몇 개(lead)를 붙인다. Layer III는 앞 frame의 bit reservoir·MDCT 겹침을
 *   쓰므로 조각 첫 frame이 깨지지 않게 하려는 것이며, 디코딩한 lead 구간은 파형에 넣지 않는다.
 * 전체 길이는 센 frame 수 × frame당 표본 수 ÷ sample rate로 정확히 나온다(CBR·VBR 모두).
 */

export type Mp3FrameHeader = {
  /** 1 = MPEG-1, 2 = MPEG-2, 2.5 = MPEG-2.5 */
  version: 1 | 2 | 2.5;
  sampleRate: number;
  bitrateKbps: number;
  samplesPerFrame: number;
  frameLength: number;
  channels: 1 | 2;
};

export type Mp3Chunk = {
  /** lead frame + 이 조각 frame의 바이트(디코더에 그대로 넘긴다). */
  bytes: Uint8Array;
  /** 앞에 붙인 lead frame 수(파형에는 넣지 않는다). */
  leadFrames: number;
  /** lead를 뺀 이 조각 첫 frame의 전체 순번(0부터). */
  firstFrame: number;
  /** lead를 뺀 frame 수. */
  frameCount: number;
};

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES_V1 = [44100, 48000, 32000];

/** `offset`의 4바이트를 Layer III frame 머리로 읽는다. 아니면 null(free format·예약 값도 거절). */
export function parseMp3FrameHeader(bytes: Uint8Array, offset: number): Mp3FrameHeader | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  if (versionBits === 0x01 || layerBits !== 0x01) return null; // 예약 version, Layer III만
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 0x03) return null;
  if ((b3 & 0x03) === 0x02) return null; // 예약 emphasis
  const version: 1 | 2 | 2.5 = versionBits === 0x03 ? 1 : versionBits === 0x02 ? 2 : 2.5;
  const divisor = version === 1 ? 1 : version === 2 ? 2 : 4;
  const sampleRate = SAMPLE_RATES_V1[sampleRateIndex] / divisor;
  const bitrateKbps = (version === 1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex];
  const padding = (b2 >> 1) & 0x01;
  const samplesPerFrame = version === 1 ? 1152 : 576;
  const frameLength = Math.floor(((samplesPerFrame / 8) * bitrateKbps * 1000) / sampleRate) + padding;
  const channels = ((b3 >> 6) & 0x03) === 0x03 ? 1 : 2;
  return { version, sampleRate, bitrateKbps, samplesPerFrame, frameLength, channels };
}

/** ID3v2 태그 전체 길이(머리 10바이트 + 본문 + footer). 태그가 아니면 0, 머리를 다 못 받았으면 null. */
export function id3v2TagLength(bytes: Uint8Array): number | null {
  if (bytes.length < 3) return bytes.length === 0 || matchesPrefix(bytes, [0x49, 0x44, 0x33]) ? null : 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // "ID3"
  if (bytes.length < 10) return null;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  const footer = bytes[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

function matchesPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  for (let i = 0; i < bytes.length && i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false;
  return true;
}

function hasTagAt(bytes: Uint8Array, offset: number, tag: string): boolean {
  if (offset + tag.length > bytes.length) return false;
  for (let i = 0; i < tag.length; i += 1) if (bytes[offset + i] !== tag.charCodeAt(i)) return false;
  return true;
}

/** frame이 Xing/Info/VBRI 머리 frame(소리 없음)인지. */
export function isVbrInfoFrame(bytes: Uint8Array, offset: number, header: Mp3FrameHeader): boolean {
  const sideInfo = header.version === 1 ? (header.channels === 1 ? 17 : 32) : header.channels === 1 ? 9 : 17;
  const xingOffset = offset + 4 + sideInfo;
  return hasTagAt(bytes, xingOffset, "Xing") || hasTagAt(bytes, xingOffset, "Info") || hasTagAt(bytes, offset + 36, "VBRI");
}

function sameStream(a: Mp3FrameHeader, b: Mp3FrameHeader): boolean {
  return a.version === b.version && a.sampleRate === b.sampleRate;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export type Mp3FrameChunkerOptions = {
  /** 조각 하나의 최대 바이트(lead 제외). 기본 4MB. */
  maxChunkBytes?: number;
  /** 조각 하나의 최대 길이(초, lead 제외). 기본 120초(디코더가 원래 sample rate로 한 번 푸는 순간 메모리를 묶는다). */
  maxChunkSeconds?: number;
  /** lead로 붙일 최소 바이트. 기본 1024(Layer III bit reservoir 최대 511바이트의 두 배). */
  leadMinBytes?: number;
};

const LEAD_MIN_FRAMES = 2;
const LEAD_MAX_FRAMES = 12;

/**
 * 바이트를 받는 대로 frame 경계에서 조각으로 나눈다. `push`가 다 찬 조각을, `finish`가 남은 조각을 돌려준다.
 * 들고 있는 바이트는 한 조각 + 들어온 덩어리 정도로 묶인다.
 */
export function createMp3FrameChunker(options: Mp3FrameChunkerOptions = {}) {
  const maxChunkBytes = options.maxChunkBytes ?? 4 * 1024 * 1024;
  const maxChunkSeconds = options.maxChunkSeconds ?? 120;
  const leadMinBytes = options.leadMinBytes ?? 1024;

  /** 아직 내보내지 않은 바이트. [0, scan)은 이번 조각의 완성 frame이다. */
  let buffer: Uint8Array = new Uint8Array(0);
  let scan = 0;
  let chunkFrames = 0;
  /** 이번 조각 frame의 길이 목록(lead 계산용). */
  let chunkFrameLengths: number[] = [];
  let id3Checked = false;
  let id3Skip = 0;
  let format: Mp3FrameHeader | null = null;
  let totalFrames = 0;
  let lead: Uint8Array = new Uint8Array(0);
  let leadFrames = 0;
  let ended = false;
  /** 깨진 바이트를 건너뛴 직후(다음 frame까지 확인한다). */
  let resyncing = false;

  function emit(): Mp3Chunk | null {
    if (chunkFrames === 0) return null;
    const frames = buffer.subarray(0, scan);
    const bytes0 = lead.length > 0 ? concat(lead, frames) : frames.slice();
    const chunk: Mp3Chunk = { bytes: bytes0, leadFrames, firstFrame: totalFrames - chunkFrames, frameCount: chunkFrames };
    // 다음 조각 lead: 끝에서부터 leadMinBytes를 넘을 때까지(2~12 frame).
    let take = 0;
    let bytes = 0;
    for (let i = chunkFrameLengths.length - 1; i >= 0 && take < LEAD_MAX_FRAMES; i -= 1) {
      if (take >= LEAD_MIN_FRAMES && bytes >= leadMinBytes) break;
      bytes += chunkFrameLengths[i];
      take += 1;
    }
    lead = frames.slice(frames.length - bytes);
    leadFrames = take;
    buffer = buffer.subarray(scan);
    scan = 0;
    chunkFrames = 0;
    chunkFrameLengths = [];
    return chunk;
  }

  /** [from, to) 바이트를 버린다(조각 안의 깨진 바이트). */
  function drop(from: number, to: number) {
    buffer = concat(buffer.subarray(0, from), buffer.subarray(to));
  }

  /** `offset`의 frame이 이 stream의 올바른 frame이고 다음 frame도 올바른지. 바이트가 모자라면 "more". */
  function validAt(offset: number, strictNext: boolean): Mp3FrameHeader | null | "more" {
    if (offset + 4 > buffer.length) return ended ? null : "more";
    const header = parseMp3FrameHeader(buffer, offset);
    if (!header || (format && !sameStream(format, header))) return null;
    if (!strictNext) return header;
    const next = offset + header.frameLength;
    if (next + 4 > buffer.length) return ended ? (next <= buffer.length ? header : null) : "more";
    const nextHeader = parseMp3FrameHeader(buffer, next);
    return nextHeader && sameStream(header, nextHeader) ? header : null;
  }

  function process(): Mp3Chunk[] {
    const out: Mp3Chunk[] = [];
    if (!id3Checked) {
      const tag = id3v2TagLength(buffer);
      if (tag === null && !ended) return out;
      id3Checked = true;
      id3Skip = tag ?? 0;
    }
    if (id3Skip > 0) {
      const skip = Math.min(id3Skip, buffer.length);
      buffer = buffer.subarray(skip);
      id3Skip -= skip;
      if (id3Skip > 0) return out;
    }
    for (;;) {
      // 깨진 곳 다음·첫 frame은 이어지는 frame까지 확인한다.
      const strict = format === null || resyncing;
      const result = validAt(scan, strict);
      if (result === "more") break;
      if (result === null) {
        // 다음 올바른 frame을 찾는다.
        let found = -1;
        let needMore = false;
        for (let p = scan + 1; p < buffer.length; p += 1) {
          if (buffer[p] !== 0xff) continue;
          const candidate = validAt(p, true);
          if (candidate === "more") {
            needMore = true;
            found = p;
            break;
          }
          if (candidate) {
            found = p;
            break;
          }
        }
        resyncing = true;
        if (found >= 0) {
          drop(scan, found);
          if (needMore) break;
          continue;
        }
        if (ended) {
          buffer = buffer.subarray(0, scan);
          break;
        }
        // 마지막 3바이트는 다음 덩어리와 이어 frame 머리가 될 수 있어 남긴다.
        drop(scan, Math.max(scan, buffer.length - 3));
        break;
      }
      const header = result;
      if (scan + header.frameLength > buffer.length) {
        if (ended) {
          buffer = buffer.subarray(0, scan);
          break;
        }
        break;
      }
      if (format === null) {
        format = header;
        if (isVbrInfoFrame(buffer, scan, header)) {
          drop(scan, scan + header.frameLength);
          continue;
        }
      }
      resyncing = false;
      scan += header.frameLength;
      chunkFrames += 1;
      chunkFrameLengths.push(header.frameLength);
      totalFrames += 1;
      const seconds = (chunkFrames * format.samplesPerFrame) / format.sampleRate;
      if (scan >= maxChunkBytes || seconds >= maxChunkSeconds) {
        const chunk = emit();
        if (chunk) out.push(chunk);
      }
    }
    return out;
  }

  return {
    push(data: Uint8Array): Mp3Chunk[] {
      if (ended) throw new Error("이미 끝난 chunker입니다.");
      buffer = concat(buffer, data);
      return process();
    },
    finish(): Mp3Chunk[] {
      ended = true;
      const out = process();
      const last = emit();
      if (last) out.push(last);
      buffer = new Uint8Array(0);
      lead = new Uint8Array(0);
      return out;
    },
    /** 첫 frame의 형식(아직 못 찾았으면 null). */
    get format(): Mp3FrameHeader | null {
      return format;
    },
    /** 지금까지 센 소리 frame 수(Xing 머리 frame 제외). */
    get totalFrames(): number {
      return totalFrames;
    },
    /** 지금까지 센 frame의 길이(초). */
    get durationSeconds(): number {
      return format ? (totalFrames * format.samplesPerFrame) / format.sampleRate : 0;
    },
  };
}

/** 앞 바이트가 MP3(ID3v2 태그 또는 Layer III frame 머리)로 시작하는지. */
export function looksLikeMp3(bytes: Uint8Array): boolean {
  if (hasTagAt(bytes, 0, "ID3")) return true;
  return parseMp3FrameHeader(bytes, 0) !== null;
}
