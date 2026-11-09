import assert from "node:assert/strict";
import test from "node:test";
import { createMp3Encoder } from "wasm-media-encoders";
import { AUDIO_PEAKS_COUNT, parseAudioPeaks } from "./peaks";
import { blobByteReader, parsePcmHeader, readExtended80, UnsupportedAudioFormatError } from "./pcm-header";
import { decodePcmChunk, pcmChunkRanges } from "./pcm-stream";
import { estimateMp3Bytes, selectMp3Bitrate } from "./mp3-bitrate";
import { parseFlacStreamInfo } from "./flac-info";
import { AudioTooLongError, createPcmFileSource, encodeSourceToMp3, maxSourceFrames, MAX_SOURCE_DURATION_SEC, type Mp3EncoderLike, type PcmSource } from "./mp3-encode";
import {
  DECODE_FALLBACK_MAX_BYTES,
  DECODE_FALLBACK_MAX_PCM_BYTES,
  estimateRemainingSeconds,
  formatRemaining,
  losslessAudioKind,
  mp3FileName,
  transferableChannels,
} from "./prepare-upload";

const MAX = 95 * 1024 * 1024;

function ascii(text: string) {
  return Array.from(text, (char) => char.charCodeAt(0));
}

/** 정수·실수 PCM WAV를 만든다. samples[frame][channel] (-1~1). */
function makeWav(samples: number[][], sampleRate: number, bits: 16 | 24 | 32, float = false, padChunk = false): Uint8Array {
  const channels = samples[0]!.length;
  const bytesPerSample = bits / 8;
  const dataBytes = samples.length * channels * bytesPerSample;
  const extra = padChunk ? 8 + 3 + 1 : 0; // 홀수 길이 LIST chunk + padding
  const out = new Uint8Array(44 + extra + dataBytes);
  const dv = new DataView(out.buffer);
  out.set(ascii("RIFF"), 0);
  dv.setUint32(4, out.length - 8, true);
  out.set(ascii("WAVE"), 8);
  let at = 12;
  if (padChunk) {
    out.set(ascii("LIST"), at);
    dv.setUint32(at + 4, 3, true);
    at += 12;
  }
  out.set(ascii("fmt "), at);
  dv.setUint32(at + 4, 16, true);
  dv.setUint16(at + 8, float ? 3 : 1, true);
  dv.setUint16(at + 10, channels, true);
  dv.setUint32(at + 12, sampleRate, true);
  dv.setUint32(at + 16, sampleRate * channels * bytesPerSample, true);
  dv.setUint16(at + 20, channels * bytesPerSample, true);
  dv.setUint16(at + 22, bits, true);
  at += 24;
  out.set(ascii("data"), at);
  dv.setUint32(at + 4, dataBytes, true);
  at += 8;
  for (const frame of samples) {
    for (const value of frame) {
      if (float) dv.setFloat32(at, value, true);
      else if (bits === 16) dv.setInt16(at, Math.round(value * 32767), true);
      else if (bits === 24) {
        const int = Math.round(value * 8388607);
        out[at] = int & 0xff;
        out[at + 1] = (int >> 8) & 0xff;
        out[at + 2] = (int >> 16) & 0xff;
      } else dv.setInt32(at, Math.round(value * 2147483647), true);
      at += bytesPerSample;
    }
  }
  return out;
}

function extended80(value: number): number[] {
  const exponent = Math.floor(Math.log2(value));
  const mantissa = value / 2 ** exponent; // 1 <= m < 2
  const hi = Math.floor(mantissa * 2 ** 31);
  const bytes = new Uint8Array(10);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, exponent + 16383, false);
  dv.setUint32(2, hi, false);
  dv.setUint32(6, 0, false);
  return Array.from(bytes);
}

/** big-endian AIFF(또는 AIFF-C sowt) 24·16비트 */
function makeAiff(samples: number[][], sampleRate: number, bits: 16 | 24, sowt = false): Uint8Array {
  const channels = samples[0]!.length;
  const bps = bits / 8;
  const dataBytes = samples.length * channels * bps;
  const commSize = sowt ? 18 + 4 + 2 : 18;
  const total = 12 + 8 + commSize + 8 + 8 + dataBytes;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(ascii("FORM"), 0);
  dv.setUint32(4, total - 8, false);
  out.set(ascii(sowt ? "AIFC" : "AIFF"), 8);
  out.set(ascii("COMM"), 12);
  dv.setUint32(16, commSize, false);
  dv.setUint16(20, channels, false);
  dv.setUint32(22, samples.length, false);
  dv.setUint16(26, bits, false);
  out.set(extended80(sampleRate), 28);
  if (sowt) {
    out.set(ascii("sowt"), 38);
    out[42] = 0; // 빈 pascal string + pad
  }
  let at = 20 + commSize;
  out.set(ascii("SSND"), at);
  dv.setUint32(at + 4, 8 + dataBytes, false);
  at += 16;
  for (const frame of samples) {
    for (const value of frame) {
      const int = Math.round(value * (bits === 16 ? 32767 : 8388607));
      if (bits === 16) dv.setInt16(at, int, sowt);
      else {
        const b = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
        out.set(sowt ? b.reverse() : b, at);
      }
      at += bps;
    }
  }
  return out;
}

