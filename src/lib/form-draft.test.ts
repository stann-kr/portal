import assert from "node:assert/strict";
import test from "node:test";
import {
  FORM_DRAFT_STORAGE_VERSION,
  createDocumentDraftKey,
  hasFormDraftStorageConflict,
  parseFormDraft,
  serializeFormDraft,
} from "./form-draft";

test("version과 저장 시각을 포함해 draft를 왕복한다", () => {
  const raw = serializeFormDraft({ title: "연습 기록" }, 1_786_000_000_000);
  const parsed = parseFormDraft<{ title: string }>(raw);

  assert.deepEqual(parsed, {
    data: { title: "연습 기록" },
    savedAt: new Date(1_786_000_000_000),
    legacy: false,
  });
  assert.equal(JSON.parse(raw).version, FORM_DRAFT_STORAGE_VERSION);
});

test("기존 raw JSON draft도 복원한다", () => {
  assert.deepEqual(parseFormDraft<{ title: string }>(JSON.stringify({ title: "이전 초안" })), {
    data: { title: "이전 초안" },
    savedAt: null,
    legacy: true,
  });
});

test("손상되었거나 알 수 없는 version의 draft는 무시한다", () => {
  assert.equal(parseFormDraft("{"), null);
  assert.equal(parseFormDraft(JSON.stringify({ version: 99, savedAt: 1, data: {} })), null);
});

test("문서 draft key는 사용자와 문서 문맥을 분리한다", () => {
  assert.equal(
    createDocumentDraftKey("note", "student:1", "new"),
    "draft:document:note:student%3A1:new",
  );
  assert.notEqual(
    createDocumentDraftKey("qna-reply", "student-1", "thread-a"),
    createDocumentDraftKey("qna-reply", "student-2", "thread-a"),
  );
});

test("다른 탭이 draft를 쓰거나 지운 경우 storage 충돌로 판정한다", () => {
  assert.equal(hasFormDraftStorageConflict("old", "old"), false);
  assert.equal(hasFormDraftStorageConflict(null, null), false);
  assert.equal(hasFormDraftStorageConflict("old", "new"), true);
  assert.equal(hasFormDraftStorageConflict("old", null), true);
  assert.equal(hasFormDraftStorageConflict(null, "new"), true);
});
