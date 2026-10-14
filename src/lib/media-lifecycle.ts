import { parseCreationOperationId } from "./creation-operation";

export const MEDIA_PURPOSES = [
  "COMMUNITY_POST_AUDIO",
  "QNA_ATTACHMENT",
] as const;

export type MediaUploadPurpose = (typeof MEDIA_PURPOSES)[number];
export type MediaPurpose = MediaUploadPurpose;

export const MEDIA_OBJECT_STATES = [
  "PENDING_UPLOAD",
  "SEALING",
  "READY",
  "ATTACHED",
  "PENDING_DELETE",
  "DELETED",
] as const;

export type MediaObjectState = (typeof MEDIA_OBJECT_STATES)[number];

export const MEDIA_DELETION_REASONS = [
  "UPLOAD_STAGING_EXPIRED",
  "ABANDONED_UPLOAD",
  "EXPIRED_UNATTACHED",
  "RESOURCE_PURGED",
  "ACCOUNT_DELETION",
  "UPLOAD_VERIFICATION_FAILED",
  "ADMIN_CLEANUP",
] as const;

export type MediaDeletionReason = (typeof MEDIA_DELETION_REASONS)[number];

const TWO_GIBIBYTES = 2 * 1024 * 1024 * 1024;

export const MEDIA_UPLOAD_URL_TTL_SECONDS = 60 * 60;
/** URL 만료 전에 browser PUT을 중단해 staging cleanup 경계를 유한하게 유지한다. */
export const MEDIA_UPLOAD_CLIENT_TIMEOUT_MS = 55 * 60 * 1_000;
/** presigned PUT은 object가 한 번 생긴 뒤 같은 URL로 덮어쓸 수 없어야 한다. */
export const MEDIA_UPLOAD_IF_NONE_MATCH = "*";
/** 만료 직전에 시작된 PUT이 끝날 시간을 둔 뒤 staging key를 정리한다. */
export const MEDIA_UPLOAD_STAGING_GRACE_SECONDS = 60 * 60;
export const MEDIA_SEAL_LEASE_SECONDS = 15 * 60;
/** CopyObject 요청 상한보다 길게 두어 만료 lease의 late copy를 final 삭제가 뒤따르게 한다. */
export const MEDIA_SEAL_RECOVERY_GRACE_SECONDS = 60 * 60;
export const MEDIA_SEAL_HEAD_TIMEOUT_MS = 60 * 1_000;
export const MEDIA_SEAL_REQUEST_TIMEOUT_MS = 10 * 60 * 1_000;
/** 사용자 요청 안의 best-effort delete가 outbox lease와 응답을 붙잡지 않게 한다. */
export const MEDIA_DELETE_REQUEST_TIMEOUT_MS = 2_000;
export const MEDIA_DRAFT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const MEDIA_OWNER_UNATTACHED_OBJECT_LIMIT = 8;
export const MEDIA_OWNER_UNATTACHED_BYTES_LIMIT = 4 * 1024 * 1024 * 1024;

export function mediaUploadRequestHeaders(contentType: string) {
  return {
    "Content-Type": contentType,
    "If-None-Match": MEDIA_UPLOAD_IF_NONE_MATCH,
  } as const;
}

const AUDIO_MIME_TYPES = [
  "audio/aiff",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
] as const;

const QNA_ATTACHMENT_MIME_TYPES = [
  ...AUDIO_MIME_TYPES,
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
] as const;

export interface MediaUploadPolicy {
  readonly keyPrefix: string;
  readonly uploadKeyPrefix: string;
  readonly allowedMimeTypes: readonly string[];
  readonly maxFileSizeBytes: number;
  readonly uploadUrlTtlSeconds: number;
}

export type MediaPurposePolicy = MediaUploadPolicy;

/** 클라이언트 입력으로 덮어쓸 수 없는 업로드 목적별 서버 정책이다. */
export const MEDIA_PURPOSE_POLICIES = {
  COMMUNITY_POST_AUDIO: {
    keyPrefix: "media/community-post-audio/",
    uploadKeyPrefix: "media-upload/community-post-audio/",
    allowedMimeTypes: AUDIO_MIME_TYPES,
    maxFileSizeBytes: TWO_GIBIBYTES,
    uploadUrlTtlSeconds: MEDIA_UPLOAD_URL_TTL_SECONDS,
  },
  QNA_ATTACHMENT: {
    keyPrefix: "media/qna-attachment/",
    uploadKeyPrefix: "media-upload/qna-attachment/",
    allowedMimeTypes: QNA_ATTACHMENT_MIME_TYPES,
    maxFileSizeBytes: TWO_GIBIBYTES,
    uploadUrlTtlSeconds: MEDIA_UPLOAD_URL_TTL_SECONDS,
  },
} as const satisfies Record<MediaUploadPurpose, MediaUploadPolicy>;

