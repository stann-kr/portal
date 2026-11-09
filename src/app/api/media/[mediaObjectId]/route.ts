import { getActiveAuthSession } from "@/lib/auth-guard";
import { createDb } from "@/db/client";
import { INVALID_MEDIA_BYTE_RANGE, parseMediaByteRange } from "@/lib/media-delivery";
import { parseMediaUuidV4 } from "@/lib/media-lifecycle";
import { loadReadableMedia } from "@/lib/media-read-access";
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

  // 읽기 권한 판단은 파형 경로와 같은 helper가 맡는다.
  const media = await loadReadableMedia(
    createDb(),
    { id: session.user.id, role: session.user.role },
    mediaObjectId,
  );
  if (!media) return unavailable();

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
