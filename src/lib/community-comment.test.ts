import assert from "node:assert/strict";
import test from "node:test";
import { COMMENT_MAX_LENGTH, groupCommentThreads, limitCommentContent } from "./community-comment";

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

test("댓글 묶음은 원 댓글 순서를 따르고, 원 댓글이 지워진 답글은 첫 답글 자리에 한 묶음으로 남는다", () => {
  const row = (id: string, parentId: string | null) => ({ id, parentId });
  const threads = groupCommentThreads([
    row("a", null),
    row("x1", "gone"),
    row("a1", "a"),
    row("b", null),
    row("x2", "gone"),
    row("a2", "a"),
  ]);
  assert.deepEqual(
    threads.map((thread) => [thread.kind, thread.id, thread.replies.map((reply) => reply.id)]),
    [
      ["comment", "a", ["a1", "a2"]],
      ["deleted", "gone", ["x1", "x2"]],
      ["comment", "b", []],
    ],
  );
  assert.deepEqual(groupCommentThreads([]), []);
});