export interface MediaUploadInput {
  purpose: MediaUploadPurpose;
  fileName: string;
  mimeType: string;
  fileSize: number;
  draftOperationId: string;
}

export interface ValidatedMediaUploadInput {
  purpose: MediaUploadPurpose;
  canonicalMimeType: string;
  fileSize: number;
  draftOperationId: string;
}

export const MEDIA_UPLOAD_VALIDATION_CODES = [
  "INVALID_INPUT",
  "INVALID_PURPOSE",
  "INVALID_FILE_NAME",
  "INVALID_MIME_TYPE",
  "INVALID_FILE_SIZE",
  "INVALID_DRAFT_OPERATION_ID",
] as const;

export type MediaUploadValidationCode =
  (typeof MEDIA_UPLOAD_VALIDATION_CODES)[number];

export interface MediaUploadValidationFailure {
  ok: false;
  code: MediaUploadValidationCode;
  message: string;
}

export interface MediaUploadValidationSuccess {
  ok: true;
  value: ValidatedMediaUploadInput;
}

export type MediaUploadValidationResult =
  | MediaUploadValidationSuccess
  | MediaUploadValidationFailure;

export interface MediaUploadIntentResult {
  mediaObjectId: string;
  objectKey: string;
  uploadObjectKey: string;
  purpose: MediaUploadPurpose;
  canonicalMimeType: string;
  expectedSizeBytes: number;
  draftOperationId: string;
}

export type MediaUploadIntentPreparationResult =
  | { ok: true; intent: MediaUploadIntentResult }
  | MediaUploadValidationFailure;

export type MediaUuidFactory = () => string;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const INVALID_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f/\\]/u;
const MAX_FILE_NAME_UTF8_BYTES = 255;
const DEFAULT_LEGACY_MEDIA_PREFIXES = ["audio/", "qna/"] as const;
const LEGACY_OBJECT_KEY_PATTERN = /^[A-Za-z0-9._/-]+$/u;

function validationFailure(
  code: MediaUploadValidationCode,
  message: string,
): MediaUploadValidationFailure {
  return { ok: false, code, message };
}

function isMediaPurpose(value: unknown): value is MediaUploadPurpose {
  return (
    typeof value === "string" &&
    (MEDIA_PURPOSES as readonly string[]).includes(value)
  );
}

function isValidFileName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value !== value.trim() || value === "." || value === "..") return false;
  if (INVALID_FILE_NAME_CHARACTERS.test(value)) return false;
  return new TextEncoder().encode(value).byteLength <= MAX_FILE_NAME_UTF8_BYTES;
}

/** 외부 업로드 요청을 서버 목적 정책에 맞춰 정규화하고 검증한다. */
export function validateMediaUploadInput(
  input: unknown,
): MediaUploadValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return validationFailure("INVALID_INPUT", "업로드 요청 형식이 올바르지 않습니다.");
  }

  const candidate = input as Record<string, unknown>;
  if (!isMediaPurpose(candidate.purpose)) {
    return validationFailure("INVALID_PURPOSE", "지원하지 않는 업로드 목적입니다.");
  }

  if (!isValidFileName(candidate.fileName)) {
    return validationFailure("INVALID_FILE_NAME", "파일 이름이 올바르지 않습니다.");
  }

  const policy = MEDIA_PURPOSE_POLICIES[candidate.purpose];
  const rawMimeType = candidate.mimeType;
  if (
    typeof rawMimeType !== "string" ||
    rawMimeType !== rawMimeType.trim() ||
    !(policy.allowedMimeTypes as readonly string[]).includes(
      rawMimeType.toLowerCase(),
    )
  ) {
    return validationFailure(
      "INVALID_MIME_TYPE",
      "업로드 목적에 허용되지 않는 파일 형식입니다.",
    );
  }
  const canonicalMimeType = rawMimeType.toLowerCase();

  if (
    typeof candidate.fileSize !== "number" ||
    !Number.isSafeInteger(candidate.fileSize) ||
    candidate.fileSize <= 0 ||
    candidate.fileSize > policy.maxFileSizeBytes
  ) {
    return validationFailure(
      "INVALID_FILE_SIZE",
      "파일 크기가 허용 범위를 벗어났습니다.",
    );
  }

  const draftOperationId = parseCreationOperationId(candidate.draftOperationId);
  if (!draftOperationId) {
    return validationFailure(
      "INVALID_DRAFT_OPERATION_ID",
      "유효한 초안 작업 식별자가 필요합니다.",
    );
  }

  return {
    ok: true,
    value: {
      purpose: candidate.purpose,
      canonicalMimeType,
      fileSize: candidate.fileSize,
      draftOperationId,
    },
  };
}

