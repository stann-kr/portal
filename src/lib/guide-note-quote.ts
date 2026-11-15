/**
 * 가이드에서 고른 글을 학생 노트에 인용으로 담는 규칙(순수 함수, DB·DOM 의존 없음).
 *
 * 인용은 노트의 기존 블록만으로 만든다: `<blockquote>` 안에 고른 글의 문단, 마지막 문단에 가이드 링크
 * (`/dashboard/guide/<pageId>#<blockId>`), 그 아래 설명을 쓸 빈 문단. 새 편집기 node를 쓰지 않으므로 열린
 * 옛 화면(옛 번들)이 공동 편집 문서에서 인용을 지우지 않고, migration도 없다(2026-11-16 결정).
 * 글과 문단 나눔만 담고 서식·사진·표 모양은 담지 않는다(표는 행마다 칸 글을 " · "로 이은 한 줄). 길이 제한은 없고
 * 노트 본문 한도(800 KiB)만 저장할 때 적용된다.
 */
import { guidePagePath, isGuideBlockId } from "@/lib/guide-content";

/** guide-access.ts의 GuideAccessSetting과 같다(그 파일은 DB를 불러 client에서 쓰지 않는다). */
type GuideAccessSetting = "CLOSED" | "ALL" | "SELECTED";

/** 인용 한 줄의 종류: 보통 문단, 제목(굵게), 목록 항목(앞에 "• "), 표 한 행. */
export type GuideQuoteBlockKind = "text" | "heading" | "item" | "row";

export type GuideQuoteBlock = { kind: GuideQuoteBlockKind; text: string };

export type GuideQuoteSelection = {
  pageId: string;
  pageTitle: string;
  /** 고른 글의 첫 블록. 링크가 이 위치를 가리킨다. 없으면 페이지 맨 위. */
  blockId: string | null;
  blocks: GuideQuoteBlock[];
  /** 고른 구간에 있었지만 담지 않은 사진 수. */
  skippedImages: number;
};

const QUOTE_BLOCK_KINDS: ReadonlySet<string> = new Set(["text", "heading", "item", "row"]);

export const GUIDE_QUOTE_LINK_PREFIX = "가이드 · ";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/** 한 줄 안의 연속 공백·줄바꿈을 한 칸으로 줄인다. */
export function normalizeGuideQuoteText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** 빈 줄을 빼고 글을 정리한다. 담을 글이 하나도 없으면 빈 배열. */
export function normalizeGuideQuoteBlocks(blocks: readonly GuideQuoteBlock[]): GuideQuoteBlock[] {
  const result: GuideQuoteBlock[] = [];
  for (const block of blocks) {
    if (!block || !QUOTE_BLOCK_KINDS.has(block.kind) || typeof block.text !== "string") continue;
    const text = normalizeGuideQuoteText(block.text);
    if (text) result.push({ kind: block.kind, text });
  }
  return result;
}

function blockHtml(block: GuideQuoteBlock): string {
  const text = escapeHtml(block.text);
  if (block.kind === "heading") return `<p><strong>${text}</strong></p>`;
  if (block.kind === "item") return `<p>• ${text}</p>`;
  return `<p>${text}</p>`;
}

/**
 * 노트에 넣을 인용 HTML. 담을 글이 없으면 null.
 * 마지막 빈 문단은 편집기가 커서를 인용 밖(설명 줄)에 둘 자리다.
 */
export function buildGuideNoteQuoteHtml(selection: GuideQuoteSelection): string | null {
  const blocks = normalizeGuideQuoteBlocks(selection.blocks);
  if (blocks.length === 0) return null;
  const blockId = isGuideBlockId(selection.blockId) ? selection.blockId : null;
  const href = escapeHtml(guidePagePath(selection.pageId, blockId));
  const title = escapeHtml(normalizeGuideQuoteText(selection.pageTitle) || "가이드");
  const link = `<p><a href="${href}">${escapeHtml(GUIDE_QUOTE_LINK_PREFIX)}${title}</a></p>`;
  return `<blockquote>${blocks.map(blockHtml).join("")}${link}</blockquote><p></p>`;
}

/** 패널의 인용 아래 한 줄: "2. 장비 이해 · 3문단 · 사진 1장은 빠짐". */
export function describeGuideQuote(selection: Pick<GuideQuoteSelection, "pageTitle" | "blocks" | "skippedImages">): string {
  const count = normalizeGuideQuoteBlocks(selection.blocks).length;
  const parts = [normalizeGuideQuoteText(selection.pageTitle) || "가이드", `${count}문단`];
  if (selection.skippedImages > 0) parts.push(`사진 ${selection.skippedImages}장은 빠짐`);
  return parts.join(" · ");
}

/** 새 노트 제목: "가이드: <페이지 제목>". */
export function guideQuoteNoteTitle(pageTitle: string): string {
  return `가이드: ${normalizeGuideQuoteText(pageTitle) || "인용"}`;
}

/**
 * 관리자가 "넣으면서 이 페이지를 열기"를 켰을 때 학생 한 명에게 할 일(2026-11-16 결정 C).
 * - 전체: 그대로.
 * - 선택: 이 페이지를 더한다(이미 열려 있으면 그대로).
 * - 닫힘: 남아 있던 옛 "선택" 페이지를 비우고 "선택"으로 바꿔 이 페이지만 연다.
 */
export type GuideQuoteOpenPlan =
  | { kind: "none" }
  | { kind: "add-page" }
  | { kind: "select-only"; clearPageIds: string[] };

export function planGuideQuoteOpen(
  access: { setting: GuideAccessSetting; pageIds: readonly string[] },
  pageId: string,
): GuideQuoteOpenPlan {
  if (access.setting === "ALL") return { kind: "none" };
  if (access.setting === "SELECTED") {
    return access.pageIds.includes(pageId) ? { kind: "none" } : { kind: "add-page" };
  }
  return { kind: "select-only", clearPageIds: access.pageIds.filter((id) => id !== pageId) };
}
