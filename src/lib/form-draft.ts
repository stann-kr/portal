import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const FORM_DRAFT_STORAGE_VERSION = 1;
export const FORM_DRAFT_RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const FORM_DRAFT_CLEAR_MARKER_VERSION = 1;
export const FORM_DRAFT_CLEAR_MARKER_TTL_MS = FORM_DRAFT_RECOVERY_TTL_MS;
export const FORM_DRAFT_RECOVERY_RECENT_MS = 60 * 60 * 1000;
export const FORM_DRAFT_MAX_DIVERGENT_RECOVERIES = 20;

export type FormDraftStatus =
  | "idle"
  | "saving"
  | "saved"
  | "conflict"
  | "incompatible"
  | "error";

export type StoredFormDraft<T> = {
  data: T;
  savedAt: Date | null;
  retainedAt?: Date;
  legacy: boolean;
};

export type FormDraftRecovery<T> = {
  storageKey: string;
  data: T;
  savedAt: Date;
  retainedAt: Date;
  raw: string;
  signature: string;
};

export type FormDraftRecoveryPreview = {
  title: string | null;
  body: string | null;
};

export type FormDraftRecoverySummary = Pick<
  FormDraftRecovery<unknown>,
  "storageKey" | "savedAt"
> & {
  isCurrent: boolean;
  preview: FormDraftRecoveryPreview;
};

const FORM_DRAFT_TITLE_PREVIEW_LENGTH = 80;
const FORM_DRAFT_BODY_PREVIEW_LENGTH = 160;
const FORM_DRAFT_TITLE_PREVIEW_SCAN_LENGTH = 512;
const FORM_DRAFT_BODY_PREVIEW_SCAN_LENGTH = 4_096;
const FORM_DRAFT_PREVIEW_CONTROL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

function decodeFormDraftPreviewEntities(value: string): string {
  const namedEntities: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#(?:x([\da-f]+)|(\d+));/giu, (entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      if (
        !Number.isFinite(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return entity;
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/&([a-z]+);/giu, (entity, name: string) => namedEntities[name.toLowerCase()] ?? entity);
}

