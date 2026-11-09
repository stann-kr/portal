import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_PEAKS_COUNT, createPeaksAccumulator, parseAudioPeaks } from "./peaks";

test("파형 누적은 조각 단위 입력을 1000개 구간 최대 진폭으로 정규화한다", () => {
  const total = AUDIO_PEAKS_COUNT * 4;
  const acc = createPeaksAccumulator(total);
  const left = new Float32Array(total / 2).fill(0.25);
  const right = new Float32Array(total / 2).fill(-0.5);
  acc.push([left, right]);
  acc.push([new Float32Array(total / 2).fill(0.1), new Float32Array(total / 2).fill(0.1)]);
  const result = acc.finish(12.5);
  assert.equal(result.peaks.length, AUDIO_PEAKS_COUNT);
  assert.equal(result.peaks[0], 1);
  assert.equal(result.peaks[AUDIO_PEAKS_COUNT - 1], 0.2);
  assert.equal(parseAudioPeaks(result).ok, true);
});

test("파형 검증은 길이·범위·버전이 틀린 값을 거부한다", () => {
  const good = { version: 1, duration: 10, peaks: Array(AUDIO_PEAKS_COUNT).fill(0.5) };
  assert.equal(parseAudioPeaks(good).ok, true);
  assert.equal(parseAudioPeaks({ ...good, version: 2 }).ok, false);
  assert.equal(parseAudioPeaks({ ...good, duration: 0 }).ok, false);
  assert.equal(parseAudioPeaks({ ...good, peaks: [0.5] }).ok, false);
  assert.equal(parseAudioPeaks({ ...good, peaks: Array(AUDIO_PEAKS_COUNT).fill(1.5) }).ok, false);
  assert.equal(parseAudioPeaks(null).ok, false);
});
