import assert from "node:assert/strict";
import test from "node:test";
import { filterEditorBlockCommands } from "./editor-block-commands";

test("슬래시 명령은 한글·영문 별칭으로 검색된다", () => {
  assert.deepEqual(filterEditorBlockCommands("체크").map((item) => item.id), ["task-list"]);
  assert.deepEqual(filterEditorBlockCommands("h2").map((item) => item.id), ["heading-2"]);
});

test("빈 검색어는 모든 블록 명령을 유지한다", () => {
  const commands = filterEditorBlockCommands("");
  assert.ok(commands.length >= 10);
  assert.equal(new Set(commands.map((item) => item.id)).size, commands.length);
});
