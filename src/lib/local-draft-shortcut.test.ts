import assert from "node:assert/strict";
import test from "node:test";
import { persistLocalDraftOnShortcut } from "./local-draft-shortcut";

test("초안 저장 단축키는 최신 snapshot만 로컬 save·flush한다", () => {
  const calls: string[] = [];
  const snapshot = { title: "마지막 입력" };

  const result = persistLocalDraftOnShortcut({
    createSnapshot: () => {
      calls.push("read");
      return snapshot;
    },
    isEmpty: () => false,
    clear: () => calls.push("clear"),
    save: (value) => {
      assert.equal(value, snapshot);
      calls.push("save");
    },
    flush: () => {
      calls.push("flush");
      return true;
    },
  });

  assert.equal(result, "saved");
  assert.deepEqual(calls, ["read", "save", "flush"]);
});

test("빈 기본값은 로컬 초안을 지우고 flush하지 않는다", () => {
  const calls: string[] = [];

  const result = persistLocalDraftOnShortcut({
    createSnapshot: () => ({ title: "" }),
    isEmpty: () => true,
    clear: () => calls.push("clear"),
    save: () => calls.push("save"),
    flush: () => {
      calls.push("flush");
      return true;
    },
  });

  assert.equal(result, "empty");
  assert.deepEqual(calls, ["clear"]);
});

test("로컬 저장소 flush 실패를 호출자가 구분할 수 있다", () => {
  const result = persistLocalDraftOnShortcut({
    createSnapshot: () => ({ title: "복구 필요" }),
    isEmpty: () => false,
    clear: () => undefined,
    save: () => undefined,
    flush: () => false,
  });

  assert.equal(result, "error");
});
