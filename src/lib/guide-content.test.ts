import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureGuideBlockIds,
  extractGuideAssetIds,
  listGuideBlockIds,
  normalizeGuideQuote,
  prepareGuideHtml,
  stripGuideBlockIds,
  unwrapClosedGuidePageLinks,
} from "./guide-content";
import { sanitizeHtml } from "./sanitize-html";

function sequence(prefix = "n") {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
}

test("모든 블록에 data-block-id를 붙이고 인라인 요소에는 붙이지 않는다", () => {
  const output = ensureGuideBlockIds(
    sanitizeHtml(
      "<h2>제목</h2><p>문단 <strong>강조</strong></p><ul><li><p>항목</p></li></ul>" +
        '<blockquote><p>인용</p></blockquote><pre><code>x</code></pre><hr><img src="/a.png">' +
        "<table><tbody><tr><td>셀</td></tr></tbody></table>",
    ),
    sequence(),
  );
  assert.deepEqual(listGuideBlockIds(output), ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10"]);
  assert.doesNotMatch(output, /<strong data-block-id/u);
  assert.doesNotMatch(output, /<td data-block-id/u);
});

test("기존 고유 식별자는 유지하고 중복은 처음 블록만 남긴 채 새로 만든다", () => {
  const input = sanitizeHtml(
    '<p data-block-id="keep">앞</p><p data-block-id="keep">나눈 뒤</p><p>새 문단</p><p data-block-id="other">다른</p>',
  );
  const output = ensureGuideBlockIds(input, sequence("x"));
  assert.deepEqual(listGuideBlockIds(output), ["keep", "x1", "x2", "other"]);
});

test("새 식별자가 기존 식별자와 겹치면 다시 만든다", () => {
  const ids = ["taken", "taken", "fresh"];
  const output = ensureGuideBlockIds(
    sanitizeHtml('<p data-block-id="taken">a</p><p>b</p>'),
    () => ids.shift() ?? "zz",
  );
  assert.deepEqual(listGuideBlockIds(output), ["taken", "fresh"]);
});

test("같은 HTML을 다시 저장해도 식별자가 바뀌지 않고 sanitizer 고정점이다", () => {
  const first = prepareGuideHtml("<p>하나</p><ul><li><p>둘</p></li></ul>");
  const second = prepareGuideHtml(first);
  assert.equal(second, first);
  assert.equal(sanitizeHtml(first), first);
  assert.equal(listGuideBlockIds(first).length, 3);
  assert.equal(new Set(listGuideBlockIds(first)).size, 3);
});

test("잘못된 식별자 값은 sanitizer가 지우고 새 식별자를 받는다", () => {
  const output = prepareGuideHtml('<p data-block-id="bad id">a</p>', sequence("ok"));
  assert.deepEqual(listGuideBlockIds(output), ["ok1"]);
});

test("본문이 가리키는 가이드 이미지 id만 고른다", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const other = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const html = sanitizeHtml(
    `<img src="/api/guide-assets/${id}"><img src="/api/guide-assets/${id}"><img src="/api/guide-assets/${other.toUpperCase()}">` +
      `<img src="https://evil.example/api/guide-assets/${other}"><img src="/api/media/${other}"><img src="/api/guide-assets/not-a-uuid">`,
  );
  assert.deepEqual(extractGuideAssetIds(html).sort(), [id, other].sort());
});

test("질문 인용은 공백을 줄이고 500자로 자르며 빈 값은 거부한다", () => {
  assert.equal(normalizeGuideQuote("  한  줄\n\n둘째  "), "한 줄 둘째");
  assert.equal(normalizeGuideQuote("   "), null);
  assert.equal(normalizeGuideQuote(42), null);
  assert.equal(Array.from(normalizeGuideQuote("가".repeat(800)) ?? "").length, 500);
});

test("재전송 비교는 태그의 블록 식별자만 지우고 본문 텍스트의 같은 글자는 남긴다", () => {
  const first = prepareGuideHtml('<p>Example data-block-id="first"</p>', sequence("a"));
  const second = prepareGuideHtml('<p>Example data-block-id="second"</p>', sequence("b"));
  assert.notEqual(stripGuideBlockIds(first), stripGuideBlockIds(second));
  const sameA = prepareGuideHtml("<h2>제목</h2><p>본문</p>", sequence("a"));
  const sameB = prepareGuideHtml("<h2>제목</h2><p>본문</p>", sequence("b"));
  assert.notEqual(sameA, sameB);
  assert.equal(stripGuideBlockIds(sameA), stripGuideBlockIds(sameB));
});

test("재전송 비교는 속성 값에 >·<가 있어도 블록 식별자를 지운다", () => {
  for (const html of [
    `<p>본문</p><img src="/api/guide-assets/${"a".repeat(32)}" alt="EQ > 컴프 순서">`,
    '<p title="a<b c > d">본문</p>',
    '<p title="따옴표 &quot;> 안">본문</p>',
  ]) {
    const first = prepareGuideHtml(html, sequence("a"));
    const second = prepareGuideHtml(html, sequence("b"));
    assert.notEqual(first, second, html);
    assert.equal(stripGuideBlockIds(first), stripGuideBlockIds(second), html);
  }
});

test("열리지 않은 가이드 페이지 링크만 글자로 바꾸고, 바뀐 것이 없으면 입력을 그대로 돌려준다", () => {
  const isOpen = (pageId: string) => pageId === "open-1";
  const html = '<ul><li data-block-id="l1"><a href="/dashboard/guide/closed-1?x=1#b1">닫힌 <em>페이지</em></a></li>'
    + '<li data-block-id="l2"><a href="/dashboard/guide/open-1">열린</a> <a href="/dashboard/guide">목록</a></li>'
    + '<li data-block-id="l3"><a href="//other.example/dashboard/guide/closed-1">다른 곳</a> <a href="/dashboard/guide/closed%2D1/edit">편집</a></li></ul>';
  assert.equal(
    unwrapClosedGuidePageLinks(html, isOpen),
    '<ul><li data-block-id="l1">닫힌 <em>페이지</em></li>'
      + '<li data-block-id="l2"><a href="/dashboard/guide/open-1">열린</a> <a href="/dashboard/guide">목록</a></li>'
      + '<li data-block-id="l3"><a href="//other.example/dashboard/guide/closed-1">다른 곳</a> 편집</li></ul>',
  );
  const untouched = '<p data-block-id="p1"><a href="/dashboard/guide/open-1">열린</a></p>';
  assert.equal(unwrapClosedGuidePageLinks(untouched, isOpen), untouched);
});
