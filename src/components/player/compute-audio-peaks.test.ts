import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_PEAKS_COUNT } from "@/lib/audio/peaks";
import { parseMp3FrameHeader } from "@/lib/audio/mp3-frames";
import { computeAudioPeaksFromUrl, computeMp3PeaksFromFile, isMp3File } from "./compute-audio-peaks";

// Node에는 decodeAudioData가 없으므로, 조각 바이트의 frame을 세어 frame 본문 값(진폭)으로 채운 가짜 AudioBuffer를 돌려준다.
// 실제 MP3 디코딩·브라우저 메모리는 이 테스트가 확인하지 않는다(브라우저 확인 필요).
const FRAME_LENGTH = 417; // MPEG-1 Layer III 128kbps 44.1kHz
const SAMPLES_PER_FRAME = 1152;

function mp3Stream(frameCount: number, amplitudeByte: (index: number) => number): Uint8Array {
  const bytes = new Uint8Array(frameCount * FRAME_LENGTH);
  for (let index = 0; index < frameCount; index += 1) {
    const offset = index * FRAME_LENGTH;
    bytes.fill(amplitudeByte(index), offset, offset + FRAME_LENGTH);
    bytes.set([0xff, 0xfb, 0x90, 0x00], offset);
  }
  return bytes;
}

type DecodeCall = { frames: number };

function installFakeAudio(calls: DecodeCall[], failEvery = 0) {
  class FakeOfflineAudioContext {
    constructor(_channels: number, _length: number, readonly sampleRate: number) {}
    async decodeAudioData(buffer: ArrayBuffer) {
      const bytes = new Uint8Array(buffer);
      const amplitudes: number[] = [];
      for (let offset = 0; offset < bytes.length; ) {
        const header = parseMp3FrameHeader(bytes, offset);
        if (!header) throw new Error("frame 경계가 아님");
        amplitudes.push(bytes[offset + 10] / 255);
        offset += header.frameLength;
      }
      calls.push({ frames: amplitudes.length });
      if (failEvery && calls.length % failEvery === 0) throw new DOMException("bad", "EncodingError");
      const perFrame = (SAMPLES_PER_FRAME * this.sampleRate) / 44100;
      const length = Math.round(amplitudes.length * perFrame);
      const data = new Float32Array(length);
      for (let i = 0; i < length; i += 1) data[i] = amplitudes[Math.min(amplitudes.length - 1, Math.floor(i / perFrame))];
      return { length, sampleRate: this.sampleRate, numberOfChannels: 1, duration: length / this.sampleRate, getChannelData: () => data };
    }
  }
  const previous = (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
  (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = FakeOfflineAudioContext;
  return () => {
    (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = previous;
  };
}

function installRangeServer(file: Uint8Array, contentType: string, supportsRange = true) {
  const ranges: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range");
    ranges.push(range ?? "");
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (!supportsRange || !match) {
      return new Response(file.slice(), { status: 200, headers: { "Content-Type": contentType, "Content-Length": String(file.length) } });
    }
    const start = Number(match[1]);
    const end = Math.min(file.length - 1, Number(match[2]));
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { "Content-Type": contentType, "Content-Range": `bytes ${start}-${end}/${file.length}` },
    });
  }) as typeof fetch;
  return { ranges, restore: () => (globalThis.fetch = previous) };
}

// 12,000 frame ≈ 5MB, 313.5초. 앞 절반 진폭 50/255, 뒤 절반 200/255.
const FRAMES = 12_000;
const stream = mp3Stream(FRAMES, (index) => (index < FRAMES / 2 ? 50 : 200));
const expectedDuration = (FRAMES * SAMPLES_PER_FRAME) / 44100;

function assertHalfAndHalf(peaks: number[]) {
  assert.equal(peaks.length, AUDIO_PEAKS_COUNT);
  assert.equal(peaks[0], 0.25);
  assert.equal(peaks[498], 0.25, "뒤 조각의 lead가 앞 구간 값을 바꾸지 않는다");
  assert.equal(peaks[501], 1);
  assert.equal(peaks[999], 1);
}

