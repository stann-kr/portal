/**
 * Q&A 답글 첨부의 표시 종류(이미지인지)와 칩 형식 이름(MP3 등)을 media MIME에서 계산한다. 스레드 화면과 수강 종료한 학생의
 * 보기 전용 상세가 함께 쓴다. 호출자가 스레드 읽기 권한을 이미 확인해야 한다.
 */
import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "@/db/client";
import { mediaObjects } from "@/db/schema";
import {
  mediaAttachmentFormatLabel,
  mediaAttachmentKind,
  parseMediaDeliveryPath,
  parseMediaUuidV4,
  type MediaAttachmentKind,
} from "@/lib/media-lifecycle";

/** 첨부 media 조회 한 번에 넣는 ID 수(D1 bind 100개 상한 아래). */
const QNA_ATTACHMENT_LOOKUP_CHUNK = 90;

/**
 * 답글 첨부의 표시 종류를 media MIME에서 계산한다. 스레드 읽기 권한은 호출자가 이미 확인했고,
 * 그 스레드 답글이 가리키는 Q&A 첨부 media만 조회하며 MIME 자체는 노출하지 않는다(종류와 짧은 형식 이름만).
 */
export async function withQnaAttachmentKinds<
  T extends { attachmentUrl: string | null; attachmentObjectId: string | null },
>(replies: T[]): Promise<Array<T & { attachmentKind: MediaAttachmentKind | null; attachmentFormat: string | null }>> {
  const mediaIdFor = (reply: T) =>
    reply.attachmentUrl
      ? (parseMediaUuidV4(reply.attachmentObjectId) ?? parseMediaDeliveryPath(reply.attachmentUrl))
      : null;
  const mediaIds = [...new Set(replies.map(mediaIdFor).filter((id): id is string => Boolean(id)))];
  const mimeById = new Map<string, string>();
  if (mediaIds.length > 0) {
    // D1은 한 문장에 bind 값을 100개까지 받는다. purpose 1개를 더해도 넘지 않게 나눈다(unified-items-store와 같은 90개).
    const db = createDb();
    const idChunks: string[][] = [];
    for (let index = 0; index < mediaIds.length; index += QNA_ATTACHMENT_LOOKUP_CHUNK) {
      idChunks.push(mediaIds.slice(index, index + QNA_ATTACHMENT_LOOKUP_CHUNK));
    }
    const chunkRows = await Promise.all(idChunks.map((ids) => db
      .select({ id: mediaObjects.id, contentType: mediaObjects.expectedContentType })
      .from(mediaObjects)
      .where(
        and(
          inArray(mediaObjects.id, ids),
          eq(mediaObjects.purpose, "QNA_ATTACHMENT"),
        ),
      )));
    for (const row of chunkRows.flat()) mimeById.set(row.id, row.contentType);
  }
  return replies.map((reply) => {
    const mediaId = mediaIdFor(reply);
    const mime = mediaId ? mimeById.get(mediaId) : undefined;
    return {
      ...reply,
      attachmentKind: mediaId ? mediaAttachmentKind(mime) : null,
      attachmentFormat: mediaId ? mediaAttachmentFormatLabel(mime) : null,
    };
  });
}
