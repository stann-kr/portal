/**
 * @file src/lib/audio/pcm-header.ts
 * @description WAV(RIFF)·AIFF/AIFF-C 머리글만 읽어 PCM 데이터의 위치와 형식을 알아낸다.
 * 파일 전체를 읽지 않고 chunk 머리글(8바이트)만 차례로 읽는다. 지원하지 않는 형식이면
 * `UnsupportedAudioFormatError`를 던져 호출부가 다른 경로(짧은 파일 전체 디코드)를 고르게 한다.
 */

export type PcmSampleFormat = "int" | "float";

export type PcmHeader = {
  container: "wav" | "aiff";
  sampleRate: number;
  channels: number;
  /** 한 샘플이 차지하는 바이트 수(컨테이너 기준). */
  bytesPerSample: number;
  sampleFormat: PcmSampleFormat;
  littleEndian: boolean;
  /** 8비트 WAV는 부호 없는 값(128 = 0)이다. */
  unsigned8: boolean;
  /** 한 프레임(모든 채널 한 샘플씩)의 바이트 수. */
  blockAlign: number;
  dataOffset: number;
  /** blockAlign 배수로 내린 PCM 바이트 수. */
  dataBytes: number;
  frames: number;
};

export class UnsupportedAudioFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedAudioFormatError";
  }
}

/** offset부터 length바이트를 읽는다(파일 끝을 넘으면 짧게 돌려준다). */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

export function blobByteReader(blob: Blob): ByteReader {
  return async (offset, length) => new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + length)).arrayBuffer());
}

const MAX_HEADER_CHUNKS = 256;

