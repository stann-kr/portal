import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { DocumentOperationType } from "@/db/schema";
import { deriveCreationResourceId } from "@/lib/creation-operation";

export const PRIVATE_NOTE_BASE_REVISION_FIELD = "baseRevision";
export const PRIVATE_NOTE_RESTORE_REVISION_FIELD = "revisionNumber";
export const PRIVATE_NOTE_REQUEST_HASH_VERSION = 1;
export const PRIVATE_NOTE_SNAPSHOT_HASH_VERSION = 1;
export const PRIVATE_NOTE_TRASH_RETENTION_SECONDS = 30 * 24 * 60 * 60;
/** Server Action 기본 1MB body 경계에서 action/form envelope 여유를 남긴다. */
export const PRIVATE_NOTE_MAX_CONTENT_BYTES = 800 * 1024;
export const PRIVATE_NOTE_MAX_CONTENT_LABEL = "800 KiB";
export const PRIVATE_NOTE_STORAGE_QUOTA_BYTES = 100 * 1024 * 1024;
export const PRIVATE_NOTE_MAX_TITLE_LENGTH = 200;

export type PrivateNoteCanonicalSnapshot = {
  title: string;
  contentHtml: string;
  noteDate: Date | null;
  deletedAt: Date | null;
};

export type PrivateNoteCanonicalRequest = {
  operationType: DocumentOperationType;
  resourceId: string;
  subjectId: string;
  baseRevision: number | null;
  title?: string;
  contentHtml?: string;
  noteDate?: Date | null;
  restoredFromRevision?: number | null;
};

function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}

function toEpochSeconds(value: Date | null | undefined): number | null {
  return value ? Math.floor(value.getTime() / 1000) : null;
}

function createPrivateNoteRequestHashV1(
  request: PrivateNoteCanonicalRequest,
): string {
  return sha256Hex(
    JSON.stringify([
      "portal-private-note-request",
      1,
      request.operationType,
      "PRIVATE_NOTE",
      request.resourceId,
      request.subjectId,
      request.baseRevision,
      request.title ?? null,
      request.contentHtml ?? null,
      toEpochSeconds(request.noteDate),
      request.restoredFromRevision ?? null,
    ]),
  );
}

/** 저장된 영수증은 새 hash 버전 도입 후에도 당시 verifier로 재전송을 검증한다. */
export function createPrivateNoteRequestHashForVersion(
  request: PrivateNoteCanonicalRequest,
  version: number,
): string | null {
  switch (version) {
    case 1:
      return createPrivateNoteRequestHashV1(request);
    default:
      return null;
  }
}

export function createPrivateNoteRequestHash(
  request: PrivateNoteCanonicalRequest,
): string {
  const hash = createPrivateNoteRequestHashForVersion(
    request,
    PRIVATE_NOTE_REQUEST_HASH_VERSION,
  );
  if (!hash) throw new Error("지원하지 않는 개인 노트 request hash 버전입니다.");
  return hash;
}

function createPrivateNoteSnapshotHashV1(
  snapshot: PrivateNoteCanonicalSnapshot,
): string {
  return sha256Hex(
    JSON.stringify([
      "portal-private-note-snapshot",
      1,
      snapshot.title,
      snapshot.contentHtml,
      toEpochSeconds(snapshot.noteDate),
      toEpochSeconds(snapshot.deletedAt),
    ]),
  );
}

/** revision full snapshot은 최신 canonicalizer와 무관하게 저장 버전으로 검증한다. */
export function createPrivateNoteSnapshotHashForVersion(
  snapshot: PrivateNoteCanonicalSnapshot,
  version: number,
): string | null {
  switch (version) {
    case 1:
      return createPrivateNoteSnapshotHashV1(snapshot);
    default:
      return null;
  }
}

export function createPrivateNoteSnapshotHash(
  snapshot: PrivateNoteCanonicalSnapshot,
): string {
  const hash = createPrivateNoteSnapshotHashForVersion(
    snapshot,
    PRIVATE_NOTE_SNAPSHOT_HASH_VERSION,
  );
  if (!hash) throw new Error("지원하지 않는 개인 노트 snapshot hash 버전입니다.");
  return hash;
}

export function getPrivateNoteSnapshotBytes(
  snapshot: Pick<PrivateNoteCanonicalSnapshot, "title" | "contentHtml">,
): number {
  return utf8ToBytes(snapshot.title).length + utf8ToBytes(snapshot.contentHtml).length;
}

export function isPrivateNoteContentWithinLimit(contentHtml: string): boolean {
  return utf8ToBytes(contentHtml).length <= PRIVATE_NOTE_MAX_CONTENT_BYTES;
}

export function parsePrivateNoteRevision(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = typeof value === "number" ? value : Number(value.trim());
  return Number.isSafeInteger(normalized) && normalized >= 1 ? normalized : null;
}

export function deriveDocumentOperationRecordId(
  actorId: string,
  operationId: string,
): string {
  return deriveCreationResourceId(
    operationId,
    JSON.stringify(["document-operation-ledger", actorId]),
  );
}

export function derivePrivateNoteRevisionId(
  actorId: string,
  operationId: string,
): string {
  return deriveCreationResourceId(
    operationId,
    JSON.stringify(["private-note-revision", actorId]),
  );
}
