import assert from "node:assert/strict";
import test from "node:test";
import { filterTracksByQuery, formatTrackSearchCount, trackSearchText } from "./digging-track-search";

const tracks = [
  { id: "1", linkUrl: "https://soundcloud.com/a/strobe", values: { title: "Strobe", artist: "deadmau5", memo: "빌드업 길게", rating: 5 } },
  { id: "2", linkUrl: null, values: { title: "Opus", artist: "Eric Prydz", memo: "피크 타임용", key: ["8A", "9A"] } },
  { id: "3", linkUrl: null, values: { title: "봄날", artist: "방탄소년단", memo: null, done: true } },
];

test("디깅 검색: 모든 컬럼 값에서 대소문자 없이 찾는다", () => {
  assert.deepEqual(filterTracksByQuery(tracks, "DEADMAU5").map((t) => t.id), ["1"]);
  assert.deepEqual(filterTracksByQuery(tracks, "피크").map((t) => t.id), ["2"]);
  assert.deepEqual(filterTracksByQuery(tracks, "9a").map((t) => t.id), ["2"], "배열 값(여러 선택)도 찾는다");
  assert.deepEqual(filterTracksByQuery(tracks, "soundcloud").map((t) => t.id), ["1"], "링크도 찾는다");
});

test("디깅 검색: 한글은 자모 분리(NFD) 입력도 찾고, 낱말은 모두 맞아야 한다", () => {
  assert.deepEqual(filterTracksByQuery(tracks, "봄날".normalize("NFD")).map((t) => t.id), ["3"]);
  assert.deepEqual(filterTracksByQuery(tracks, "방탄 봄").map((t) => t.id), ["3"]);
  assert.deepEqual(filterTracksByQuery(tracks, "방탄 strobe"), []);
});

test("디깅 검색: 빈 검색어는 모두 남기고 개수 표시는 '12곡 중 3곡'", () => {
  assert.equal(filterTracksByQuery(tracks, "   ").length, 3);
  assert.equal(formatTrackSearchCount(3, 12), "12곡 중 3곡");
  assert.ok(!trackSearchText(tracks[2]!).includes("true"), "체크 값은 글로 넣지 않는다");
});
