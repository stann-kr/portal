/** 제목과 리치 텍스트 기록 검색의 정규화·평문·일치 구간을 공유한다. */
import { defaultTreeAdapter, parseFragment } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";

export const DOCUMENT_SEARCH_MAX_QUERY_LENGTH = 120;
const NON_TEXT_TAGS = new Set(["script", "style", "template", "iframe", "noscript"]);
const BLOCK_TAGS = new Set(["p", "div", "br", "hr", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "tr", "td", "th"]);

export function normalizeDocumentSearchQuery(value: string | string[] | undefined): string {
  return (typeof value === "string" ? value : "").trim().slice(0, DOCUMENT_SEARCH_MAX_QUERY_LENGTH).replace(/[\uD800-\uDFFF]/gu, "");
}

/** 저장된 HTML 전체에서 본문만 추출한다. 속성·숨겨진 코드와 짧은 목록 preview는 검색하지 않는다. */
export function getSearchableDocumentText(contentHtml: string): string {
  const parts: string[] = [];
  const stack: (DefaultTreeAdapterTypes.ChildNode | string)[] = [...parseFragment(contentHtml).childNodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node === "string") {
      parts.push(node);
    } else if (defaultTreeAdapter.isTextNode(node)) {
      parts.push(node.value);
    } else if (defaultTreeAdapter.isElementNode(node) && !NON_TEXT_TAGS.has(node.tagName)) {
      if (BLOCK_TAGS.has(node.tagName)) {
        parts.push(" ");
        stack.push(" ");
      }
      for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push(node.childNodes[index]);
    }
  }
  return parts.join("").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function getDocumentSearchWords(query: string): string[] {
  return query.normalize("NFKC").toLowerCase().split(/\s+/u).filter(Boolean);
}

export function getDocumentSearchExcerpt(body: string, words: readonly string[]): string | undefined {
  const lowerBody = body.toLowerCase();
  const firstMatch = words.map((word) => lowerBody.indexOf(word)).find((index) => index >= 0) ?? 0;
  let matchStart = firstMatch;
  // İ처럼 소문자 변환으로 길이가 달라지는 문자는 원문 위치로 되돌린다.
  if (lowerBody.length !== body.length) {
    matchStart = 0;
    let foldedOffset = 0;
    for (const character of body) {
      const nextOffset = foldedOffset + character.toLowerCase().length;
      if (nextOffset > firstMatch) break;
      foldedOffset = nextOffset;
      matchStart += character.length;
    }
  }
  let start = Math.max(0, matchStart - 40);
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(body[start])) start--;
  const excerpt = Array.from(body.slice(start, start + 320)).slice(0, 160).join("");
  return body ? `${start ? "…" : ""}${excerpt}${start + excerpt.length < body.length ? "…" : ""}` : undefined;
}
