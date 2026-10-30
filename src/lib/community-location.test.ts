import assert from "node:assert/strict";
import test from "node:test";
import { describeCommunityBoardLocation } from "./community-location";

test("이력의 게시판 위치는 내부 값 대신 게시판 이름을 보이고 채널은 자유 게시판에만 붙인다", () => {
  assert.equal(describeCommunityBoardLocation("FEEDBACK", "feedback"), "믹스셋");
  assert.equal(describeCommunityBoardLocation("ANNOUNCEMENT", "announcement"), "공지");
  assert.equal(describeCommunityBoardLocation("GENERAL", "일반"), "자유 · # 일반");
  assert.equal(describeCommunityBoardLocation("GENERAL", ""), "자유");
  // 알 수 없는 값은 원문을 노출하지 않는다.
  assert.equal(describeCommunityBoardLocation("LEGACY", "x"), "게시판");
});
