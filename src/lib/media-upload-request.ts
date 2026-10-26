import { DOCUMENT_IMAGE_MIME_TYPES } from "@/lib/media-lifecycle";

/** Worker 업로드 route가 body를 받기 전에 확인하는 D1 row의 필요한 부분이다. */
export type MediaUploadTarget = {
  purpose: string;
  state: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  uploadExpiresAt: Date;
};

export type MediaUploadRequestHeaders = {
  contentType: string | null;
  contentLength: string | null;
  origin: string | null;
  secFetchSite: string | null;
};

export type MediaUploadRequestDecision =
  | { ok: true; sniffImage: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409 | 410 | 411 | 413 | 415 };

function sameOrigin(
  headers: MediaUploadRequestHeaders,
  requestOrigin: string,
): boolean {
  if (headers.secFetchSite && !["same-origin", "none"].includes(headers.secFetchSite)) {
    return false;
  }
  return headers.origin === null || headers.origin === requestOrigin;
}

function normalizedContentType(value: string | null): string | null {
  if (!value) return null;
  return value.split(";", 1)[0]!.trim().toLowerCase() || null;
}

/** 소유자 확인을 마친 upload intent에 이 PUT 요청을 받아도 되는지 판정한다. */
export function evaluateMediaUploadRequest(input: {
  target: MediaUploadTarget | null;
  headers: MediaUploadRequestHeaders;
  requestOrigin: string;
  now: Date;
}): MediaUploadRequestDecision {
  if (!sameOrigin(input.headers, input.requestOrigin)) {
    return { ok: false, status: 403 };
  }
  const target = input.target;
  if (!target) return { ok: false, status: 404 };
  if (target.state !== "PENDING_UPLOAD") return { ok: false, status: 409 };
  if (target.uploadExpiresAt.getTime() <= input.now.getTime()) {
    return { ok: false, status: 410 };
  }
  if (normalizedContentType(input.headers.contentType) !== target.expectedContentType) {
    return { ok: false, status: 415 };
  }
  const rawLength = input.headers.contentLength;
  if (rawLength === null) return { ok: false, status: 411 };
  if (!/^\d+$/u.test(rawLength)) return { ok: false, status: 400 };
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length !== target.expectedSizeBytes) {
    return { ok: false, status: length > target.expectedSizeBytes ? 413 : 400 };
  }
  return {
    ok: true,
    sniffImage: (DOCUMENT_IMAGE_MIME_TYPES as readonly string[]).includes(
      target.expectedContentType,
    ),
  };
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** 본문에 들어갈 raster image의 실제 형식을 첫 bytes로 판정한다. SVG 등은 null이다. */
export function sniffImageMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

/** 형식 판정에 필요한 bytes 수. WebP가 가장 길다(12 bytes). */
export const IMAGE_SIGNATURE_BYTES = 16;

/**
 * stream 앞부분만 읽어 돌려주고, 읽은 부분을 다시 앞에 붙인 같은 내용의 stream을 만든다.
 * 큰 첨부도 전체를 메모리에 올리지 않고 형식을 확인할 수 있다.
 */
export async function peekStreamPrefix(
  body: ReadableStream<Uint8Array>,
  prefixLength: number,
): Promise<{ prefix: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let collected = 0;
  while (collected < prefixLength) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.byteLength === 0) continue;
    chunks.push(value);
    collected += value.byteLength;
  }
  const prefix = new Uint8Array(Math.min(collected, prefixLength));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= prefix.byteLength) break;
    const part = chunk.subarray(0, prefix.byteLength - offset);
    prefix.set(part, offset);
    offset += part.byteLength;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { prefix, stream };
}
