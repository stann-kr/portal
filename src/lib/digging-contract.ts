import type { DiggingColumnType } from "@/db/schema";

export const DIGGING_COLUMN_NAME_MAX_LENGTH = 60;
export const DIGGING_COLUMN_OPTION_MAX_LENGTH = 80;
export const DIGGING_COLUMN_OPTIONS_MAX_COUNT = 20;
export const DIGGING_COLUMNS_MAX_COUNT = 32;
export const DIGGING_TEXT_MAX_LENGTH = 240;
export const DIGGING_TEXTAREA_MAX_LENGTH = 4_000;
export const DIGGING_LINK_MAX_LENGTH = 2_048;
export const DIGGING_TRACK_VALUES_MAX_BYTES = 32 * 1_024;

export const ALLOWED_DIGGING_LINK_HOSTS = [
  "youtube.com",
  "youtu.be",
  "soundcloud.com",
  "spotify.com",
  "music.apple.com",
  "bandcamp.com",
] as const;

const COLUMN_TYPES = new Set<DiggingColumnType>([
  "text",
  "textarea",
  "number",
  "select",
  "rating",
  "link",
  "camelot_key",
]);

export type DiggingColumnContract = {
  id: string;
  userId: string;
  columnType: DiggingColumnType;
  options: string | null;
};

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function isAllowedDiggingLinkUrl(value: string): boolean {
  if (!value || value.length > DIGGING_LINK_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    return ALLOWED_DIGGING_LINK_HOSTS.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

export function parseDiggingColumnInput(input: unknown): ValidationResult<{
  name: string;
  columnType: DiggingColumnType;
  options: string[] | null;
}> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "컬럼 정보가 올바르지 않습니다." };
  }
  const record = input as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name || name.length > DIGGING_COLUMN_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `컬럼 이름은 1자 이상 ${DIGGING_COLUMN_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`,
    };
  }
  if (
    typeof record.columnType !== "string" ||
    !COLUMN_TYPES.has(record.columnType as DiggingColumnType)
  ) {
    return { ok: false, error: "컬럼 유형이 올바르지 않습니다." };
  }
  const columnType = record.columnType as DiggingColumnType;
  if (columnType !== "select") {
    return { ok: true, value: { name, columnType, options: null } };
  }

  if (!Array.isArray(record.options)) {
    return { ok: false, error: "선택형 컬럼에는 선택지를 입력해 주세요." };
  }
  const options = record.options.map((option) =>
    typeof option === "string" ? option.trim() : "",
  );
  if (
    options.length < 1 ||
    options.length > DIGGING_COLUMN_OPTIONS_MAX_COUNT ||
    options.some(
      (option) => !option || option.length > DIGGING_COLUMN_OPTION_MAX_LENGTH,
    ) ||
    new Set(options).size !== options.length
  ) {
    return { ok: false, error: "선택지는 중복 없이 유효한 값으로 입력해 주세요." };
  }
  return { ok: true, value: { name, columnType, options } };
}

