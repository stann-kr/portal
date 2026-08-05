import assert from "node:assert/strict";
import test from "node:test";
import { isCreatePostDraftEmpty } from "./post-draft";

const defaults = { boardType: "GENERAL", category: "general" };
const emptyDraft = {
  ...defaults,
  isPinned: false,
  title: "",
  contentHtml: "<p></p>",
  mediaUrl: "",
};

test("기본 게시판 선택만 있는 새 게시물은 빈 초안으로 판정한다", () => {
  assert.equal(isCreatePostDraftEmpty(emptyDraft, defaults), true);
});

test("게시판·채널·고정 metadata만 바꿔도 복원할 초안으로 판정한다", () => {
  assert.equal(
    isCreatePostDraftEmpty({ ...emptyDraft, boardType: "FEEDBACK" }, defaults),
    false,
  );
  assert.equal(
    isCreatePostDraftEmpty({ ...emptyDraft, category: "mixing" }, defaults),
    false,
  );
  assert.equal(
    isCreatePostDraftEmpty({ ...emptyDraft, isPinned: true }, defaults),
    false,
  );
});

test("제목·본문·미디어 중 하나라도 있으면 복원할 초안으로 판정한다", () => {
  assert.equal(
    isCreatePostDraftEmpty({ ...emptyDraft, title: "연습 공유" }, defaults),
    false,
  );
  assert.equal(
    isCreatePostDraftEmpty({ ...emptyDraft, contentHtml: "<p>본문</p>" }, defaults),
    false,
  );
  assert.equal(
    isCreatePostDraftEmpty({ ...emptyDraft, mediaUrl: "https://example.com/mix.mp3" }, defaults),
    false,
  );
});