const FRAMES: number[][] = [[0.5, -0.5], [-1, 1], [0.25, 0], [0, -0.25]];

function near(actual: number, expected: number, epsilon = 1e-3) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
}

async function decodeAll(bytes: Uint8Array) {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
  const header = await parsePcmHeader(blobByteReader(blob), blob.size);
  const data = bytes.subarray(header.dataOffset, header.dataOffset + header.dataBytes);
  return { header, channels: decodePcmChunk(data, header) };
}

test("WAV 머리글: 16·24·32비트 정수와 32비트 실수, 홀수 길이 chunk 건너뛰기", async () => {
  for (const [bits, float] of [[16, false], [24, false], [32, false], [32, true]] as const) {
    const { header, channels } = await decodeAll(makeWav(FRAMES, 48000, bits, float, true));
    assert.equal(header.container, "wav");
    assert.equal(header.sampleRate, 48000);
    assert.equal(header.channels, 2);
    assert.equal(header.frames, FRAMES.length);
    assert.equal(header.sampleFormat, float ? "float" : "int");
    near(channels[0]![0]!, 0.5);
    near(channels[1]![1]!, 1);
    near(channels[0]![1]!, -1);
    near(channels[1]![3]!, -0.25);
  }
});

test("AIFF 머리글: big-endian 24비트와 AIFF-C sowt(little-endian) 16비트, 80비트 샘플레이트", async () => {
  const be = await decodeAll(makeAiff(FRAMES, 44100, 24));
  assert.equal(be.header.container, "aiff");
  assert.equal(be.header.littleEndian, false);
  assert.equal(be.header.sampleRate, 44100);
  assert.equal(be.header.frames, FRAMES.length);
  near(be.channels[0]![0]!, 0.5);
  near(be.channels[0]![1]!, -1);
  near(be.channels[1]![3]!, -0.25);
  const sowt = await decodeAll(makeAiff(FRAMES, 96000, 16, true));
  assert.equal(sowt.header.littleEndian, true);
  assert.equal(sowt.header.sampleRate, 96000);
  near(sowt.channels[1]![1]!, 1);
  near(readExtended80(new Uint8Array(extended80(22050))), 22050, 1e-9);
});

test("지원하지 않는 머리글은 UnsupportedAudioFormatError", async () => {
  const blob = new Blob([new Uint8Array(64)]);
  await assert.rejects(parsePcmHeader(blobByteReader(blob), blob.size), UnsupportedAudioFormatError);
});

test("PCM 조각은 프레임 경계에 맞고 구간을 빠짐없이 덮는다", () => {
  const ranges = [...pcmChunkRanges(44, 6 * 1000 + 5, 6, 1024)];
  assert.equal(ranges[0]!.start, 44);
  for (const range of ranges) {
    assert.equal((range.end - range.start) % 6, 0);
    assert.ok(range.end - range.start <= 1024);
  }
  for (let index = 1; index < ranges.length; index += 1) assert.equal(ranges[index]!.start, ranges[index - 1]!.end);
  assert.equal(ranges.at(-1)!.end, 44 + 6000, "남는 반쪽 프레임은 버린다.");
  assert.deepEqual([...pcmChunkRanges(0, 3, 4, 1024)], []);
  // 목표보다 큰 프레임도 한 프레임씩은 나간다.
  assert.deepEqual([...pcmChunkRanges(0, 16, 8, 4)], [{ start: 0, end: 8 }, { start: 8, end: 16 }]);
});

test("비트레이트는 95MB 안에 들도록 192부터 낮춘다", () => {
  assert.equal(selectMp3Bitrate(60 * 60, MAX), 192);
  assert.equal(selectMp3Bitrate(65 * 60, MAX), 192);
  assert.equal(selectMp3Bitrate(75 * 60, MAX), 160);
  assert.equal(selectMp3Bitrate(100 * 60, MAX), 128);
  assert.equal(selectMp3Bitrate(120 * 60, MAX), 96);
  assert.equal(selectMp3Bitrate(10 * 60 * 60, MAX), null);
  assert.equal(selectMp3Bitrate(0, MAX), null);
  for (const minutes of [30, 69, 70, 90, 150, 200]) {
    const bitrate = selectMp3Bitrate(minutes * 60, MAX);
    if (bitrate) assert.ok(estimateMp3Bytes(minutes * 60, bitrate) <= MAX);
  }
});

