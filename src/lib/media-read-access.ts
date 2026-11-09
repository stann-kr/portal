/**
 * @file src/lib/media-read-access.ts
 * @description 인증형 media 읽기 권한의 단일 판단. 전달 경로(`/api/media/[id]`)와 파형 경로
 * (`/api/media/[id]/peaks`)가 같은 규칙으로 "이 사람이 이 매체를 읽을 수 있는가"를 판단한다.
 */
import { and, eq } from "drizzle-orm";
import type { createDb } from "@/db/client";
import {
  mediaObjects,
  posts,
  privateNotes,
  qnaReplies,
  qnaThreads,
} from "@/db/schema";
import {
  canAccessMediaDelivery,
  type MediaDeliveryPrincipal,
  type MediaDeliveryResourceContext,
} from "@/lib/media-delivery";

type Db = ReturnType<typeof createDb>;

export type ReadableMediaObject = {
  id: string;
  ownerId: string | null;
  purpose: (typeof mediaObjects.$inferSelect)["purpose"];
  objectKey: string;
  state: (typeof mediaObjects.$inferSelect)["state"];
  expectedContentType: string;
  actualSizeBytes: number | null;
  etag: string | null;
  resourceType: (typeof mediaObjects.$inferSelect)["resourceType"];
  resourceId: string | null;
};

/** 본문 이미지가 연결된 문서의 열람 범위를 읽는다. 문서가 없으면 null이다. */
async function loadDocumentImageResource(
  db: Db,
  resourceType: string | null,
  resourceId: string,
): Promise<MediaDeliveryResourceContext> {
  if (resourceType === "PRIVATE_NOTE") {
    const [note] = await db
      .select({ studentId: privateNotes.studentId })
      .from(privateNotes)
      .where(eq(privateNotes.id, resourceId))
      .limit(1);
    return note ? { kind: "PRIVATE_NOTE", studentId: note.studentId } : null;
  }
  if (resourceType === "COMMUNITY_POST") {
    const [post] = await db
      .select({ authorId: posts.authorId, deletedAt: posts.deletedAt })
      .from(posts)
      .where(eq(posts.id, resourceId))
      .limit(1);
    return post
      ? { kind: "COMMUNITY_POST", authorId: post.authorId, deleted: post.deletedAt !== null }
      : null;
  }
  if (resourceType === "QNA_REPLY") {
    const [thread] = await db
      .select({ studentId: qnaThreads.studentId })
      .from(qnaReplies)
      .innerJoin(qnaThreads, eq(qnaReplies.threadId, qnaThreads.id))
      .where(eq(qnaReplies.id, resourceId))
      .limit(1);
    return thread ? { kind: "QNA_REPLY", studentId: thread.studentId } : null;
  }
  return null;
}

/**
 * 읽을 수 있는 READY·ATTACHED 매체만 돌려준다. 없거나 읽을 수 없으면 null(호출자는 존재 여부를 숨기려 404로 답한다).
 */
export async function loadReadableMedia(
  db: Db,
  principal: MediaDeliveryPrincipal,
  mediaObjectId: string,
): Promise<ReadableMediaObject | null> {
  const [media] = await db
    .select({
      id: mediaObjects.id,
      ownerId: mediaObjects.ownerId,
      purpose: mediaObjects.purpose,
      objectKey: mediaObjects.objectKey,
      state: mediaObjects.state,
      expectedContentType: mediaObjects.expectedContentType,
      actualSizeBytes: mediaObjects.actualSizeBytes,
      etag: mediaObjects.etag,
      resourceType: mediaObjects.resourceType,
      resourceId: mediaObjects.resourceId,
    })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  if (!media || (media.state !== "READY" && media.state !== "ATTACHED")) return null;

  let resource: MediaDeliveryResourceContext = null;
  if (media.state === "ATTACHED" && media.purpose === "COMMUNITY_POST_AUDIO") {
    if (media.resourceType !== "COMMUNITY_POST" || !media.resourceId) return null;
    const [post] = await db
      .select({ authorId: posts.authorId, deletedAt: posts.deletedAt })
      .from(posts)
      .where(and(eq(posts.id, media.resourceId), eq(posts.mediaObjectId, media.id)))
      .limit(1);
    if (post) {
      resource = { kind: "COMMUNITY_POST", authorId: post.authorId, deleted: post.deletedAt !== null };
    }
  } else if (media.state === "ATTACHED" && media.purpose === "QNA_ATTACHMENT") {
    if (media.resourceType !== "QNA_REPLY" || !media.resourceId) return null;
    const [thread] = await db
      .select({ studentId: qnaThreads.studentId })
      .from(qnaReplies)
      .innerJoin(qnaThreads, eq(qnaReplies.threadId, qnaThreads.id))
      .where(and(eq(qnaReplies.id, media.resourceId), eq(qnaReplies.attachmentObjectId, media.id)))
      .limit(1);
    if (thread) resource = { kind: "QNA_REPLY", studentId: thread.studentId };
  } else if (media.state === "ATTACHED" && media.purpose === "DOCUMENT_IMAGE") {
    if (!media.resourceId) return null;
    resource = await loadDocumentImageResource(db, media.resourceType, media.resourceId);
  }
  return canAccessMediaDelivery(principal, media, resource) ? media : null;
}

/** 파형을 둘 수 있는 매체: 믹스셋 오디오, 또는 오디오 형식으로 올린 Q&A 첨부. */
export function isAudioMedia(media: Pick<ReadableMediaObject, "purpose" | "expectedContentType">): boolean {
  return media.purpose === "COMMUNITY_POST_AUDIO" || media.expectedContentType.toLowerCase().startsWith("audio/");
}