test("MP3 주소는 4MB Range로 나눠 받고 조각마다 디코딩해 frame 수로 길이를 정한다", async () => {
  const calls: DecodeCall[] = [];
  const restoreAudio = installFakeAudio(calls);
  const server = installRangeServer(stream, "audio/mpeg");
  try {
    const result = await computeAudioPeaksFromUrl("/api/media/m1");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.complete, true);
    assert.ok(Math.abs(result.peaks.duration - expectedDuration) < 1e-9);
    assertHalfAndHalf(result.peaks.peaks);
    assert.deepEqual(server.ranges, ["bytes=0-4194303", `bytes=4194304-${stream.length - 1}`]);
    assert.ok(calls.length >= 3, "120초 조각으로 여러 번 디코딩한다");
    assert.ok(calls.every((call) => call.frames <= 4600 + 12), "조각마다 120초(4594 frame) + lead 이하");
  } finally {
    server.restore();
    restoreAudio();
  }
});

test("Range를 지원하지 않는 서버(200)면 한 응답 본문을 받는 대로 끊어 같은 파형을 만든다", async () => {
  const calls: DecodeCall[] = [];
  const restoreAudio = installFakeAudio(calls);
  const server = installRangeServer(stream, "audio/mpeg", false);
  try {
    const result = await computeAudioPeaksFromUrl("/api/media/m1");
    assert.equal(result.ok, true);
    if (result.ok) assertHalfAndHalf(result.peaks.peaks);
    assert.equal(server.ranges.length, 1);
  } finally {
    server.restore();
    restoreAudio();
  }
});

test("서버 오류는 다시 해 볼 실패, 디코딩하지 못한 파일은 다시 하지 않을 실패다", async () => {
  const calls: DecodeCall[] = [];
  const restoreAudio = installFakeAudio(calls, 1);
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
    assert.deepEqual(await computeAudioPeaksFromUrl("/api/media/m1"), { ok: false, retry: true });
    globalThis.fetch = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    assert.deepEqual(await computeAudioPeaksFromUrl("/api/media/m1"), { ok: false, retry: true });
    const server = installRangeServer(stream, "audio/mpeg");
    assert.deepEqual(await computeAudioPeaksFromUrl("/api/media/m1"), { ok: false, retry: false }, "모든 조각 디코딩 실패");
    server.restore();
  } finally {
    globalThis.fetch = previous;
    restoreAudio();
  }
});

test("일부 조각만 디코딩하지 못하면 빈 구간 있는 파형을 complete=false로 돌려준다(저장하지 않을 결과)", async () => {
  const calls: DecodeCall[] = [];
  const restoreAudio = installFakeAudio(calls, 3);
  const server = installRangeServer(stream, "audio/mpeg");
  try {
    const result = await computeAudioPeaksFromUrl("/api/media/m1");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.complete, false);
  } finally {
    server.restore();
    restoreAudio();
  }
});

test("로컬 MP3 파일은 네트워크 없이 같은 방법으로 파형을 만든다", async () => {
  const calls: DecodeCall[] = [];
  const restoreAudio = installFakeAudio(calls);
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("네트워크를 쓰면 안 된다");
  }) as typeof fetch;
  try {
    const file = new File([stream.slice()], "mix.mp3", { type: "audio/mpeg" });
    assert.equal(isMp3File(file), true);
    assert.equal(isMp3File({ name: "MIX.MP3", type: "" }), true);
    assert.equal(isMp3File({ name: "mix.m4a", type: "audio/mp4" }), false);
    const result = await computeMp3PeaksFromFile(file);
    assert.equal(result.ok, true);
    if (result.ok) assertHalfAndHalf(result.peaks.peaks);
    assert.deepEqual(await computeMp3PeaksFromFile(new File([new Uint8Array(100)], "x.mp3")), { ok: false, retry: false });
  } finally {
    globalThis.fetch = previous;
    restoreAudio();
  }
});