test("FLAC STREAMINFO에서 샘플레이트·채널·전체 프레임 수를 읽는다", () => {
  const bytes = new Uint8Array(42);
  bytes.set(ascii("fLaC"), 0);
  bytes[4] = 0x80; // last block, STREAMINFO
  bytes[7] = 34;
  // 44100Hz = 0x0AC44, 2ch, 16bit, totalFrames 0x1_0000_0005
  const s = 8;
  bytes[s + 10] = 0x0a;
  bytes[s + 11] = 0xc4;
  bytes[s + 12] = (0x4 << 4) | (1 << 1) | 0; // rate low nibble, channels-1=1, bps-1 high bit 0
  bytes[s + 13] = (15 << 4) | 0x1; // bps-1 low 4 = 15, total high nibble 1
  bytes[s + 17] = 5;
  assert.deepEqual(parseFlacStreamInfo(bytes), { sampleRate: 44100, channels: 2, bitsPerSample: 16, totalFrames: 2 ** 32 + 5 });
  assert.throws(() => parseFlacStreamInfo(new Uint8Array(42)), UnsupportedAudioFormatError);
});

test("파일 종류 판별·이름·남은 시간 표시", () => {
  assert.equal(losslessAudioKind({ name: "set.WAV", type: "" }), "pcm");
  assert.equal(losslessAudioKind({ name: "set.aif", type: "" }), "pcm");
  assert.equal(losslessAudioKind({ name: "set.flac", type: "audio/flac" }), "flac");
  assert.equal(losslessAudioKind({ name: "noext", type: "audio/x-wav" }), "pcm");
  assert.equal(losslessAudioKind({ name: "set.mp3", type: "audio/mpeg" }), null);
  assert.equal(losslessAudioKind({ name: "set.m4a", type: "audio/mp4" }), null);
  assert.equal(mp3FileName("set-nov.wav"), "set-nov.mp3");
  assert.equal(mp3FileName("a.b.flac"), "a.b.mp3");
  assert.equal(estimateRemainingSeconds(1, 5000), null);
  assert.equal(estimateRemainingSeconds(42, 29000), 40);
  assert.equal(formatRemaining(40), "약 40초 남음");
  assert.equal(formatRemaining(185), "약 3분 남음");
});

test("작은 WAV를 실제 MP3로 인코딩하고 파형 1000개를 만든다", async () => {
  const rate = 44100;
  const seconds = 3;
  const frames = Array.from({ length: rate * seconds }, (_, index) => {
    const value = Math.sin(index * 0.05) * (index / (rate * seconds));
    return [value, value * 0.5];
  });
  const wav = makeWav(frames, rate, 24);
  const source = await createPcmFileSource(new Blob([wav as Uint8Array<ArrayBuffer>]));
  const progress: number[] = [];
  const result = await encodeSourceToMp3(source, {
    createEncoder: () => createMp3Encoder() as Promise<Mp3EncoderLike>,
    maxBytes: MAX,
    onProgress: (percent) => progress.push(percent),
  });
  assert.equal(result.bitrateKbps, 192);
  near(result.durationSec, seconds, 1e-6);
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(result.blob.type, "audio/mpeg");
  // 첫 MP3 프레임 sync: 11비트 1, MPEG-1 Layer III
  const first = bytes.findIndex((byte, index) => byte === 0xff && ((bytes[index + 1] ?? 0) & 0xe0) === 0xe0);
  assert.ok(first >= 0, "MP3 프레임 sync가 있다.");
  assert.equal((bytes[first + 1]! >> 3) & 0x03, 0x03, "MPEG-1");
  assert.equal((bytes[first + 1]! >> 1) & 0x03, 0x01, "Layer III");
  near(bytes.length, (192000 / 8) * seconds, 192000 / 8 * 0.3);
  assert.equal(result.peaks.peaks.length, AUDIO_PEAKS_COUNT);
  assert.equal(parseAudioPeaks(result.peaks).ok, true);
  assert.ok(result.peaks.peaks[AUDIO_PEAKS_COUNT - 1]! > result.peaks.peaks[10]!, "점점 커지는 소리는 뒤 파형이 더 크다.");
  assert.equal(progress.at(-1), 100);
});

