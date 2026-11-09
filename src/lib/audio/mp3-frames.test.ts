import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMp3FrameChunker, id3v2TagLength, isVbrInfoFrame, looksLikeMp3, parseMp3FrameHeader, type Mp3Chunk } from "./mp3-frames";

/** MPEG-1 Layer III 128kbps 44.1kHz frame(417바이트, padding이면 418). 본문은 순번으로 채운다. */
function frame(index: number, options: { padding?: boolean; mono?: boolean } = {}): Uint8Array {
  const length = 417 + (options.padding ? 1 : 0);
  const bytes = new Uint8Array(length).fill((index % 200) + 1);
  bytes.set([0xff, 0xfb, 0x90 | (options.padding ? 0x02 : 0), options.mono ? 0xc0 : 0x00], 0);
  return bytes;
}

function xingFrame(): Uint8Array {
  const bytes = frame(0);
  bytes.fill(0, 4);
  bytes.set([...Buffer.from("Info")], 4 + 32);
  return bytes;
}

function id3(bodySize: number): Uint8Array {
  const tag = new Uint8Array(10 + bodySize).fill(0x41);
  tag.set([0x49, 0x44, 0x33, 4, 0, 0, (bodySize >> 21) & 0x7f, (bodySize >> 14) & 0x7f, (bodySize >> 7) & 0x7f, bodySize & 0x7f], 0);
  return tag;
}

function join2(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function runChunker(bytes: Uint8Array, pieceSize: number, options: Parameters<typeof createMp3FrameChunker>[0]) {
  const chunker = createMp3FrameChunker(options);
  const chunks: Mp3Chunk[] = [];
  for (let offset = 0; offset < bytes.length; offset += pieceSize) chunks.push(...chunker.push(bytes.subarray(offset, offset + pieceSize)));
  chunks.push(...chunker.finish());
  return { chunker, chunks };
}

test("frame 머리: MPEG-1·2 Layer III 길이·표본 수를 계산하고 예약·free·다른 layer는 거절한다", () => {
  assert.deepEqual(parseMp3FrameHeader(frame(0), 0), { version: 1, sampleRate: 44100, bitrateKbps: 128, samplesPerFrame: 1152, frameLength: 417, channels: 2 });
  assert.equal(parseMp3FrameHeader(frame(0, { padding: true }), 0)?.frameLength, 418);
  assert.equal(parseMp3FrameHeader(frame(0, { mono: true }), 0)?.channels, 1);
  // MPEG-2 Layer III 64kbps 22.05kHz: 72 × 64000 / 22050 = 208
  assert.deepEqual(parseMp3FrameHeader(new Uint8Array([0xff, 0xf3, 0x80, 0x00]), 0), { version: 2, sampleRate: 22050, bitrateKbps: 64, samplesPerFrame: 576, frameLength: 208, channels: 2 });
  // MPEG-1 320kbps 48kHz: 144 × 320000 / 48000 = 960
  assert.equal(parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0xe4, 0x00]), 0)?.frameLength, 960);
  assert.equal(parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x00, 0x00]), 0), null, "free format");
  assert.equal(parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0xf0, 0x00]), 0), null, "bitrate 15");
  assert.equal(parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x9c, 0x00]), 0), null, "예약 sample rate");
  assert.equal(parseMp3FrameHeader(new Uint8Array([0xff, 0xfd, 0x90, 0x00]), 0), null, "Layer II");
  assert.equal(parseMp3FrameHeader(new Uint8Array([0xff, 0xeb, 0x90, 0x00]), 0), null, "예약 version");
  assert.equal(parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x90]), 0), null, "4바이트 미만");
});

test("ID3v2 태그 길이와 Xing/Info 머리 frame을 알아본다", () => {
  assert.equal(id3v2TagLength(id3(300)), 310);
  assert.equal(id3v2TagLength(frame(0)), 0);
  assert.equal(id3v2TagLength(new Uint8Array([0x49, 0x44])), null, "머리를 다 받기 전");
  assert.equal(id3v2TagLength(id3(300).subarray(0, 8)), null);
  const xing = xingFrame();
  assert.equal(isVbrInfoFrame(xing, 0, parseMp3FrameHeader(xing, 0)!), true);
  assert.equal(isVbrInfoFrame(frame(1), 0, parseMp3FrameHeader(frame(1), 0)!), false);
  assert.equal(looksLikeMp3(id3(10)), true);
  assert.equal(looksLikeMp3(frame(0)), true);
  assert.equal(looksLikeMp3(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])), false, "M4A");
});

