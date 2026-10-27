/**
 * 공용 가이드 이미지의 업로드(관리자)·열람(로그인한 활성 사용자) 처리.
 * route는 실제 session·DB·R2를 넘기고, 테스트는 가짜 의존성을 넘긴다.
 */
import { eq } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import { guideAssets, type GuideAssetContentType } from "@/db/schema";
import { asDocumentReadDb } from "@/lib/document-lifecycle-atomic";
import {
  GUIDE_ASSET_MAX_BYTES,
  guideAssetPath,
  parseGuideAssetId,
} from "@/lib/guide-content";
import { IMAGE_SIGNATURE_BYTES, sniffImageMimeType } from "@/lib/media-upload-request";
import type { GuideAssetObjectStorage } from "@/lib/r2";

export type GuideAssetSession = { user: { id: string; role: string } } | null;

export type GuideAssetDeps = {
  getSession: () => Promise<GuideAssetSession>;
  getContext: () => DbContext;
  getStorage: () => Promise<GuideAssetObjectStorage>;
  createId?: () => string;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

/** 이미지 하나는 id마다 내용이 바뀌지 않는다. 공유 cache에는 남기지 않고 브라우저에서만 하루 재사용한다. */
const ASSET_CACHE_CONTROL = "private, max-age=86400";

function reply(status: number, body?: unknown): Response {
  if (body === undefined) return new Response(null, { status, headers: NO_STORE_HEADERS });
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

/** cookie 인증 POST이므로 같은 출처에서 보낸 요청만 받는다(CSRF 방지). */
function isSameOriginRequest(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  if (origin !== null) return origin === requestOrigin;
  return fetchSite === "same-origin";
}

async function readBodyWithLimit(
  body: ReadableStream<Uint8Array>,
  expectedLength: number,
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const bytes = new Uint8Array(expectedLength);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > expectedLength) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    bytes.set(value, offset);
    offset += value.byteLength;
  }
  return offset === expectedLength ? bytes : null;
}

export async function handleGuideAssetUpload(
  request: Request,
  deps: GuideAssetDeps,
): Promise<Response> {
  const session = await deps.getSession();
  if (!session) return reply(401);
  if (session.user.role !== "admin") return reply(403);
  if (!isSameOriginRequest(request)) return reply(403);

  const rawLength = request.headers.get("content-length");
  const length = rawLength && /^\d{1,9}$/u.test(rawLength) ? Number(rawLength) : null;
  if (length === null) return reply(411);
  if (length < 1 || length > GUIDE_ASSET_MAX_BYTES) return reply(413);
  if (!request.body) return reply(400);

  const bytes = await readBodyWithLimit(request.body, length);
  if (!bytes) return reply(400);
  const sniffed = sniffImageMimeType(bytes.subarray(0, IMAGE_SIGNATURE_BYTES));
  const declared = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!sniffed || (declared && declared !== sniffed)) return reply(415);

  const id = (deps.createId ?? (() => crypto.randomUUID()))();
  if (!parseGuideAssetId(id)) return reply(500);
  const objectKey = `guide/${id}`;
  try {
    const storage = await deps.getStorage();
    await storage.put(objectKey, bytes, sniffed);
    await asDocumentReadDb(deps.getContext()).insert(guideAssets).values({
      id,
      objectKey,
      contentType: sniffed as GuideAssetContentType,
      sizeBytes: bytes.byteLength,
      guidePageId: null,
      uploadedById: session.user.id,
    });
  } catch {
    return reply(502);
  }
  return reply(201, { id, url: guideAssetPath(id), contentType: sniffed });
}

export async function handleGuideAssetGet(
  rawAssetId: string,
  deps: Omit<GuideAssetDeps, "createId">,
): Promise<Response> {
  const session = await deps.getSession();
  if (!session) return reply(401);
  const assetId = parseGuideAssetId(rawAssetId);
  if (!assetId) return reply(404);

  const [asset] = await asDocumentReadDb(deps.getContext())
    .select({
      objectKey: guideAssets.objectKey,
      contentType: guideAssets.contentType,
      sizeBytes: guideAssets.sizeBytes,
    })
    .from(guideAssets)
    .where(eq(guideAssets.id, assetId))
    .limit(1);
  if (!asset) return reply(404);

  const object = await (await deps.getStorage()).get(asset.objectKey);
  if (!object) return reply(404);
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(object.size || asset.sizeBytes),
      "Cache-Control": ASSET_CACHE_CONTROL,
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