export function parseStoredDiggingOptions(options: string | null): string[] | null {
  if (!options) return null;
  try {
    const parsed: unknown = JSON.parse(options);
    if (
      !Array.isArray(parsed) ||
      parsed.length < 1 ||
      parsed.length > DIGGING_COLUMN_OPTIONS_MAX_COUNT ||
      parsed.some(
        (option) =>
          typeof option !== "string" ||
          !option ||
          option.length > DIGGING_COLUMN_OPTION_MAX_LENGTH,
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseDiggingColumnValue(
  column: DiggingColumnContract,
  input: unknown,
): ValidationResult<unknown> {
  switch (column.columnType) {
    case "text":
    case "textarea": {
      if (typeof input !== "string") {
        return { ok: false, error: "텍스트 값이 올바르지 않습니다." };
      }
      const max = column.columnType === "text"
        ? DIGGING_TEXT_MAX_LENGTH
        : DIGGING_TEXTAREA_MAX_LENGTH;
      if (input.length > max) {
        return { ok: false, error: `입력값은 ${max}자까지 저장할 수 있습니다.` };
      }
      return { ok: true, value: input };
    }
    case "number": {
      if (input === "" || input === null) return { ok: true, value: "" };
      const number =
        typeof input === "number"
          ? input
          : typeof input === "string" && /^-?(?:\d+\.?\d*|\.\d+)$/.test(input)
            ? Number(input)
            : Number.NaN;
      if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000) {
        return { ok: false, error: "숫자 값이 올바르지 않습니다." };
      }
      return { ok: true, value: number };
    }
    case "select": {
      if (input === "" || input === null) return { ok: true, value: "" };
      const options = parseStoredDiggingOptions(column.options);
      if (typeof input !== "string" || !options?.includes(input)) {
        return { ok: false, error: "허용된 선택지 중 하나를 선택해 주세요." };
      }
      return { ok: true, value: input };
    }
    case "rating": {
      if (input === "" || input === null) return { ok: true, value: "" };
      if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > 5) {
        return { ok: false, error: "별점은 1점부터 5점까지 선택해 주세요." };
      }
      return { ok: true, value: input };
    }
    case "link": {
      if (input === "" || input === null) return { ok: true, value: "" };
      if (typeof input !== "string" || !isAllowedDiggingLinkUrl(input.trim())) {
        return { ok: false, error: "지원하는 HTTPS 음악 링크를 입력해 주세요." };
      }
      return { ok: true, value: input.trim() };
    }
    case "camelot_key": {
      if (input === "" || input === null) return { ok: true, value: "" };
      if (typeof input !== "string" || !/^(?:[1-9]|1[0-2])[AB]$/.test(input)) {
        return { ok: false, error: "Camelot 키가 올바르지 않습니다." };
      }
      return { ok: true, value: input };
    }
  }
}

export function parseDiggingTrackInput(
  input: unknown,
  columns: DiggingColumnContract[],
): ValidationResult<{ linkUrl: string | null; values: Record<string, unknown> }> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "트랙 정보가 올바르지 않습니다." };
  }
  const record = input as Record<string, unknown>;
  if (
    !record.values ||
    typeof record.values !== "object" ||
    Array.isArray(record.values)
  ) {
    return { ok: false, error: "트랙 값이 올바르지 않습니다." };
  }
  const rawValues = record.values as Record<string, unknown>;
  const columnMap = new Map(columns.map((column) => [column.id, column]));
  const entries = Object.entries(rawValues);
  if (entries.length > columns.length) {
    return { ok: false, error: "트랙 값에 알 수 없는 컬럼이 포함되어 있습니다." };
  }

  const values: Record<string, unknown> = {};
  for (const [columnId, value] of entries) {
    const column = columnMap.get(columnId);
    if (!column) {
      return { ok: false, error: "트랙 값에 알 수 없는 컬럼이 포함되어 있습니다." };
    }
    const parsed = parseDiggingColumnValue(column, value);
    if (!parsed.ok) return parsed;
    values[columnId] = parsed.value;
  }

  const rawLink = record.linkUrl;
  let linkUrl: string | null = null;
  if (rawLink !== undefined && rawLink !== null && rawLink !== "") {
    if (typeof rawLink !== "string" || !isAllowedDiggingLinkUrl(rawLink.trim())) {
      return { ok: false, error: "지원하는 HTTPS 음악 링크를 입력해 주세요." };
    }
    linkUrl = rawLink.trim();
  }

  const serialized = JSON.stringify(values);
  if (utf8Bytes(serialized) > DIGGING_TRACK_VALUES_MAX_BYTES) {
    return { ok: false, error: "트랙 입력값이 저장 가능한 크기를 넘었습니다." };
  }
  return { ok: true, value: { linkUrl, values } };
}

// ─── 플레이리스트 ─────────────────────────────────
// 길이 상한은 src/db/schema.ts `digging_playlists_payload_check`와 같다.
export const DIGGING_PLAYLIST_URL_MAX_LENGTH = DIGGING_LINK_MAX_LENGTH;
export const DIGGING_PLAYLIST_TITLE_MAX_LENGTH = 200;
export const DIGGING_PLAYLIST_NOTE_MAX_LENGTH = 2_000;
export const DIGGING_PLAYLISTS_MAX_COUNT = 100;

export type DiggingPlaylistProviderName = "beatport" | "soundcloud";

export const DIGGING_PLAYLIST_DEFAULT_TITLES: Record<DiggingPlaylistProviderName, string> = {
  beatport: "Beatport 플레이리스트",
  soundcloud: "SoundCloud 플레이리스트",
};

export type DiggingPlaylistUrlResult =
  | { ok: true; provider: DiggingPlaylistProviderName; url: string }
  | { ok: false; error: string };

const BEATPORT_PLAYLIST_HOSTS = new Set(["www.beatport.com", "beatport.com"]);
const SOUNDCLOUD_PLAYLIST_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]);
const BEATPORT_SHARE_PATH = /^\/playlists\/share\/(\d{1,20})\/?$/u;
// permalink는 영문·숫자·_·- 만 쓴다. 비공개 세트는 마지막에 `s-<토큰>` 세그먼트가 붙는다.
const SOUNDCLOUD_SET_PATH = /^\/([A-Za-z0-9_-]{1,100})\/sets\/([A-Za-z0-9_-]{1,200})(\/s-[A-Za-z0-9]{1,64})?\/?$/u;

const PLAYLIST_HTTPS_MESSAGE = "https로 시작하는 공유 링크를 그대로 붙여 넣어 주세요.";
const PLAYLIST_UNSUPPORTED_MESSAGE =
  "Beatport 플레이리스트 공유 링크 또는 SoundCloud 플레이리스트 링크만 등록할 수 있습니다.";
const SOUNDCLOUD_SHORT_LINK_MESSAGE =
  "SoundCloud 앱 공유 단축 링크 대신 브라우저 주소창의 전체 플레이리스트 링크(soundcloud.com/…/sets/…)를 붙여 넣어 주세요.";
