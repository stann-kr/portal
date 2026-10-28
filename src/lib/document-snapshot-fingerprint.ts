import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const DOCUMENT_SNAPSHOT_FINGERPRINT_FIELD = "baseFingerprint";

const DOCUMENT_SNAPSHOT_FINGERPRINT_DOMAIN = "portal-document-snapshot/v1";
const DOCUMENT_SNAPSHOT_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DATE_ONLY_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;

export type DocumentSnapshotKind = "private-note" | "community-post" | "guide-page";

export type DocumentSnapshotFingerprintInput = {
  kind: DocumentSnapshotKind;
  id: string;
  title: string;
  contentHtml: string;
  noteDate: Date | string | null;
};

/**
 * 노트 날짜를 저장 스냅샷의 date-only 표현으로 정규화한다.
 * 문자열은 이미 canonical한 YYYY-MM-DD만 허용하며 존재하지 않는 날짜를 보정하지 않는다.
 */
export function normalizeDocumentSnapshotNoteDate(
  value: Date | string | null,
): string | null {
  if (value === null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("Invalid document snapshot note date");
    }
    return value.toISOString().slice(0, 10);
  }

  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new TypeError("Invalid document snapshot note date");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError("Invalid document snapshot note date");
  }
  return value;
}

/** 엄격한 date-only 폼 입력을 DB timestamp용 UTC 자정 Date로 변환한다. */
export function parseDocumentNoteDateInput(value: unknown): Date | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new TypeError("Invalid document note date input");
  }
  const normalized = normalizeDocumentSnapshotNoteDate(value);
  return normalized === null
    ? null
    : new Date(`${normalized}T00:00:00.000Z`);
}

/** 외부 요청의 fingerprint는 canonical lowercase SHA-256 표기만 허용한다. */
export function isDocumentSnapshotFingerprint(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    DOCUMENT_SNAPSHOT_FINGERPRINT_PATTERN.test(value)
  );
}

/**
 * 리소스 종류와 ID까지 domain-separated tuple에 묶어 편집 기준 스냅샷을 식별한다.
 * 저장된 원문 필드에는 trim, sanitize, Unicode normalize를 적용하지 않는다.
 */
export function createDocumentSnapshotFingerprint({
  kind,
  id,
  title,
  contentHtml,
  noteDate,
}: DocumentSnapshotFingerprintInput): string {
  const normalizedNoteDate =
    kind === "private-note"
      ? normalizeDocumentSnapshotNoteDate(noteDate)
      : null;
  const serialized = JSON.stringify([
    DOCUMENT_SNAPSHOT_FINGERPRINT_DOMAIN,
    kind,
    id,
    title,
    contentHtml,
    normalizedNoteDate,
  ]);
  return `sha256:${bytesToHex(sha256(utf8ToBytes(serialized)))}`;
}