function defaultUuidFactory(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("안전한 미디어 식별자를 만들 수 없습니다.");
  }
  return crypto.randomUUID();
}

export function parseMediaUuidV4(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : null;
}

function assertUuidV4(value: unknown): string {
  const normalized = parseMediaUuidV4(value);
  if (!normalized) {
    throw new Error("미디어 식별자는 UUID v4여야 합니다.");
  }
  return normalized;
}

/** 외부에 노출하지 않을 별도 storage UUID로 최종 R2 object key를 만든다. */
export function createMediaObjectKey(
  purpose: MediaUploadPurpose,
  storageObjectId: string,
): string {
  const opaqueId = assertUuidV4(storageObjectId);
  return `${MEDIA_PURPOSE_POLICIES[purpose].keyPrefix}${opaqueId}`;
}

/** presigned URL에만 노출되는 staging key를 public media ID와 결합한다. */
export function createMediaUploadObjectKey(
  purpose: MediaUploadPurpose,
  mediaObjectId: string,
): string {
  const opaqueId = assertUuidV4(mediaObjectId);
  return `${MEDIA_PURPOSE_POLICIES[purpose].uploadKeyPrefix}${opaqueId}`;
}

function hasManagedMediaPrefix(
  value: string,
  prefixField: "keyPrefix" | "uploadKeyPrefix",
): boolean {
  return Object.values(MEDIA_PURPOSE_POLICIES).some((policy) => {
    const prefix = policy[prefixField];
    return (
      value.startsWith(prefix) &&
      UUID_V4_PATTERN.test(value.slice(prefix.length))
    );
  });
}

/** application registry가 소유하는 never-presigned final key만 허용한다. */
export function isManagedFinalMediaObjectKey(value: string): boolean {
  return hasManagedMediaPrefix(value, "keyPrefix");
}

/** browser presign에 사용하는 staging key만 허용한다. */
export function isManagedUploadMediaObjectKey(value: string): boolean {
  return hasManagedMediaPrefix(value, "uploadKeyPrefix");
}

export function isManagedMediaObjectKey(value: string): boolean {
  return (
    isManagedFinalMediaObjectKey(value) ||
    isManagedUploadMediaObjectKey(value)
  );
}

/** 원본 R2 주소를 노출하지 않는 인증형 애플리케이션 전달 경로다. */
export function mediaDeliveryPath(mediaObjectId: string): string {
  return `/api/media/${assertUuidV4(mediaObjectId)}`;
}

export function createOpaqueMediaObjectKey(
  purpose: MediaUploadPurpose,
  uuidFactory: MediaUuidFactory = defaultUuidFactory,
): string {
  return createMediaObjectKey(purpose, uuidFactory());
}

/** 검증된 입력에서 DB 업로드 의도를 만들기 위한 불투명 식별자 묶음을 준비한다. */
export function prepareMediaUploadIntent(
  input: unknown,
  uuidFactory: MediaUuidFactory = defaultUuidFactory,
): MediaUploadIntentPreparationResult {
  const validation = validateMediaUploadInput(input);
  if (!validation.ok) return validation;

  const mediaObjectId = assertUuidV4(uuidFactory());
  const storageObjectId = assertUuidV4(uuidFactory());
  if (storageObjectId === mediaObjectId) {
    throw new Error("공개 미디어 식별자와 storage 식별자는 달라야 합니다.");
  }
  const objectKey = createMediaObjectKey(
    validation.value.purpose,
    storageObjectId,
  );
  const uploadObjectKey = createMediaUploadObjectKey(
    validation.value.purpose,
    mediaObjectId,
  );

  return {
    ok: true,
    intent: {
      mediaObjectId,
      objectKey,
      uploadObjectKey,
      purpose: validation.value.purpose,
      canonicalMimeType: validation.value.canonicalMimeType,
      expectedSizeBytes: validation.value.fileSize,
      draftOperationId: validation.value.draftOperationId,
    },
  };
}

