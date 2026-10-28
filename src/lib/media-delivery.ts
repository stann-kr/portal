import type { MediaObjectByteRange } from "@/lib/r2";

export const INVALID_MEDIA_BYTE_RANGE = Symbol("INVALID_MEDIA_BYTE_RANGE");

export type MediaDeliveryPrincipal = {
  id: string;
  role: string | null | undefined;
};

export type MediaDeliveryRecord = {
  ownerId: string | null;
  purpose: "COMMUNITY_POST_AUDIO" | "QNA_ATTACHMENT" | "DOCUMENT_IMAGE";
  state:
    | "PENDING_UPLOAD"
    | "SEALING"
    | "READY"
    | "ATTACHED"
    | "PENDING_DELETE"
    | "DELETED";
  resourceType: "COMMUNITY_POST" | "QNA_REPLY" | "PRIVATE_NOTE" | null;
};

export type MediaDeliveryResourceContext =
  | { kind: "COMMUNITY_POST"; authorId: string; deleted: boolean }
  | { kind: "QNA_REPLY"; studentId: string }
  | { kind: "PRIVATE_NOTE"; studentId: string }
  | null;

/** READY preview는 owner만, ATTACHED object는 문서 audience만 읽을 수 있다. */
export function canAccessMediaDelivery(
  principal: MediaDeliveryPrincipal,
  media: MediaDeliveryRecord,
  resource: MediaDeliveryResourceContext,
): boolean {
  if (media.state === "READY") return media.ownerId === principal.id;
  if (media.state !== "ATTACHED") return false;

  if (media.purpose === "DOCUMENT_IMAGE") {
    // 본문 이미지는 연결된 문서를 볼 수 있는 사람에게만 보인다.
    if (media.resourceType === "COMMUNITY_POST" && resource?.kind === "COMMUNITY_POST") {
      return (
        !resource.deleted ||
        principal.role === "admin" ||
        resource.authorId === principal.id
      );
    }
    if (
      (media.resourceType === "QNA_REPLY" && resource?.kind === "QNA_REPLY") ||
      (media.resourceType === "PRIVATE_NOTE" && resource?.kind === "PRIVATE_NOTE")
    ) {
      return principal.role === "admin" || resource.studentId === principal.id;
    }
    return false;
  }

  if (
    media.purpose === "COMMUNITY_POST_AUDIO" &&
    media.resourceType === "COMMUNITY_POST" &&
    resource?.kind === "COMMUNITY_POST"
  ) {
    return (
      !resource.deleted ||
      principal.role === "admin" ||
      resource.authorId === principal.id
    );
  }
  return (
    media.purpose === "QNA_ATTACHMENT" &&
    media.resourceType === "QNA_REPLY" &&
    resource?.kind === "QNA_REPLY" &&
    (principal.role === "admin" || resource.studentId === principal.id)
  );
}

/** 단일 HTTP bytes range만 받아 R2 offset/length로 정규화한다. */
export function parseMediaByteRange(
  header: string | null,
  totalSize: number,
): MediaObjectByteRange | null | typeof INVALID_MEDIA_BYTE_RANGE {
  if (!header) return null;
  if (!Number.isSafeInteger(totalSize) || totalSize < 1) {
    return INVALID_MEDIA_BYTE_RANGE;
  }

  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return INVALID_MEDIA_BYTE_RANGE;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
      return INVALID_MEDIA_BYTE_RANGE;
    }
    const length = Math.min(suffixLength, totalSize);
    return { offset: totalSize - length, length };
  }

  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= totalSize) {
    return INVALID_MEDIA_BYTE_RANGE;
  }
  const requestedEnd = match[2] ? Number(match[2]) : totalSize - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < offset) {
    return INVALID_MEDIA_BYTE_RANGE;
  }
  const end = Math.min(requestedEnd, totalSize - 1);
  return { offset, length: end - offset + 1 };
}
