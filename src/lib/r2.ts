import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  isManagedFinalMediaObjectKey,
  isManagedMediaObjectKey,
  isManagedUploadMediaObjectKey,
} from "@/lib/media-lifecycle";
import type { MediaObjectDeletionStorage } from "@/lib/r2-deletion-storage";

const BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "portal-storage";

function createR2Client(): S3Client {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 업로드 자격 증명이 설정되지 않았습니다.");
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

function assertManagedFinalObjectKey(objectKey: string): void {
  if (!isManagedFinalMediaObjectKey(objectKey)) {
    throw new Error("관리 대상 R2 object key가 올바르지 않습니다.");
  }
}

function assertManagedUploadObjectKey(objectKey: string): void {
  if (!isManagedUploadMediaObjectKey(objectKey)) {
    throw new Error("관리 대상 R2 upload key가 올바르지 않습니다.");
  }
}

function assertManagedObjectKey(objectKey: string): void {
  if (!isManagedMediaObjectKey(objectKey)) {
    throw new Error("관리 대상 R2 object key가 올바르지 않습니다.");
  }
}

export type MediaUploadBody = {
  /** 검증된 요청 body. binding은 길이가 정해진 stream을, S3 fallback은 bytes를 쓴다. */
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
};

export type MediaObjectHead = {
  size: number;
  contentType: string | null;
  etag: string | null;
};

export interface MediaObjectStorage extends MediaObjectDeletionStorage {
  /** 아직 없는 staging key에만 browser가 보낸 body를 저장한다. 이미 있으면 false. */
  putUpload(
    uploadObjectKey: string,
    body: MediaUploadBody,
    signal?: AbortSignal,
  ): Promise<boolean>;
  head(objectKey: string, signal?: AbortSignal): Promise<MediaObjectHead | null>;
  seal(
    uploadObjectKey: string,
    finalObjectKey: string,
    source: MediaObjectHead,
    signal?: AbortSignal,
  ): Promise<MediaObjectHead>;
  delete(objectKey: string, signal?: AbortSignal): Promise<void>;
}

type RuntimeR2Bucket = {
  head(objectKey: string): Promise<{
    size: number;
    httpMetadata?: { contentType?: string };
    httpEtag?: string;
  } | null>;
  get(
    objectKey: string,
    options?: {
      range?: { offset: number; length: number };
      onlyIf?: { etagMatches: string };
    },
  ): Promise<{
    body?: ReadableStream<Uint8Array>;
    size: number;
    httpMetadata?: { contentType?: string };
    httpEtag?: string;
  } | null>;
  put(
    objectKey: string,
    value: ReadableStream<Uint8Array>,
    options?: {
      httpMetadata?: { contentType?: string };
      onlyIf?: Headers;
    },
  ): Promise<{
    size: number;
    httpMetadata?: { contentType?: string };
    httpEtag?: string;
  } | null>;
  delete(objectKey: string): Promise<void>;
};

declare const FixedLengthStream:
  | (new (length: number) => TransformStream<Uint8Array, Uint8Array>)
  | undefined;

/** R2 binding put은 길이를 아는 stream을 요구한다. Workers 밖에서는 그대로 둔다. */
function withKnownLength(
  stream: ReadableStream<Uint8Array>,
  size: number,
): ReadableStream<Uint8Array> {
  if (typeof FixedLengthStream === "undefined") return stream;
  return stream.pipeThrough(new FixedLengthStream(size));
}

function toMediaObjectHead(object: {
  size: number;
  httpMetadata?: { contentType?: string };
  httpEtag?: string;
}): MediaObjectHead {
  return {
    size: object.size,
    contentType: object.httpMetadata?.contentType ?? null,
    etag: object.httpEtag?.replace(/^"|"$/gu, "") ?? null,
  };
}

export type MediaObjectByteRange = {
  offset: number;
  length: number;
};

export type MediaObjectContent = {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string | null;
  etag: string | null;
};

function isNotFoundStorageError(error: unknown): boolean {
  const status =
    typeof error === "object" && error !== null && "$metadata" in error
      ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined;
  return status === 404;
}

function isPreconditionStorageError(error: unknown): boolean {
  const status =
    typeof error === "object" && error !== null && "$metadata" in error
      ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined;
  return status === 412;
}

function toWebReadableStream(body: unknown): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) return body as ReadableStream<Uint8Array>;
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToWebStream" in body &&
    typeof body.transformToWebStream === "function"
  ) {
    return body.transformToWebStream() as ReadableStream<Uint8Array>;
  }
  throw new Error("R2 object body를 Web ReadableStream으로 변환할 수 없습니다.");
}