export const MEDIA_DELETION_BACKOFF_DEFAULTS = {
  baseDelayMs: 30_000,
  maxDelayMs: 6 * 60 * 60 * 1_000,
} as const;

export function mediaDeletionBackoffSeconds(attemptCount: number): number {
  return calculateMediaDeletionBackoffMs(attemptCount) / 1_000;
}

/** 실패 횟수(1부터 시작)에 따라 상한이 있는 지수 백오프를 계산한다. */
export function calculateMediaDeletionBackoffMs(
  failedAttempt: number,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {},
): number {
  if (!Number.isSafeInteger(failedAttempt) || failedAttempt < 1) {
    throw new RangeError("실패 횟수는 1 이상의 안전한 정수여야 합니다.");
  }

  const baseDelayMs =
    options.baseDelayMs ?? MEDIA_DELETION_BACKOFF_DEFAULTS.baseDelayMs;
  const maxDelayMs =
    options.maxDelayMs ?? MEDIA_DELETION_BACKOFF_DEFAULTS.maxDelayMs;
  if (
    !Number.isSafeInteger(baseDelayMs) ||
    !Number.isSafeInteger(maxDelayMs) ||
    baseDelayMs < 1 ||
    maxDelayMs < baseDelayMs
  ) {
    throw new RangeError("백오프 시간 범위가 올바르지 않습니다.");
  }

  const exponent = Math.min(failedAttempt - 1, 52);
  return Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
}

function normalizeManagedPrefix(prefix: string): string | null {
  if (
    !prefix ||
    prefix.startsWith("/") ||
    !prefix.endsWith("/") ||
    prefix.includes("//") ||
    !LEGACY_OBJECT_KEY_PATTERN.test(prefix)
  ) {
    return null;
  }

  const segments = prefix.split("/").filter(Boolean);
  return segments.some((segment) => segment === "." || segment === "..")
    ? null
    : prefix;
}

function parseTrustedPublicBaseUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 신뢰한 퍼블릭 origin과 관리 prefix가 모두 정확히 일치할 때만 legacy 키를 반환한다.
 * SQL migration에서 URL을 곧바로 삭제 대상으로 바꾸지 말고 inventory 단계에서 사용한다.
 */
export function getTrustedLegacyMediaObjectKey(
  candidateUrl: string,
  trustedPublicBaseUrl: string,
  managedPrefixes: readonly string[] = DEFAULT_LEGACY_MEDIA_PREFIXES,
): string | null {
  const trustedBase = parseTrustedPublicBaseUrl(trustedPublicBaseUrl);
  if (!trustedBase || managedPrefixes.length === 0) return null;

  let candidate: URL;
  try {
    candidate = new URL(candidateUrl);
  } catch {
    return null;
  }

  if (
    candidate.origin !== trustedBase.origin ||
    candidate.protocol !== trustedBase.protocol ||
    candidate.username ||
    candidate.password ||
    candidate.search ||
    candidate.hash ||
    candidate.pathname.includes("%")
  ) {
    return null;
  }

  const basePath = trustedBase.pathname.replace(/\/+$/u, "");
  const expectedPathPrefix = `${basePath}/`;
  if (!candidate.pathname.startsWith(expectedPathPrefix)) return null;

  const objectKey = candidate.pathname.slice(expectedPathPrefix.length);
  if (
    !objectKey ||
    objectKey.startsWith("/") ||
    objectKey.includes("//") ||
    !LEGACY_OBJECT_KEY_PATTERN.test(objectKey)
  ) {
    return null;
  }

  const segments = objectKey.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  const normalizedPrefixes = managedPrefixes.map(normalizeManagedPrefix);
  return normalizedPrefixes.some(
    (prefix) => prefix !== null && objectKey.startsWith(prefix),
  )
    ? objectKey
    : null;
}

export function isTrustedLegacyMediaUrl(
  candidateUrl: string,
  trustedPublicBaseUrl: string,
  managedPrefixes?: readonly string[],
): boolean {
  return (
    getTrustedLegacyMediaObjectKey(
      candidateUrl,
      trustedPublicBaseUrl,
      managedPrefixes,
    ) !== null
  );
}