function truncateFormDraftPreview(value: string, maxLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, maxLength - 1).join("")}…`;
}

function createPlainTextFormDraftPreview(
  value: string | null,
  maxLength: number,
): string | null {
  if (!value) return null;

  const plainText = decodeFormDraftPreviewEntities(
    value
      .replace(/<!--[\s\S]*?(?:-->|$)/gu, " ")
      .replace(
        /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu,
        " ",
      )
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th|\/blockquote|\/pre)\b[^>]*>/giu, " ")
      .replace(/<[^>]*>/gu, " "),
  )
    .replace(FORM_DRAFT_PREVIEW_CONTROL_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return plainText
    ? truncateFormDraftPreview(plainText, maxLength)
    : null;
}

function readFormDraftPreviewField(
  data: unknown,
  fieldNames: readonly string[],
  scanLength: number,
): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value !== "string") continue;
    const boundedValue = value.slice(0, scanLength);
    if (/\S/u.test(boundedValue)) return boundedValue;
  }
  return null;
}

function createFormDraftEmbedPreview(contentHtml: string | null): string | null {
  if (!contentHtml) return null;
  const labels: string[] = [];
  if (/<img\b/iu.test(contentHtml)) labels.push("이미지 포함");
  if (/<iframe\b/iu.test(contentHtml)) labels.push("동영상 포함");
  if (/<table\b/iu.test(contentHtml)) labels.push("표 포함");
  if (/<hr\b/iu.test(contentHtml)) labels.push("구분선 포함");
  return labels.length > 0 ? labels.join(" · ") : null;
}

/** recovery data를 HTML로 렌더링하지 않고 사람이 구분할 수 있는 짧은 평문으로 축약한다. */
export function createFormDraftRecoveryPreview(
  data: unknown,
): FormDraftRecoveryPreview {
  const titleSource = readFormDraftPreviewField(
    data,
    ["title"],
    FORM_DRAFT_TITLE_PREVIEW_SCAN_LENGTH,
  );
  const bodySource = readFormDraftPreviewField(data, [
    "contentHtml",
    "content",
    "body",
    "text",
  ], FORM_DRAFT_BODY_PREVIEW_SCAN_LENGTH);
  const hasAttachment = Boolean(
    readFormDraftPreviewField(
      data,
      ["attachmentUrl", "mediaUrl"],
      FORM_DRAFT_TITLE_PREVIEW_SCAN_LENGTH,
    ),
  );

  return {
    title: createPlainTextFormDraftPreview(
      titleSource,
      FORM_DRAFT_TITLE_PREVIEW_LENGTH,
    ),
    body:
      createPlainTextFormDraftPreview(
        bodySource,
        FORM_DRAFT_BODY_PREVIEW_LENGTH,
      ) ??
      createFormDraftEmbedPreview(bodySource) ??
      (hasAttachment ? "첨부 파일 포함" : null),
  };
}

export type FormDraftRecoveryStorage = {
  readonly length: number;
  key: (index: number) => string | null;
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
};

export type FormDraftStorage = FormDraftRecoveryStorage & {
  setItem: (key: string, value: string) => void;
};

export type FormDraftClearMarker = {
  version: typeof FORM_DRAFT_CLEAR_MARKER_VERSION;
  signature: string;
  clearedAt: Date;
  raw: string;
};

export type FormDraftRecoveryRetentionOptions = {
  now?: number;
  maxDivergent?: number;
  recentMs?: number;
  protectedKeys?: Iterable<string>;
};

export type RemoveFormDraftSnapshotsOptions = {
  savedAtOrBefore?: number;
};

export type FormDraftRecoveryCompactionResult = {
  removedKeys: string[];
  invalidOrExpiredKeys: string[];
  duplicateKeys: string[];
  excessKeys: string[];
  resolvedMarkerKeys: string[];
};

export type PersistFormDraftSnapshotOptions<T> = {
  sourceKey: string;
  recoveryKey: string;
  data: T;
  expectedRaw: string | null;
  savedAt?: number;
};

export type PersistFormDraftRawSnapshotOptions = {
  sourceKey: string;
  recoveryKey: string;
  raw: string;
  expectedRaw: string | null;
};

export type PersistFormDraftSnapshotResult = {
  status: "saved" | "conflict";
  raw: string;
  currentRaw: string | null;
  recoveryKey: string;
};

type FormDraftEnvelope<T> = {
  version: typeof FORM_DRAFT_STORAGE_VERSION;
  savedAt: number;
  retainedAt?: number;
  data: T;
};

type FormDraftClearMarkerEnvelope = {
  version: typeof FORM_DRAFT_CLEAR_MARKER_VERSION;
  signature: string;
  clearedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFutureEnvelopeVersion(raw: string, currentVersion: number): boolean {
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

export function createDocumentDraftKey(
  kind: "note" | "qna-thread" | "qna-reply" | "community-post",
  ownerId: string,
  contextId = "new",
): string {
  const safeOwnerId = encodeURIComponent(ownerId);
  const safeContextId = encodeURIComponent(contextId);
  return `draft:document:${kind}:${safeOwnerId}:${safeContextId}`;
}

export function createFormDraftClearMarkerKey(sourceKey: string): string {
  return `draft:document-clear-marker:${encodeURIComponent(sourceKey)}`;
}

export function createFormDraftClearMarkerEntryPrefix(sourceKey: string): string {
  return `${createFormDraftClearMarkerKey(sourceKey)}:entry:`;
}

export function createFormDraftClearMarkerEntryKey(
  sourceKey: string,
  signature: string,
  clearedAt: number,
): string {
  return `${createFormDraftClearMarkerEntryPrefix(sourceKey)}${clearedAt}:${encodeURIComponent(signature)}`;
}

export function isFormDraftClearMarkerKey(
  sourceKey: string,
  candidateKey: string,
): boolean {
  return candidateKey === createFormDraftClearMarkerKey(sourceKey) ||
    candidateKey.startsWith(createFormDraftClearMarkerEntryPrefix(sourceKey));
}

/** 제출 완료 snapshot을 recovery 보존 기간 동안 식별하는 marker를 기록한다. */
export function writeFormDraftClearMarker(
  storage: FormDraftStorage,
  sourceKey: string,
  signature: string,
  clearedAt = Date.now(),
): FormDraftClearMarker {
  if (!Number.isFinite(clearedAt)) {
    throw new TypeError("Form draft clear marker time must be finite");
  }

  const envelope: FormDraftClearMarkerEnvelope = {
    version: FORM_DRAFT_CLEAR_MARKER_VERSION,
    signature,
    clearedAt,
  };
  const raw = JSON.stringify(envelope);
  const headKey = createFormDraftClearMarkerKey(sourceKey);
  const promoteLegacyHead = (headRaw: string | null) => {
    const marker = headRaw ? parseFormDraftClearMarker(headRaw, clearedAt) : null;
    if (!marker) return;
    storage.setItem(
      createFormDraftClearMarkerEntryKey(
        sourceKey,
        marker.signature,
        marker.clearedAt.getTime(),
      ),
      marker.raw,
    );
  };

  promoteLegacyHead(storage.getItem(headKey));
  storage.setItem(createFormDraftClearMarkerEntryKey(sourceKey, signature, clearedAt), raw);
  const latestHeadRaw = storage.getItem(headKey);
  promoteLegacyHead(latestHeadRaw);
  if (
    !latestHeadRaw ||
    !hasFutureEnvelopeVersion(latestHeadRaw, FORM_DRAFT_CLEAR_MARKER_VERSION)
  ) {
    storage.setItem(headKey, raw);
  }
  pruneFormDraftClearMarkers(storage, sourceKey, clearedAt);
  return {
    version: FORM_DRAFT_CLEAR_MARKER_VERSION,
    signature,
    clearedAt: new Date(clearedAt),
    raw,
  };
}

/** 유효 기간 안의 document-scoped clear marker만 반환한다. */
export function parseFormDraftClearMarker(
  raw: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== FORM_DRAFT_CLEAR_MARKER_VERSION ||
      typeof parsed.signature !== "string" ||
      typeof parsed.clearedAt !== "number" ||
      !Number.isFinite(parsed.clearedAt) ||
      now - parsed.clearedAt > FORM_DRAFT_CLEAR_MARKER_TTL_MS
    ) {
      return null;
    }

    const clearedAt = new Date(parsed.clearedAt);
    if (!Number.isFinite(clearedAt.getTime())) return null;
    return {
      version: FORM_DRAFT_CLEAR_MARKER_VERSION,
      signature: parsed.signature,
      clearedAt,
      raw,
    };
  } catch {
    return null;
  }
}

function collectFormDraftClearMarkerKeys(
  storage: Pick<FormDraftRecoveryStorage, "length" | "key">,
  sourceKey: string,
): string[] {
  const markerKey = createFormDraftClearMarkerKey(sourceKey);
  const entryPrefix = createFormDraftClearMarkerEntryPrefix(sourceKey);
  const keys = [markerKey];

  for (let index = 0; index < storage.length; index += 1) {
    const candidateKey = storage.key(index);
    if (candidateKey?.startsWith(entryPrefix)) keys.push(candidateKey);
  }
  return keys;
}

/** TTL 안의 제출 tombstone을 signature별 최신 시각으로 반환한다. */
export function readFormDraftClearMarkers(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  now = Date.now(),
): FormDraftClearMarker[] {
  const markersBySignature = new Map<string, FormDraftClearMarker>();
  for (const markerKey of collectFormDraftClearMarkerKeys(storage, sourceKey)) {
    const raw = storage.getItem(markerKey);
    const marker = raw ? parseFormDraftClearMarker(raw, now) : null;
    if (!marker) continue;

    const previous = markersBySignature.get(marker.signature);
    if (!previous || marker.clearedAt.getTime() > previous.clearedAt.getTime()) {
      markersBySignature.set(marker.signature, marker);
    }
  }

  return [...markersBySignature.values()]
    .sort((left, right) => right.clearedAt.getTime() - left.clearedAt.getTime());
}

/** 유효 기간 안의 가장 최근 document-scoped clear marker를 반환한다. */
export function readFormDraftClearMarker(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  return readFormDraftClearMarkers(storage, sourceKey, now)[0] ?? null;
}

/** 특정 data signature의 최근 제출 tombstone을 반환한다. */
export function findFormDraftClearMarker(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  signature: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  return readFormDraftClearMarkers(storage, sourceKey, now)
    .find((marker) => marker.signature === signature) ?? null;
}

/** 제출 cutoff 이전 canonical snapshot을 해결된 ghost로 판정한다. */
export function findFormDraftClearMarkerForSnapshot<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  raw: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  const stored = parseFormDraft<T>(raw);
  if (!stored) return null;

  const marker = findFormDraftClearMarker(
    storage,
    sourceKey,
    createFormDraftDataSignature(stored.data),
    now,
  );
  if (!marker) return null;

  const savedAt = stored.savedAt?.getTime();
  return savedAt === undefined || savedAt <= marker.clearedAt.getTime()
    ? marker
    : null;
}

/** signature·cutoff가 일치하는 canonical snapshot만 CAS 삭제한다. */
export function removeFormDraftCanonicalSnapshotBySignature<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  signature: string,
  options: RemoveFormDraftSnapshotsOptions = {},
): boolean {
  const cutoff = options.savedAtOrBefore;
  if (cutoff !== undefined && !Number.isFinite(cutoff)) {
    throw new TypeError("Form draft snapshot cutoff must be finite");
  }

  const observedRaw = storage.getItem(sourceKey);
  const stored = observedRaw ? parseFormDraft<T>(observedRaw) : null;
  if (!observedRaw || !stored) return false;
  if (createFormDraftDataSignature(stored.data) !== signature) return false;

  const savedAt = stored.savedAt?.getTime();
  if (cutoff !== undefined && savedAt !== undefined && savedAt > cutoff) {
    return false;
  }
  if (storage.getItem(sourceKey) !== observedRaw) return false;
  storage.removeItem(sourceKey);
  return true;
}

/** 만료·손상·cap 초과 tombstone을 CAS 정리하고 최신 marker 목록을 반환한다. */
export function pruneFormDraftClearMarkers(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  now = Date.now(),
): FormDraftClearMarker[] {
  const markerKey = createFormDraftClearMarkerKey(sourceKey);
  const validEntries: Array<{
    storageKey: string;
    marker: FormDraftClearMarker;
  }> = [];

  for (const storageKey of collectFormDraftClearMarkerKeys(storage, sourceKey)) {
    const observedRaw = storage.getItem(storageKey);
    if (!observedRaw) continue;

    const marker = parseFormDraftClearMarker(observedRaw, now);
    if (!marker) {
      if (hasFutureEnvelopeVersion(observedRaw, FORM_DRAFT_CLEAR_MARKER_VERSION)) continue;
      if (storage.getItem(storageKey) === observedRaw) storage.removeItem(storageKey);
      continue;
    }
    if (storageKey !== markerKey) validEntries.push({ storageKey, marker });
  }

  validEntries.sort(
    (left, right) => right.marker.clearedAt.getTime() - left.marker.clearedAt.getTime(),
  );
  const seenSignatures = new Set<string>();
  const duplicateEntries: typeof validEntries = [];
  for (const entry of validEntries) {
    if (seenSignatures.has(entry.marker.signature)) duplicateEntries.push(entry);
    else seenSignatures.add(entry.marker.signature);
  }

  for (const removable of duplicateEntries) {
    if (storage.getItem(removable.storageKey) === removable.marker.raw) {
      storage.removeItem(removable.storageKey);
    }
  }

  return readFormDraftClearMarkers(storage, sourceKey, now);
}

/** 단일 marker API 호환 wrapper. */
export function pruneFormDraftClearMarker(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  now = Date.now(),
): FormDraftClearMarker | null {
  return pruneFormDraftClearMarkers(storage, sourceKey, now)[0] ?? null;
}

export function removeFormDraftClearMarker(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
): void {
  for (const markerKey of collectFormDraftClearMarkerKeys(storage, sourceKey)) {
    storage.removeItem(markerKey);
  }
}

export function createFormDraftRecoveryPrefix(sourceKey: string): string {
  return `draft:document-recovery:${encodeURIComponent(sourceKey)}:`;
}

export function createFormDraftRecoveryKey(sourceKey: string, recoveryId: string): string {
  return `${createFormDraftRecoveryPrefix(sourceKey)}${encodeURIComponent(recoveryId)}`;
}

/** raw snapshot과 결합된 불변 recovery key를 만든다. 같은 key에 다른 내용을 덮어쓰지 않는다. */
export function createImmutableFormDraftRecoveryKey(
  sourceKey: string,
  writerId: string,
  raw: string,
): string {
  const rawSignature = bytesToHex(sha256(utf8ToBytes(raw)));
  return createFormDraftRecoveryKey(
    sourceKey,
    `snapshot:${rawSignature}:${writerId}`,
  );
}

function readImmutableFormDraftRecoveryRawSignature(
  sourceKey: string,
  recoveryKey: string,
): string | null {
  const prefix = createFormDraftRecoveryPrefix(sourceKey);
  if (!recoveryKey.startsWith(prefix)) return null;

  try {
    const recoveryId = decodeURIComponent(recoveryKey.slice(prefix.length));
    const match = /^snapshot:([0-9a-f]{64}):/u.exec(recoveryId);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 새 client가 내용별 불변 프로토콜로 만든 recovery key인지 판정한다. */
export function isImmutableFormDraftRecoveryKey(
  sourceKey: string,
  recoveryKey: string,
): boolean {
  return readImmutableFormDraftRecoveryRawSignature(sourceKey, recoveryKey) !== null;
}

function assertImmutableFormDraftRecoveryRaw(
  sourceKey: string,
  recoveryKey: string,
  raw: string,
): void {
  const expectedSignature = readImmutableFormDraftRecoveryRawSignature(
    sourceKey,
    recoveryKey,
  );
  if (!expectedSignature) return;
  const actualSignature = bytesToHex(sha256(utf8ToBytes(raw)));
  if (expectedSignature !== actualSignature) {
    throw new Error("Immutable form draft recovery key does not match its snapshot");
  }
}

export function isFormDraftRecoveryKey(sourceKey: string, candidateKey: string): boolean {
  return candidateKey.startsWith(createFormDraftRecoveryPrefix(sourceKey));
}

function parseFormDraftRecoveryRaw<T>(
  storageKey: string,
  raw: string,
  now: number,
): FormDraftRecovery<T> | null {
  const stored = parseFormDraft<T>(raw);
  const savedAt = stored?.savedAt;
  const savedAtMs = savedAt?.getTime();
  const retainedAt = stored?.retainedAt ?? savedAt;
  const retainedAtMs = retainedAt?.getTime();
  if (
    !stored ||
    stored.legacy ||
    !savedAt ||
    savedAtMs === undefined ||
    !Number.isFinite(savedAtMs) ||
    !retainedAt ||
    retainedAtMs === undefined ||
    !Number.isFinite(retainedAtMs) ||
    now - retainedAtMs > FORM_DRAFT_RECOVERY_TTL_MS
  ) {
    return null;
  }

  return {
    storageKey,
    data: stored.data,
    savedAt,
    retainedAt,
    raw,
    signature: createFormDraftDataSignature(stored.data),
  };
}

/** namespace와 TTL을 검증해 선택한 복구본을 읽되 storage에서는 삭제하지 않는다. */
export function readFormDraftRecovery<T>(
  storage: Pick<FormDraftRecoveryStorage, "getItem">,
  sourceKey: string,
  storageKey: string,
  now = Date.now(),
): FormDraftRecovery<T> | null {
  if (!isFormDraftRecoveryKey(sourceKey, storageKey)) return null;

  const raw = storage.getItem(storageKey);
  return raw ? parseFormDraftRecoveryRaw<T>(storageKey, raw, now) : null;
}

type ResolvedFormDraftRecoveryRetention = {
  now: number;
  maxDivergent: number;
  recentMs: number;
  protectedKeys: Set<string>;
};

type RetainedFormDraftRecovery<T> = FormDraftRecovery<T> & {
  protected: boolean;
  recent: boolean;
};

function resolveFormDraftRecoveryRetention(
  optionsOrNow: number | FormDraftRecoveryRetentionOptions | undefined,
): ResolvedFormDraftRecoveryRetention {
  const options = typeof optionsOrNow === "number" ? { now: optionsOrNow } : optionsOrNow;
  const now = options?.now ?? Date.now();
  const requestedMax = options?.maxDivergent ?? FORM_DRAFT_MAX_DIVERGENT_RECOVERIES;
  const requestedRecentMs = options?.recentMs ?? FORM_DRAFT_RECOVERY_RECENT_MS;
  return {
    now,
    maxDivergent: Number.isFinite(requestedMax)
      ? Math.max(0, Math.floor(requestedMax))
      : FORM_DRAFT_MAX_DIVERGENT_RECOVERIES,
    recentMs: Number.isFinite(requestedRecentMs)
      ? Math.max(0, requestedRecentMs)
      : FORM_DRAFT_RECOVERY_RECENT_MS,
    protectedKeys: new Set(options?.protectedKeys ?? []),
  };
}

function collectFormDraftRecoveryKeys(
  storage: Pick<FormDraftRecoveryStorage, "length" | "key">,
  sourceKey: string,
): string[] {
  const prefix = createFormDraftRecoveryPrefix(sourceKey);
  const candidateKeys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const candidateKey = storage.key(index);
    if (candidateKey?.startsWith(prefix)) candidateKeys.push(candidateKey);
  }
  return candidateKeys;
}

function removeObservedFormDraftValue(
  storage: Pick<FormDraftRecoveryStorage, "getItem" | "removeItem">,
  storageKey: string,
  observedRaw: string,
): boolean {
  if (storage.getItem(storageKey) !== observedRaw) return false;
  storage.removeItem(storageKey);
  return true;
}

function collectValidFormDraftRecoveries<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  retention: ResolvedFormDraftRecoveryRetention,
  invalidOrExpiredKeys?: string[],
): RetainedFormDraftRecovery<T>[] {
  const valid: RetainedFormDraftRecovery<T>[] = [];
  for (const storageKey of collectFormDraftRecoveryKeys(storage, sourceKey)) {
    const observedRaw = storage.getItem(storageKey);
    const recovery = observedRaw
      ? parseFormDraftRecoveryRaw<T>(storageKey, observedRaw, retention.now)
      : null;
    if (!observedRaw || !recovery) {
      if (observedRaw && hasFutureFormDraftVersion(observedRaw)) continue;
      if (
        observedRaw &&
        isImmutableFormDraftRecoveryKey(sourceKey, storageKey) &&
        removeObservedFormDraftValue(storage, storageKey, observedRaw)
      ) {
        invalidOrExpiredKeys?.push(storageKey);
      }
      continue;
    }

    valid.push({
      ...recovery,
      protected: retention.protectedKeys.has(storageKey),
      recent: retention.now - recovery.retainedAt.getTime() <= retention.recentMs,
    });
  }

  valid.sort((left, right) => right.retainedAt.getTime() - left.retainedAt.getTime());
  return valid;
}

type FormDraftCanonicalMetadata = {
  signature: string;
  savedAt: Date | null;
};

function getFormDraftCanonicalMetadata<T>(
  raw: string | null,
): FormDraftCanonicalMetadata | null {
  const stored = raw ? parseFormDraft<T>(raw) : null;
  if (!stored) return null;
  return {
    signature: createFormDraftDataSignature(stored.data),
    savedAt: stored.savedAt,
  };
}

function getLiveFormDraftCanonicalSignature(
  canonical: FormDraftCanonicalMetadata | null,
  markersBySignature: ReadonlyMap<string, FormDraftClearMarker>,
): string | null {
  if (!canonical) return null;
  const marker = markersBySignature.get(canonical.signature);
  if (!marker) return canonical.signature;
  return canonical.savedAt && canonical.savedAt.getTime() > marker.clearedAt.getTime()
    ? canonical.signature
    : null;
}

/**
 * quota retry 전에 TTL/손상, 오래된 물리 중복, 오래된 cap 초과본 순으로 안전하게 정리한다.
 * 최근 1시간 및 protected key는 cap·중복 정리로 삭제하지 않는다.
 */
export function compactFormDraftRecoveries<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  optionsOrNow?: number | FormDraftRecoveryRetentionOptions,
): FormDraftRecoveryCompactionResult {
  const retention = resolveFormDraftRecoveryRetention(optionsOrNow);
  const result: FormDraftRecoveryCompactionResult = {
    removedKeys: [],
    invalidOrExpiredKeys: [],
    duplicateKeys: [],
    excessKeys: [],
    resolvedMarkerKeys: [],
  };
  const valid = collectValidFormDraftRecoveries<T>(
    storage,
    sourceKey,
    retention,
    result.invalidOrExpiredKeys,
  );
  const markers = pruneFormDraftClearMarkers(storage, sourceKey, retention.now);
  const markersBySignature = new Map(
    markers.map((marker) => [marker.signature, marker] as const),
  );

  const recordRemoval = (
    recovery: RetainedFormDraftRecovery<T>,
    bucket: string[],
  ) => {
    if (recovery.protected || recovery.recent) return false;
    if (!isImmutableFormDraftRecoveryKey(sourceKey, recovery.storageKey)) return false;
    if (!removeObservedFormDraftValue(storage, recovery.storageKey, recovery.raw)) return false;
    bucket.push(recovery.storageKey);
    return true;
  };

  const groups = new Map<string, RetainedFormDraftRecovery<T>[]>();
  for (const recovery of valid) {
    const group = groups.get(recovery.signature) ?? [];
    group.push(recovery);
    groups.set(recovery.signature, group);
  }

  // 같은 data는 causal savedAt이 가장 최신인 snapshot을 대표로 삼는다.
  // 이후 marker가 생겨도 대표만 stale이고 삭제본만 live인 역전이 생기지 않는다.
  for (const group of groups.values()) {
    const representative = group.reduce((latest, recovery) => {
      const savedAtDelta = recovery.savedAt.getTime() - latest.savedAt.getTime();
      if (savedAtDelta > 0) return recovery;
      if (savedAtDelta < 0) return latest;
      const retainedAtDelta =
        recovery.retainedAt.getTime() - latest.retainedAt.getTime();
      if (retainedAtDelta > 0) return recovery;
      if (retainedAtDelta < 0) return latest;
      return recovery.storageKey > latest.storageKey ? recovery : latest;
    });
    for (const duplicate of group) {
      if (duplicate !== representative) recordRemoval(duplicate, result.duplicateKeys);
    }
  }

  // canonical과 recovery는 서로 다른 key라 교체와 삭제를 하나의 CAS로 묶을 수 없다.
  // 같은 내용의 recovery도 후속 marker 뒤에는 유효본이 될 수 있어 물리 보존한다.
  const canonical = getFormDraftCanonicalMetadata<T>(storage.getItem(sourceKey));
  const canonicalSignature = getLiveFormDraftCanonicalSignature(
    canonical,
    markersBySignature,
  );

  for (const marker of markers) {
    const resolved = groups.get(marker.signature) ?? [];
    for (const recovery of resolved) {
      if (recovery.savedAt.getTime() <= marker.clearedAt.getTime()) {
        recordRemoval(recovery, result.resolvedMarkerKeys);
      }
    }
  }

  const liveGroups = [...groups.entries()].flatMap(([signature, group]) => {
    const live = group.filter(
      (recovery) => storage.getItem(recovery.storageKey) === recovery.raw,
    );
    return live.length > 0 ? [{ signature, recoveries: live }] : [];
  });
  const divergentGroups = liveGroups
    .flatMap(({ signature, recoveries }) => {
      if (signature === canonicalSignature) return [];
      const marker = markersBySignature.get(signature);
      const visibleRecoveries = marker
        ? recoveries.filter(
            (recovery) => recovery.savedAt.getTime() > marker.clearedAt.getTime(),
          )
        : recoveries;
      return visibleRecoveries.length > 0
        ? [{
            signature,
            recoveries: visibleRecoveries,
            liveRecoveryCount: recoveries.length,
          }]
        : [];
    })
    .sort(
      (left, right) =>
        right.recoveries[0]!.retainedAt.getTime() -
        left.recoveries[0]!.retainedAt.getTime(),
    );

  for (const group of divergentGroups.slice(retention.maxDivergent)) {
    // recent/protected/mutable duplicate가 남은 group에서 causal 최신 대표만
    // 지우면 후속 marker가 남은 과거본만 숨길 수 있으므로 group 전체를 보존한다.
    if (group.liveRecoveryCount !== 1) continue;
    recordRemoval(group.recoveries[0]!, result.excessKeys);
  }

  result.removedKeys = [
    ...result.invalidOrExpiredKeys,
    ...result.duplicateKeys,
    ...result.resolvedMarkerKeys,
    ...result.excessKeys,
  ];
  return result;
}

/**
 * recovery를 안전하게 compact하고 canonical/clear marker와 다른 unique data를 최신순으로 반환한다.
 * cap 밖이라도 recent/protected recovery는 목록과 storage에 유지한다.
 */
export function pruneFormDraftRecoveries<T>(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  optionsOrNow?: number | FormDraftRecoveryRetentionOptions,
): FormDraftRecovery<T>[] {
  const retention = resolveFormDraftRecoveryRetention(optionsOrNow);
  compactFormDraftRecoveries<T>(storage, sourceKey, {
    now: retention.now,
    maxDivergent: retention.maxDivergent,
    recentMs: retention.recentMs,
    protectedKeys: retention.protectedKeys,
  });

  const valid = collectValidFormDraftRecoveries<T>(storage, sourceKey, retention);

  const markersBySignature = new Map(
    readFormDraftClearMarkers(storage, sourceKey, retention.now)
      .map((marker) => [marker.signature, marker] as const),
  );
  const canonical = getFormDraftCanonicalMetadata<T>(storage.getItem(sourceKey));
  const canonicalSignature = getLiveFormDraftCanonicalSignature(
    canonical,
    markersBySignature,
  );
  const visibleBySignature = new Map<string, RetainedFormDraftRecovery<T>>();
  for (const recovery of valid) {
      const marker = markersBySignature.get(recovery.signature);
      if (
        marker &&
        recovery.savedAt.getTime() <= marker.clearedAt.getTime()
      ) {
        continue;
      }
      if (canonicalSignature === recovery.signature) {
        continue;
      }

      const selected = visibleBySignature.get(recovery.signature);
      if (
        !selected ||
        recovery.savedAt.getTime() > selected.savedAt.getTime() ||
        (recovery.savedAt.getTime() === selected.savedAt.getTime() &&
          recovery.retainedAt.getTime() > selected.retainedAt.getTime())
      ) {
        visibleBySignature.set(recovery.signature, recovery);
      }
  }

  return [...visibleBySignature.values()]
    .sort((left, right) => right.retainedAt.getTime() - left.retainedAt.getTime())
    .map((recovery) => ({
      storageKey: recovery.storageKey,
      data: recovery.data,
      savedAt: recovery.savedAt,
      retainedAt: recovery.retainedAt,
      raw: recovery.raw,
      signature: recovery.signature,
    }));
}

/**
 * 제출·명시 폐기된 data와 같은 recovery mirror만 문서 namespace에서 제거한다.
 * 삭제 직전에 raw를 다시 비교해 그 사이 다른 data로 바뀐 recovery는 보존한다.
 */
export function removeFormDraftSnapshotsBySignature(
  storage: FormDraftRecoveryStorage,
  sourceKey: string,
  signature: string,
  options: RemoveFormDraftSnapshotsOptions = {},
): string[] {
  const cutoff = options.savedAtOrBefore;
  if (cutoff !== undefined && !Number.isFinite(cutoff)) {
    throw new TypeError("Form draft snapshot cutoff must be finite");
  }
  const prefix = createFormDraftRecoveryPrefix(sourceKey);
  const candidateKeys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const candidateKey = storage.key(index);
    if (candidateKey?.startsWith(prefix)) candidateKeys.push(candidateKey);
  }

  const removedKeys: string[] = [];
  for (const storageKey of candidateKeys) {
    if (!isImmutableFormDraftRecoveryKey(sourceKey, storageKey)) continue;
    const observedRaw = storage.getItem(storageKey);
    const observed = observedRaw ? parseFormDraft<unknown>(observedRaw) : null;
    if (!observed || createFormDraftDataSignature(observed.data) !== signature) continue;
    const observedSavedAt = observed.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (cutoff !== undefined && observedSavedAt > cutoff) continue;

    const currentRaw = storage.getItem(storageKey);
    if (currentRaw !== observedRaw) continue;
    const current = currentRaw ? parseFormDraft<unknown>(currentRaw) : null;
    if (!current || createFormDraftDataSignature(current.data) !== signature) continue;
    const currentSavedAt = current.savedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (cutoff !== undefined && currentSavedAt > cutoff) continue;

    storage.removeItem(storageKey);
    removedKeys.push(storageKey);
  }

  return removedKeys;
}

/**
 * 이미 직렬화한 snapshot을 own shadow에 먼저 쓴 뒤 optimistic canonical write를 시도한다.
 * canonical compare/write 사이에 다른 writer가 개입해도 shadow는 유지된다.
 */
export function persistFormDraftRawSnapshot(
  storage: FormDraftStorage,
  options: PersistFormDraftRawSnapshotOptions,
): PersistFormDraftSnapshotResult {
  const { sourceKey, recoveryKey, raw, expectedRaw } = options;
  if (!isFormDraftRecoveryKey(sourceKey, recoveryKey)) {
    throw new Error("Form draft recovery key does not belong to the source document");
  }
  assertImmutableFormDraftRecoveryRaw(sourceKey, recoveryKey, raw);

  const existingRecoveryRaw = storage.getItem(recoveryKey);
  if (existingRecoveryRaw !== null && existingRecoveryRaw !== raw) {
    throw new Error("Immutable form draft recovery key cannot be overwritten");
  }

  storage.setItem(recoveryKey, raw);

  const currentRaw = storage.getItem(sourceKey);
  if (hasFormDraftStorageConflict(expectedRaw, currentRaw)) {
    return { status: "conflict", raw, currentRaw, recoveryKey };
  }

  storage.setItem(sourceKey, raw);
  const persistedCanonicalRaw = storage.getItem(sourceKey);
  return {
    status: persistedCanonicalRaw === raw ? "saved" : "conflict",
    raw,
    currentRaw: persistedCanonicalRaw,
    recoveryKey,
  };
}

/** data를 versioned envelope로 만든 뒤 shadow-first로 저장한다. */
export function persistFormDraftSnapshot<T>(
  storage: FormDraftStorage,
  options: PersistFormDraftSnapshotOptions<T>,
): PersistFormDraftSnapshotResult {
  const raw = serializeFormDraft(options.data, options.savedAt);
  return persistFormDraftRawSnapshot(storage, { ...options, raw });
}

/** 마지막으로 관찰한 값과 현재 storage 값이 다르면 다른 탭의 변경으로 본다. */
export function hasFormDraftStorageConflict(
  expectedRaw: string | null,
  currentRaw: string | null,
): boolean {
  return expectedRaw !== currentRaw;
}
