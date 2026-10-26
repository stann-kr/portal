import { createDbContext } from "@/db/client";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { findOwnedMediaObject } from "@/lib/media-lifecycle-atomic";
import { parseMediaUuidV4 } from "@/lib/media-lifecycle";
import {
  IMAGE_SIGNATURE_BYTES,
  evaluateMediaUploadRequest,
  peekStreamPrefix,
  sniffImageMimeType,
} from "@/lib/media-upload-request";
import { getMediaObjectStorage } from "@/lib/r2";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function reply(status: number): Response {
  return new Response(null, { status, headers: NO_STORE_HEADERS });
}

/**
 * 본인 upload intent의 body를 Worker가 받아 R2 binding의 staging key에 저장한다.
 * 저장 뒤 검증·seal은 기존 completeMediaUploadAction이 맡는다.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ mediaObjectId: string }> },
): Promise<Response> {
  const session = await getActiveAuthSession();
  if (!session) return reply(401);

  const mediaObjectId = parseMediaUuidV4((await params).mediaObjectId);
  if (!mediaObjectId) return reply(404);

  const media = await findOwnedMediaObject(
    createDbContext(),
    session.user.id,
    mediaObjectId,
  );
  const decision = evaluateMediaUploadRequest({
    target: media,
    headers: {
      contentType: request.headers.get("content-type"),
      contentLength: request.headers.get("content-length"),
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    },
    requestOrigin: new URL(request.url).origin,
    now: new Date(),
  });
  if (!decision.ok) return reply(decision.status);
  if (!media || !request.body) return reply(400);

  let stream: ReadableStream<Uint8Array> = request.body;
  if (decision.sniffImage) {
    // 첫 bytes로 실제 형식이 선언과 같은지 확인하고 나머지는 그대로 흘려 보낸다.
    const peeked = await peekStreamPrefix(request.body, IMAGE_SIGNATURE_BYTES);
    if (sniffImageMimeType(peeked.prefix) !== media.expectedContentType) {
      await peeked.stream.cancel().catch(() => undefined);
      return reply(415);
    }
    stream = peeked.stream;
  }

  try {
    const storage = await getMediaObjectStorage();
    const stored = await storage.putUpload(media.uploadObjectKey, {
      stream,
      contentType: media.expectedContentType,
      size: media.expectedSizeBytes,
    });
    return reply(stored ? 200 : 409);
  } catch {
    return reply(502);
  }
}
