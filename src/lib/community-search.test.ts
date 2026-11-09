import assert from "node:assert/strict";
import test from "node:test";
import {
  communitySearchFilter,
  communitySearchHref,
  communitySearchSummary,
  getCommunitySearchWords,
  matchesCommunityPostSearch,
  resolveCommunitySearchScope,
} from "./community-search";

test("커뮤니티 검색: 낱말이 제목·본문 평문에 모두 있어야 하고 태그·속성은 찾지 않는다", () => {
  const post = { title: "Techno 셋 리뷰", contentHtml: "<p class=\"highlight\">BPM 128로 <strong>전환</strong> 연습</p>" };
  assert.equal(matchesCommunityPostSearch(post, getCommunitySearchWords("techno")), true, "대소문자 없이 제목");
  assert.equal(matchesCommunityPostSearch(post, getCommunitySearchWords("셋 전환")), true, "제목+본문 낱말");
  assert.equal(matchesCommunityPostSearch(post, getCommunitySearchWords("bpm 128")), true);
  assert.equal(matchesCommunityPostSearch(post, getCommunitySearchWords("highlight")), false, "속성 값은 찾지 않는다");
  assert.equal(matchesCommunityPostSearch(post, getCommunitySearchWords("셋 하우스")), false, "낱말은 모두 맞아야 한다");
  assert.equal(matchesCommunityPostSearch(post, getCommunitySearchWords("   ")), false, "빈 검색어는 검색하지 않는다");
  assert.equal(matchesCommunityPostSearch({ title: "ｔｅｃｈｎｏ", contentHtml: "" }, getCommunitySearchWords("techno")), true, "NFKC");
});

test("커뮤니티 검색: 지금 범위는 게시판(자유는 채널까지), 전체는 조건 없음", () => {
  assert.deepEqual(communitySearchFilter({ scope: "current", boardType: "GENERAL", category: "free" }), { boardType: "GENERAL", category: "free" });
  assert.deepEqual(communitySearchFilter({ scope: "current", boardType: "FEEDBACK", category: "free" }), { boardType: "FEEDBACK", category: null });
  assert.deepEqual(communitySearchFilter({ scope: "all", boardType: "GENERAL", category: "free" }), { boardType: null, category: null });
  assert.equal(resolveCommunitySearchScope("all"), "all");
  assert.equal(resolveCommunitySearchScope("other"), "current");
});

test("커뮤니티 검색: 주소와 빈 결과 문구", () => {
  assert.equal(
    communitySearchHref({ boardType: "GENERAL", category: "free", query: "셋 리뷰", scope: "all" }),
    "/community?boardType=GENERAL&category=free&q=%EC%85%8B+%EB%A6%AC%EB%B7%B0&scope=all",
  );
  assert.equal(communitySearchHref({ boardType: "ANNOUNCEMENT", category: "", query: "" }), "/community?boardType=ANNOUNCEMENT");
  assert.equal(communitySearchSummary("셋", 0), "‘셋’ 결과 없음");
  assert.equal(communitySearchSummary("셋", 3), "‘셋’ 결과 3개");
});
