import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeHtml } from "./sanitize-html";

test("script element와 inline event handler를 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<p>안전한 본문</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
  );

  assert.match(sanitized, /<p>안전한 본문<\/p>/);
  assert.doesNotMatch(sanitized, /<script/i);
  assert.doesNotMatch(sanitized, /onerror/i);
});

test("javascript protocol 링크를 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<a href="javascript:alert(1)">위험</a><a href="https://example.com">안전</a>',
  );

  assert.doesNotMatch(sanitized, /javascript:/i);
  assert.match(sanitized, /href="https:\/\/example\.com"/);
});

test("에디터가 사용하는 안전한 서식은 유지한다", () => {
  const sanitized = sanitizeHtml(
    "<h2>제목</h2><p><strong>강조</strong></p><ul><li>항목</li></ul>",
  );

  assert.equal(
    sanitized,
    "<h2>제목</h2><p><strong>강조</strong></p><ul><li>항목</li></ul>",
  );
});
