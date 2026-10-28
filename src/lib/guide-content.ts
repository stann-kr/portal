/**
 * 공용 가이드 본문의 블록 식별자·이미지 참조·질문 인용 규칙.
 * 저장 HTML은 항상 sanitizeHtml을 거친 뒤 블록 식별자를 붙인다.
 */
import {
  defaultTreeAdapter,
  html,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes,
} from "parse5";
import { BLOCK_ID_TAGS, SAFE_BLOCK_ID, sanitizeHtml } from "@/lib/sanitize-html";

export const GUIDE_TITLE_MAX_LENGTH = 120;
export const GUIDE_BASE_REVISION_FIELD = "baseRevision";
/** Server Action 1MB body 경계 안쪽. 노트와 같은 기준이다. */
export const GUIDE_CONTENT_MAX_BYTES = 800 * 1024;
export const GUIDE_QUOTE_MAX_LENGTH = 500;
export const GUIDE_ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const GUIDE_ASSET_PATH_PREFIX = "/api/guide-assets/";
export const GUIDE_ASSET_CONTENT_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const GUIDE_ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const BLOCK_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export function isGuideBlockId(value: unknown): value is string {
  return typeof value === "string" && SAFE_BLOCK_ID.test(value);
}

export function parseGuideAssetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return GUIDE_ASSET_ID_PATTERN.test(normalized) ? normalized : null;
}

export function guideAssetPath(assetId: string): string {
  return `${GUIDE_ASSET_PATH_PREFIX}${assetId}`;
}

export function guidePagePath(pageId: string, blockId?: string | null): string {
  const base = `/dashboard/guide/${encodeURIComponent(pageId)}`;
  return blockId ? `${base}#${encodeURIComponent(blockId)}` : base;
}

/** 질문 인용: 연속 공백을 한 칸으로 줄이고 500자(code point)까지 자른다. 비면 null. */
export function normalizeGuideQuote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/gu, " ").trim();
  if (!collapsed) return null;
  const codePoints = Array.from(collapsed);
  return codePoints.length <= GUIDE_QUOTE_MAX_LENGTH
    ? collapsed
    : codePoints.slice(0, GUIDE_QUOTE_MAX_LENGTH).join("").trimEnd();
}

export function createRandomGuideBlockId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = "b";
  for (const byte of bytes) id += BLOCK_ID_ALPHABET[byte % BLOCK_ID_ALPHABET.length];
  return id;
}

function visitElements(parent: ParentNode, visit: (element: Element) => void): void {
  for (const child of defaultTreeAdapter.getChildNodes(parent)) {
    if (!defaultTreeAdapter.isElementNode(child)) continue;
    visit(child);
    visitElements(child, visit);
  }
}

function parseGuideFragment(sanitizedHtml: string) {
  const context = defaultTreeAdapter.createElement("div", html.NS.HTML, []);
  return parseFragment(context, sanitizedHtml, {});
}

/**
 * 모든 블록(p·h1–h6·li·blockquote·pre·table·img·hr)에 고유한 data-block-id를 붙인다.
 * 이미 있는 고유 식별자는 그대로 두고, 중복(편집기 문단 나누기가 속성을 복사한 경우)은
 * 처음 나온 블록만 유지하고 뒤의 것에 새 식별자를 준다. 입력은 sanitize된 HTML이어야 한다.
 */
