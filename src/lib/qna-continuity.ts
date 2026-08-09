import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { DocumentOperationType, QnaStatus } from "@/db/schema";
import { deriveCreationResourceId } from "@/lib/creation-operation";

export const QNA_BASE_REVISION_FIELD = "baseRevision";
export const QNA_REQUEST_HASH_VERSION = 1;
export const QNA_EVENT_HASH_VERSION = 1;
export const QNA_TRASH_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const QNA_MAX_CONTENT_BYTES = 800 * 1024;
export const QNA_MAX_CONTENT_LABEL = "800 KiB";
export const QNA_MAX_TITLE_LENGTH = 200;

export type QnaCanonicalEvent = {
  title: string;
  status: QnaStatus;
  replyId: string | null;
  deletedAt: Date | null;
};

export type QnaCanonicalRequest = {
  operationType: Extract<
    DocumentOperationType,
    | "CREATE"
    | "APPEND_REPLY"
    | "SET_STATUS"
    | "TRASH"
    | "RESTORE_TRASH"
    | "PURGE"
  >;
  resourceId: string;
  subjectId: string;
  baseRevision: number | null;
  title?: string;
  status?: QnaStatus;
  replyId?: string | null;
  replyAuthorId?: string | null;
  contentHtml?: string | null;
  attachmentUrl?: string | null;
};

function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}

function epochSeconds(value: Date | null | undefined): number | null {
  return value ? Math.floor(value.getTime() / 1000) : null;
}

function createQnaRequestHashV1(request: QnaCanonicalRequest): string {
  return sha256Hex(
    JSON.stringify([
      "portal-qna-thread-request",
      1,
      request.operationType,
      "QNA_THREAD",
      request.resourceId,
      request.subjectId,
      request.baseRevision,
      request.title ?? null,
      request.status ?? null,
      request.replyId ?? null,
      request.replyAuthorId ?? null,
      request.contentHtml ?? null,
      request.attachmentUrl ?? null,
    ]),
  );
}

export function createQnaRequestHashForVersion(
  request: QnaCanonicalRequest,
  version: number,
): string | null {
  return version === 1 ? createQnaRequestHashV1(request) : null;
}

export function createQnaRequestHash(request: QnaCanonicalRequest): string {
  const hash = createQnaRequestHashForVersion(request, QNA_REQUEST_HASH_VERSION);
  if (!hash) throw new Error("지원하지 않는 Q&A request hash 버전입니다.");
  return hash;
}

function createQnaEventHashV1(event: QnaCanonicalEvent): string {
  return sha256Hex(
    JSON.stringify([
      "portal-qna-thread-event",
      1,
      event.title,
      event.status,
      event.replyId,
      epochSeconds(event.deletedAt),
    ]),
  );
}

export function createQnaEventHashForVersion(
  event: QnaCanonicalEvent,
  version: number,
): string | null {
  return version === 1 ? createQnaEventHashV1(event) : null;
}

export function createQnaEventHash(event: QnaCanonicalEvent): string {
  const hash = createQnaEventHashForVersion(event, QNA_EVENT_HASH_VERSION);
  if (!hash) throw new Error("지원하지 않는 Q&A event hash 버전입니다.");
  return hash;
}

export function isQnaContentWithinLimit(contentHtml: string): boolean {
  return utf8ToBytes(contentHtml).length <= QNA_MAX_CONTENT_BYTES;
}

export function parseQnaRevision(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function deriveQnaEventId(actorId: string, operationId: string): string {
  return deriveCreationResourceId(
    operationId,
    JSON.stringify(["qna-thread-event", actorId]),
  );
}