function fourcc(bytes: Uint8Array, at = 0) {
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function parsePcmHeader(read: ByteReader, fileSize: number): Promise<PcmHeader> {
  const head = await read(0, 12);
  if (head.length < 12) throw new UnsupportedAudioFormatError("파일이 너무 짧습니다.");
  const id = fourcc(head);
  if (id === "RIFF" && fourcc(head, 8) === "WAVE") return parseWav(read, fileSize);
  if (id === "FORM" && (fourcc(head, 8) === "AIFF" || fourcc(head, 8) === "AIFC")) {
    return parseAiff(read, fileSize, fourcc(head, 8) === "AIFC");
  }
  throw new UnsupportedAudioFormatError("WAV·AIFF 머리글이 아닙니다.");
}

type WavFormat = { channels: number; sampleRate: number; blockAlign: number; bitsPerSample: number; formatTag: number };

async function parseWav(read: ByteReader, fileSize: number): Promise<PcmHeader> {
  let offset = 12;
  let fmt: WavFormat | null = null;
  for (let index = 0; index < MAX_HEADER_CHUNKS && offset + 8 <= fileSize; index += 1) {
    const chunkHead = await read(offset, 8);
    if (chunkHead.length < 8) break;
    const chunkId = fourcc(chunkHead);
    const chunkSize = view(chunkHead).getUint32(4, true);
    const body = offset + 8;
    if (chunkId === "fmt ") {
      const bytes = await read(body, Math.min(chunkSize, 40));
      if (bytes.length < 16) throw new UnsupportedAudioFormatError("fmt 머리글이 짧습니다.");
      const dv = view(bytes);
      let formatTag = dv.getUint16(0, true);
      if (formatTag === 0xfffe && bytes.length >= 26) formatTag = dv.getUint16(24, true);
      fmt = {
        formatTag,
        channels: dv.getUint16(2, true),
        sampleRate: dv.getUint32(4, true),
        blockAlign: dv.getUint16(12, true),
        bitsPerSample: dv.getUint16(14, true),
      };
    } else if (chunkId === "data") {
      if (!fmt) throw new UnsupportedAudioFormatError("fmt 머리글보다 data가 먼저 나왔습니다.");
      // 녹음 중 끊긴 파일은 크기가 0 또는 0xFFFFFFFF일 수 있다. 실제 파일 끝까지로 줄인다.
      const available = fileSize - body;
      const declared = chunkSize === 0 || chunkSize === 0xffffffff ? available : Math.min(chunkSize, available);
      return buildWavHeader(fmt, body, declared);
    }
    offset = body + chunkSize + (chunkSize % 2);
  }
  throw new UnsupportedAudioFormatError("WAV data 구간을 찾지 못했습니다.");
}

function buildWavHeader(fmt: WavFormat, dataOffset: number, declaredBytes: number): PcmHeader {
  const { formatTag, channels, sampleRate, bitsPerSample } = fmt;
  let sampleFormat: PcmSampleFormat;
  if (formatTag === 1 && [8, 16, 24, 32].includes(bitsPerSample)) sampleFormat = "int";
  else if (formatTag === 3 && (bitsPerSample === 32 || bitsPerSample === 64)) sampleFormat = "float";
  else throw new UnsupportedAudioFormatError(`지원하지 않는 WAV 형식(${formatTag}, ${bitsPerSample}bit)입니다.`);
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = bytesPerSample * channels;
  return finishHeader({
    container: "wav",
    sampleRate,
    channels,
    bytesPerSample,
    sampleFormat,
    littleEndian: true,
    unsigned8: bitsPerSample === 8,
    blockAlign,
    dataOffset,
    dataBytes: declaredBytes,
  });
}

/** IEEE 754 80비트 확장 정밀도(AIFF COMM의 sampleRate). */
export function readExtended80(bytes: Uint8Array, at = 0): number {
  const dv = view(bytes);
  const signExp = dv.getUint16(at, false);
  const hi = dv.getUint32(at + 2, false);
  const lo = dv.getUint32(at + 6, false);
  if (signExp === 0 && hi === 0 && lo === 0) return 0;
  const sign = signExp & 0x8000 ? -1 : 1;
  const exponent = (signExp & 0x7fff) - 16383;
  return sign * (hi * 2 ** (exponent - 31) + lo * 2 ** (exponent - 63));
}

async function parseAiff(read: ByteReader, fileSize: number, isAifc: boolean): Promise<PcmHeader> {
  let offset = 12;
  let comm: { channels: number; frames: number; bits: number; sampleRate: number; compression: string } | null = null;
  let ssnd: { dataOffset: number; available: number } | null = null;
  for (let index = 0; index < MAX_HEADER_CHUNKS && offset + 8 <= fileSize; index += 1) {
    const chunkHead = await read(offset, 8);
    if (chunkHead.length < 8) break;
    const chunkId = fourcc(chunkHead);
    const chunkSize = view(chunkHead).getUint32(4, false);
    const body = offset + 8;
    if (chunkId === "COMM") {
      const bytes = await read(body, Math.min(chunkSize, 64));
      if (bytes.length < 18) throw new UnsupportedAudioFormatError("COMM 머리글이 짧습니다.");
      const dv = view(bytes);
      comm = {
        channels: dv.getUint16(0, false),
        frames: dv.getUint32(2, false),
        bits: dv.getUint16(6, false),
        sampleRate: readExtended80(bytes, 8),
        compression: isAifc && bytes.length >= 22 ? fourcc(bytes, 18) : "NONE",
      };
    } else if (chunkId === "SSND") {
      const bytes = await read(body, 8);
      const ssndOffset = bytes.length >= 4 ? view(bytes).getUint32(0, false) : 0;
      const dataOffset = body + 8 + ssndOffset;
      ssnd = { dataOffset, available: Math.max(0, Math.min(body + chunkSize, fileSize) - dataOffset) };
    }
    if (comm && ssnd) break;
    offset = body + chunkSize + (chunkSize % 2);
  }
  if (!comm || !ssnd) throw new UnsupportedAudioFormatError("AIFF COMM·SSND 구간을 찾지 못했습니다.");
  const { compression, bits } = comm;
  let sampleFormat: PcmSampleFormat = "int";
  let littleEndian = false;
  let bytesPerSample = Math.ceil(bits / 8);
  if (compression === "NONE" || compression === "twos") {
    // 기본 AIFF: 부호 있는 big-endian 정수.
  } else if (compression === "sowt") {
    littleEndian = true;
  } else if (compression === "fl32" || compression === "FL32") {
    sampleFormat = "float";
    bytesPerSample = 4;
  } else if (compression === "fl64" || compression === "FL64") {
    sampleFormat = "float";
    bytesPerSample = 8;
  } else {
    throw new UnsupportedAudioFormatError(`지원하지 않는 AIFF-C 압축(${compression})입니다.`);
  }
  if (sampleFormat === "int" && ![1, 2, 3, 4].includes(bytesPerSample)) {
    throw new UnsupportedAudioFormatError(`지원하지 않는 AIFF 비트 수(${bits})입니다.`);
  }
  const blockAlign = bytesPerSample * comm.channels;
  return finishHeader({
    container: "aiff",
    sampleRate: comm.sampleRate,
    channels: comm.channels,
    bytesPerSample,
    sampleFormat,
    littleEndian,
    unsigned8: false,
    blockAlign,
    dataOffset: ssnd.dataOffset,
    dataBytes: Math.min(ssnd.available, comm.frames * blockAlign),
  });
}

function finishHeader(header: Omit<PcmHeader, "frames">): PcmHeader {
  if (!Number.isFinite(header.sampleRate) || header.sampleRate < 8000 || header.sampleRate > 384000) {
    throw new UnsupportedAudioFormatError("샘플레이트가 올바르지 않습니다.");
  }
  if (header.channels < 1 || header.channels > 32 || header.blockAlign <= 0) {
    throw new UnsupportedAudioFormatError("채널 수가 올바르지 않습니다.");
  }
  const frames = Math.floor(Math.max(0, header.dataBytes) / header.blockAlign);
  if (frames <= 0) throw new UnsupportedAudioFormatError("소리 데이터가 없습니다.");
  return { ...header, dataBytes: frames * header.blockAlign, frames };
}
