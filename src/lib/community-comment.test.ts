import assert from "node:assert/strict";
import test from "node:test";
import { COMMENT_MAX_LENGTH, limitCommentContent } from "./community-comment";

test("댓글 입력은 서버와 같은 글자 단위로 세고 한도를 넘친 뒷부분만 자른다", () => {
  assert.deepEqual(limitCommentContent("안녕하세요"), { value: "안녕하세요", length: 5, cut: 0 });

  const atLimit = "가".repeat(COMMENT_MAX_LENGTH);
  assert.deepEqual(limitCommentContent(atLimit), { value: atLimit, length: COMMENT_MAX_LENGTH, cut: 0 });

  const over = `${atLimit}나다`;
  assert.deepEqual(limitCommentContent(over), { value: atLimit, length: COMMENT_MAX_LENGTH, cut: 2 });

  // 이모지는 UTF-16으로 두 칸이지만 한 글자로 센다. 한도 안이면 자르지 않고, 넘치면 글자 중간을 끊지 않는다.
  const emoji = "🎧".repeat(COMMENT_MAX_LENGTH);
  assert.equal(emoji.length, COMMENT_MAX_LENGTH * 2);
  assert.deepEqual(limitCommentContent(emoji), { value: emoji, length: COMMENT_MAX_LENGTH, cut: 0 });
  const emojiOver = limitCommentContent(`${emoji}🎧`);
  assert.equal(emojiOver.value, emoji);
  assert.equal(emojiOver.cut, 1);
});
