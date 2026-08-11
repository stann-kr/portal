import assert from "node:assert/strict";
import test from "node:test";
import { getPrivateNotePreview } from "./PrivateNoteList";

test("노트 목록 preview는 HTML을 렌더하지 않는 짧은 평문이다", () => {
  const preview = getPrivateNotePreview("<p>첫 문장 &amp; <strong>둘째</strong></p><script>alert('x')</script>");
  assert.equal(preview, "첫 문장 & 둘째");
  assert.equal(preview.includes("alert"), false);
  assert.equal(preview.includes("<"), false);
});
