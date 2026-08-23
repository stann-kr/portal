import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { BoardType, DocumentOperationType } from "@/db/schema";
import { deriveCreationResourceId } from "@/lib/creation-operation";

export const POST_BASE_REVISION_FIELD = "baseRevision";
export const POST_RESTORE_REVISION_FIELD = "revisionNumber";
export const POST_REQUEST_HASH_VERSION = 2;
export const POST_SNAPSHOT_HASH_VERSION = 2;
export const POST_TRASH_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const POST_MAX_CONTENT_BYTES = 800 * 1024;
export const POST_MAX_CONTENT_LABEL = "800 KiB";
export const POST_MAX_TITLE_LENGTH = 200;

export type PostCanonicalSnapshot = {
  category: string;
  boardType: BoardType;
  isPinned: boolean;
  mediaUrl: string | null;
  mediaObjectId: string | null;
  title: string;
  contentHtml: string;
  deletedAt: Date | null;
};

export type PostCanonicalRequest = {
  operationType: Extract<
    DocumentOperationType,
    | "CREATE"
    | "UPDATE"
    | "SET_PIN"
    | "TRASH"
    | "RESTORE_TRASH"
    | "RESTORE_REVISION"
    | "PURGE"
  >;
  resourceId: string;
  subjectId: string;
  baseRevision: number | null;
  snapshot?: PostCanonicalSnapshot;
  title?: string;
  contentHtml?: string;
  isPinned?: boolean;
  restoredFromRevision?: number | null;
};

function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}

function epochSeconds(value: Date | null | undefined): number | null {
  return value ? Math.floor(value.getTime() / 1000) : null;
}

function snapshotTupleV1(snapshot: PostCanonicalSnapshot | undefined) {
  return snapshot
    ? [
        snapshot.category,
        snapshot.boardType,
        snapshot.isPinned,
        snapshot.mediaUrl,
        snapshot.title,
        snapshot.contentHtml,
        epochSeconds(snapshot.deletedAt),
      ]
    : null;
}

function snapshotTupleV2(snapshot: PostCanonicalSnapshot | undefined) {
  return snapshot
    ? [
        snapshot.category,
        snapshot.boardType,
        snapshot.isPinned,
        snapshot.mediaObjectId ? null : snapshot.mediaUrl,
        snapshot.mediaObjectId,
        snapshot.title,
        snapshot.contentHtml,
        epochSeconds(snapshot.deletedAt),
      ]
    : null;
}

function createPostRequestHashV1(request: PostCanonicalRequest): string {
  return sha256Hex(
    JSON.stringify([
      "portal-community-post-request",
      1,
      request.operationType,
      "COMMUNITY_POST",
      request.resourceId,
      request.subjectId,
      request.baseRevision,
      snapshotTupleV1(request.snapshot),
      request.title ?? null,
      request.contentHtml ?? null,
      request.isPinned ?? null,
      request.restoredFromRevision ?? null,
    ]),
  );
}

function createPostRequestHashV2(request: PostCanonicalRequest): string {
  return sha256Hex(
    JSON.stringify([
      "portal-community-post-request",
      2,
      request.operationType,
      "COMMUNITY_POST",
      request.resourceId,
      request.subjectId,
      request.baseRevision,
      snapshotTupleV2(request.snapshot),
      request.title ?? null,
      request.contentHtml ?? null,
      request.isPinned ?? null,
      request.restoredFromRevision ?? null,
    ]),
  );
}

export function createPostRequestHashForVersion(
  request: PostCanonicalRequest,
  version: number,
): string | null {
  if (version === 1) return createPostRequestHashV1(request);
  if (version === 2) return createPostRequestHashV2(request);
  return null;
}

export function createPostRequestHash(request: PostCanonicalRequest): string {
  const hash = createPostRequestHashForVersion(request, POST_REQUEST_HASH_VERSION);
  if (!hash) throw new Error("지원하지 않는 게시물 request hash 버전입니다.");
  return hash;
}

function createPostSnapshotHashV1(snapshot: PostCanonicalSnapshot): string {
  return sha256Hex(
    JSON.stringify(["portal-community-post-snapshot", 1, ...snapshotTupleV1(snapshot)!]),
  );
}

function createPostSnapshotHashV2(snapshot: PostCanonicalSnapshot): string {
  return sha256Hex(
    JSON.stringify(["portal-community-post-snapshot", 2, ...snapshotTupleV2(snapshot)!]),
  );
}

export function createPostSnapshotHashForVersion(
  snapshot: PostCanonicalSnapshot,
  version: number,
): string | null {
  if (version === 1) return createPostSnapshotHashV1(snapshot);
  if (version === 2) return createPostSnapshotHashV2(snapshot);
  return null;
}

export function createPostSnapshotHash(snapshot: PostCanonicalSnapshot): string {
  const hash = createPostSnapshotHashForVersion(snapshot, POST_SNAPSHOT_HASH_VERSION);
  if (!hash) throw new Error("지원하지 않는 게시물 snapshot hash 버전입니다.");
  return hash;
}

export function isPostContentWithinLimit(contentHtml: string): boolean {
  return utf8ToBytes(contentHtml).length <= POST_MAX_CONTENT_BYTES;
}

export function parsePostRevision(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function derivePostRevisionId(actorId: string, operationId: string): string {
  return deriveCreationResourceId(
    operationId,
    JSON.stringify(["community-post-revision", actorId]),
  );
}
