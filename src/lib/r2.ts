import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MEDIA_UPLOAD_IF_NONE_MATCH } from "@/lib/media-lifecycle";

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

const MANAGED_FINAL_OBJECT_KEY_PATTERN =
  /^media\/(?:community-post-audio|qna-attachment)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MANAGED_UPLOAD_OBJECT_KEY_PATTERN =
  /^media-upload\/(?:community-post-audio|qna-attachment)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function assertManagedFinalObjectKey(objectKey: string): void {
  if (!MANAGED_FINAL_OBJECT_KEY_PATTERN.test(objectKey)) {
    throw new Error("관리 대상 R2 object key가 올바르지 않습니다.");
  }
}

function assertManagedUploadObjectKey(objectKey: string): void {
  if (!MANAGED_UPLOAD_OBJECT_KEY_PATTERN.test(objectKey)) {
    throw new Error("관리 대상 R2 upload key가 올바르지 않습니다.");
  }
}

function assertManagedObjectKey(objectKey: string): void {
  if (
    !MANAGED_FINAL_OBJECT_KEY_PATTERN.test(objectKey) &&
    !MANAGED_UPLOAD_OBJECT_KEY_PATTERN.test(objectKey)
  ) {
    throw new Error("관리 대상 R2 object key가 올바르지 않습니다.");
  }
}

export type PresignedUploadRequest = {
  uploadObjectKey: string;
  mimeType: string;
  fileSize: number;
  expiresIn: number;
};

export type PresignedUploadResult = {
  uploadUrl: string;
  key: string;
};

/** 검증된 서버 정책과 opaque key만 받아 PUT presign을 생성한다. */
export async function generatePresignedUploadUrl(
  request: PresignedUploadRequest,
): Promise<PresignedUploadResult> {
  assertManagedUploadObjectKey(request.uploadObjectKey);
  if (!Number.isSafeInteger(request.fileSize) || request.fileSize <= 0) {
    throw new Error("파일 크기가 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(request.expiresIn) || request.expiresIn <= 0) {
    throw new Error("업로드 URL 만료 시간이 올바르지 않습니다.");
  }

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: request.uploadObjectKey,
    ContentType: request.mimeType,
    ContentLength: request.fileSize,
    // 같은 presigned URL로 이미 검증·첨부된 object를 덮어쓰지 못하게 한다.
    IfNoneMatch: MEDIA_UPLOAD_IF_NONE_MATCH,
  });
  const uploadUrl = await getSignedUrl(createR2Client(), command, {
    expiresIn: request.expiresIn,
  });

  return {
    uploadUrl,
    key: request.uploadObjectKey,
  };
}

export type MediaObjectHead = {
  size: number;
  contentType: string | null;
  etag: string | null;
};

export interface MediaObjectStorage {
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
  delete(objectKey: string): Promise<void>;
};

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
      async head(objectKey) {
        assertManagedObjectKey(objectKey);
        const object = await bucket.head(objectKey);
        if (!object) return null;
        return {
          size: object.size,
          contentType: object.httpMetadata?.contentType ?? null,
          etag: object.httpEtag?.replace(/^"|"$/gu, "") ?? null,
        };
      },
      async seal(uploadObjectKey, finalObjectKey, source, signal) {
        return sealR2Object(
          uploadObjectKey,
          finalObjectKey,
          source,
          createR2Client(),
          signal,
        );
      },
      async delete(objectKey) {
        assertManagedObjectKey(objectKey);
        await bucket.delete(objectKey);
      },
    };
  }

  const client = createR2Client();
  return {
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