test("취소 신호가 오면 AbortError로 멈춘다", async () => {
  const wav = makeWav(Array.from({ length: 44100 }, () => [0.1, 0.1]), 44100, 16);
  const source = await createPcmFileSource(new Blob([wav as Uint8Array<ArrayBuffer>]));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    encodeSourceToMp3(source, { createEncoder: () => createMp3Encoder() as Promise<Mp3EncoderLike>, maxBytes: MAX, signal: controller.signal }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );
});

/** 머리글에는 1초라고 적고 실제로는 조각을 `count`개 내는 원본과, 호출마다 정해진 바이트를 내는 가짜 인코더. */
function lyingSource(framesPerChunk: number, count: number, pulled: { count: number }): PcmSource {
  const rate = 44100;
  return {
    sampleRate: rate,
    channels: 1,
    totalFrames: rate,
    async *chunks() {
      for (let index = 0; index < count; index++) {
        pulled.count += 1;
        yield [new Float32Array(framesPerChunk).fill(0.1)];
      }
    },
  };
}

function fakeEncoder(bytesPerCall: number, calls: { count: number }): () => Promise<Mp3EncoderLike> {
  return async () => ({
    configure() {},
    encode() {
      calls.count += 1;
      return new Uint8Array(bytesPerCall);
    },
    finalize: () => new Uint8Array(0),
  });
}

test("출력이 maxBytes를 넘는 순간 남은 조각을 읽지 않고 too-long으로 멈춘다", async () => {
  const pulled = { count: 0 };
  const calls = { count: 0 };
  // 1초라고 적힌 원본이 조각 200개(조각마다 1,000바이트 출력)를 낸다. 상한 100,000바이트.
  await assert.rejects(
    encodeSourceToMp3(lyingSource(100, 200, pulled), { createEncoder: fakeEncoder(1000, calls), maxBytes: 100_000 }),
    (error: unknown) => error instanceof AudioTooLongError,
  );
  assert.equal(calls.count, 101, "101번째 조각에서 상한을 넘자마자 멈춘다");
  assert.equal(pulled.count, 101, "그 뒤 조각은 읽지 않는다");
});

test("머리글 길이(+여유)보다 프레임이 많이 나오면 인코딩하기 전에 too-long으로 멈춘다", async () => {
  const pulled = { count: 0 };
  const calls = { count: 0 };
  const source = lyingSource(44100, 200, pulled);
  assert.equal(maxSourceFrames(source), Math.ceil(44100 * 1.02) + 44100);
  await assert.rejects(
    encodeSourceToMp3(source, { createEncoder: fakeEncoder(10, calls), maxBytes: MAX }),
    (error: unknown) => error instanceof AudioTooLongError,
  );
  assert.equal(pulled.count, 3, "세 번째 조각(3초)에서 상한(약 2.02초)을 넘는다");
  assert.equal(calls.count, 2, "넘친 조각은 인코딩하지 않는다");
  // 머리글이 아주 길어도 절대 상한을 넘지 않는다.
  assert.equal(maxSourceFrames({ sampleRate: 48000, totalFrames: 48000 * 10 * 60 * 60 }), 48000 * MAX_SOURCE_DURATION_SEC);
});

test("대체 디코딩 채널은 자기 버퍼 전체를 쓰면 복사 없이 넘기고, 나눠 쓰는 버퍼만 복사한다", () => {
  const left = new Float32Array([0.1, 0.2]);
  const right = new Float32Array([0.3, 0.4]);
  const own = transferableChannels([left, right]);
  assert.equal(own.channelData[0], left, "복사하지 않는다");
  assert.equal(own.channelData[1], right);
  assert.deepEqual(own.transfer, [left.buffer, right.buffer]);

  const shared = new Float32Array(4);
  const a = shared.subarray(0, 2);
  const b = shared.subarray(2, 4);
  const mixed = transferableChannels([a, b]);
  assert.notEqual(mixed.channelData[0], a, "일부만 쓰는 view는 복사한다");
  assert.equal(new Set(mixed.transfer).size, mixed.transfer.length, "같은 버퍼를 두 번 넘기지 않는다");
});

test("대체 디코딩 상한: 4bit ADPCM 최악(원본의 8배) + 원본이 200MB 안에 든다", () => {
  assert.ok(DECODE_FALLBACK_MAX_BYTES * 8 + DECODE_FALLBACK_MAX_BYTES <= 200 * 1024 * 1024);
  assert.ok(DECODE_FALLBACK_MAX_PCM_BYTES + DECODE_FALLBACK_MAX_BYTES <= 200 * 1024 * 1024);
});
