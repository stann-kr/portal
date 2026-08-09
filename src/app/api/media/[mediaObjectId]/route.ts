import { and, eq } from "drizzle-orm";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { createDb } from "@/db/client";
import { mediaObjects, posts, qnaReplies, qnaThreads } from "@/db/schema";
import {
  INVALID_MEDIA_BYTE_RANGE,
  canAccessMediaDelivery,
  parseMediaByteRange,
  type MediaDeliveryResourceContext,
} from "@/lib/media-delivery";
import { parseMediaUuidV4 } from "@/lib/media-lifecycle";
import { getR2ObjectContent } from "@/lib/r2";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
} as const;

function unavailable(status = 404): Response {
  return new Response(status === 401 ? "Unauthorized" : "Not found", {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaObjectId: string }> },
): Promise<Response> {
  const session = await getActiveAuthSession();
  if (!session?.user?.id) return unavailable(401);

  const mediaObjectId = parseMediaUuidV4((await params).mediaObjectId);
  if (!mediaObjectId) return unavailable();

  const db = createDb();
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
  if (!media || (media.state !== "READY" && media.state !== "ATTACHED")) {
    return unavailable();
  }

  let resource: MediaDeliveryResourceContext = null;
  if (media.state === "ATTACHED" && media.purpose === "COMMUNITY_POST_AUDIO") {
    if (media.resourceType !== "COMMUNITY_POST" || !media.resourceId) {
      return unavailable();
    }
    const [post] = await db
      .select({ authorId: posts.authorId, deletedAt: posts.deletedAt })
      .from(posts)
      .where(
        and(
          eq(posts.id, media.resourceId),
          eq(posts.mediaObjectId, media.id),
        ),
      )
      .limit(1);
    if (post) {
      resource = {
        kind: "COMMUNITY_POST",
        authorId: post.authorId,
        deleted: post.deletedAt !== null,
      };
    }
  } else if (media.state === "ATTACHED" && media.purpose === "QNA_ATTACHMENT") {
    if (media.resourceType !== "QNA_REPLY" || !media.resourceId) {
      return unavailable();
    }
    const [thread] = await db
      .select({ studentId: qnaThreads.studentId })
      .from(qnaReplies)
      .innerJoin(qnaThreads, eq(qnaReplies.threadId, qnaThreads.id))
      .where(
        and(
          eq(qnaReplies.id, media.resourceId),
          eq(qnaReplies.attachmentObjectId, media.id),
        ),
      )
      .limit(1);
    if (thread) resource = { kind: "QNA_REPLY", studentId: thread.studentId };
  }
  if (
    !canAccessMediaDelivery(
      { id: session.user.id, role: session.user.role },
      media,
      resource,
    )
  ) {
    return unavailable();
  }

  const totalSize = media.actualSizeBytes;
  if (
    !Number.isSafeInteger(totalSize) ||
    !totalSize ||
    totalSize < 1 ||
    !media.etag
  ) {
    return unavailable();
  }
  const range = parseMediaByteRange(request.headers.get("range"), totalSize);
  if (range === INVALID_MEDIA_BYTE_RANGE) {
    return new Response(null, {
      status: 416,
      headers: {
        ...PRIVATE_NO_STORE_HEADERS,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${totalSize}`,
      },
    });
  }

  const object = await getR2ObjectContent(
    media.objectKey,
    range ?? undefined,
    media.etag,
  );
  if (!object) return unavailable();
  const headers = new Headers(PRIVATE_NO_STORE_HEADERS);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Disposition", "inline");
  headers.set("Content-Length", String(range?.length ?? totalSize));
  headers.set("Content-Type", media.expectedContentType);
  if (object.etag) headers.set("ETag", `"${object.etag}"`);
  if (range) {
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${totalSize}`,
    );
  }
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers,
  });
}