test("chunker는 ID3·Xing·깨진 바이트·끝 태그를 건너뛰고 frame 경계 조각과 lead를 만든다", () => {
  const frames = Array.from({ length: 60 }, (_, index) => frame(index + 1, { padding: index % 3 === 0 }));
  const junk = new Uint8Array([0, 1, 2, 0xff, 0x00, 0xff, 0xfb, 7, 8, 9]);
  const tail = join2([new Uint8Array([0x54, 0x41, 0x47]), new Uint8Array(125)]);
  const stream = join2([id3(5000), xingFrame(), ...frames.slice(0, 50), junk, ...frames.slice(50), tail]);

  for (const pieceSize of [1, 37, 4096, stream.length]) {
    const { chunker, chunks } = runChunker(stream, pieceSize, { maxChunkBytes: 417 * 8, leadMinBytes: 1000 });
    assert.equal(chunker.totalFrames, 60, `piece ${pieceSize}: Xing 머리 frame은 세지 않는다`);
    assert.equal(chunker.durationSeconds, (60 * 1152) / 44100);
    assert.equal(chunks.reduce((sum, chunk) => sum + chunk.frameCount, 0), 60);
    let next = 0;
    for (const [index, chunk] of chunks.entries()) {
      assert.equal(chunk.firstFrame, next, "조각은 빈틈없이 이어진다");
      next += chunk.frameCount;
      assert.ok(chunk.frameCount * 417 <= 417 * 8 + 8, "조각 크기 상한");
      if (index === 0) assert.equal(chunk.leadFrames, 0);
      else assert.ok(chunk.leadFrames >= 2 && chunk.leadFrames <= 12, "앞 조각 frame을 lead로 붙인다");
      // 조각 바이트 = lead frame + 이 조각 frame, 모두 frame 머리로 시작하고 깨진 바이트가 없다.
      let offset = 0;
      let count = 0;
      while (offset < chunk.bytes.length) {
        const header = parseMp3FrameHeader(chunk.bytes, offset);
        assert.ok(header, `piece ${pieceSize} 조각 ${index}: ${offset}에 frame 머리`);
        offset += header.frameLength;
        count += 1;
      }
      assert.equal(offset, chunk.bytes.length);
      assert.equal(count, chunk.leadFrames + chunk.frameCount);
    }
  }
});

test("chunker는 길이(초) 상한으로도 조각을 나누고 lead 구간이 앞 조각 끝과 같다", () => {
  const frames = Array.from({ length: 100 }, (_, index) => frame(index + 1));
  const { chunks } = runChunker(join2(frames), 1000, { maxChunkSeconds: (20 * 1152) / 44100, leadMinBytes: 0 });
  assert.deepEqual(chunks.map((chunk) => chunk.frameCount), [20, 20, 20, 20, 20]);
  for (const chunk of chunks.slice(1)) {
    assert.equal(chunk.leadFrames, 2);
    // lead 두 frame은 바로 앞 순번이다(본문 fill 값 = 순번 + 1).
    assert.equal(chunk.bytes[10], ((chunk.firstFrame - 2 + 1) % 200) + 1);
    assert.equal(chunk.bytes[417 * 2 + 10], ((chunk.firstFrame + 1) % 200) + 1);
  }
});

test("chunker는 MP3 frame이 없으면 조각을 만들지 않는다", () => {
  const { chunker, chunks } = runChunker(new Uint8Array(10_000).fill(0x20), 333, {});
  assert.equal(chunks.length, 0);
  assert.equal(chunker.totalFrames, 0);
  assert.equal(chunker.format, null);
});

function ffmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("ffmpeg로 만든 실제 MP3(CBR·VBR·ID3·mono 22kHz)의 길이를 frame 수로 맞게 센다", { skip: !ffmpegAvailable() && "ffmpeg 없음" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "portal-mp3-frames-"));
  try {
    const cases = [
      { name: "cbr.mp3", args: ["-b:a", "192k", "-ar", "44100", "-ac", "2", "-metadata", "title=테스트 믹스셋"] },
      { name: "vbr.mp3", args: ["-q:a", "4", "-ar", "48000", "-ac", "2"] },
      { name: "mono22.mp3", args: ["-b:a", "64k", "-ar", "22050", "-ac", "1"] },
    ];
    for (const { name, args } of cases) {
      const path = join(dir, name);
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=37", "-c:a", "libmp3lame", ...args, path]);
      const bytes = new Uint8Array(readFileSync(path));
      assert.equal(looksLikeMp3(bytes), true);
      const { chunker, chunks } = runChunker(bytes, 64 * 1024, { maxChunkBytes: 128 * 1024 });
      // LAME는 앞뒤에 디코더 지연·padding을 더해 마지막 frame까지 센 길이가 37초보다 조금(1 frame 남짓) 길다.
      assert.ok(chunker.durationSeconds >= 37 && chunker.durationSeconds < 37.2, `${name}: ${chunker.durationSeconds}`);
      assert.ok(chunks.length > 1, `${name}: 여러 조각`);
      assert.equal(chunks.reduce((sum, chunk) => sum + chunk.frameCount, 0), chunker.totalFrames);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
