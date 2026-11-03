import assert from "node:assert/strict";
import test from "node:test";
import {
  MIX_ANALYSIS_MEMO_MAX_LENGTH,
  formatAnalysisClock,
  mediaUrlAt,
  mixAnalysisToDraft,
  parseAnalysisClock,
  parseStoredMixAnalysis,
  sortAnalysisEntries,
  splitFeedbackByEntry,
  validateMixAnalysisInput,
} from "./mix-analysis";

const input = (value: unknown) => JSON.stringify(value);

test("시점은 m:ss·h:mm:ss만 읽고 표시는 한 시간 전 m:ss, 넘으면 h:mm:ss다", () => {
  assert.equal(parseAnalysisClock("0:40"), 40);
  assert.equal(parseAnalysisClock("14:30"), 870);
  assert.equal(parseAnalysisClock("75:05"), 4505);
  assert.equal(parseAnalysisClock("1:02:03"), 3723);
  assert.equal(parseAnalysisClock("1:75:00"), null);
  assert.equal(parseAnalysisClock("3:7"), null);
  assert.equal(parseAnalysisClock("24:00:00"), null);
  assert.equal(parseAnalysisClock("abc"), null);
  assert.equal(formatAnalysisClock(40), "0:40");
  assert.equal(formatAnalysisClock(870), "14:30");
  assert.equal(formatAnalysisClock(3723), "1:02:03");
});

test("시점 순 정렬에서 시점 없는 줄은 앞 시점 줄과 함께 움직이고 맨 앞 줄은 맨 앞에 남는다", () => {
  const sorted = sortAnalysisEntries([
    { at: null, memo: "전체 느낌" },
    { at: 600, memo: "10분" },
    { at: null, memo: "10분 덧붙임" },
    { at: 60, memo: "1분" },
    { at: 600, memo: "10분 둘째" },
  ]);
  assert.deepEqual(sorted.map((entry) => entry.memo), ["전체 느낌", "1분", "10분", "10분 덧붙임", "10분 둘째"]);
});

test("분석 입력은 빈 메모 줄을 버리고 시점을 초로 바꿔 정렬한다", () => {
  const result = validateMixAnalysisInput(input({
    rating: 5,
    recommended: true,
    oneLiner: "  이상적인\n라이브셋  ",
    entries: [{ at: "8:40", memo: "비트 체인지" }, { at: "0:00", memo: " 시작 " }, { at: "14:47", memo: "  " }, { at: "", memo: "덧붙임" }],
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.analysis, {
    v: 1,
    rating: 5,
    recommended: true,
    oneLiner: "이상적인 라이브셋",
    entries: [{ at: 0, memo: "시작" }, { at: null, memo: "덧붙임" }, { at: 520, memo: "비트 체인지" }],
  });
  assert.deepEqual(JSON.parse(result.json), result.analysis);
});

test("분석 입력은 평점·시점·길이·빈 분석을 안내 문구로 막는다", () => {
  const error = (value: unknown) => {
    const result = validateMixAnalysisInput(typeof value === "string" ? value : input(value));
    return result.ok ? null : result.error;
  };
  assert.match(error("{bad") ?? "", /읽지 못했습니다/u);
  assert.match(error({ rating: 6, entries: [] }) ?? "", /1점에서 5점/u);
  assert.match(error({ rating: 2.5, entries: [] }) ?? "", /1점에서 5점/u);
  assert.match(error({ entries: [{ at: "12분", memo: "메모" }] }) ?? "", /1번째 줄의 시점 "12분"/u);
  assert.match(error({ entries: [{ at: "", memo: "가".repeat(MIX_ANALYSIS_MEMO_MAX_LENGTH + 1) }] }) ?? "", /자까지/u);
  assert.match(error({ oneLiner: "가".repeat(201), entries: [] }) ?? "", /한줄평/u);
  assert.match(error({ rating: null, oneLiner: " ", entries: [{ at: "1:00", memo: "" }] }) ?? "", /하나 이상/u);
  assert.equal(error({ rating: 3, entries: [] }), null);
});

test("저장된 분석은 모양이 어긋나면 null이고 작성 화면 입력으로 되돌릴 수 있다", () => {
  assert.equal(parseStoredMixAnalysis(null), null);
  assert.equal(parseStoredMixAnalysis("{bad"), null);
  assert.equal(parseStoredMixAnalysis(JSON.stringify({ rating: 3 })), null);
  const stored = parseStoredMixAnalysis(JSON.stringify({
    v: 1, rating: 4, recommended: false, oneLiner: "좋음", entries: [{ at: 3723, memo: "긴 셋" }, { at: null, memo: "덧" }, { memo: 1 }],
  }));
  assert.deepEqual(stored?.entries, [{ at: 3723, memo: "긴 셋" }, { at: null, memo: "덧" }]);
  assert.deepEqual(mixAnalysisToDraft(stored), {
    rating: 4, recommended: false, oneLiner: "좋음", entries: [{ at: "1:02:03", memo: "긴 셋" }, { at: "", memo: "덧" }],
  });
});

test("피드백은 시점이 같은 첫 줄 아래에 붙고, 맞는 줄이 없거나 시점이 없으면 전체 피드백으로 남는다", () => {
  const entries = [{ at: 40, memo: "a" }, { at: 210, memo: "b" }, { at: 210, memo: "b2" }, { at: null, memo: "c" }];
  const feedback = [
    { id: "f1", timeMarker: 210 },
    { id: "f2", timeMarker: null },
    { id: "f3", timeMarker: 999 },
    { id: "f4", timeMarker: 40 },
  ];
  const { byEntry, rest } = splitFeedbackByEntry(entries, feedback);
  assert.deepEqual(byEntry.map((items) => items.map((item) => item.id)), [["f4"], ["f1"], [], []]);
  assert.deepEqual(rest.map((item) => item.id), ["f2", "f3"]);
});

test("임베드가 막힌 영상의 시점은 원본 사이트에서 그 위치로 연다", () => {
  assert.equal(mediaUrlAt("https://youtu.be/l4pr6Xirt4Y", 870), "https://www.youtube.com/watch?v=l4pr6Xirt4Y&t=870s");
  assert.equal(mediaUrlAt("https://www.youtube.com/watch?v=l4pr6Xirt4Y&t=60", 30), "https://www.youtube.com/watch?v=l4pr6Xirt4Y&t=90s");
  assert.equal(mediaUrlAt("https://soundcloud.com/artist/set", 75), "https://soundcloud.com/artist/set#t=1:15");
  assert.equal(mediaUrlAt("https://example.com/a", 10), "https://example.com/a");
});
