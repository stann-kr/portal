/**
 * 화면에서 고른 가이드 본문 구간(DOM Range)을 인용 줄로 읽는다. 가이드 읽기 화면과 노트 편집기의 "가이드 인용" 패널이 같이 쓴다.
 * 문단·제목·코드·표 행 단위로 고른 부분의 글만 읽고(첫·끝 줄은 고른 곳까지만), 사진은 세어서 뺀다.
 */
import type { GuideQuoteBlock } from "@/lib/guide-note-quote";
import { normalizeGuideQuoteBlocks } from "@/lib/guide-note-quote";

const LINE_SELECTOR = "p, h1, h2, h3, h4, h5, h6, pre, tr";

export type CollectedGuideQuote = {
  blockId: string | null;
  blocks: GuideQuoteBlock[];
  skippedImages: number;
};

/** `element` 안에서 `range`와 겹치는 부분의 글. */
function clippedText(element: Element, range: Range): string {
  const document = element.ownerDocument;
  const part = document.createRange();
  part.selectNodeContents(element);
  if (part.compareBoundaryPoints(part.START_TO_START, range) < 0) part.setStart(range.startContainer, range.startOffset);
  if (part.compareBoundaryPoints(part.END_TO_END, range) > 0) part.setEnd(range.endContainer, range.endOffset);
  if (part.collapsed) return "";
  return part.toString();
}

function blockIdOf(element: Element, content: Element): string | null {
  const own = element.matches("[data-block-id]") ? element : element.querySelector("[data-block-id]");
  const found = own ?? element.closest("[data-block-id]");
  if (!found || !content.contains(found)) return null;
  return found.getAttribute("data-block-id");
}

function lineKind(element: Element, content: Element): GuideQuoteBlock["kind"] {
  const tag = element.tagName.toLowerCase();
  if (tag === "tr") return "row";
  if (/^h[1-6]$/u.test(tag)) return "heading";
  const item = element.closest("li");
  return item && content.contains(item) ? "item" : "text";
}

/** 고른 구간이 `content` 밖이거나 담을 글이 없으면 null. */
export function collectGuideQuoteSelection(content: Element, range: Range): CollectedGuideQuote | null {
  if (range.collapsed || !content.contains(range.commonAncestorContainer)) return null;
  const blocks: GuideQuoteBlock[] = [];
  let blockId: string | null = null;
  for (const line of content.querySelectorAll(LINE_SELECTOR)) {
    if (!range.intersectsNode(line)) continue;
    // 표 칸 안의 문단은 행(tr)이 한 줄로 읽는다. 다른 줄 안에 든 줄(예: 코드 안의 p)은 바깥 줄이 읽는다.
    const outer = line.parentElement?.closest(LINE_SELECTOR);
    if (outer && content.contains(outer)) continue;
    let text: string;
    if (line.tagName.toLowerCase() === "tr") {
      text = Array.from(line.children)
        .filter((cell) => range.intersectsNode(cell))
        .map((cell) => clippedText(cell, range).replace(/\s+/gu, " ").trim())
        .filter(Boolean)
        .join(" · ");
    } else {
      text = clippedText(line, range);
    }
    if (!text.trim()) continue;
    blockId ??= blockIdOf(line, content);
    blocks.push({ kind: lineKind(line, content), text });
  }
  const normalized = normalizeGuideQuoteBlocks(blocks);
  if (normalized.length === 0) return null;
  let skippedImages = 0;
  for (const image of content.querySelectorAll("img")) {
    if (range.intersectsNode(image)) skippedImages += 1;
  }
  return { blockId, blocks: normalized, skippedImages };
}
