/**
 * 이름 뒤 목적격 조사. 마지막 글자가 한글이면 받침으로 을/를을 고르고,
 * 이메일·영문처럼 한글로 끝나지 않으면 읽는 법을 알 수 없어 "을(를)"을 쓴다.
 */
export function withObjectParticle(word: string): string {
  const last = word.trim().at(-1);
  if (!last) return word;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${word}을(를)`;
  return `${word}${(code - 0xac00) % 28 === 0 ? "를" : "을"}`;
}
