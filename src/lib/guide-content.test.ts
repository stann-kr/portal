import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureGuideBlockIds,
  extractGuideAssetIds,
  listGuideBlockIds,
  normalizeGuideQuote,
  prepareGuideHtml,
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