const SOUNDCLOUD_NOT_SET_MESSAGE =
  "SoundCloud는 트랙이 아닌 플레이리스트 링크(soundcloud.com/…/sets/…)를 붙여 넣어 주세요.";
const BEATPORT_NOT_SHARE_MESSAGE =
  "Beatport는 플레이리스트 공유 링크(beatport.com/playlists/share/숫자)를 붙여 넣어 주세요.";

/**
 * 플레이리스트 링크를 provider별 표준 주소로 맞춘다.
 * https만 받고 계정 정보·포트·query·hash는 저장하지 않는다. path 대소문자는 바꾸지 않는다(비공개 토큰 보존).
 */
export function normalizeDiggingPlaylistUrl(raw: unknown): DiggingPlaylistUrlResult {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "플레이리스트 링크를 입력해 주세요." };
  if (value.length > DIGGING_PLAYLIST_URL_MAX_LENGTH) {
    return { ok: false, error: "링크가 너무 깁니다. 공유 링크를 다시 복사해 주세요." };
  }
  // URL 파서가 조용히 지우는 제어 문자(탭·줄바꿈 등)가 섞이면 아래 원본 검사를 우회할 수 있으므로 거부한다.
  if ([...value].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    return { ok: false, error: PLAYLIST_HTTPS_MESSAGE };
  }
  // `new URL()`은 기본 포트(:443)를 지워 버리므로, 파싱 전에 원본 authority에 적힌 포트를 먼저 거부한다.
  const authority = value.match(/^[A-Za-z][A-Za-z0-9+.-]*:[/\\]*([^/?#\\]*)/u)?.[1] ?? "";
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostPort.includes(":")) return { ok: false, error: PLAYLIST_HTTPS_MESSAGE };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: PLAYLIST_UNSUPPORTED_MESSAGE };
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return { ok: false, error: PLAYLIST_HTTPS_MESSAGE };
  }
  const host = url.hostname.toLowerCase();

  if (BEATPORT_PLAYLIST_HOSTS.has(host)) {
    const match = url.pathname.match(BEATPORT_SHARE_PATH);
    if (!match) return { ok: false, error: BEATPORT_NOT_SHARE_MESSAGE };
    return {
      ok: true,
      provider: "beatport",
      url: `https://www.beatport.com/playlists/share/${match[1]}`,
    };
  }

  if (host === "on.soundcloud.com") return { ok: false, error: SOUNDCLOUD_SHORT_LINK_MESSAGE };
  if (SOUNDCLOUD_PLAYLIST_HOSTS.has(host)) {
    const match = url.pathname.match(SOUNDCLOUD_SET_PATH);
    if (!match) return { ok: false, error: SOUNDCLOUD_NOT_SET_MESSAGE };
    return {
      ok: true,
      provider: "soundcloud",
      url: `https://soundcloud.com/${match[1]}/sets/${match[2]}${match[3] ?? ""}`,
    };
  }

  return { ok: false, error: PLAYLIST_UNSUPPORTED_MESSAGE };
}

function parseOptionalPlaylistText(
  input: unknown,
  max: number,
  label: "제목" | "메모",
): ValidationResult<string | null> {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, error: `${label} 값이 올바르지 않습니다.` };
  const value = input.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > max) return { ok: false, error: `${label}${label === "제목" ? "은" : "는"} ${max}자까지 입력할 수 있습니다.` };
  return { ok: true, value };
}

/** 제목: 앞뒤 공백을 지우고, 비면 null(화면은 provider 기본 이름). */
export function parseDiggingPlaylistTitle(input: unknown): ValidationResult<string | null> {
  return parseOptionalPlaylistText(input, DIGGING_PLAYLIST_TITLE_MAX_LENGTH, "제목");
}

/** 메모: 앞뒤 공백을 지우고, 비면 null. 줄바꿈은 보존한다. */
export function parseDiggingPlaylistNote(input: unknown): ValidationResult<string | null> {
  return parseOptionalPlaylistText(input, DIGGING_PLAYLIST_NOTE_MAX_LENGTH, "메모");
}

/** 외부(oEmbed)에서 받은 제목을 저장 가능한 길이로 다듬는다. 비면 null. */
export function clampDiggingPlaylistTitle(input: string | null | undefined): string | null {
  const value = input?.replace(/\s+/gu, " ").trim() ?? "";
  if (!value) return null;
  // 입력 검증과 같은 UTF-16 길이로 자르되 surrogate pair를 가르지 않는다.
  let clamped = "";
  for (const character of value) {
    if (clamped.length + character.length > DIGGING_PLAYLIST_TITLE_MAX_LENGTH) break;
    clamped += character;
  }
  return clamped.trim() || null;
}

export function diggingPlaylistDisplayTitle(playlist: {
  provider: DiggingPlaylistProviderName;
  title: string | null | undefined;
}): string {
  return playlist.title?.trim() || DIGGING_PLAYLIST_DEFAULT_TITLES[playlist.provider];
}
