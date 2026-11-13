/**
 * 가이드 블록 식별자 생성. 서버(`ensureGuideBlockIds`)와 편집기(`GuideBlockId`)가 함께 쓴다.
 * 편집기 번들에 parse5·정화 코드가 따라 들어가지 않도록 의존 없이 둔다.
 */
const BLOCK_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function createRandomGuideBlockId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = "b";
  for (const byte of bytes) id += BLOCK_ID_ALPHABET[byte % BLOCK_ID_ALPHABET.length];
  return id;
}
