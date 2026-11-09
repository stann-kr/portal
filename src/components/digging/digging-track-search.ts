/**
 * @file src/components/digging/digging-track-search.ts
 * @description 디깅 트랙 글자 검색(UsabilityBundle ⑨). 모든 컬럼 값(제목·아티스트·메모·링크 등)을
 * 한 덩어리 글로 만들어 대소문자 구분 없이 찾는다. 한글은 NFC로 맞춰 자모 분리(NFD) 입력도 찾는다.
 * 공백으로 나눈 낱말은 모두 들어 있어야 한다.
 */

/** 검색 비교용 정규화: NFC + 소문자 + 공백 하나로. */
export function normalizeTrackSearchText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("ko-KR").replace(/\s+/gu, " ").trim();
}

function collectText(value: unknown, out: string[]): void {
  if (value === null || value === undefined || typeof value === "boolean") return;
  if (typeof value === "string" || typeof value === "number") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectText(entry, out);
    return;
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) collectText(entry, out);
  }
}

/** 트랙의 모든 컬럼 값과 링크를 검색용 글 한 줄로. */
export function trackSearchText(track: { values: Record<string, unknown>; linkUrl?: string | null }): string {
  const parts: string[] = [];
  collectText(track.values, parts);
  if (track.linkUrl) parts.push(track.linkUrl);
  return normalizeTrackSearchText(parts.join(" "));
}

/** 검색어에 맞는 트랙만 남긴다(순서 유지). 빈 검색어는 모두 남긴다. */
export function filterTracksByQuery<T extends { values: Record<string, unknown>; linkUrl?: string | null }>(
  tracks: readonly T[],
  query: string,
): T[] {
  const terms = normalizeTrackSearchText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return [...tracks];
  return tracks.filter((track) => {
    const text = trackSearchText(track);
    return terms.every((term) => text.includes(term));
  });
}

/** 검색 중 개수 표시: "12곡 중 3곡". */
export function formatTrackSearchCount(matched: number, total: number): string {
  return `${total}곡 중 ${matched}곡`;
}
