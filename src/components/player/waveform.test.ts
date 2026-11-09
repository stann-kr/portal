import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fractionFromPointer,
  playedFraction,
  positionMarkers,
  resamplePeaks,
  seekForKey,
  spokenTime,
  waveformBarCount,
} from "./waveform";

test("저장 막대를 화면 막대 수로 줄일 때 구간 최댓값을 지켜 짧은 드롭이 사라지지 않는다", () => {
  const source = Array.from({ length: 1000 }, (_, index) => (index === 503 ? 1 : 0.1));
  const bars = resamplePeaks(source, 100);
  assert.equal(bars.length, 100);
  assert.equal(bars[50], 1, "503번 막대는 50번 화면 막대에 들어간다");
  assert.equal(bars.filter((value) => value === 1).length, 1);
  assert.ok(bars.every((value) => value >= 0 && value <= 1));
});

test("화면 막대가 더 많으면 가까운 값으로 늘리고, 빈 입력·0개는 빈 배열이다", () => {
  assert.deepEqual(resamplePeaks([0.2, 0.8], 4), [0.2, 0.2, 0.8, 0.8]);
  assert.deepEqual(resamplePeaks([], 10), []);
  assert.deepEqual(resamplePeaks([0.5], 0), []);
  assert.deepEqual(resamplePeaks([2, -1, Number.NaN], 3), [1, 0, 0], "범위 밖 값은 0~1로 자른다");
});

test("막대 수는 폭에 맞추되 최소 16, 최대 저장 막대 수다", () => {
  assert.equal(waveformBarCount(760, 1000), 152);
  assert.equal(waveformBarCount(20, 1000), 16);
  assert.equal(waveformBarCount(100_000, 1000), 1000);
  assert.equal(waveformBarCount(0, 1000), 120, "폭을 모르면 기본 120");
});

test("시점 댓글은 길이 안에서만 비율 위치에 놓고 시간순으로 둔다", () => {
  const markers = [
    { id: "b", seconds: 845, author: "Stann", isStann: true, text: "킥" },
    { id: "a", seconds: 280, author: "김학생", isStann: false, text: "드롭" },
    { id: "late", seconds: 4000, author: "이학생", isStann: false, text: "끝 뒤" },
  ];
  const placed = positionMarkers(markers, 3500);
  assert.deepEqual(placed.map((marker) => marker.id), ["a", "b"]);
  assert.equal(placed[0].leftPercent, 8);
  assert.ok(Math.abs(placed[1].leftPercent - 24.142857) < 1e-4);
  assert.deepEqual(positionMarkers(markers, 0), [], "길이를 모르면 놓지 않는다");
});

test("슬라이더 키는 ←/→ 5초, Home/End, 범위 안으로 자른다", () => {
  assert.equal(seekForKey("ArrowRight", 10, 100), 15);
  assert.equal(seekForKey("ArrowLeft", 3, 100), 0);
  assert.equal(seekForKey("ArrowRight", 98, 100), 100);
  assert.equal(seekForKey("Home", 50, 100), 0);
  assert.equal(seekForKey("End", 50, 100), 100);
  assert.equal(seekForKey("End", 50, 0), null, "길이를 모르면 끝으로 갈 수 없다");
  assert.equal(seekForKey("a", 50, 100), null);
});

test("재생 비율·포인터 비율·낭독 시간", () => {
  assert.equal(playedFraction(768, 3500), 768 / 3500);
  assert.equal(playedFraction(10, 0), 0);
  assert.equal(playedFraction(200, 100), 1);
  assert.equal(fractionFromPointer(150, { left: 100, width: 200 }), 0.25);
  assert.equal(fractionFromPointer(0, { left: 100, width: 200 }), 0);
  assert.equal(fractionFromPointer(10, { left: 0, width: 0 }), 0);
  assert.equal(spokenTime(768), "12분 48초");
  assert.equal(spokenTime(3723), "1시간 2분 3초");
  assert.equal(spokenTime(0), "0초");
  assert.equal(spokenTime(120), "2분");
});
