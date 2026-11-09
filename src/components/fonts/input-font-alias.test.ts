import assert from "node:assert/strict";
import { test } from "node:test";
import { absolutizeFontSrc, BODY_FONT_FAMILY, inputAliasDescriptors } from "./input-font-alias";

test("입력 글꼴 별칭: 본문 글꼴의 같은 파일·조각을 swap으로 다시 등록하고 상대 주소를 stylesheet 기준으로 푼다", () => {
  const base = "https://portal.test/_next/static/chunks/a.css";
  const result = inputAliasDescriptors([
    { family: `"${BODY_FONT_FAMILY}"`, src: 'url("../media/x.woff2") format("woff2")', style: "normal", weight: "400", unicodeRange: "U+AC00-AC7F", baseHref: base },
    { family: "IBM Plex Mono", src: 'url("../media/m.woff2")', style: "normal", weight: "400", unicodeRange: "", baseHref: base },
    { family: BODY_FONT_FAMILY, src: "", style: "", weight: "", unicodeRange: "", baseHref: base },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].src, 'url("https://portal.test/_next/static/media/x.woff2") format("woff2")');
  assert.deepEqual(result[0].descriptors, { style: "normal", weight: "400", unicodeRange: "U+AC00-AC7F", display: "swap" });
});

test("입력 글꼴 별칭: 따옴표 없는 url도 절대 주소로 바꾼다", () => {
  assert.equal(absolutizeFontSrc("url(../media/y.woff2)format(\"woff2\")", "https://portal.test/_next/static/chunks/b.css"), 'url("https://portal.test/_next/static/media/y.woff2")format("woff2")');
});
