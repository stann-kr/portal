import assert from "node:assert/strict";
import test from "node:test";
import { isRichTextEmpty } from "./rich-text";

test("Tiptap 빈 paragraph 변형을 빈 내용으로 판정한다", () => {
  assert.equal(isRichTextEmpty(""), true);
  assert.equal(isRichTextEmpty("<p></p>"), true);
  assert.equal(isRichTextEmpty("<p><br></p>"), true);
  assert.equal(isRichTextEmpty("<p>&nbsp;</p>"), true);
});

test("텍스트와 문서 embed는 유효한 내용으로 판정한다", () => {
  assert.equal(isRichTextEmpty("<p>연습 기록</p>"), false);
  assert.equal(isRichTextEmpty('<img src="https://example.com/image.jpg">'), false);
  assert.equal(isRichTextEmpty('<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>'), false);
  assert.equal(isRichTextEmpty("<hr>"), false);
});
