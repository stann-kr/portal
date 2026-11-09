import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_PEAKS_COUNT, createPeaksAccumulator, createTimedPeaksAccumulator, isPlausiblePeaksDuration, parseAudioPeaks } from "./peaks";

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

test("시간 누적기는 조각 시작 시각에 맞춰 놓고 lead·꼬리 구간은 버린다", () => {
  const acc = createTimedPeaksAccumulator();
  const rate = 3000;
  // 0~50초는 0.2, 50~100초는 0.8. 두 번째 조각은 앞 2초 lead(값 1.0)를 붙여 48초부터 시작한다.
  acc.push([new Float32Array(50 * rate).fill(0.2)], rate, 0, 0, 50);
  const second = new Float32Array(52 * rate).fill(0.8);
  second.fill(1, 0, 2 * rate);
  acc.push([second, new Float32Array(52 * rate).fill(-0.4)], rate, 48, 50, 100);
  const result = acc.finish(100);
  assert.equal(result.peaks.length, AUDIO_PEAKS_COUNT);
  assert.equal(result.peaks[0], 0.25, "앞 절반 = 0.2 / 0.8");
  assert.equal(result.peaks[499], 0.25, "lead의 1.0이 앞 조각 구간에 들어가지 않는다");
  assert.equal(result.peaks[500], 1);
  assert.equal(result.peaks[999], 1);
  assert.equal(result.duration, 100);
  assert.equal(parseAudioPeaks(result).ok, true);
});

test("시간 누적기는 칸 수 상한을 넘으면 칸을 합쳐 메모리를 묶고 최대값을 잃지 않는다", () => {
  const acc = createTimedPeaksAccumulator({ initialBucketSeconds: 0.001, maxBuckets: 2048 });
  const rate = 3000;
  // 60초를 1초 조각으로. 37.5초에만 큰 값.
  for (let second = 0; second < 60; second += 1) {
    const samples = new Float32Array(rate).fill(0.1);
    if (second === 37) samples[1500] = 0.9;
    acc.push([samples], rate, second);
  }
  const result = acc.finish(60);
  // 칸을 합친 뒤 칸 폭(0.032초)이 구간 경계에 걸치면 이웃 구간 하나까지 번질 수 있다.
  const expected = Math.floor((37.5 / 60) * AUDIO_PEAKS_COUNT);
  assert.ok(Math.abs(result.peaks.indexOf(1) - expected) <= 1);
  assert.ok(result.peaks.filter((value) => value === 1).length <= 2);
  assert.equal(result.peaks[0], 0.111);
  assert.equal(result.peaks[AUDIO_PEAKS_COUNT - 1], 0.111);
});

test("파형 길이는 파일 크기로 본 평균 비트레이트가 4~10,000kbps일 때만 받아들인다", () => {
  const size59min192k = Math.round((59 * 60 * 192_000) / 8);
  assert.equal(isPlausiblePeaksDuration(59 * 60, size59min192k), true);
  assert.equal(isPlausiblePeaksDuration(1, size59min192k), false, "85MB가 1초일 수 없다");
  assert.equal(isPlausiblePeaksDuration(24 * 60 * 60, 1024), false, "1KB가 하루일 수 없다");
  assert.equal(isPlausiblePeaksDuration(30, null), true, "크기를 모르면 통과");
  assert.equal(isPlausiblePeaksDuration(0, null), false);
  assert.equal(isPlausiblePeaksDuration(Number.NaN, 1000), false);
  assert.equal(isPlausiblePeaksDuration(Number.POSITIVE_INFINITY, null), false);
});
