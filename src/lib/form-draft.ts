export const FORM_DRAFT_STORAGE_VERSION = 1;

export type FormDraftStatus = "idle" | "saving" | "saved" | "conflict" | "error";

export type StoredFormDraft<T> = {
  data: T;
  savedAt: Date | null;
  legacy: boolean;
};

type FormDraftEnvelope<T> = {
  version: typeof FORM_DRAFT_STORAGE_VERSION;
  savedAt: number;
  data: T;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializeFormDraft<T>(data: T, savedAt = Date.now()): string {
  const envelope: FormDraftEnvelope<T> = {
    version: FORM_DRAFT_STORAGE_VERSION,
    savedAt,
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
        !("data" in parsed)
      ) {
        return null;
      }

      return {
        data: parsed.data as T,
        savedAt: new Date(parsed.savedAt),
        legacy: false,
      };
    }

    return { data: parsed as T, savedAt: null, legacy: true };
  } catch {
    return null;
  }
}

export function createDocumentDraftKey(
  kind: "note" | "qna-thread" | "qna-reply" | "community-post",
  ownerId: string,
  contextId = "new",
): string {
  const safeOwnerId = encodeURIComponent(ownerId);
  const safeContextId = encodeURIComponent(contextId);
  return `draft:document:${kind}:${safeOwnerId}:${safeContextId}`;
}

/** 마지막으로 관찰한 값과 현재 storage 값이 다르면 다른 탭의 변경으로 본다. */
export function hasFormDraftStorageConflict(
  expectedRaw: string | null,
  currentRaw: string | null,
): boolean {
  return expectedRaw !== currentRaw;
}
