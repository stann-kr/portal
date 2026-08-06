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
    '<h2>제목</h2><p data-text-align="center" style="text-align: center"><strong>강조</strong></p>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">' +
      '<label><input type="checkbox" checked><span></span></label><div>완료</div></li></ul>',
  );

  assert.match(sanitized, /<h2>제목<\/h2>/);
  assert.match(sanitized, /<p data-text-align="center"><strong>강조<\/strong><\/p>/);
  assert.match(sanitized, /data-type="taskList"/);
  assert.match(sanitized, /data-checked="true"/);
  assert.doesNotMatch(sanitized, /<input\b/i);
});

test("본문이 포털 UI를 덮거나 입력을 위장할 수 있는 속성과 control을 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<div title=">" class="fixed inset-0 z-50" style="position:fixed;inset:0">덮개</div>' +
      '<form><input type="password" name="password"><button type="submit">로그인</button></form>' +
      '<p title="a>b" style="position:fixed;inset:0" id="fake">본문</p>',
  );

  assert.doesNotMatch(sanitized, /\b(?:class|id|style)\s*=/i);
  assert.doesNotMatch(sanitized, /<(?:form|button|input)\b/i);
  assert.match(sanitized, /덮개/);
  assert.match(sanitized, /로그인/);
});

test("YouTube nocookie embed만 보존한다", () => {
  const sanitized = sanitizeHtml(
    '<div data-youtube-video><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" onload="alert(1)"></iframe></div>' +
      '<iframe src="https://example.com/embed/tracker"></iframe>',
  );

  assert.match(sanitized, /https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?rel=0/);
  assert.match(sanitized, /title="YouTube 동영상"/);
  assert.doesNotMatch(sanitized, /example\.com/);
  assert.doesNotMatch(sanitized, /onload/);
});

test("YouTube embed의 사용자 정보·비표준 port와 알 수 없는 query를 제거한다", () => {
  const sanitized = sanitizeHtml(
    '<iframe src="https://user:pass@www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com:444/embed/dQw4w9WgXcQ"></iframe>' +
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=10&origin=https://evil.example"></iframe>',
  );

  assert.equal((sanitized.match(/<iframe/g) ?? []).length, 1);
  assert.match(sanitized, /\?start=10/);
  assert.doesNotMatch(sanitized, /(?:user:pass|:444|origin=|evil\.example)/);
});
