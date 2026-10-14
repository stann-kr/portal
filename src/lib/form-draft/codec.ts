/** 버전별 envelope 해석과 key-order 독립 데이터 직렬화. */
import {
  FORM_DRAFT_STORAGE_VERSION,
  type StoredFormDraft,
} from "./contract";
import {
  bytesToHex,
  utf8ToBytes,
} from "@noble/hashes/utils";
import {
  sha256,
} from "@noble/hashes/sha256";

type FormDraftEnvelope<T> = {
  version: typeof FORM_DRAFT_STORAGE_VERSION;
  savedAt: number;
  retainedAt?: number;
  data: T;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasFutureEnvelopeVersion(raw: string, currentVersion: number): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    return (
      isRecord(parsed) &&
      typeof parsed.version === "number" &&
      Number.isSafeInteger(parsed.version) &&
      parsed.version > currentVersion
    );
  } catch {
    return false;
  }
}

const OMITTED_JSON_VALUE = Symbol("omitted-json-value");

function normalizeFormDraftData(
  value: unknown,
  ancestors: Set<object>,
  arrayValue = false,
): unknown | typeof OMITTED_JSON_VALUE {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return arrayValue ? null : OMITTED_JSON_VALUE;
  }
  if (typeof value === "bigint") {
    throw new TypeError("BigInt cannot be serialized as form draft data");
  }
  if (typeof value !== "object") return value;
  if (ancestors.has(value)) {
    throw new TypeError("Circular form draft data cannot be serialized");
  }

  ancestors.add(value);
  try {
    const serializable = value as { toJSON?: (key?: string) => unknown };
    if (typeof serializable.toJSON === "function") {
      return normalizeFormDraftData(serializable.toJSON(""), ancestors, arrayValue);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeFormDraftData(entry, ancestors, true));
    }

    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = normalizeFormDraftData((value as Record<string, unknown>)[key], ancestors);
      if (entry !== OMITTED_JSON_VALUE) normalized[key] = entry;
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

/** 저장 시각과 object key 순서에 영향받지 않는 draft data 비교용 signature. */
export function createFormDraftDataSignature(data: unknown): string {
  const normalized = normalizeFormDraftData(data, new Set());
  const serialized = normalized === OMITTED_JSON_VALUE
    ? "undefined"
    : JSON.stringify(normalized);
  return `sha256:${bytesToHex(sha256(utf8ToBytes(serialized)))}`;
}

/** 서버 초안과 local queue가 공유할 key-order 독립 JSON object를 만든다. */
export function serializeNormalizedFormDraftData(data: unknown): string {
  const normalized = normalizeFormDraftData(data, new Set());
  if (
    normalized === OMITTED_JSON_VALUE ||
    typeof normalized !== "object" ||
    normalized === null ||
    Array.isArray(normalized)
  ) {
    throw new TypeError("Document draft data must serialize to a JSON object");
  }
  return JSON.stringify(normalized);
}

export function serializeFormDraft<T>(
  data: T,
  savedAt = Date.now(),
  retainedAt?: number,
): string {
  if (!Number.isFinite(savedAt) || (retainedAt !== undefined && !Number.isFinite(retainedAt))) {
    throw new TypeError("Form draft timestamps must be finite");
  }
  const envelope: FormDraftEnvelope<T> = {
    version: FORM_DRAFT_STORAGE_VERSION,
    savedAt,
    ...(retainedAt === undefined ? {} : { retainedAt }),
    data,
  };

  return JSON.stringify(envelope);
}

/**
 * 현재 envelope와 이전 raw JSON draft를 함께 읽는다.
 * 알 수 없는 미래 version은 잘못 해석하지 않고 무시한다.
 */
export function parseFormDraft<T>(raw: string): StoredFormDraft<T> | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (isRecord(parsed) && "version" in parsed) {
      if (
        parsed.version !== FORM_DRAFT_STORAGE_VERSION ||
        typeof parsed.savedAt !== "number" ||
        !Number.isFinite(parsed.savedAt) ||
        ("retainedAt" in parsed &&
          (typeof parsed.retainedAt !== "number" ||
            !Number.isFinite(parsed.retainedAt))) ||
        !("data" in parsed)
      ) {
        return null;
      }

      return {
        data: parsed.data as T,
        savedAt: new Date(parsed.savedAt),
        ...(typeof parsed.retainedAt === "number"
          ? { retainedAt: new Date(parsed.retainedAt) }
          : {}),
        legacy: false,
      };
    }

    return { data: parsed as T, savedAt: null, legacy: true };
  } catch {
    return null;
  }
}

/** rolling deploy 중 구버전 client가 해석할 수 없는 미래 draft인지 판정한다. */
export function hasFutureFormDraftVersion(raw: string): boolean {
  return hasFutureEnvelopeVersion(raw, FORM_DRAFT_STORAGE_VERSION);
}
