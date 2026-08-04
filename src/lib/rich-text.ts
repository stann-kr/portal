const MEANINGFUL_EMBED_PATTERN = /<(?:img|iframe|table|hr)\b/iu;

/**
 * Tiptap의 빈 paragraph 변형을 같은 의미로 판정한다.
 * 이미지·동영상·표·구분선은 텍스트가 없어도 유효한 문서 내용이다.
 */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  if (MEANINGFUL_EMBED_PATTERN.test(html)) return false;

  const text = html
    .replace(/<br\s*\/?\s*>/giu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&[a-z\d#]+;/giu, "x")
    .trim();

  return text.length === 0;
}
