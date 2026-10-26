"use server";

import { createDbContext } from "@/db/client";
import { requireAdmin, requireAuth } from "@/lib/auth-guard";
import {
  completeMediaUpload,
  createMediaUploadIntent,
  enqueueExpiredUnattachedMedia,
  processMediaDeletionOutbox,
  processMediaDeletionOutboxBestEffort,
  queueOwnedMediaDeletion,
} from "@/lib/media-lifecycle-atomic";
import {
  MEDIA_PURPOSE_POLICIES,
  mediaDeliveryPath,
  mediaUploadPath,
  parseMediaUuidV4,
  prepareMediaUploadIntent,
  type MediaUploadInput,
} from "@/lib/media-lifecycle";
import { getMediaObjectStorage } from "@/lib/r2";

export type RequestMediaUploadResult =
  | {
      success: true;
      uploadUrl: string;
      uploadContentType: string;
      mediaObjectId: string;
      deliveryUrl: string;
    }
  | { success: false; error: string };

/** 서버 고정 purpose 정책으로 D1 upload intent를 만들고 same-origin 업로드 경로를 돌려준다. */
export async function requestMediaUpload(
  input: MediaUploadInput,
): Promise<RequestMediaUploadResult> {
  const session = await requireAuth();
  const prepared = prepareMediaUploadIntent(input);
  if (!prepared.ok) return { success: false, error: prepared.message };

  const context = createDbContext();
  const now = new Date();
  const policy = MEDIA_PURPOSE_POLICIES[prepared.intent.purpose];
  const uploadExpiresAt = new Date(
    now.getTime() + policy.uploadUrlTtlSeconds * 1_000,
  );
  const inserted = await createMediaUploadIntent(context, {
    id: prepared.intent.mediaObjectId,
    ownerId: session.user.id,
    purpose: prepared.intent.purpose,
    objectKey: prepared.intent.objectKey,
    uploadObjectKey: prepared.intent.uploadObjectKey,
    expectedContentType: prepared.intent.canonicalMimeType,
    expectedSizeBytes: prepared.intent.expectedSizeBytes,
    draftOperationId: prepared.intent.draftOperationId,
    uploadExpiresAt,
    now,
  });
  if (!inserted) {
    return { success: false, error: "업로드 의도를 안전하게 등록하지 못했습니다." };
  }

  return {
    success: true,
    uploadUrl: mediaUploadPath(prepared.intent.mediaObjectId),
    uploadContentType: prepared.intent.canonicalMimeType,
    mediaObjectId: prepared.intent.mediaObjectId,
    deliveryUrl: mediaDeliveryPath(prepared.intent.mediaObjectId),
  };
}

export type CompleteMediaUploadActionResult =
  | { success: true; mediaObjectId: string; deliveryUrl: string }
  | { success: false; error: string };

/** PUT이 끝난 object의 실제 size/MIME을 R2 HEAD로 확인한 뒤 READY로 전이한다. */
export async function completeMediaUploadAction(
  mediaObjectIdInput: string,
): Promise<CompleteMediaUploadActionResult> {
  const session = await requireAuth();
  const mediaObjectId = parseMediaUuidV4(mediaObjectIdInput);
  if (!mediaObjectId) {
    return { success: false, error: "업로드 식별자가 올바르지 않습니다." };
  }

  const context = createDbContext();
  try {
    const storage = await getMediaObjectStorage();
    let result = await completeMediaUpload(context, storage, {
      ownerId: session.user.id,
      mediaObjectId,
      now: new Date(),
    });
    for (
      let retry = 1;
      !result.ok && result.reason === "OBJECT_HEAD_FAILED" && retry <= 2;
      retry += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, retry * 250));
      result = await completeMediaUpload(context, storage, {
        ownerId: session.user.id,
        mediaObjectId,
        now: new Date(),
      });
    }
    if (result.ok) {
      await processMediaDeletionOutboxBestEffort(context, {
        limit: 1,
        enqueueExpired: true,
      });
      return {
        success: true,
        mediaObjectId,
        deliveryUrl: mediaDeliveryPath(mediaObjectId),
      };
    }

    if (
      result.reason === "UPLOAD_EXPIRED" ||
      result.reason === "METADATA_MISMATCH" ||
      result.reason === "OBJECT_SEAL_FAILED" ||
      result.reason === "INTERNAL_INVARIANT_FAILURE" ||
      result.reason === "OBJECT_NOT_FOUND"
    ) {
      await queueOwnedMediaDeletion(context, {
        ownerId: session.user.id,
        mediaObjectId,
        reason: "UPLOAD_VERIFICATION_FAILED",
        now: new Date(),
      });
      await processMediaDeletionOutboxBestEffort(context, { limit: 1 });
    }
    const error =
      result.reason === "METADATA_MISMATCH"
        ? "업로드된 파일 정보가 요청과 일치하지 않습니다."
        : result.reason === "UPLOAD_EXPIRED"
          ? "업로드 시간이 만료되었습니다. 다시 선택해 주세요."
          : result.reason === "OBJECT_HEAD_FAILED"
            ? "저장소 응답을 확인하지 못했습니다. 파일을 다시 선택해 주세요."
            : "업로드 완료를 확인하지 못했습니다.";
    return { success: false, error };
  } catch {
    await queueOwnedMediaDeletion(context, {
      ownerId: session.user.id,
      mediaObjectId,
      reason: "UPLOAD_VERIFICATION_FAILED",
      now: new Date(),
    }).catch(() => false);
    await processMediaDeletionOutboxBestEffort(context, { limit: 1 });
    return { success: false, error: "업로드 완료를 확인하지 못했습니다." };
  }
}

/** 제출하지 않을 READY/PENDING object를 durable 삭제 outbox에 넣는다. */
export async function abandonMediaUpload(mediaObjectIdInput: string): Promise<void> {
  const session = await requireAuth();
  const mediaObjectId = parseMediaUuidV4(mediaObjectIdInput);
  if (!mediaObjectId) return;
  const context = createDbContext();
  const queued = await queueOwnedMediaDeletion(context, {
    ownerId: session.user.id,
    mediaObjectId,
    reason: "ABANDONED_UPLOAD",
    now: new Date(),
  });
  if (queued) await processMediaDeletionOutboxBestEffort(context, { limit: 1 });
}

/** 운영자가 만료 orphan을 enqueue하고 bounded batch로 R2 삭제를 재시도한다. */
export async function processPendingMediaDeletions(limit = 10) {
  await requireAdmin();
  const boundedLimit = Number.isSafeInteger(limit)
    ? Math.min(Math.max(limit, 1), 25)
    : 10;
  const context = createDbContext();
  const now = new Date();
  await enqueueExpiredUnattachedMedia(context, now);
  return processMediaDeletionOutbox(context, await getMediaObjectStorage(), {
    limit: boundedLimit,
  });
}