export function ensureGuideBlockIds(
  sanitizedHtml: string,
  createId: () => string = createRandomGuideBlockId,
): string {
  const fragment = parseGuideFragment(sanitizedHtml);
  const blocks: Element[] = [];
  visitElements(fragment, (element) => {
    if (BLOCK_ID_TAGS.has(defaultTreeAdapter.getTagName(element))) blocks.push(element);
  });

  const used = new Set<string>();
  for (const block of blocks) {
    const value = block.attrs.find((attribute) => attribute.name === "data-block-id")?.value;
    if (isGuideBlockId(value) && !used.has(value)) used.add(value);
  }

  const kept = new Set<string>();
  let changed = false;
  for (const block of blocks) {
    const attribute = block.attrs.find((candidate) => candidate.name === "data-block-id");
    if (attribute && isGuideBlockId(attribute.value) && !kept.has(attribute.value)) {
      kept.add(attribute.value);
      continue;
    }
    let nextId = createId();
    for (let attempt = 0; (!isGuideBlockId(nextId) || used.has(nextId)) && attempt < 32; attempt += 1) {
      nextId = createId();
    }
    if (!isGuideBlockId(nextId) || used.has(nextId)) {
      throw new Error("가이드 블록 식별자를 만들지 못했습니다.");
    }
    used.add(nextId);
    kept.add(nextId);
    changed = true;
    if (attribute) attribute.value = nextId;
    else block.attrs.push({ name: "data-block-id", value: nextId });
  }

  return changed ? serialize(fragment) : sanitizedHtml;
}

/** 외부 입력을 저장 가능한 가이드 HTML로 만든다: sanitize → 블록 식별자 → 다시 sanitize로 고정점 확인. */
export function prepareGuideHtml(
  rawHtml: string,
  createId: () => string = createRandomGuideBlockId,
): string {
  const withIds = ensureGuideBlockIds(sanitizeHtml(rawHtml), createId);
  const fixedPoint = sanitizeHtml(withIds);
  if (fixedPoint !== withIds) throw new Error("가이드 본문을 안정적으로 정리하지 못했습니다.");
  return withIds;
}

export function listGuideBlockIds(sanitizedHtml: string): string[] {
  const ids: string[] = [];
  visitElements(parseGuideFragment(sanitizedHtml), (element) => {
    if (!BLOCK_ID_TAGS.has(defaultTreeAdapter.getTagName(element))) return;
    const value = element.attrs.find((attribute) => attribute.name === "data-block-id")?.value;
    if (isGuideBlockId(value)) ids.push(value);
  });
  return ids;
}

/** 본문이 가리키는 가이드 이미지 id(`/api/guide-assets/<id>`)를 중복 없이 고른다. */
export function extractGuideAssetIds(sanitizedHtml: string): string[] {
  const ids = new Set<string>();
  visitElements(parseGuideFragment(sanitizedHtml), (element) => {
    if (defaultTreeAdapter.getTagName(element) !== "img") return;
    const source = element.attrs.find((attribute) => attribute.name === "src")?.value ?? "";
    let pathname = source;
    try {
      const url = new URL(source, "https://portal.invalid");
      if (url.origin !== "https://portal.invalid" && /^[a-z][a-z\d+.-]*:/iu.test(source)) return;
      pathname = url.pathname;
    } catch {
      return;
    }
    if (!pathname.startsWith(GUIDE_ASSET_PATH_PREFIX)) return;
    const id = parseGuideAssetId(pathname.slice(GUIDE_ASSET_PATH_PREFIX.length));
    if (id) ids.add(id);
  });
  return [...ids];
}

const GUIDE_PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export function parseGuidePageId(value: unknown): string | null {
  return typeof value === "string" && GUIDE_PAGE_ID_PATTERN.test(value) ? value : null;
}

/**
 * 블록 식별자를 뺀 본문. 같은 원문을 다시 보내면 새 블록의 식별자만 무작위로 달라지므로,
 * 재전송이 같은 요청인지 비교할 때 쓴다(입력은 prepareGuideHtml을 거친 HTML).
 */
export function stripGuideBlockIds(preparedHtml: string): string {
  // 본문 텍스트에 같은 글자가 있어도 지우지 않도록 시작 태그 안의 속성만 지운다(sanitize 뒤라 텍스트의 `<`는 escape되어 있다).
  return preparedHtml.replace(/<[A-Za-z][^<>]*>/gu, (tag) => tag.replace(/ data-block-id="[A-Za-z0-9_-]{1,64}"/gu, ""));
}
