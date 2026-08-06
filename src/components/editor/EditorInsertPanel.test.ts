import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEditorUrl } from "./EditorInsertPanel";

test("프로토콜 없는 링크에 https를 보완한다", () => {
  assert.equal(normalizeEditorUrl("example.com/path", "link"), "https://example.com/path");
});

test("문서 링크만 mailto를 허용하고 위험한 protocol은 거부한다", () => {
  assert.equal(normalizeEditorUrl("mailto:student@example.com", "link"), "mailto:student@example.com");
  assert.equal(normalizeEditorUrl("mailto:student@example.com", "image"), null);
  assert.equal(normalizeEditorUrl("javascript:alert(1)", "link"), null);
});
