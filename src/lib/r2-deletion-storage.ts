import { isManagedMediaObjectKey } from "@/lib/media-lifecycle";

export interface MediaObjectDeletionStorage {
  delete(objectKey: string, signal?: AbortSignal): Promise<void>;
}

export interface RuntimeR2DeletionBucket {
  delete(objectKey: string | string[]): Promise<void>;
}

/** scheduled event에서 request AsyncLocalStorage 없이 native R2 binding을 사용한다. */
export function createR2BindingDeletionStorage(
  bucket: RuntimeR2DeletionBucket,
): MediaObjectDeletionStorage {
  return {
    async delete(objectKey) {
      if (!isManagedMediaObjectKey(objectKey)) {
        throw new Error("관리 대상 R2 object key가 올바르지 않습니다.");
      }
      await bucket.delete(objectKey);
    },
  };
}