async function getR2BucketBinding(): Promise<RuntimeR2Bucket | null> {
  if (process.env.NODE_ENV === "development") return null;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const runtimeEnv = getCloudflareContext().env as unknown as {
      BUCKET?: RuntimeR2Bucket;
    };
    return runtimeEnv.BUCKET ?? null;
  } catch {
    return null;
  }
}

async function createBoundOrS3Storage(): Promise<MediaObjectStorage> {
  const bucket = await getR2BucketBinding();
  if (bucket) {
    return {
      async putUpload(uploadObjectKey, body) {
        assertManagedUploadObjectKey(uploadObjectKey);
        // 같은 staging key를 다시 덮어쓰지 못하게 한다. HEAD는 빠른 거절이고,
        // 동시에 들어온 PUT 사이의 원자성은 R2 조건부 쓰기(If-None-Match: *)가 맡는다.
        if (await bucket.head(uploadObjectKey)) return false;
        const stored = await bucket.put(
          uploadObjectKey,
          withKnownLength(body.stream, body.size),
          {
            httpMetadata: { contentType: body.contentType },
            onlyIf: new Headers({ "If-None-Match": "*" }),
          },
        );
        return stored !== null;
      },
      async head(objectKey) {
        assertManagedObjectKey(objectKey);
        const object = await bucket.head(objectKey);
        return object ? toMediaObjectHead(object) : null;
      },
      async seal(uploadObjectKey, finalObjectKey, source) {
        assertManagedUploadObjectKey(uploadObjectKey);
        assertManagedFinalObjectKey(finalObjectKey);
        if (!source.etag) {
          throw new Error("검증할 R2 upload ETag가 없습니다.");
        }
        const uploaded = await bucket.get(uploadObjectKey, {
          onlyIf: { etagMatches: source.etag },
        });
        if (!uploaded?.body) {
          throw new Error("검증한 R2 upload object를 다시 읽지 못했습니다.");
        }
        const sealed = await bucket.put(
          finalObjectKey,
          withKnownLength(uploaded.body, uploaded.size),
          {
            httpMetadata: {
              contentType: source.contentType ?? undefined,
            },
          },
        );
        if (!sealed) {
          throw new Error("R2 final object를 저장하지 못했습니다.");
        }
        return toMediaObjectHead(sealed);
      },
      async delete(objectKey) {
        assertManagedObjectKey(objectKey);
        await bucket.delete(objectKey);
      },
    };
  }

  const client = createR2Client();
  return {
    async putUpload(uploadObjectKey, body, signal) {
      assertManagedUploadObjectKey(uploadObjectKey);
      const bytes = new Uint8Array(await new Response(body.stream).arrayBuffer());
      if (bytes.byteLength !== body.size) {
        throw new Error("업로드 body 크기가 요청과 다릅니다.");
      }
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: uploadObjectKey,
            Body: bytes,
            ContentType: body.contentType,
            ContentLength: body.size,
            IfNoneMatch: "*",
          }),
          { abortSignal: signal },
        );
        return true;
      } catch (error: unknown) {
        if (isPreconditionStorageError(error)) return false;
        throw error;
      }
    },
    async head(objectKey, signal) {
      assertManagedObjectKey(objectKey);
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey }),
          { abortSignal: signal },
        );
        return {
          size: result.ContentLength ?? 0,
          contentType: result.ContentType ?? null,
          etag: result.ETag?.replace(/^"|"$/gu, "") ?? null,
        };
      } catch (error: unknown) {
        if (isNotFoundStorageError(error)) return null;
        throw error;
      }
    },
    async seal(uploadObjectKey, finalObjectKey, source, signal) {
      return sealR2Object(
        uploadObjectKey,
        finalObjectKey,
        source,
        client,
        signal,
      );
    },
    async delete(objectKey, signal) {
      assertManagedObjectKey(objectKey);
      await client.send(
        new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey }),
        { abortSignal: signal },
      );
    },
  };
}

async function sealR2Object(
  uploadObjectKey: string,
  finalObjectKey: string,
  source: MediaObjectHead,
  client = createR2Client(),
  signal?: AbortSignal,
): Promise<MediaObjectHead> {
  assertManagedUploadObjectKey(uploadObjectKey);
  assertManagedFinalObjectKey(finalObjectKey);
  if (!source.etag) {
    throw new Error("검증할 R2 upload ETag가 없습니다.");
  }
  await client.send(
    new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      Key: finalObjectKey,
      CopySource: `${BUCKET_NAME}/${uploadObjectKey}`,
      CopySourceIfMatch: `"${source.etag.replace(/^"|"$/gu, "")}"`,
      ContentType: source.contentType ?? undefined,
      MetadataDirective: "REPLACE",
    }),
    { abortSignal: signal },
  );
  const result = await client.send(
    new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: finalObjectKey }),
    { abortSignal: signal },
  );
  return {
    size: result.ContentLength ?? 0,
    contentType: result.ContentType ?? null,
    etag: result.ETag?.replace(/^"|"$/gu, "") ?? null,
  };
}

