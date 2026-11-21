/**
 * @file src/lib/digging-import.ts
 * @description 플레이리스트에서 디깅 보드로 트랙 가져오기(2026-11-21 사용자 결정, 캔버스 Decisions1121 ③).
 * SoundCloud 위젯이 준 곡 정보와 붙여 넣은 '아티스트 - 제목' 목록을 같은 후보 모양으로 바꾸고,
 * 보드에 이미 있는 곡(링크, 링크가 없으면 트랙명·아티스트)을 찾는다. 화면과 서버가 같은 규칙을 쓴다.
 */

/** SoundCloud 공식 위젯은 앞 20곡에만 제목·링크를 채워 준다. 나머지는 붙여 넣기로 더한다. */
export const DIGGING_IMPORT_SOUNDCLOUD_LIMIT = 20;
/** 붙여 넣은 목록에서 한 번에 읽는 줄 수. */
export const DIGGING_IMPORT_PASTE_MAX_LINES = 200;
/** 한 번에 보드에 넣는 곡 수. 서버도 같은 상한으로 막는다. */
export const DIGGING_IMPORT_MAX_TRACKS = DIGGING_IMPORT_PASTE_MAX_LINES + DIGGING_IMPORT_SOUNDCLOUD_LIMIT;

export type DiggingImportCandidate = {
  title: string;
  artist: string;
  linkUrl: string | null;
};

export type DiggingImportColumnIds = {
  titleId: string | null;
  artistId: string | null;
  linkId: string | null;
};

// "아티스트 - 제목". 하이픈·en dash·em dash 앞뒤에 공백이 있어야 나눈다(제목 속 "Hi-Fi"는 그대로).
const ARTIST_TITLE_SEPARATOR = /\s+[-–—]\s+/u;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function splitArtistTitle(line: string): { artist: string; title: string } | null {
  const match = ARTIST_TITLE_SEPARATOR.exec(line);
  if (!match) return null;
  const artist = line.slice(0, match.index).trim();
  const title = line.slice(match.index + match[0].length).trim();
  return artist && title ? { artist, title } : null;
}

/** 링크 비교용: https만, 호스트 소문자, 쿼리·조각·끝 슬래시를 뗀다. URL이 아니면 null. */
export function normalizeDiggingImportLink(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    const path = url.pathname.replace(/\/+$/u, "");
    return `https://${url.hostname.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/**
 * SoundCloud 위젯 `getSounds()` 결과를 후보로 바꾼다. 제목이 '아티스트 - 제목'이면 나누고,
 * 아니면 발매 정보의 아티스트, 그것도 없으면 올린 사람 이름을 아티스트로 둔다.
 * `total`은 플레이리스트 전체 곡 수(정보가 안 온 곡 포함)다.
 */
export function readSoundCloudImportCandidates(sounds: readonly unknown[]): {
  total: number;
  candidates: DiggingImportCandidate[];
} {
  const candidates: DiggingImportCandidate[] = [];
  for (const sound of sounds) {
    if (candidates.length >= DIGGING_IMPORT_SOUNDCLOUD_LIMIT) break;
    if (!sound || typeof sound !== "object") continue;
    const record = sound as Record<string, unknown>;
    const rawTitle = cleanText(record.title);
    const linkUrl = normalizeDiggingImportLink(record.permalink_url);
    if (!rawTitle || !linkUrl) continue;
    const split = splitArtistTitle(rawTitle);
    const publisher = record.publisher_metadata as Record<string, unknown> | null | undefined;
    const user = record.user as Record<string, unknown> | null | undefined;
    candidates.push({
      title: split?.title ?? rawTitle,
      artist: split?.artist ?? (cleanText(publisher?.artist) || cleanText(user?.username)),
      linkUrl,
    });
  }
  return { total: sounds.length, candidates };
}

/** 붙여 넣은 곡 목록. 한 줄에 한 곡, 첫 구분자 앞이 아티스트다. 나눌 수 없는 줄은 제목만 둔다. */
export function parsePastedTrackList(text: string): DiggingImportCandidate[] {
  const candidates: DiggingImportCandidate[] = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    if (candidates.length >= DIGGING_IMPORT_PASTE_MAX_LINES) break;
    const line = cleanText(rawLine);
    if (!line) continue;
    const split = splitArtistTitle(line);
    candidates.push(split ? { ...split, linkUrl: null } : { title: line, artist: "", linkUrl: null });
  }
  return candidates;
}

/** 기본 컬럼 이름으로 트랙명·아티스트(글자 칸)와 링크 칸을 찾는다. 학생이 지웠으면 null. */
export function findDiggingImportColumns(
  columns: readonly { id: string; name: string; columnType: string }[],
): DiggingImportColumnIds {
  const textColumn = (name: string) => columns.find((column) => column.name === name && column.columnType === "text")?.id ?? null;
  return {
    titleId: textColumn("트랙명"),
    artistId: textColumn("아티스트"),
    linkId: columns.find((column) => column.columnType === "link")?.id ?? null,
  };
}

function textKey(value: unknown): string {
  return cleanText(value).toLocaleLowerCase("ko-KR");
}

/** 중복 판정 key. 링크가 있으면 링크, 없으면 트랙명·아티스트. */
export function diggingImportKey(candidate: DiggingImportCandidate): string {
  const link = normalizeDiggingImportLink(candidate.linkUrl);
  return link ? `link:${link}` : `name:${textKey(candidate.title)}\u0000${textKey(candidate.artist)}`;
}

/** 보드 트랙들의 중복 판정 key 모음. 링크 key와 이름 key를 모두 넣는다. */
export function diggingBoardImportKeys(
  tracks: readonly { linkUrl?: string | null; values: Record<string, unknown> }[],
  ids: DiggingImportColumnIds,
): Set<string> {
  const keys = new Set<string>();
  for (const track of tracks) {
    const link = normalizeDiggingImportLink(track.linkUrl);
    if (link) keys.add(`link:${link}`);
    const title = ids.titleId ? track.values[ids.titleId] : "";
    const artist = ids.artistId ? track.values[ids.artistId] : "";
    if (textKey(title)) keys.add(`name:${textKey(title)}\u0000${textKey(artist)}`);
  }
  return keys;
}

export function isDiggingImportOnBoard(
  candidate: DiggingImportCandidate,
  tracks: readonly { linkUrl?: string | null; values: Record<string, unknown> }[],
  ids: DiggingImportColumnIds,
): boolean {
  return diggingBoardImportKeys(tracks, ids).has(diggingImportKey(candidate));
}
