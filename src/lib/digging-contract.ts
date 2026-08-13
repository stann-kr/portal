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