/** 인증된 애플리케이션 delivery route가 object body를 읽을 때만 사용한다. */
export async function getR2ObjectContent(
  objectKey: string,
  range?: MediaObjectByteRange,
  expectedEtag?: string,
): Promise<MediaObjectContent | null> {
  assertManagedFinalObjectKey(objectKey);
  if (
    range &&
    (!Number.isSafeInteger(range.offset) ||
      !Number.isSafeInteger(range.length) ||
      range.offset < 0 ||
      range.length < 1)
  ) {
    throw new Error("R2 byte range가 올바르지 않습니다.");
  }

  const bucket = await getR2BucketBinding();
  if (bucket) {
    const object = await bucket.get(objectKey, {
      ...(range ? { range } : {}),
      ...(expectedEtag ? { onlyIf: { etagMatches: expectedEtag } } : {}),
    });
    if (!object?.body) return null;
    const etag = object.httpEtag?.replace(/^"|"$/gu, "") ?? null;
    if (expectedEtag && etag !== expectedEtag) return null;
    return {
      body: object.body,
      size: range?.length ?? object.size,
      contentType: object.httpMetadata?.contentType ?? null,
      etag,
    };
  }

  const client = createR2Client();
  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: objectKey,
        Range: range
          ? `bytes=${range.offset}-${range.offset + range.length - 1}`
          : undefined,
        IfMatch: expectedEtag ? `"${expectedEtag.replace(/^"|"$/gu, "")}"` : undefined,
      }),
    );
    if (!result.Body) return null;
    const etag = result.ETag?.replace(/^"|"$/gu, "") ?? null;
    if (expectedEtag && etag !== expectedEtag) return null;
    return {
      body: toWebReadableStream(result.Body),
      size: result.ContentLength ?? range?.length ?? 0,
      contentType: result.ContentType ?? null,
      etag,
    };
  } catch (error: unknown) {
    if (isNotFoundStorageError(error) || isPreconditionStorageError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getMediaObjectStorage(): Promise<MediaObjectStorage> {
  return createBoundOrS3Storage();
}

export async function headR2Object(objectKey: string): Promise<MediaObjectHead | null> {
  return (await getMediaObjectStorage()).head(objectKey);
}

export async function deleteR2Object(objectKey: string): Promise<void> {
  await (await getMediaObjectStorage()).delete(objectKey);
}

const GUIDE_ASSET_OBJECT_KEY_PATTERN =
  /^guide\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function assertGuideAssetObjectKey(objectKey: string): void {
  if (!GUIDE_ASSET_OBJECT_KEY_PATTERN.test(objectKey)) {
    throw new Error("가이드 이미지 R2 object key가 올바르지 않습니다.");
  }
}

/** 공용 가이드 이미지 저장소. 학생 media 수명주기와 분리된 `guide/<id>` key만 다룬다. */
export interface GuideAssetObjectStorage {
  put(objectKey: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(objectKey: string): Promise<{ body: ReadableStream<Uint8Array>; size: number; contentType: string | null } | null>;
}

export async function getGuideAssetStorage(): Promise<GuideAssetObjectStorage> {
  const bucket = await getR2BucketBinding();
  if (bucket) {
    return {
      async put(objectKey, bytes, contentType) {
        assertGuideAssetObjectKey(objectKey);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
        const stored = await bucket.put(objectKey, withKnownLength(stream, bytes.byteLength), {
          httpMetadata: { contentType },
        });
        if (!stored) throw new Error("가이드 이미지를 저장하지 못했습니다.");
      },
      async get(objectKey) {
        assertGuideAssetObjectKey(objectKey);
        const object = await bucket.get(objectKey);
        if (!object?.body) return null;
        return { body: object.body, size: object.size, contentType: object.httpMetadata?.contentType ?? null };
      },
    };
  }

  const client = createR2Client();
  return {
    async put(objectKey, bytes, contentType) {
      assertGuideAssetObjectKey(objectKey);
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: objectKey,
          Body: bytes,
          ContentType: contentType,
          ContentLength: bytes.byteLength,
        }),
      );
    },
    async get(objectKey) {
      assertGuideAssetObjectKey(objectKey);
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey }));
        if (!result.Body) return null;
        return {
          body: toWebReadableStream(result.Body),
          size: result.ContentLength ?? 0,
          contentType: result.ContentType ?? null,
        };
      } catch (error: unknown) {
        if (isNotFoundStorageError(error)) return null;
        throw error;
      }
    },
  };
}
